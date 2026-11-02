import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { availableParallelism } from 'node:os';
import type { Client, ClientOptions } from './client.js';
import { Collection } from './collection.js';

export const SHARD_ID_ENV = 'OPENCORD_SHARD_ID';
export const SHARD_COUNT_ENV = 'OPENCORD_SHARD_COUNT';

/** FNV-1a de 32 bits: estável entre processos, usada para dividir os servidores entre shards. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** shard de um servidor (`fnv1a(id) % count`) */
export function shardIdForGuild(guildId: string, shardCount: number): number {
  return shardCount <= 1 ? 0 : fnv1a(guildId) % shardCount;
}

function parseInt_(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Resolve `shardId`/`shardCount` das opções do Client ou do ambiente (`OPENCORD_SHARD_ID`/`_COUNT`). */
export function resolveShardOptions(
  options: Pick<ClientOptions, 'shards' | 'shardCount' | 'shardId'>,
  envId?: string,
  envCount?: string,
): { id: number; count: number } {
  const envI = parseInt_(envId);
  const envC = parseInt_(envCount);
  let count: number | null = typeof options.shardCount === 'number' ? options.shardCount : null;
  let id: number | null = options.shardId ?? null;
  if (Array.isArray(options.shards)) id ??= options.shards[0] ?? null;
  else if (typeof options.shards === 'number') id ??= options.shards;
  if (options.shards === 'auto' || options.shardCount === 'auto') {
    id ??= envI;
    count ??= envC;
  }
  id ??= envI ?? 0;
  count ??= envC ?? (id > 0 ? id + 1 : 1);
  if (count < 1) throw new RangeError('shardCount precisa ser ≥ 1');
  if (id < 0 || id >= count) throw new RangeError(`shardId ${id} fora de 0..${count - 1}`);
  return { id, count };
}

/** `client.shard`: id e total deste processo. */
export class ShardClientUtil {
  constructor(
    readonly client: Client,
    readonly id: number,
    readonly count: number,
  ) {}
  get ids() {
    return [this.id];
  }
  get mode() {
    return 'process' as const;
  }
  /** o servidor é deste shard? */
  inShard(guildId: string) {
    return shardIdForGuild(guildId, this.count) === this.id;
  }
  /** manda uma mensagem ao `ShardingManager` (`shard.on('message')`) */
  send(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!process.send) {
        reject(new Error('este processo não foi criado pelo ShardingManager'));
        return;
      }
      process.send(message as Serializable, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }
  /** não há avaliação remota: cada shard é um processo comum; use `send()` e `shard.on('message')` */
  broadcastEval(): never {
    throw new Error('broadcastEval não existe: troque mensagens com shard.send() e ShardingManager/Shard "message"');
  }
}

export interface ShardEvents {
  spawn: [process: ChildProcess];
  death: [process: ChildProcess];
  message: [message: unknown];
  error: [error: Error];
  ready: [];
}

/** Um processo do bot criado pelo `ShardingManager`. */
export class Shard extends EventEmitter<ShardEvents> {
  process: ChildProcess | null = null;
  ready = false;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  constructor(
    readonly manager: ShardingManager,
    readonly id: number,
  ) {
    super();
  }

  get env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.manager.options.env,
      [SHARD_ID_ENV]: String(this.id),
      [SHARD_COUNT_ENV]: String(this.manager.totalShards),
    };
  }

  /** inicia o processo (`node arquivo`, com `OPENCORD_SHARD_ID`/`OPENCORD_SHARD_COUNT` no ambiente) */
  spawn(): ChildProcess {
    if (this.process) throw new Error(`shard ${this.id} já está rodando`);
    this.stopping = false;
    const child = fork(this.manager.file, this.manager.options.shardArgs ?? [], {
      env: this.env,
      execArgv: this.manager.options.execArgv ?? process.execArgv,
      stdio: this.manager.options.silent ? 'ignore' : 'inherit',
    });
    this.process = child;
    child.on('message', (m) => {
      if (m && typeof m === 'object' && '_ready' in m) {
        this.ready = true;
        this.emit('ready');
      }
      this.emit('message', m);
    });
    child.on('error', (e) => this.emit('error', e));
    child.once('exit', () => {
      this.process = null;
      this.ready = false;
      this.emit('death', child);
      if (!this.stopping && this.manager.options.respawn) {
        this.respawnTimer = setTimeout(() => {
          this.respawnTimer = null;
          try {
            this.spawn();
          } catch (e) {
            this.emit('error', e instanceof Error ? e : new Error(String(e)));
          }
        }, this.manager.options.respawnDelay);
        this.respawnTimer.unref?.();
      }
    });
    this.emit('spawn', child);
    return child;
  }
  /** encerra sem reiniciar */
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.stopping = true;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    this.process?.kill(signal);
  }
  /** encerra e inicia de novo */
  respawn(): ChildProcess {
    const p = this.process;
    this.stopping = true;
    if (p) {
      p.kill('SIGTERM');
      this.process = null;
    }
    return this.spawn();
  }
  send(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error(`shard ${this.id} não está rodando`));
        return;
      }
      this.process.send(message as Serializable, (err) => (err ? reject(err) : resolve()));
    });
  }
}

export interface ShardingManagerOptions {
  /** quantos processos; `'auto'` = núcleos disponíveis */
  totalShards?: number | 'auto';
  /** reiniciar o shard que cair (padrão true) */
  respawn?: boolean;
  /** espera antes de reiniciar (ms; padrão 5000) */
  respawnDelay?: number;
  /** argumentos para o arquivo do bot */
  shardArgs?: string[];
  execArgv?: string[];
  env?: Record<string, string>;
  /** aceito e ignorado: o token vai no ambiente do bot (`OPENCORD_TOKEN`) */
  token?: string;
  /** não herdar stdout/stderr dos shards */
  silent?: boolean;
  /** aceito e ignorado (só há o modo processo) */
  mode?: 'process' | 'worker';
}

export interface ShardingManagerEvents {
  shardCreate: [shard: Shard];
}

/**
 * Divide os **servidores** entre N processos do mesmo arquivo: cada processo conecta ao gateway, mas o `Client`
 * só trata eventos dos servidores em que `fnv1a(guildId) % shardCount === shardId` (DMs ficam no shard 0). A API
 * continua uma só; é uma forma de espalhar CPU de um bot grande, não sharding de gateway.
 */
export class ShardingManager extends EventEmitter<ShardingManagerEvents> {
  readonly shards = new Collection<number, Shard>();
  readonly totalShards: number;
  readonly options: Required<Pick<ShardingManagerOptions, 'respawn' | 'respawnDelay'>> & ShardingManagerOptions;

  constructor(
    readonly file: string,
    options: ShardingManagerOptions = {},
  ) {
    super();
    if (!file) throw new Error('ShardingManager: informe o arquivo do bot');
    const total = options.totalShards ?? 'auto';
    this.totalShards = total === 'auto' ? Math.max(1, availableParallelism()) : total;
    if (!Number.isInteger(this.totalShards) || this.totalShards < 1)
      throw new RangeError('totalShards precisa ser ≥ 1');
    this.options = { respawn: true, respawnDelay: 5000, ...options };
  }

  /** cria um shard sem iniciar */
  createShard(id = this.shards.size): Shard {
    if (this.shards.has(id)) throw new Error(`shard ${id} já existe`);
    const shard = new Shard(this, id);
    this.shards.set(id, shard);
    this.emit('shardCreate', shard);
    return shard;
  }

  /** inicia todos os shards, com `delay` ms entre um e outro */
  async spawn(options: { amount?: number; delay?: number } = {}): Promise<Collection<number, Shard>> {
    const amount = options.amount ?? this.totalShards;
    for (let id = 0; id < amount; id++) {
      const shard = this.shards.get(id) ?? this.createShard(id);
      shard.spawn();
      if (options.delay && id < amount - 1) await new Promise((r) => setTimeout(r, options.delay));
    }
    return this.shards;
  }
  async respawnAll(options: { shardDelay?: number } = {}): Promise<Collection<number, Shard>> {
    for (const shard of this.shards.values()) {
      shard.respawn();
      if (options.shardDelay) await new Promise((r) => setTimeout(r, options.shardDelay));
    }
    return this.shards;
  }
  /** encerra todos sem reiniciar */
  killAll(signal: NodeJS.Signals = 'SIGTERM') {
    for (const shard of this.shards.values()) shard.kill(signal);
  }
  /** manda a mesma mensagem a todos os shards */
  broadcast(message: unknown): Promise<void[]> {
    return Promise.all([...this.shards.values()].map((s) => s.send(message)));
  }
  broadcastEval(): never {
    throw new Error('broadcastEval não existe: troque mensagens com broadcast() e shard.on("message")');
  }
}

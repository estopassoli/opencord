import { EventEmitter } from 'node:events';
import type { Client } from './client.js';
import { Collection } from './collection.js';
import { InteractionType, type ComponentTypeValue } from './constants.js';
import type { Channel } from './structures/channel.js';
import type { Interaction, MessageComponentInteraction } from './structures/interaction.js';
import type { Message, PartialMessage } from './structures/message.js';

/** Erro de `awaitMessageComponent`/`awaitMessages`/`awaitModalSubmit`: `code` é a razão (`time`, `idle`…). */
export class CollectorError extends Error {
  constructor(
    readonly code: string,
    what = 'Collector',
  ) {
    super(`${what} received no items before ending with reason: ${code}`);
    this.name = 'CollectorError';
  }
}

export interface CollectorOptions<V> {
  filter?: (item: V) => boolean | Promise<boolean>;
  /** tempo total (ms) */
  time?: number;
  /** encerra se ficar este tempo (ms) sem coletar */
  idle?: number;
  /** quantos itens coletar antes de encerrar (razão `limit`) */
  max?: number;
  /** quantos itens avaliar (coletados ou não) antes de encerrar (razão `processedLimit`) */
  maxProcessed?: number;
  dispose?: boolean;
}

export interface CollectorEvents<K, V> {
  collect: [item: V];
  ignore: [item: V];
  dispose: [item: V];
  end: [collected: Collection<K, V>, reason: string];
}

/** Base dos coletores: filtro, prazo, limite, `stop()`, evento `end(collected, reason)`. */
export abstract class Collector<K, V> extends EventEmitter<CollectorEvents<K, V>> {
  readonly collected = new Collection<K, V>();
  ended = false;
  endReason: string | null = null;
  received = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  protected readonly filter: (item: V) => boolean | Promise<boolean>;

  constructor(
    readonly client: Client,
    readonly options: CollectorOptions<V>,
  ) {
    super();
    this.filter = options.filter ?? (() => true);
    if (options.time) this.timeout = setTimeout(() => this.stop('time'), options.time);
    if (options.idle) this.idleTimeout = setTimeout(() => this.stop('idle'), options.idle);
  }

  /** chave do item, ou null para não coletar (sem contar como ignorado) */
  protected abstract collectKey(item: V): K | null;
  protected abstract listen(): void;
  protected abstract unlisten(): void;

  /** avalia um item vindo do gateway */
  async handleCollect(item: V): Promise<void> {
    if (this.ended) return;
    const key = this.collectKey(item);
    if (key === null) return;
    this.received++;
    try {
      if (await this.filter(item)) {
        this.collected.set(key, item);
        this.emit('collect', item);
        if (this.idleTimeout) {
          clearTimeout(this.idleTimeout);
          this.idleTimeout = setTimeout(() => this.stop('idle'), this.options.idle);
        }
      } else this.emit('ignore', item);
    } catch (e) {
      this.client.emit('debug', `filtro do coletor lançou: ${String(e)}`);
      this.emit('ignore', item);
    }
    this.checkEnd();
  }

  checkEnd(): boolean {
    const reason = this.endReasonNow();
    if (reason) this.stop(reason);
    return Boolean(reason);
  }
  protected endReasonNow(): string | null {
    if (this.options.max && this.collected.size >= this.options.max) return 'limit';
    if (this.options.maxProcessed && this.received >= this.options.maxProcessed) return 'processedLimit';
    return null;
  }

  stop(reason = 'user'): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    if (this.timeout) clearTimeout(this.timeout);
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    this.timeout = null;
    this.idleTimeout = null;
    this.unlisten();
    this.emit('end', this.collected, reason);
  }
  resetTimer(options: { time?: number; idle?: number } = {}) {
    if (this.timeout) clearTimeout(this.timeout);
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    const time = options.time ?? this.options.time;
    const idle = options.idle ?? this.options.idle;
    this.timeout = time ? setTimeout(() => this.stop('time'), time) : null;
    this.idleTimeout = idle ? setTimeout(() => this.stop('idle'), idle) : null;
  }
  /** promessa do próximo item (rejeita com `CollectorError` se encerrar antes) */
  get next(): Promise<V> {
    return new Promise((resolve, reject) => {
      if (this.ended) {
        reject(new CollectorError(this.endReason ?? 'user'));
        return;
      }
      const onCollect = (item: V) => {
        cleanup();
        resolve(item);
      };
      const onEnd = (_c: Collection<K, V>, reason: string) => {
        cleanup();
        reject(new CollectorError(reason));
      };
      const cleanup = () => {
        this.off('collect', onCollect);
        this.off('end', onEnd);
      };
      this.on('collect', onCollect);
      this.on('end', onEnd);
    });
  }
  /** resolve com o primeiro item; rejeita (`CollectorError`) se encerrar sem coletar */
  awaitOne(): Promise<V> {
    return new Promise((resolve, reject) => {
      this.once('end', (collected, reason) => {
        const first = collected.first();
        if (first !== undefined) resolve(first);
        else reject(new CollectorError(reason, this.constructor.name));
      });
    });
  }
  /** resolve com tudo o que coletou; rejeita se a razão do fim estiver em `errors` (ex.: `['time']`) */
  awaitAll(errors: readonly string[] = []): Promise<Collection<K, V>> {
    return new Promise((resolve, reject) => {
      this.once('end', (collected, reason) => {
        if (errors.includes(reason)) reject(new CollectorError(reason, this.constructor.name));
        else resolve(collected);
      });
    });
  }
  async *[Symbol.asyncIterator](): AsyncIterableIterator<V> {
    const queue: V[] = [];
    let wake: (() => void) | null = null;
    const onCollect = (item: V) => {
      queue.push(item);
      wake?.();
    };
    const onEnd = () => wake?.();
    this.on('collect', onCollect);
    this.on('end', onEnd);
    try {
      while (!this.ended || queue.length) {
        if (queue.length) yield queue.shift() as V;
        else await new Promise<void>((r) => (wake = r));
      }
    } finally {
      this.off('collect', onCollect);
      this.off('end', onEnd);
    }
  }
}

export interface InteractionCollectorOptions<
  T extends Interaction = MessageComponentInteraction,
> extends CollectorOptions<T> {
  /** só este tipo de componente (`ComponentType.Button`…) */
  componentType?: ComponentTypeValue;
  /** `InteractionType.MessageComponent` (padrão quando há `componentType`/`message`), `ModalSubmit`… */
  interactionType?: number;
  /** só cliques nesta mensagem (ou cartão efêmero da interação, via `interactionId`) */
  message?: Message | PartialMessage | { id: string };
  /** só desta interação efêmera (`ephemeralOf`) */
  interactionId?: string;
  channel?: Channel | { id: string };
  guild?: { id: string };
  users?: readonly string[];
}
export type AwaitMessageComponentOptions<T extends Interaction = MessageComponentInteraction> = Omit<
  InteractionCollectorOptions<T>,
  'max' | 'maxProcessed'
>;

/** Coleta interações (`interactionCreate`) com os filtros de mensagem, canal, tipo e componente. */
export class InteractionCollector<T extends Interaction = MessageComponentInteraction> extends Collector<string, T> {
  readonly messageId: string | null;
  readonly interactionId: string | null;
  readonly channelId: string | null;
  readonly guildId: string | null;
  private readonly onInteraction = (i: Interaction) => void this.handleCollect(i as T);
  private readonly onMessageDelete = (m: { id: string }) => {
    if (this.messageId && m.id === this.messageId) this.stop('messageDelete');
  };
  private readonly onMessageDeleteBulk = (ms: Collection<string, Message | PartialMessage>) => {
    if (this.messageId && ms.has(this.messageId)) this.stop('messageDelete');
  };
  private readonly onChannelDelete = (c: { id: string }) => {
    if (this.channelId && c.id === this.channelId) this.stop('channelDelete');
  };
  private readonly onGuildDelete = (g: { id: string }) => {
    if (this.guildId && g.id === this.guildId) this.stop('guildDelete');
  };

  constructor(client: Client, options: InteractionCollectorOptions<T> = {}) {
    super(client, options);
    this.messageId = options.message?.id ?? null;
    this.interactionId = options.interactionId ?? null;
    this.channelId = options.channel?.id ?? null;
    this.guildId = options.guild?.id ?? null;
    this.listen();
  }
  declare readonly options: InteractionCollectorOptions<T>;

  protected collectKey(i: T): string | null {
    const o = this.options;
    const wantType =
      o.interactionType ??
      (o.componentType || this.messageId || this.interactionId ? InteractionType.MessageComponent : null);
    if (wantType !== null && i.type !== wantType) return null;
    if (o.componentType && (!('componentType' in i) || i.componentType !== o.componentType)) return null;
    if (this.messageId || this.interactionId) {
      const msgId = 'message' in i ? (i.message?.id ?? null) : null;
      const eph = 'ephemeralOf' in i ? (i.ephemeralOf ?? null) : null;
      const byMessage = !!this.messageId && msgId === this.messageId;
      const byEphemeral = !!this.interactionId && eph === this.interactionId;
      if (!byMessage && !byEphemeral) return null;
    }
    if (this.channelId && i.channelId !== this.channelId) return null;
    if (this.guildId && i.guildId !== this.guildId) return null;
    if (o.users && !o.users.includes(i.user.id)) return null;
    return i.id;
  }
  protected listen() {
    this.client.on('interactionCreate', this.onInteraction);
    this.client.on('messageDelete', this.onMessageDelete);
    this.client.on('messageDeleteBulk', this.onMessageDeleteBulk);
    this.client.on('channelDelete', this.onChannelDelete);
    this.client.on('guildDelete', this.onGuildDelete);
  }
  protected unlisten() {
    this.client.off('interactionCreate', this.onInteraction);
    this.client.off('messageDelete', this.onMessageDelete);
    this.client.off('messageDeleteBulk', this.onMessageDeleteBulk);
    this.client.off('channelDelete', this.onChannelDelete);
    this.client.off('guildDelete', this.onGuildDelete);
  }
}

export interface MessageCollectorOptions extends CollectorOptions<Message> {
  channel?: Channel | { id: string };
}
export interface AwaitMessagesOptions extends MessageCollectorOptions {
  /** razões de fim que rejeitam a promessa (ex.: `['time']`) */
  errors?: readonly string[];
}

/** Coleta mensagens (`messageCreate`) de um canal ou conversa. */
export class MessageCollector extends Collector<string, Message> {
  readonly channelId: string | null;
  private readonly onMessage = (m: Message) => void this.handleCollect(m);
  private readonly onChannelDelete = (c: { id: string }) => {
    if (this.channelId && c.id === this.channelId) this.stop('channelDelete');
  };
  constructor(client: Client, options: MessageCollectorOptions = {}) {
    super(client, options);
    this.channelId = options.channel?.id ?? null;
    this.listen();
  }
  protected collectKey(m: Message): string | null {
    if (this.channelId && m.channelId !== this.channelId && m.conversationId !== this.channelId) return null;
    return m.id;
  }
  protected listen() {
    this.client.on('messageCreate', this.onMessage);
    this.client.on('channelDelete', this.onChannelDelete);
  }
  protected unlisten() {
    this.client.off('messageCreate', this.onMessage);
    this.client.off('channelDelete', this.onChannelDelete);
  }
}

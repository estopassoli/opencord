import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ShardingManager, fnv1a, resolveShardOptions, shardIdForGuild } from '../src/index.js';
import {
  BOT_ID,
  CHANNEL_ID,
  CONV_ID,
  SERVER2_ID,
  SERVER_ID,
  channelDto,
  interactionDto,
  messageDto,
  serverDetail,
  serverSummary,
  setup,
} from './helpers.js';

describe('sharding', () => {
  it('fnv1a é estável e divide os servidores; resolveShardOptions lê opções e ambiente', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a(SERVER_ID)).toBe(fnv1a(SERVER_ID));
    expect(shardIdForGuild(SERVER_ID, 1)).toBe(0);
    expect(shardIdForGuild(SERVER_ID, 2)).not.toBe(shardIdForGuild(SERVER2_ID, 2));
    expect(resolveShardOptions({})).toEqual({ id: 0, count: 1 });
    expect(resolveShardOptions({ shardId: 1, shardCount: 3 })).toEqual({ id: 1, count: 3 });
    expect(resolveShardOptions({ shards: 2, shardCount: 4 })).toEqual({ id: 2, count: 4 });
    expect(resolveShardOptions({ shards: 'auto' }, '1', '2')).toEqual({ id: 1, count: 2 });
    expect(resolveShardOptions({}, '1', '2')).toEqual({ id: 1, count: 2 });
    expect(() => resolveShardOptions({ shardId: 2, shardCount: 2 })).toThrow(/fora de/);
  });

  it('Client com shardCount 2 só carrega os servidores do shard e ignora eventos dos outros; DMs no shard 0', async () => {
    const a = shardIdForGuild(SERVER_ID, 2);
    const b = shardIdForGuild(SERVER2_ID, 2);
    expect(a).not.toBe(b);
    const CH2 = '33333333-3333-4333-8333-333333333399';
    const mk = (id: number) =>
      setup({
        shardId: id,
        shardCount: 2,
        guilds: [serverSummary(), serverSummary({ id: SERVER2_ID, name: 'Outro' })],
        details: {
          [SERVER_ID]: serverDetail(),
          [SERVER2_ID]: serverDetail({
            id: SERVER2_ID,
            name: 'Outro',
            channels: [channelDto({ id: CH2, serverId: SERVER2_ID })],
          }),
        },
      });
    const s = mk(a);
    await s.ready();
    expect(s.client.shard?.id).toBe(a);
    expect(s.client.shard?.count).toBe(2);
    expect([...s.client.guilds.cache.keys()]).toEqual([SERVER_ID]);
    expect(s.calls.filter((c) => c.method === 'GET' && /^\/servers\/[^/]+$/.test(c.path)).map((c) => c.path)).toEqual([
      `/servers/${SERVER_ID}`,
    ]);
    const msgs: string[] = [];
    s.client.on('messageCreate', (m) => msgs.push(m.id));
    const inter: string[] = [];
    s.client.on('interactionCreate', (i) => inter.push(i.id));
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555101' }));
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555102', channelId: CH2 }));
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555103', channelId: null, conversationId: CONV_ID }),
    );
    s.socket().fire('interaction:created', interactionDto({ id: '66666666-6666-4666-8666-666666666101' }));
    s.socket().fire(
      'interaction:created',
      interactionDto({ id: '66666666-6666-4666-8666-666666666102', serverId: SERVER2_ID, channelId: CH2 }),
    );
    s.socket().fire(
      'channel:created',
      channelDto({ id: '33333333-3333-4333-8333-333333333398', serverId: SERVER2_ID, name: 'fora' }),
    );
    s.socket().fire('server:added', serverSummary({ id: SERVER2_ID, name: 'Outro' }));
    expect(msgs).toEqual(
      a === 0
        ? ['55555555-5555-4555-8555-555555555101', '55555555-5555-4555-8555-555555555103']
        : ['55555555-5555-4555-8555-555555555101'],
    );
    expect(inter).toEqual(['66666666-6666-4666-8666-666666666101']);
    expect(s.client.channels.cache.has('33333333-3333-4333-8333-333333333398')).toBe(false);
    expect(s.client.guilds.cache.has(SERVER2_ID)).toBe(false);
    expect(s.client.inShard(SERVER_ID)).toBe(true);
    expect(s.client.inShard(SERVER2_ID)).toBe(false);
    expect(s.client.shard?.inShard(CHANNEL_ID)).toBe(s.client.inShard(CHANNEL_ID));
    s.client.destroy();

    const t = mk(b);
    await t.ready();
    expect([...t.client.guilds.cache.keys()]).toEqual([SERVER2_ID]);
    t.client.destroy();
    const single = setup();
    await single.ready();
    expect(single.client.shard).toBeNull();
    expect(single.client.guilds.cache.get(SERVER_ID)?.members.me?.id).toBe(BOT_ID);
    single.client.destroy();
  });

  it('ShardingManager cria N processos do arquivo com OPENCORD_SHARD_ID/COUNT no ambiente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocb-shard-'));
    const file = join(dir, 'bot.mjs');
    writeFileSync(
      file,
      "process.send({ _ready: true, id: process.env.OPENCORD_SHARD_ID, count: process.env.OPENCORD_SHARD_COUNT, extra: process.env.EXTRA });\nprocess.on('message', (m) => { if (m === 'bye') process.exit(0); });\n",
    );
    const manager = new ShardingManager(file, { totalShards: 2, respawn: false, env: { EXTRA: 'sim' }, silent: true });
    const created: number[] = [];
    manager.on('shardCreate', (s) => created.push(s.id));
    const reports = new Map<number, unknown>();
    const ready = new Promise<void>((resolve) => {
      manager.on('shardCreate', (shard) =>
        shard.on('message', (m) => {
          reports.set(shard.id, m);
          if (reports.size === 2) resolve();
        }),
      );
    });
    await manager.spawn();
    expect(created).toEqual([0, 1]);
    expect(manager.shards.size).toBe(2);
    await ready;
    expect(reports.get(0)).toEqual({ _ready: true, id: '0', count: '2', extra: 'sim' });
    expect(reports.get(1)).toEqual({ _ready: true, id: '1', count: '2', extra: 'sim' });
    expect(manager.shards.get(0)?.ready).toBe(true);
    const deaths = Promise.all(
      [...manager.shards.values()].map((s) => new Promise<void>((r) => s.once('death', () => r()))),
    );
    await manager.broadcast('bye');
    await deaths;
    expect(manager.shards.get(0)?.process).toBeNull();
    expect(() => manager.broadcastEval()).toThrow(/broadcastEval/);
  }, 20_000);
});

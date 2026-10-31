import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, type Message, type Role, type ServerDetail } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  command,
  connectSocket,
  Http,
  nextEvent,
  noEvent,
  prisma,
  register,
  resetDb,
  rid,
  sleep,
  startApp,
} from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];
const open = async (token: string) => {
  const s = await connectSocket(token);
  sockets.push(s);
  return s;
};

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  return { ...b, alice, bob, channelId: channel.id };
}

describe('Socket.IO: autenticação e chat em tempo real (F2.4)', () => {
  it('recusa conexão sem token ou com token inválido', async () => {
    await expect(connectSocket('invalido')).rejects.toThrow(/unauthorized/);
  });

  it('dois clientes trocam mensagens com ACK e broadcast; reenvio idempotente', async () => {
    const { alice, bob, channelId } = await setup();
    const sa = await open(alice.token);
    const sb = await open(bob.token);
    const requestId = rid();
    const got = nextEvent<Message>(sb, 'chat:message:created', (m) => m.channelId === channelId);
    const ack = await command<{ messageId: string; duplicate: boolean }>(sa, 'chat:message:create', {
      requestId,
      channelId,
      body: 'olá bob',
    });
    expect(ack.ok).toBe(true);
    const msg = await got;
    expect(msg.body).toBe('olá bob');
    expect(msg.id).toBe(ack.data?.messageId);
    const again = await command<{ messageId: string; duplicate: boolean }>(sa, 'chat:message:create', {
      requestId,
      channelId,
      body: 'olá bob',
    });
    expect(again.data).toMatchObject({ messageId: msg.id, duplicate: true });
  });

  it('valida payload e permissões nos comandos (sem derrubar o socket)', async () => {
    const { alice, channelId } = await setup();
    const sa = await open(alice.token);
    const bad = await command(sa, 'chat:message:create', { requestId: 'x', channelId, body: 'a' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid' } });
    const other = await bootstrapOwner(http);
    // o outro servidor também é oficial (alice entrou nele ao se cadastrar) e do oficial não se sai pela API:
    // remove direto no banco para que o canal seja de fato alheio
    await prisma.serverMember.deleteMany({ where: { serverId: other.serverId, userId: alice.id } });
    const foreign = await prisma.channel.findFirstOrThrow({ where: { serverId: other.serverId, kind: 'text' } });
    const denied = await command(sa, 'chat:message:create', { requestId: rid(), channelId: foreign.id, body: 'a' });
    expect(denied).toMatchObject({ ok: false, error: { code: '404' } });
    expect(sa.connected).toBe(true);
  });

  it('canal privado: quem não vê o canal não recebe eventos', async () => {
    const { alice, bob, owner, serverId } = await setup();
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    const priv = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'segredo', kind: 'text' },
    });
    await http.req('PATCH', `/channels/${priv.body.id}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'member', subjectId: bob.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    const sb = await open(bob.token);
    const sa = await open(alice.token);
    const aliceGets = nextEvent<Message>(sa, 'chat:message:created', (m) => m.channelId === priv.body.id);
    const bobSilent = noEvent(sb, 'chat:message:created', (p) => (p as Message).channelId === priv.body.id);
    await http.req('POST', `/channels/${priv.body.id}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'confidencial' },
    });
    await aliceGets;
    await bobSilent;
    void everyone;
  });

  it('perder VIEW_CHANNEL com o socket aberto remove o usuário da room imediatamente', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    const sa = await open(alice.token);
    const first = nextEvent<Message>(sa, 'chat:message:created');
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'antes' },
    });
    await first;
    const changed = nextEvent(sa, 'permissions:changed');
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'member', subjectId: alice.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    await changed;
    const silent = noEvent(sa, 'chat:message:created');
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'depois' },
    });
    await silent;
    void serverId;
  });

  it('typing é retransmitido aos outros e não ao remetente', async () => {
    const { alice, bob, channelId } = await setup();
    const sa = await open(alice.token);
    const sb = await open(bob.token);
    const typing = nextEvent<{ userId: string; active: boolean }>(sb, 'chat:typing');
    const selfSilent = noEvent(sa, 'chat:typing', () => true, 500);
    expect((await command(sa, 'chat:typing:start', { channelId })).ok).toBe(true);
    expect(await typing).toMatchObject({ userId: alice.id, active: true });
    await selfSilent;
  });

  it('presença: online ao conectar, offline ao desconectar, invisível aparece offline', async () => {
    const { alice, bob, serverId } = await setup();
    const sb = await open(bob.token);
    const online = nextEvent<{ userId: string; status: string }>(
      sb,
      'presence:changed',
      (p) => p.userId === alice.id && p.status === 'online',
    );
    const sa = await open(alice.token);
    await online;
    const pres = await http.req<Record<string, string>>('GET', `/servers/${serverId}/presence`, { token: bob.token });
    expect(pres.body[alice.id]).toBe('online');
    const invisible = nextEvent<{ userId: string; status: string }>(
      sb,
      'presence:changed',
      (p) => p.userId === alice.id,
    );
    await command(sa, 'presence:heartbeat', { status: 'invisible' });
    expect((await invisible).status).toBe('offline');
    await command(sa, 'presence:heartbeat', { status: 'online' });
    await sleep(100);
    const offline = nextEvent<{ userId: string; status: string }>(
      sb,
      'presence:changed',
      (p) => p.userId === alice.id && p.status === 'offline',
    );
    sa.disconnect();
    await offline;
  });

  it('jogo atual (ADR-0021): outros veem e recebem; invisível esconde; fechar o app apaga', async () => {
    const { alice, bob, serverId } = await setup();
    const sb = await open(bob.token);
    const sa = await open(alice.token);
    await sleep(100);
    const game = { name: 'Path of Exile 2', startedAt: Date.now(), steamAppId: 2694490 };
    const playing = nextEvent<{ userId: string; game: unknown }>(
      sb,
      'presence:game:changed',
      (e) => e.userId === alice.id,
    );
    expect((await command(sa, 'presence:game', { game })).ok).toBe(true);
    expect((await playing).game).toEqual(game);
    const games = await http.req<Record<string, unknown>>('GET', `/servers/${serverId}/games`, { token: bob.token });
    expect(games.body[alice.id]).toEqual(game);
    expect((await command(sa, 'presence:game', { game: { name: '', startedAt: 1 } })).ok).toBe(false);

    // invisível: o jogo some para os outros; voltar mostra de novo
    const hidden = nextEvent<{ userId: string; game: unknown }>(
      sb,
      'presence:game:changed',
      (e) => e.userId === alice.id,
    );
    await command(sa, 'presence:heartbeat', { status: 'invisible' });
    expect((await hidden).game).toBeNull();
    expect(
      (await http.req<Record<string, unknown>>('GET', `/servers/${serverId}/games`, { token: bob.token })).body[
        alice.id
      ],
    ).toBeUndefined();
    const back = nextEvent<{ userId: string; game: unknown }>(
      sb,
      'presence:game:changed',
      (e) => e.userId === alice.id,
    );
    await command(sa, 'presence:heartbeat', { status: 'online' });
    expect((await back).game).toEqual(game);

    // fechou o app: o jogo acaba
    const gone = nextEvent<{ userId: string; game: unknown }>(
      sb,
      'presence:game:changed',
      (e) => e.userId === alice.id,
    );
    sa.disconnect();
    expect((await gone).game).toBeNull();
    const sa2 = await open(alice.token);
    await sleep(100);
    expect(
      (await http.req<Record<string, unknown>>('GET', `/servers/${serverId}/games`, { token: bob.token })).body[
        alice.id
      ],
    ).toBeUndefined();
    sa2.disconnect();
  });

  it('kick: cliente recebe server:removed e deixa de receber eventos do servidor', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    const sa = await open(alice.token);
    const removed = nextEvent<{ serverId: string; reason: string }>(sa, 'server:removed');
    await http.req('DELETE', `/servers/${serverId}/members/${alice.id}`, { token: owner.token });
    expect(await removed).toEqual({ serverId, reason: 'kicked' });
    const silent = noEvent(sa, 'chat:message:created');
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'sem você' },
    });
    await silent;
  });

  it('logout derruba sockets da sessão (session:revoked)', async () => {
    const { alice } = await setup();
    const sa = await open(alice.token);
    const revoked = nextEvent<{ reason: string }>(sa, 'session:revoked');
    const disconnected = new Promise((r) => sa.once('disconnect', r));
    await http.req('POST', '/auth/logout', { token: alice.token });
    expect((await revoked).reason).toBe('logout');
    await disconnected;
  });

  it('sync:resume devolve mensagens perdidas após reconexão', async () => {
    const { alice, owner, channelId } = await setup();
    const m1 = await http.req<Message>('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'm1' },
    });
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'm2' },
    });
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'm3' },
    });
    const sa = await open(alice.token);
    const r = await command<{ missed: Message[]; truncated: boolean }>(sa, 'sync:resume', {
      channels: [{ channelId, lastMessageId: m1.body.id }],
    });
    expect(r.data?.missed.map((m) => m.body)).toEqual(['m2', 'm3']);
    expect(r.data?.truncated).toBe(false);
  });

  it('rate limit por socket', async () => {
    const { alice, channelId } = await setup();
    const sa = await open(alice.token);
    const results = await Promise.all(
      Array.from({ length: 45 }, () => command(sa, 'chat:typing:start', { channelId })),
    );
    expect(results.some((r) => r.error?.code === 'rate_limited')).toBe(true);
  });

  it('quem não pode enviar mensagens não anuncia "digitando"', async () => {
    const { owner, alice, serverId, channelId } = await setup();
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.SEND_MESSAGES }] },
    });
    const sa = await open(alice.token);
    expect((await command(sa, 'chat:typing:start', { channelId })).ok).toBe(false);
    expect((await command(sa, 'chat:typing:stop', { channelId })).ok).toBe(true);
  });
});

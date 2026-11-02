/**
 * Moderação (ADR-0034): banir expulsa, grava o banimento e fecha convite, diretório, admin-join e entrada de bot;
 * desbanir libera; hierarquia (dono e super admin intocáveis, ninguém se pune); castigo bloqueia mensagem, reação,
 * enquete, comando pelo socket e entrada em voz, derruba a voz atual e expira sozinho.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type BotWithToken,
  type Invite,
  type Member,
  type Message,
  type Role,
  type ServerBan,
  type ServerDetail,
  type VoiceJoinResponse,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  command,
  connectSocket,
  Http,
  nextEvent,
  outsider,
  prisma,
  register,
  resetDb,
  rid,
  sleep,
  startApp,
  type Client,
} from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const socket = async (token: string) => {
  const s = await connectSocket(token);
  sockets.push(s);
  return s;
};

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const text = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  const voice = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'voice' } });
  return { ...b, alice, bob, channelId: text.id, voiceId: voice.id };
}

const send = (token: string, channelId: string, body: string) =>
  http.req<Message>('POST', `/channels/${channelId}/messages`, { token, body: { requestId: rid(), body } });

/** dá um cargo novo com os bits pedidos à pessoa (pelo dono) */
async function grant(owner: Client, serverId: string, target: Client, name: string, permissions: number) {
  const role = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
    token: owner.token,
    body: { name, permissions },
  });
  expect(role.status).toBe(201);
  const set = await http.req('PUT', `/servers/${serverId}/members/${target.id}/roles`, {
    token: owner.token,
    body: { roleIds: [role.body.id] },
  });
  expect(set.status).toBe(200);
  return role.body;
}

describe('banimento', () => {
  it('banir expulsa, apaga as mensagens recentes, lista e fecha convite, diretório, admin-join e bot; desbanir libera', async () => {
    const { owner, alice, bob, serverId, channelId } = await setup();
    const old = await send(alice.token, channelId, 'antiga');
    await prisma.message.update({
      where: { id: old.body.id },
      data: { createdAt: new Date(Date.now() - 2 * 3600_000) },
    });
    const recent = await send(alice.token, channelId, 'recente');
    const keep = await send(bob.token, channelId, 'do bob');

    const so = await socket(owner.token);
    const sa = await socket(alice.token);
    const added = nextEvent<ServerBan>(so, 'server:ban:added', (b) => b.user.id === alice.id);
    const removed = nextEvent<{ serverId: string; reason: string }>(sa, 'server:removed');
    const gone = nextEvent<{ messageId: string }>(so, 'chat:message:deleted', (p) => p.messageId === recent.body.id);
    const ban = await http.req<ServerBan>('PUT', `/servers/${serverId}/bans/${alice.id}`, {
      token: owner.token,
      body: { reason: 'spam', deleteMessageSeconds: 3600 },
    });
    expect(ban.status).toBe(200);
    expect(ban.body).toMatchObject({ serverId, reason: 'spam', user: { id: alice.id }, by: { id: owner.id } });
    expect(await added).toMatchObject({ user: { id: alice.id }, reason: 'spam' });
    expect(await removed).toMatchObject({ serverId, reason: 'kicked' });
    await gone;

    // expulsa de verdade e só as mensagens da janela somem (soft delete)
    expect((await http.req('GET', `/servers/${serverId}`, { token: alice.token })).status).toBe(404);
    const rows = await prisma.message.findMany({ where: { id: { in: [old.body.id, recent.body.id, keep.body.id] } } });
    expect(rows.find((m) => m.id === old.body.id)?.deletedAt).toBeNull();
    expect(rows.find((m) => m.id === recent.body.id)?.deletedAt).not.toBeNull();
    expect(rows.find((m) => m.id === keep.body.id)?.deletedAt).toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { serverId, action: 'member.ban', targetId: alice.id } });
    expect(log?.actorId).toBe(owner.id);
    expect(log?.metadata).toMatchObject({ reason: 'spam', deletedMessages: 1 });

    // nenhuma porta abre para o banido
    expect((await http.req('POST', `/servers/${serverId}/join`, { token: alice.token })).status).toBe(403);
    const inv = await http.req<Invite>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    const viaInvite = await http.req<{ message: string }>('POST', `/invites/${inv.body.code}`, { token: alice.token });
    expect(viaInvite.status).toBe(403);
    expect(viaInvite.body.message).toContain('banido');
    expect((await prisma.invite.findUniqueOrThrow({ where: { code: inv.body.code } })).uses).toBe(0);
    await prisma.user.update({ where: { id: alice.id }, data: { isInstanceAdmin: true } });
    expect((await http.req('POST', `/admin/servers/${serverId}/join`, { token: alice.token })).status).toBe(403);
    await prisma.user.update({ where: { id: alice.id }, data: { isInstanceAdmin: false } });

    // lista (BAN_MEMBERS), mais recente primeiro
    const out = await outsider(http);
    expect((await http.req('PUT', `/servers/${serverId}/bans/${out.id}`, { token: owner.token })).status).toBe(200);
    expect((await http.req('GET', `/servers/${serverId}/bans`, { token: bob.token })).status).toBe(403);
    const list = await http.req<ServerBan[]>('GET', `/servers/${serverId}/bans`, { token: owner.token });
    expect(list.status).toBe(200);
    expect(list.body.map((b) => b.user.id)).toEqual([out.id, alice.id]);
    expect(list.body[0]!.reason).toBeNull();
    // quem nunca foi membro também fica de fora do diretório
    expect((await http.req('POST', `/servers/${serverId}/join`, { token: out.token })).status).toBe(403);

    // desbanir: 404 se não estava banido; depois a pessoa volta pelo diretório
    expect((await http.req('DELETE', `/servers/${serverId}/bans/${bob.id}`, { token: owner.token })).status).toBe(404);
    const unbanned = nextEvent<{ userId: string }>(so, 'server:ban:removed', (p) => p.userId === alice.id);
    expect((await http.req('DELETE', `/servers/${serverId}/bans/${alice.id}`, { token: owner.token })).status).toBe(
      204,
    );
    await unbanned;
    expect(await prisma.auditLog.count({ where: { serverId, action: 'member.unban', targetId: alice.id } })).toBe(1);
    expect((await http.req('POST', `/servers/${serverId}/join`, { token: alice.token })).status).toBe(201);
    expect((await http.req<ServerBan[]>('GET', `/servers/${serverId}/bans`, { token: owner.token })).body).toHaveLength(
      1,
    );
  });

  it('bot banido não entra no servidor', async () => {
    const { owner, serverId } = await setup();
    const bot = await http.req<BotWithToken>('POST', '/me/bots', { token: owner.token, body: { name: 'Banido' } });
    expect(bot.status).toBe(201);
    expect(
      (await http.req('PUT', `/servers/${serverId}/bans/${bot.body.user.id}`, { token: owner.token })).status,
    ).toBe(200);
    const add = await http.req<{ message: string }>('POST', `/servers/${serverId}/bots`, {
      token: owner.token,
      body: { botId: bot.body.id },
    });
    expect(add.status).toBe(403);
    expect(add.body.message).toContain('banido');
    expect(await prisma.serverMember.findFirst({ where: { userId: bot.body.user.id } })).toBeNull();
  });

  it('hierarquia: exige BAN_MEMBERS, não bane a si mesmo, nem o dono, nem quem está acima, nem super admin', async () => {
    const { owner, alice, bob, serverId } = await setup();
    expect((await http.req('PUT', `/servers/${serverId}/bans/${bob.id}`, { token: alice.token })).status).toBe(403);
    const modRole = await grant(owner, serverId, alice, 'Mod', Permission.BAN_MEMBERS);
    expect((await http.req('PUT', `/servers/${serverId}/bans/${alice.id}`, { token: alice.token })).status).toBe(400);
    expect((await http.req('PUT', `/servers/${serverId}/bans/${owner.id}`, { token: alice.token })).status).toBe(403);
    // bob ganha um cargo acima do da alice
    const above = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Admin', permissions: 0 },
    });
    expect(above.body.position).toBeGreaterThan(modRole.position);
    await http.req('PUT', `/servers/${serverId}/members/${bob.id}/roles`, {
      token: owner.token,
      body: { roleIds: [above.body.id] },
    });
    expect((await http.req('PUT', `/servers/${serverId}/bans/${bob.id}`, { token: alice.token })).status).toBe(403);
    // super admin da instância: intocável até para o dono, mesmo fora do servidor
    const boss = await register(http);
    await prisma.user.update({ where: { id: boss.id }, data: { isInstanceAdmin: true } });
    expect((await http.req('PUT', `/servers/${serverId}/bans/${boss.id}`, { token: owner.token })).status).toBe(403);
    await prisma.serverMember.deleteMany({ where: { userId: boss.id } });
    expect((await http.req('PUT', `/servers/${serverId}/bans/${boss.id}`, { token: owner.token })).status).toBe(403);
    // usuário inexistente → 404; membro sem cargo → ok
    expect((await http.req('PUT', `/servers/${serverId}/bans/${rid()}`, { token: alice.token })).status).toBe(404);
    const carol = await register(http);
    expect((await http.req('PUT', `/servers/${serverId}/bans/${carol.id}`, { token: alice.token })).status).toBe(200);
    expect((await http.req('GET', `/servers/${serverId}`, { token: carol.token })).status).toBe(404);
    // corpo inválido (mais de 7 dias de mensagens)
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/bans/${bob.id}`, {
          token: owner.token,
          body: { deleteMessageSeconds: 8 * 86400 },
        })
      ).status,
    ).toBe(400);
  });
});

describe('castigo', () => {
  it('bloqueia mensagem (REST e socket), reação, enquete e voz; aparece no membro; tirar e expirar liberam', async () => {
    const { owner, alice, bob, serverId, channelId, voiceId } = await setup();
    const target = await send(bob.token, channelId, 'reaja aqui');
    const sa = await socket(alice.token);
    const so = await socket(owner.token);

    // alice está em voz: o castigo derruba a chamada
    const joined = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    expect(joined.status).toBe(201);
    const left = nextEvent<{ userId: string }>(so, 'voice:member:left', (p) => p.userId === alice.id);
    const forced = nextEvent<{ reason: string }>(sa, 'voice:force-disconnect');
    const updated = nextEvent<{ member: Member }>(so, 'server:member:updated', (p) => p.member.user.id === alice.id);

    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    const r = await http.req<Member>('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: until, reason: 'flood' },
    });
    expect(r.status).toBe(200);
    expect(r.body.timeoutUntil).toBe(until);
    expect((await updated).member.timeoutUntil).toBe(until);
    await left;
    expect((await forced).reason).toBe('revoked');
    const log = await prisma.auditLog.findFirst({ where: { serverId, action: 'member.timeout', targetId: alice.id } });
    expect(log?.metadata).toMatchObject({ until, reason: 'flood' });
    const detail = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: bob.token });
    expect(detail.body.members.find((m) => m.user.id === alice.id)?.timeoutUntil).toBe(until);
    expect(detail.body.members.find((m) => m.user.id === bob.id)?.timeoutUntil).toBeNull();

    // bloqueios, sempre 403 com a data
    const denied = await send(alice.token, channelId, 'oi');
    expect(denied.status).toBe(403);
    expect((denied.body as unknown as { message: string }).message).toBe(`em castigo até ${until}`);
    const viaSocket = await command(sa, 'chat:message:create', { requestId: rid(), channelId, body: 'oi' });
    expect(viaSocket.ok).toBe(false);
    expect(viaSocket.error?.code).toBe('403');
    expect(
      (
        await http.req('PUT', `/messages/${target.body.id}/reactions/${encodeURIComponent('👍')}`, {
          token: alice.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await http.req('POST', `/channels/${channelId}/polls`, {
          token: alice.token,
          body: { requestId: rid(), question: 'pode?', options: ['sim', 'não'] },
        })
      ).status,
    ).toBe(403);
    expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: alice.token })).status).toBe(403);
    // ler e editar o que já escreveu continua livre
    expect((await http.req('GET', `/channels/${channelId}/messages`, { token: alice.token })).status).toBe(200);
    const mine = await prisma.message.create({
      data: { authorId: alice.id, channelId, requestId: rid(), body: 'antes do castigo', mentions: [] },
    });
    expect(
      (await http.req('PATCH', `/messages/${mine.id}`, { token: alice.token, body: { body: 'editada' } })).status,
    ).toBe(200);

    // tirar (null) libera na hora
    const off = await http.req<Member>('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: null },
    });
    expect(off.body.timeoutUntil).toBeNull();
    expect((await send(alice.token, channelId, 'de volta')).status).toBe(201);

    // expira sozinho (prazo curto) e um prazo já passado equivale a tirar
    const soon = new Date(Date.now() + 1200).toISOString();
    await http.req('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: soon },
    });
    expect((await send(alice.token, channelId, 'ainda não')).status).toBe(403);
    await sleep(1400);
    expect((await send(alice.token, channelId, 'agora sim')).status).toBe(201);
    expect(
      (await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: bob.token })).body.members.find(
        (m) => m.user.id === alice.id,
      )?.timeoutUntil,
    ).toBeNull();
    const past = await http.req<Member>('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(past.body.timeoutUntil).toBeNull();
  });

  it('exige MODERATE_MEMBERS e hierarquia; limite de 28 dias; nem a si mesmo, nem dono, nem super admin', async () => {
    const { owner, alice, bob, serverId } = await setup();
    const until = new Date(Date.now() + 60_000).toISOString();
    const patch = (token: string, userId: string, timeoutUntil: string | null = until) =>
      http.req('PATCH', `/servers/${serverId}/members/${userId}`, { token, body: { timeoutUntil } });
    expect((await patch(alice.token, bob.id)).status).toBe(403);
    await grant(owner, serverId, alice, 'Mod', Permission.MODERATE_MEMBERS);
    expect((await patch(alice.token, alice.id)).status).toBe(400);
    expect((await patch(alice.token, owner.id)).status).toBe(403);
    expect((await patch(alice.token, bob.id)).status).toBe(200);
    // super admin intocável, inclusive pelo dono
    const boss = await register(http);
    await prisma.user.update({ where: { id: boss.id }, data: { isInstanceAdmin: true } });
    expect((await patch(owner.token, boss.id)).status).toBe(403);
    // não membro → 404; mais de 28 dias → 400; corpo sem timeoutUntil → 400
    expect((await patch(owner.token, rid())).status).toBe(404);
    expect((await patch(owner.token, bob.id, new Date(Date.now() + 29 * 86_400_000).toISOString())).status).toBe(400);
    expect(
      (await http.req('PATCH', `/servers/${serverId}/members/${bob.id}`, { token: owner.token, body: { reason: 'x' } }))
        .status,
    ).toBe(400);
    // o apelido continua pela rota própria (`/members/me`), que não é a do castigo
    expect(
      (await http.req('PATCH', `/servers/${serverId}/members/me`, { token: bob.token, body: { nickname: 'Bobby' } }))
        .status,
    ).toBe(200);
  });
});

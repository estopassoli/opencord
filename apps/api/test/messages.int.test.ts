import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { UserProfile } from '@opencord/contracts';
import {
  Permission,
  type Message,
  type MessagePage,
  type Role,
  type ServerDetail,
  type UnreadState,
} from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, outsider, prisma, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  const voice = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'voice' } });
  return { ...b, alice, bob, channelId: channel.id, voiceId: voice.id };
}

const send = (token: string, channelId: string, body: string, extra: Record<string, unknown> = {}) =>
  http.req<Message>('POST', `/channels/${channelId}/messages`, { token, body: { requestId: rid(), body, ...extra } });

describe('mensagens (RF-03)', () => {
  it('cria, lista e pagina por cursor sem duplicar nem pular (120 mensagens)', async () => {
    const { alice, channelId } = await setup();
    const sent: string[] = [];
    for (let i = 0; i < 120; i++) sent.push((await send(alice.token, channelId, `m${i}`)).body.id);
    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const q: string = before ? `?limit=50&before=${encodeURIComponent(before)}` : '?limit=50';
      const p: { body: MessagePage } = await http.req<MessagePage>('GET', `/channels/${channelId}/messages${q}`, {
        token: alice.token,
      });
      // cada página em ordem cronológica
      const ids = p.body.messages.map((m) => m.id);
      seen.unshift(...ids);
      before = p.body.nextBefore;
      pages++;
    } while (before && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(sent);
    expect(new Set(seen).size).toBe(120);
  });

  it('cursor "after" retorna mensagens novas em ordem', async () => {
    const { alice, channelId } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await send(alice.token, channelId, `n${i}`)).body.id);
    const first = await http.req<MessagePage>('GET', `/channels/${channelId}/messages?limit=2`, { token: alice.token });
    expect(first.body.messages.map((m) => m.id)).toEqual(ids.slice(3));
    expect(first.body.nextBefore).toBeTruthy();
    expect((await http.req('GET', `/channels/${channelId}/messages?before=lixo`, { token: alice.token })).status).toBe(
      400,
    );
  });

  it('idempotência por requestId: reenvio não duplica', async () => {
    const { alice, channelId } = await setup();
    const requestId = rid();
    const [a, b] = await Promise.all([
      http.req<Message>('POST', `/channels/${channelId}/messages`, {
        token: alice.token,
        body: { requestId, body: 'oi' },
      }),
      http.req<Message>('POST', `/channels/${channelId}/messages`, {
        token: alice.token,
        body: { requestId, body: 'oi' },
      }),
    ]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.message.count({ where: { channelId } })).toBe(1);
  });

  it('edição só pelo autor; deleção pelo autor ou MANAGE_MESSAGES', async () => {
    const { alice, bob, owner, channelId } = await setup();
    const m = await send(alice.token, channelId, 'original');
    expect(
      (await http.req('PATCH', `/messages/${m.body.id}`, { token: bob.token, body: { body: 'hack' } })).status,
    ).toBe(403);
    const e = await http.req<Message>('PATCH', `/messages/${m.body.id}`, {
      token: alice.token,
      body: { body: 'editada' },
    });
    expect(e.body.body).toBe('editada');
    expect(e.body.editedAt).toBeTruthy();
    expect((await http.req('DELETE', `/messages/${m.body.id}`, { token: bob.token })).status).toBe(403);
    expect((await http.req('DELETE', `/messages/${m.body.id}`, { token: owner.token })).status).toBe(204);
    const page = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: alice.token });
    expect(page.body.messages[0]?.deleted).toBe(true);
    expect(page.body.messages[0]?.body).toBe('');
  });

  it('replies no mesmo destino e reações agregadas', async () => {
    const { alice, bob, channelId, serverId, owner } = await setup();
    const parent = await send(alice.token, channelId, 'pergunta');
    const reply = await send(bob.token, channelId, 'resposta', { replyToId: parent.body.id });
    expect(reply.body.replyTo?.id).toBe(parent.body.id);
    expect(reply.body.replyTo?.bodyPreview).toBe('pergunta');
    const other = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'outro', kind: 'text' },
    });
    expect((await send(bob.token, other.body.id, 'x', { replyToId: parent.body.id })).status).toBe(400);

    expect(
      (await http.req('PUT', `/messages/${parent.body.id}/reactions/${encodeURIComponent('👍')}`, { token: bob.token }))
        .status,
    ).toBe(204);
    expect(
      (
        await http.req('PUT', `/messages/${parent.body.id}/reactions/${encodeURIComponent('👍')}`, {
          token: alice.token,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await http.req('PUT', `/messages/${parent.body.id}/reactions/${encodeURIComponent('👍')}`, {
          token: alice.token,
        })
      ).status,
    ).toBe(204);
    const page = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: alice.token });
    const p = page.body.messages.find((m) => m.id === parent.body.id);
    expect(p?.reactions).toEqual([{ emoji: '👍', count: 2, me: true, userIds: [bob.id, alice.id] }]);
    await http.req('DELETE', `/messages/${parent.body.id}/reactions/${encodeURIComponent('👍')}`, {
      token: alice.token,
    });
    const page2 = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: alice.token });
    expect(page2.body.messages.find((m) => m.id === parent.body.id)?.reactions[0]?.count).toBe(1);
  });

  it('negação de SEND_MESSAGES por override é respeitada', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.SEND_MESSAGES }] },
    });
    expect((await send(alice.token, channelId, 'oi')).status).toBe(403);
    expect((await http.req('GET', `/channels/${channelId}/messages`, { token: alice.token })).status).toBe(200);
  });

  it('canal de voz não aceita mensagens; corpo vazio rejeitado; corpo > 4000 rejeitado', async () => {
    const { alice, channelId, voiceId } = await setup();
    expect((await send(alice.token, voiceId, 'oi')).status).toBe(400);
    expect((await send(alice.token, channelId, '   ')).status).toBe(400);
    expect((await send(alice.token, channelId, 'x'.repeat(4001))).status).toBe(400);
  });

  it('menções: só usuários com acesso; @everyone exige MENTION_EVERYONE', async () => {
    const { alice, bob, channelId } = await setup();
    const out = await outsider(http);
    const m = await send(alice.token, channelId, `oi <@${bob.id}> <@${out.id}> @everyone`);
    expect(m.body.mentions).toEqual([bob.id]);
    const row = await prisma.message.findUniqueOrThrow({ where: { id: m.body.id } });
    expect(row.mentionEveryone).toBe(false);
  });

  it('não lidas e menções por canal; marcador de leitura não regride', async () => {
    const { alice, bob, channelId } = await setup();
    const m1 = await send(alice.token, channelId, 'a');
    await send(alice.token, channelId, `b <@${bob.id}>`);
    const m3 = await send(alice.token, channelId, 'c');
    let u = await http.req<UnreadState[]>('GET', '/me/unreads', { token: bob.token });
    let st = u.body.find((s) => s.channelId === channelId);
    expect(st).toMatchObject({ unreadCount: 3, mentionCount: 1, lastMessageId: m3.body.id });
    await http.req('PUT', `/channels/${channelId}/read`, { token: bob.token, body: { messageId: m3.body.id } });
    await http.req('PUT', `/channels/${channelId}/read`, { token: bob.token, body: { messageId: m1.body.id } });
    u = await http.req<UnreadState[]>('GET', '/me/unreads', { token: bob.token });
    st = u.body.find((s) => s.channelId === channelId);
    expect(st).toMatchObject({ unreadCount: 0, mentionCount: 0, lastReadMessageId: m3.body.id });
    // o autor não conta as próprias mensagens
    const ua = await http.req<UnreadState[]>('GET', '/me/unreads', { token: alice.token });
    expect(ua.body.find((s) => s.channelId === channelId)?.unreadCount).toBe(0);
  });
});

describe('amigos, bloqueios e DMs (RF-04)', () => {
  it('pedido, aceite, DM, bloqueio impede DM', async () => {
    const { alice, bob } = await setup();
    const req = await http.req<{ status: string }>('POST', '/friends/requests', {
      token: alice.token,
      body: { username: bob.auth.user.username },
    });
    expect(req.body.status).toBe('pending_outgoing');
    const bobView = await http.req<{ status: string; user: { id: string } }[]>('GET', '/friends', { token: bob.token });
    expect(bobView.body[0]?.status).toBe('pending_incoming');
    expect((await http.req('POST', `/friends/${alice.id}/accept`, { token: bob.token })).status).toBe(201);
    const conv = await http.req<{ id: string; kind: string }>('POST', '/conversations', {
      token: alice.token,
      body: { userIds: [bob.id] },
    });
    expect(conv.body.kind).toBe('dm');
    // abrir de novo retorna a mesma DM
    const again = await http.req<{ id: string }>('POST', '/conversations', {
      token: bob.token,
      body: { userIds: [alice.id] },
    });
    expect(again.body.id).toBe(conv.body.id);
    const m = await http.req<Message>('POST', `/conversations/${conv.body.id}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'oi bob' },
    });
    expect(m.status).toBe(201);
    const list = await http.req<MessagePage>('GET', `/conversations/${conv.body.id}/messages`, { token: bob.token });
    expect(list.body.messages.map((x) => x.body)).toEqual(['oi bob']);

    expect((await http.req('PUT', `/blocks/${alice.id}`, { token: bob.token })).status).toBe(204);
    const blocked = await http.req('POST', `/conversations/${conv.body.id}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'oi?' },
    });
    expect(blocked.status).toBe(403);
    // bloqueio também desfaz amizade e impede novo pedido (resposta indistinguível de inexistente)
    expect((await http.req<unknown[]>('GET', '/friends', { token: alice.token })).body).toHaveLength(0);
    expect(
      (await http.req('POST', '/friends/requests', { token: alice.token, body: { username: bob.auth.user.username } }))
        .status,
    ).toBe(404);
  });

  it('terceiro não acessa a DM; grupo exige amizade', async () => {
    const { alice, bob } = await setup();
    const carol = await register(http);
    const conv = await http.req<{ id: string }>('POST', '/conversations', {
      token: alice.token,
      body: { userIds: [bob.id] },
    });
    expect(conv.status).toBe(201); // servidor em comum permite DM
    expect((await http.req('GET', `/conversations/${conv.body.id}/messages`, { token: carol.token })).status).toBe(404);
    expect(
      (await http.req('POST', '/conversations', { token: alice.token, body: { userIds: [bob.id, carol.id] } })).status,
    ).toBe(403);
  });

  it('DM exige amizade ou servidor em comum', async () => {
    const { alice } = await setup();
    const stranger = await outsider(http);
    // alice também fica sem servidor (do oficial não se sai pela API): sem servidor em comum e sem amizade
    await prisma.serverMember.deleteMany({ where: { userId: alice.id } });
    expect(
      (await http.req('POST', '/conversations', { token: alice.token, body: { userIds: [stranger.id] } })).status,
    ).toBe(403);
  });
});

describe('configurações do usuário', () => {
  it('defaults, salvar e validar schema', async () => {
    const { alice } = await setup();
    const d = await http.req<{ version: number; audio: { inputMode: string } }>('GET', '/me/settings', {
      token: alice.token,
    });
    expect(d.body.version).toBe(1);
    const saved = await http.req<{ audio: { inputMode: string } }>('PUT', '/me/settings', {
      token: alice.token,
      body: { ...d.body, audio: { ...d.body.audio, inputMode: 'ptt' } },
    });
    expect(saved.body.audio.inputMode).toBe('ptt');
    expect(
      (await http.req<{ audio: { inputMode: string } }>('GET', '/me/settings', { token: alice.token })).body.audio
        .inputMode,
    ).toBe('ptt');
    expect((await http.req('PUT', '/me/settings', { token: alice.token, body: { version: 99 } })).status).toBe(400);
  });

  it('aparência personalizada fica na conta e valida cor/fonte', async () => {
    const { alice } = await setup();
    type S = { appearance: Record<string, unknown> };
    const d = (await http.req<S>('GET', '/me/settings', { token: alice.token })).body;
    expect(d.appearance).toMatchObject({ accent: '#4d56fd', surface: 'default', radiusScale: 1, fontFamily: '' });
    const custom = { accent: '#ef4f4f', surface: 'oled', radiusScale: 0, fontFamily: 'Georgia' };
    const put = await http.req('PUT', '/me/settings', {
      token: alice.token,
      body: { ...d, appearance: { ...d.appearance, ...custom } },
    });
    expect(put.status).toBe(200);
    // outra sessão (outro PC) recebe as mesmas preferências
    expect((await http.req<S>('GET', '/me/settings', { token: alice.token })).body.appearance).toMatchObject(custom);
    for (const bad of [{ accent: 'red' }, { fontFamily: 'x"; } body { display:none' }, { radiusScale: 9 }]) {
      const r = await http.req('PUT', '/me/settings', {
        token: alice.token,
        body: { ...d, appearance: { ...d.appearance, ...bad } },
      });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('perfil para o painel da DM: data, amizade e servidores em comum; sem vínculo ou com bloqueio é 404', async () => {
    const { alice, bob, serverId } = await setup();
    const p0 = await http.req<UserProfile>('GET', `/users/${bob.id}/profile`, { token: alice.token });
    expect(p0.status).toBe(200);
    expect(p0.body.friendSince).toBeNull();
    expect(p0.body.mutualServers.map((s) => s.id)).toContain(serverId);
    expect(Date.parse(p0.body.createdAt)).toBeGreaterThan(0);
    await http.req('POST', '/friends/requests', { token: alice.token, body: { username: bob.auth.user.username } });
    await http.req('POST', `/friends/${alice.id}/accept`, { token: bob.token });
    const p1 = await http.req<UserProfile>('GET', `/users/${bob.id}/profile`, { token: alice.token });
    expect(p1.body.friendSince).not.toBeNull();
    // sem vínculo: 404 (não serve de busca de usuários)
    const stranger = await outsider(http);
    expect((await http.req('GET', `/users/${bob.id}/profile`, { token: stranger.token })).status).toBe(404);
    // bloqueio em qualquer direção: 404
    await http.req('PUT', `/blocks/${alice.id}`, { token: bob.token });
    expect((await http.req('GET', `/users/${bob.id}/profile`, { token: alice.token })).status).toBe(404);
  });
});

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { BotWithToken, UserProfile } from '@opencord/contracts';
import {
  Permission,
  type Message,
  type MessagePage,
  type Role,
  type ServerDetail,
  type UnreadState,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  outsider,
  prisma,
  register,
  resetDb,
  rid,
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

/** bot do dono já dentro do servidor (ADR-0032); devolve o token `ocb_…` */
async function botIn(owner: Client, serverId: string): Promise<BotWithToken> {
  const bot = await http.req<BotWithToken>('POST', '/me/bots', { token: owner.token, body: { name: 'Cartões' } });
  if (bot.status !== 201) throw new Error(`criar bot: ${bot.status}`);
  const add = await http.req('POST', `/servers/${serverId}/bots`, { token: owner.token, body: { botId: bot.body.id } });
  if (add.status !== 201) throw new Error(`adicionar bot: ${add.status}`);
  return bot.body;
}

const EMBED = {
  title: 'Resultado',
  description: 'ficou **bom**',
  color: '#3fb27f',
  fields: [{ name: 'Mapa', value: 'Dust', inline: true }],
  footer: { text: 'bot de teste' },
};
const ROWS = [
  {
    type: 'row',
    components: [
      { type: 'button', style: 'primary', label: 'Sim', customId: 'yes' },
      { type: 'button', style: 'link', label: 'Docs', url: 'https://example.com' },
    ],
  },
  {
    type: 'row',
    components: [
      {
        type: 'select',
        customId: 'cor',
        placeholder: 'escolha',
        options: [
          { label: 'Azul', value: 'blue' },
          { label: 'Verde', value: 'green' },
        ],
      },
    ],
  },
];

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

  it('embeds só para bots/webhooks e componentes só para bots (403 com motivo); bot envia e todos leem', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    const bot = await botIn(owner, serverId);
    const forbidden = await send(alice.token, channelId, 'olha', { embeds: [EMBED] });
    expect(forbidden.status).toBe(403);
    expect((forbidden.body as unknown as { message: string }).message).toContain('embeds');
    expect((await send(owner.token, channelId, 'olha', { components: ROWS })).status).toBe(403);
    // validação do contrato: embed vazio, botão sem customId, duas linhas com o mesmo customId
    expect((await send(bot.token, channelId, '', { embeds: [{ color: '#000000' }] })).status).toBe(400);
    expect(
      (
        await send(bot.token, channelId, 'x', {
          components: [{ type: 'row', components: [{ type: 'button', label: 'sem id' }] }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(bot.token, channelId, 'x', {
          components: [
            { type: 'row', components: [{ type: 'button', label: 'a', customId: 'dup' }] },
            { type: 'row', components: [{ type: 'button', label: 'b', customId: 'dup' }] },
          ],
        })
      ).status,
    ).toBe(400);

    // só embed, sem texto, é uma mensagem válida para o bot
    const sa = await socket(alice.token);
    const live = nextEvent<Message>(sa, 'chat:message:created', (m) => m.author.bot);
    const posted = await send(bot.token, channelId, '', { embeds: [EMBED], components: ROWS });
    expect(posted.status).toBe(201);
    expect(posted.body.body).toBe('');
    expect(posted.body.embeds).toHaveLength(1);
    expect(posted.body.embeds[0]).toMatchObject({ title: 'Resultado', color: '#3fb27f' });
    expect(posted.body.embeds[0]!.fields[0]).toEqual({ name: 'Mapa', value: 'Dust', inline: true });
    expect(posted.body.components).toHaveLength(2);
    expect(posted.body.components[0]!.components[0]).toMatchObject({
      type: 'button',
      customId: 'yes',
      disabled: false,
    });
    expect((await live).components).toHaveLength(2);
    // listagem, GET /messages/:id e quem não vê o canal
    const page = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: alice.token });
    expect(page.body.messages.find((m) => m.id === posted.body.id)?.embeds[0]?.title).toBe('Resultado');
    const one = await http.req<Message>('GET', `/messages/${posted.body.id}`, { token: alice.token });
    expect(one.status).toBe(200);
    expect(one.body.components[1]!.components[0]).toMatchObject({ type: 'select', customId: 'cor' });
    const out = await outsider(http);
    expect((await http.req('GET', `/messages/${posted.body.id}`, { token: out.token })).status).toBe(404);
    expect((await http.req('GET', `/messages/${rid()}`, { token: alice.token })).status).toBe(404);
    // JSON fora do contrato no banco vira lista vazia, sem derrubar a leitura
    await prisma.message.update({ where: { id: posted.body.id }, data: { embeds: [{ lixo: true }], components: 7 } });
    const safe = await http.req<Message>('GET', `/messages/${posted.body.id}`, { token: alice.token });
    expect(safe.body.embeds).toEqual([]);
    expect(safe.body.components).toEqual([]);
  });

  it('edição parcial: só o que veio muda; components: [] tira; pessoa não ganha embeds editando', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    const bot = await botIn(owner, serverId);
    const m = await send(bot.token, channelId, 'texto', { embeds: [EMBED], components: ROWS });
    const edit = (token: string, id: string, body: Record<string, unknown>) =>
      http.req<Message>('PATCH', `/messages/${id}`, { token, body });
    const t = await edit(bot.token, m.body.id, { body: 'texto 2' });
    expect(t.status).toBe(200);
    expect(t.body.body).toBe('texto 2');
    expect(t.body.embeds).toHaveLength(1);
    expect(t.body.components).toHaveLength(2);
    const noButtons = await edit(bot.token, m.body.id, { components: [] });
    expect(noButtons.body.components).toEqual([]);
    expect(noButtons.body.body).toBe('texto 2');
    expect(noButtons.body.embeds).toHaveLength(1);
    // tirar o texto: o contrato exige os embeds no mesmo pedido ("texto vazio só com embeds")
    expect((await edit(bot.token, m.body.id, { body: '' })).status).toBe(400);
    const noText = await edit(bot.token, m.body.id, { body: '', embeds: [EMBED] });
    expect(noText.status).toBe(200);
    expect(noText.body.body).toBe('');
    // sem texto nem embed não dá
    expect((await edit(bot.token, m.body.id, { embeds: [] })).status).toBe(400);
    expect((await edit(bot.token, m.body.id, {})).status).toBe(400);
    const mine = await send(alice.token, channelId, 'minha');
    expect((await edit(alice.token, mine.body.id, { embeds: [EMBED] })).status).toBe(403);
    expect((await edit(alice.token, mine.body.id, { components: ROWS })).status).toBe(403);
    expect((await edit(alice.token, mine.body.id, { components: [] })).status).toBe(200);
  });

  it('bulk-delete: MANAGE_MESSAGES apaga qualquer uma; sem ela só as próprias; outro canal é 400', async () => {
    const { alice, bob, owner, serverId, channelId } = await setup();
    const a1 = await send(alice.token, channelId, 'a1');
    const a2 = await send(alice.token, channelId, 'a2');
    const b1 = await send(bob.token, channelId, 'b1');
    const bulk = (token: string, cid: string, messageIds: string[]) =>
      http.req<{ message: string }>('POST', `/channels/${cid}/messages/bulk-delete`, { token, body: { messageIds } });
    // alice inclui a do bob: 403 e nada apagado
    expect((await bulk(alice.token, channelId, [a1.body.id, b1.body.id])).status).toBe(403);
    expect(await prisma.message.count({ where: { channelId, deletedAt: null } })).toBe(3);
    const sb = await socket(bob.token);
    const gone = nextEvent<{ messageId: string }>(sb, 'chat:message:deleted', (p) => p.messageId === a2.body.id);
    expect((await bulk(alice.token, channelId, [a1.body.id, a2.body.id, a2.body.id])).status).toBe(204);
    await gone;
    expect(await prisma.message.count({ where: { channelId, deletedAt: null } })).toBe(1);
    // outro canal → 400; lista vazia → 400; id inexistente → 400
    const other = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'outro', kind: 'text' },
    });
    expect((await bulk(owner.token, other.body.id, [b1.body.id])).status).toBe(400);
    expect((await bulk(owner.token, channelId, [])).status).toBe(400);
    expect((await bulk(owner.token, channelId, [rid()])).status).toBe(400);
    // dono apaga a do bob (já apagadas são ignoradas) e fica na auditoria com a contagem
    expect((await bulk(owner.token, channelId, [b1.body.id, a1.body.id])).status).toBe(204);
    expect(await prisma.message.count({ where: { channelId, deletedAt: null } })).toBe(0);
    const logs = await prisma.auditLog.findMany({ where: { serverId, action: 'message.bulk_delete' } });
    expect(logs.map((l) => l.metadata)).toEqual([
      { count: 2, requested: 2 },
      { count: 1, requested: 2 },
    ]);
    expect((await bulk(alice.token, rid(), [a1.body.id])).status).toBe(404);
  });

  it('limpar reações: só MANAGE_MESSAGES; evento chat:reactions:cleared', async () => {
    const { alice, bob, owner, channelId } = await setup();
    const m = await send(alice.token, channelId, 'reajam');
    const react = (token: string, emoji: string) =>
      http.req('PUT', `/messages/${m.body.id}/reactions/${encodeURIComponent(emoji)}`, { token });
    await react(alice.token, '👍');
    await react(bob.token, '🔥');
    expect((await http.req('DELETE', `/messages/${m.body.id}/reactions`, { token: alice.token })).status).toBe(403);
    const sa = await socket(alice.token);
    const cleared = nextEvent<{ messageId: string; channelId: string }>(sa, 'chat:reactions:cleared');
    expect((await http.req('DELETE', `/messages/${m.body.id}/reactions`, { token: owner.token })).status).toBe(204);
    expect(await cleared).toEqual({ messageId: m.body.id, channelId, conversationId: null });
    const one = await http.req<Message>('GET', `/messages/${m.body.id}`, { token: bob.token });
    expect(one.body.reactions).toEqual([]);
    expect((await http.req('DELETE', `/messages/${rid()}/reactions`, { token: owner.token })).status).toBe(404);
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

  it('busca: por palavra (todas), por pessoa, por link; no servidor só em canais que eu vejo', async () => {
    const { alice, owner, serverId, channelId } = await setup();
    await send(alice.token, channelId, 'o clipe do boss ficou bom');
    await send(owner.token, channelId, 'manda o Clipe do BOSS de novo');
    await send(owner.token, channelId, 'olha isso https://exemplo.com/boss');
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    const secret = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'staff', kind: 'text' },
    });
    await http.req('PATCH', `/channels/${secret.body.id}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    await send(owner.token, secret.body.id, 'boss secreto');
    type R = { messages: Message[]; total: number };
    const q = (token: string, params: string) =>
      http.req<R>('GET', `/servers/${serverId}/messages/search?${params}`, { token });
    // todas as palavras, sem diferenciar maiúsculas
    expect((await q(alice.token, 'q=clipe+boss')).body.total).toBe(2);
    // só nos canais que a alice vê: o "staff" fica de fora; o dono vê os 4
    expect((await q(alice.token, 'q=boss')).body.total).toBe(3);
    expect((await q(owner.token, 'q=boss')).body.total).toBe(4);
    expect((await q(alice.token, `q=boss&authorId=${alice.id}`)).body.total).toBe(1);
    expect((await q(alice.token, 'q=boss&has=link')).body.messages.map((m) => m.body)).toEqual([
      'olha isso https://exemplo.com/boss',
    ]);
    expect((await q(alice.token, `q=boss&channelId=${secret.body.id}`)).body.total).toBe(0);
    // paginação por offset, mais recente primeiro
    const p1 = await q(owner.token, 'q=boss&limit=2');
    const p2 = await q(owner.token, 'q=boss&limit=2&offset=2');
    expect(p1.body.messages).toHaveLength(2);
    expect(p2.body.messages).toHaveLength(2);
    expect(new Set([...p1.body.messages, ...p2.body.messages].map((m) => m.id)).size).toBe(4);
    // quem não é do servidor: 404
    const out = await outsider(http);
    expect((await q(out.token, 'q=boss')).status).toBe(404);
    expect((await q(alice.token, 'q=')).status).toBe(400);
  });

  it('melhores momentos: só mensagens com vídeo, ranqueadas por pessoas que reagiram, nos canais que eu vejo', async () => {
    const { alice, bob, owner, serverId, channelId } = await setup();
    const attach = async (uploaderId: string, messageId: string, mime: string) =>
      prisma.attachment.create({
        data: {
          uploaderId,
          messageId,
          storageKey: `t/${messageId}`,
          mime,
          sizeBytes: 10,
          originalName: 'x',
          sha256: messageId,
        },
      });
    const v1 = await send(alice.token, channelId, 'clipe 1');
    const v2 = await send(bob.token, channelId, 'clipe 2');
    const img = await send(alice.token, channelId, 'foto');
    await attach(alice.id, v1.body.id, 'video/webm');
    await attach(bob.id, v2.body.id, 'video/mp4');
    await attach(alice.id, img.body.id, 'image/png');
    // v2 ganha duas pessoas (um emoji cada); v1 ganha uma pessoa com dois emojis (conta 1)
    const react = (token: string, mid: string, emoji: string) =>
      http.req('PUT', `/messages/${mid}/reactions/${encodeURIComponent(emoji)}`, { token });
    await react(alice.token, v2.body.id, '🔥');
    await react(owner.token, v2.body.id, '👍');
    await react(bob.token, v1.body.id, '🔥');
    await react(bob.token, v1.body.id, '👍');
    type H = { message: Message; score: number; channelName: string }[];
    const top = await http.req<H>('GET', `/servers/${serverId}/highlights`, { token: alice.token });
    expect(top.status).toBe(200);
    expect(top.body.map((h) => [h.message.body, h.score])).toEqual([
      ['clipe 2', 2],
      ['clipe 1', 1],
    ]);
    expect(top.body[0]?.channelName).toBeTruthy();
    // canal escondido não entra
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    expect((await http.req<H>('GET', `/servers/${serverId}/highlights`, { token: alice.token })).body).toEqual([]);
    expect((await http.req('GET', `/servers/${serverId}/highlights?days=0`, { token: alice.token })).status).toBe(400);
  });

  it('thread leve: replyCount na mensagem e GET /messages/:id/replies em ordem; terceiro não vê', async () => {
    const { alice, bob, channelId, serverId, owner } = await setup();
    const root = await send(alice.token, channelId, 'alguém topa raid?');
    expect(root.body.replyCount).toBe(0);
    const r1 = await send(bob.token, channelId, 'eu', { replyToId: root.body.id });
    const r2 = await send(alice.token, channelId, 'eu também', { replyToId: root.body.id });
    await send(bob.token, channelId, 'fora da thread');
    const page = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: alice.token });
    expect(page.body.messages.find((m) => m.id === root.body.id)?.replyCount).toBe(2);
    const replies = await http.req<Message[]>('GET', `/messages/${root.body.id}/replies`, { token: alice.token });
    expect(replies.body.map((m) => m.id)).toEqual([r1.body.id, r2.body.id]);
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    expect((await http.req('GET', `/messages/${root.body.id}/replies`, { token: alice.token })).status).toBe(404);
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

  it('mensagens fixadas: na DM qualquer participante; no canal só MANAGE_MESSAGES; terceiro não vê', async () => {
    const { alice, bob, channelId, owner } = await setup();
    await http.req('POST', '/friends/requests', { token: alice.token, body: { username: bob.auth.user.username } });
    await http.req('POST', `/friends/${alice.id}/accept`, { token: bob.token });
    const conv = await http.req<{ id: string }>('POST', '/conversations', {
      token: alice.token,
      body: { userIds: [bob.id] },
    });
    const m = await http.req<Message>('POST', `/conversations/${conv.body.id}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'endereço da festa' },
    });
    // bob (não é o autor) fixa na DM
    const pinned = await http.req<Message>('PUT', `/messages/${m.body.id}/pin`, { token: bob.token });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinnedAt).toBeTruthy();
    const pins = await http.req<Message[]>('GET', `/conversations/${conv.body.id}/pins`, { token: alice.token });
    expect(pins.body.map((x) => x.id)).toEqual([m.body.id]);
    const page = await http.req<MessagePage>('GET', `/conversations/${conv.body.id}/messages`, { token: alice.token });
    expect(page.body.messages[0]?.pinnedAt).toBeTruthy();
    // terceiro não vê nem fixa
    const eve = await register(http);
    expect((await http.req('GET', `/conversations/${conv.body.id}/pins`, { token: eve.token })).status).toBe(404);
    expect((await http.req('DELETE', `/messages/${m.body.id}/pin`, { token: eve.token })).status).toBe(404);
    // desafixar e excluir
    await http.req('DELETE', `/messages/${m.body.id}/pin`, { token: alice.token });
    expect(
      (await http.req<Message[]>('GET', `/conversations/${conv.body.id}/pins`, { token: bob.token })).body,
    ).toEqual([]);
    await http.req('PUT', `/messages/${m.body.id}/pin`, { token: alice.token });
    await http.req('DELETE', `/messages/${m.body.id}`, { token: alice.token });
    expect(
      (await http.req<Message[]>('GET', `/conversations/${conv.body.id}/pins`, { token: bob.token })).body,
    ).toEqual([]);

    // canal: membro comum não fixa; dono fixa
    const c = await send(alice.token, channelId, 'regras');
    expect((await http.req('PUT', `/messages/${c.body.id}/pin`, { token: alice.token })).status).toBe(403);
    expect((await http.req('PUT', `/messages/${c.body.id}/pin`, { token: owner.token })).status).toBe(200);
    const cp = await http.req<Message[]>('GET', `/channels/${channelId}/pins`, { token: bob.token });
    expect(cp.body.map((x) => x.id)).toEqual([c.body.id]);
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

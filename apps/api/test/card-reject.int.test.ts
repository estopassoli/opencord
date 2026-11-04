/** Recusar ideia do quadro (ADR-0045): card some e quem relatou recebe DM da conta de avisos, sem poder responder. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AdminSystemMessagePage,
  BoardCard,
  Channel,
  Conversation,
  Message,
  MessagePage,
  ServerDetail,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rejectionText } from '../src/boards/card-rejection.service.js';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, rid, startApp } from './helpers.js';

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

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const ana = await register(http, 'Ana');
  const board = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
    token: owner.token,
    body: { name: 'ideias-kanban', kind: 'board' },
  });
  const feed = (await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token })).body.channels.find(
    (c) => c.kind === 'text',
  )!;
  await http.req('PATCH', `/channels/${feed.id}`, { token: owner.token, body: { boardId: board.body.id } });
  await http.req<Message>('POST', `/channels/${feed.id}/messages`, {
    token: ana.token,
    body: { requestId: rid(), body: 'Modo karaokê na call' },
  });
  const cards = await http.req<BoardCard[]>('GET', `/channels/${board.body.id}/cards`, { token: owner.token });
  expect(cards.body).toHaveLength(1);
  return { owner, ana, board: board.body, card: cards.body[0]! };
}

describe('recusar ideia do quadro', () => {
  it('apaga o card e manda a DM da conta de avisos; a pessoa não responde nem liga', async () => {
    const { owner, ana, board, card } = await setup();
    // quem não gerencia o quadro não recusa (nem vê o card: 404 ou 403)
    expect([403, 404]).toContain(
      (await http.req('POST', `/cards/${card.id}/reject`, { token: ana.token, body: {} })).status,
    );

    const s = await connectSocket(ana.token);
    sockets.push(s);
    const conv = nextEvent<Conversation>(s, 'conversation:upserted');
    const r = await http.req<{ notified: boolean }>('POST', `/cards/${card.id}/reject`, {
      token: owner.token,
      body: { reason: 'Fora do foco agora.' },
    });
    expect(r.status).toBe(200);
    expect(r.body.notified).toBe(true);
    const c = await conv;
    const system = c.members.find((m) => m.id !== ana.id)!;
    expect(system).toMatchObject({ displayName: 'OpenCord', system: true, verified: true, bot: true });

    const page = await http.req<MessagePage>('GET', `/conversations/${c.id}/messages`, { token: ana.token });
    expect(page.body.messages).toHaveLength(1);
    expect(page.body.messages[0]!.author.id).toBe(system.id);
    expect(page.body.messages[0]!.body).toContain('> Modo karaokê na call');
    expect(page.body.messages[0]!.body).toContain('**Motivo:** Fora do foco agora.');

    // sem resposta, sem chamada, sem abrir DM nem pedir amizade
    expect(
      (
        await http.req('POST', `/conversations/${c.id}/messages`, {
          token: ana.token,
          body: { requestId: rid(), body: 'mas por quê?' },
        })
      ).status,
    ).toBe(403);
    expect((await http.req('POST', `/voice/conversations/${c.id}/join`, { token: ana.token })).status).toBe(403);
    expect(
      (await http.req('POST', '/conversations', { token: ana.token, body: { userIds: [system.id] } })).status,
    ).toBe(403);
    expect(
      (await http.req('POST', '/friends/requests', { token: ana.token, body: { username: system.username } })).status,
    ).toBe(404);

    // o super admin confere os avisos mandados; quem não é recebe 404
    expect((await http.req('GET', '/admin/system-messages', { token: owner.token })).status).toBe(404);
    await prisma.user.update({ where: { id: owner.id }, data: { isInstanceAdmin: true } });
    const sent = await http.req<AdminSystemMessagePage>('GET', '/admin/system-messages', { token: owner.token });
    expect(sent.status).toBe(200);
    expect(sent.body.messages).toHaveLength(1);
    expect(sent.body.messages[0]).toMatchObject({ recipient: { id: ana.id }, deleted: false });
    expect(sent.body.messages[0]!.body).toContain('Fora do foco agora.');
    expect(sent.body.nextCursor).toBeNull();

    // o card sumiu
    const after = await http.req<BoardCard[]>('GET', `/channels/${board.id}/cards`, { token: owner.token });
    expect(after.body).toHaveLength(0);
  });

  it('sem avisar: só apaga; a próxima recusa usa a mesma DM', async () => {
    const { owner, card } = await setup();
    const r = await http.req<{ notified: boolean }>('POST', `/cards/${card.id}/reject`, {
      token: owner.token,
      body: { notify: false },
    });
    expect(r.body.notified).toBe(false);
  });

  it('texto da recusa', () => {
    const t = rejectionText({ server: 'OpenCord', board: 'kanban-de-ideias', title: 'A\nB', reason: '' });
    expect(t).toContain('**OpenCord**');
    expect(t).toContain('> A\n> B');
    expect(t).not.toContain('Motivo');
  });
});

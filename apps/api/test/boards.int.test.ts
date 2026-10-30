/** Quadros kanban (ADR-0017): visibilidade pelo canal, mensagens do canal de relatos viram cards, mover e editar. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, type BoardCard, type Channel, type Role, type ServerDetail } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, register, resetDb, rid, startApp } from './helpers.js';

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
  const alice = await register(http);
  const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
  const board = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
    token: owner.token,
    body: { name: 'kanban', kind: 'board' },
  });
  // só a equipe vê o quadro
  await http.req('PATCH', `/channels/${board.body.id}`, {
    token: owner.token,
    body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
  });
  const reports = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
    token: owner.token,
    body: { name: 'reportar-bugs', kind: 'text' },
  });
  const linked = await http.req<Channel>('PATCH', `/channels/${reports.body.id}`, {
    token: owner.token,
    body: { boardId: board.body.id },
  });
  expect(linked.body.boardId).toBe(board.body.id);
  return { owner, alice, serverId, boardId: board.body.id, reportsId: reports.body.id };
}

describe('quadros kanban', () => {
  it('mensagem no canal de relatos vira card; só quem vê o quadro recebe e lista', async () => {
    const { owner, alice, boardId, reportsId } = await setup();
    const so = await connectSocket(owner.token);
    sockets.push(so);
    const upserted = nextEvent<BoardCard>(so, 'board:card:upserted');
    const sent = await http.req<{ id: string }>('POST', `/channels/${reportsId}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'A live trava ao trocar de cena\nWindows 11, app 0.2.x' },
    });
    expect(sent.status).toBe(201);
    const card = await upserted;
    expect(card).toMatchObject({
      boardId,
      column: 'new',
      title: 'A live trava ao trocar de cena',
      body: 'A live trava ao trocar de cena\nWindows 11, app 0.2.x',
      messageId: sent.body.id,
      sourceChannelId: reportsId,
    });
    expect(card.reporter?.id).toBe(alice.id);

    const list = await http.req<BoardCard[]>('GET', `/channels/${boardId}/cards`, { token: owner.token });
    expect(list.body.map((c) => c.id)).toEqual([card.id]);
    // alice relata, mas não vê o quadro: nem a lista nem o card existem para ela
    expect((await http.req('GET', `/channels/${boardId}/cards`, { token: alice.token })).status).toBe(404);
    expect(
      (await http.req('PATCH', `/cards/${card.id}`, { token: alice.token, body: { column: 'done' } })).status,
    ).toBe(404);
    // o quadro não aceita mensagens
    expect(
      (
        await http.req('POST', `/channels/${boardId}/messages`, {
          token: owner.token,
          body: { requestId: rid(), body: 'oi' },
        })
      ).status,
    ).toBe(400);
  });

  it('mover entre colunas vai para o topo; editar; criar à mão; excluir', async () => {
    const { owner, boardId } = await setup();
    const mk = (title: string) =>
      http.req<BoardCard>('POST', `/channels/${boardId}/cards`, { token: owner.token, body: { title } });
    const a = (await mk('A')).body;
    const b = (await mk('B')).body;
    expect(b.position).toBeLessThan(a.position); // novo entra no topo
    const moved = await http.req<BoardCard>('PATCH', `/cards/${a.id}`, {
      token: owner.token,
      body: { column: 'doing' },
    });
    expect(moved.body.column).toBe('doing');
    const edited = await http.req<BoardCard>('PATCH', `/cards/${a.id}`, {
      token: owner.token,
      body: { title: 'A (corrigindo)', body: 'detalhes' },
    });
    expect(edited.body).toMatchObject({ title: 'A (corrigindo)', body: 'detalhes', column: 'doing' });
    expect((await http.req('DELETE', `/cards/${b.id}`, { token: owner.token })).status).toBe(204);
    const list = await http.req<BoardCard[]>('GET', `/channels/${boardId}/cards`, { token: owner.token });
    expect(list.body.map((c) => c.title)).toEqual(['A (corrigindo)']);
  });

  it('ligar a quadro: só canal de texto e quadro do mesmo servidor', async () => {
    const { owner, serverId, boardId } = await setup();
    const voice = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'sala', kind: 'voice' },
    });
    expect(
      (await http.req('PATCH', `/channels/${voice.body.id}`, { token: owner.token, body: { boardId } })).status,
    ).toBe(400);
    const text = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'outro', kind: 'text' },
    });
    expect(
      (await http.req('PATCH', `/channels/${text.body.id}`, { token: owner.token, body: { boardId: voice.body.id } }))
        .status,
    ).toBe(400);
  });
});

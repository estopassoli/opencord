/** Modo lento e canal de fórum (ADR-0052). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Channel, ForumPostPage, Message, ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const send = (token: string, channelId: string, body: Record<string, unknown>) =>
  http.req<Message & { code?: string; retryAfterSec?: number }>('POST', `/channels/${channelId}/messages`, {
    token,
    body: { requestId: rid(), ...body },
  });

describe('modo lento', () => {
  it('segura a segunda mensagem da mesma pessoa; quem gerencia não espera; só texto e fórum', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    const voice = d.body.channels.find((c) => c.kind === 'voice')!;

    // só quem gerencia o canal liga
    expect(
      (await http.req('PATCH', `/channels/${text.id}`, { token: ana.token, body: { slowmodeSec: 30 } })).status,
    ).toBe(403);
    const on = await http.req<Channel>('PATCH', `/channels/${text.id}`, {
      token: owner.token,
      body: { slowmodeSec: 30 },
    });
    expect(on.status).toBe(200);
    expect(on.body.slowmodeSec).toBe(30);
    expect(
      (await http.req('PATCH', `/channels/${voice.id}`, { token: owner.token, body: { slowmodeSec: 30 } })).status,
    ).toBe(400);

    expect((await send(ana.token, text.id, { body: 'primeira' })).status).toBe(201);
    const second = await send(ana.token, text.id, { body: 'segunda' });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('slowmode');
    expect(second.body.retryAfterSec).toBeGreaterThan(25);
    expect(second.body.retryAfterSec).toBeLessThanOrEqual(30);
    // dono (gerencia mensagens) escreve sem esperar
    expect((await send(owner.token, text.id, { body: 'a' })).status).toBe(201);
    expect((await send(owner.token, text.id, { body: 'b' })).status).toBe(201);

    // desligado: volta ao normal
    await http.req('PATCH', `/channels/${text.id}`, { token: owner.token, body: { slowmodeSec: 0 } });
    expect((await send(ana.token, text.id, { body: 'agora vai' })).status).toBe(201);
  });
});

describe('fórum', () => {
  it('posts com título, respostas penduradas no post e lista pela atividade mais recente', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const created = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'ajuda', kind: 'forum' },
    });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('forum');
    const forum = created.body.id;

    // post precisa de título
    expect((await send(ana.token, forum, { body: 'sem título' })).status).toBe(400);
    const p1 = await send(ana.token, forum, { title: 'Como configuro o microfone?', body: 'Ninguém me ouve.' });
    expect(p1.status).toBe(201);
    expect(p1.body.title).toBe('Como configuro o microfone?');
    const p2 = await send(owner.token, forum, { title: 'Regras do fórum', body: 'Leia antes de postar.' });
    expect(p2.status).toBe(201);

    // resposta: sem título e só a um post
    expect((await send(owner.token, forum, { replyToId: p1.body.id, title: 'x', body: 'oi' })).status).toBe(400);
    const r1 = await send(owner.token, forum, { replyToId: p1.body.id, body: 'Veja Configurações → Voz.' });
    expect(r1.status).toBe(201);
    expect(r1.body.title).toBeNull();
    expect((await send(ana.token, forum, { replyToId: r1.body.id, body: 'resposta da resposta' })).status).toBe(400);

    // a resposta move o post 1 para o topo; respostas não aparecem como posts
    const page = await http.req<ForumPostPage>('GET', `/channels/${forum}/posts`, { token: ana.token });
    expect(page.status).toBe(200);
    expect(page.body.posts.map((p) => p.message.id)).toEqual([p1.body.id, p2.body.id]);
    expect(page.body.posts[0]!.message.replyCount).toBe(1);
    expect(page.body.posts[0]!.lastActivityAt >= page.body.posts[1]!.lastActivityAt).toBe(true);
    expect(page.body.nextBefore).toBeNull();

    // paginação
    const first = await http.req<ForumPostPage>('GET', `/channels/${forum}/posts?limit=1`, { token: ana.token });
    expect(first.body.posts).toHaveLength(1);
    expect(first.body.nextBefore).not.toBeNull();
    const rest = await http.req<ForumPostPage>(
      'GET',
      `/channels/${forum}/posts?limit=1&before=${encodeURIComponent(first.body.nextBefore!)}`,
      { token: ana.token },
    );
    expect(rest.body.posts.map((p) => p.message.id)).toEqual([p2.body.id]);

    // título fora do fórum é recusado; a lista de posts só existe no fórum
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    expect((await send(ana.token, text.id, { title: 'x', body: 'y' })).status).toBe(400);
    expect((await http.req('GET', `/channels/${text.id}/posts`, { token: ana.token })).status).toBe(400);
  });
});

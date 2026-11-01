/** Webhooks de entrada (ADR-0030): criar, postar pelo link (público), permissões, token errado, apagar. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Message, Webhook } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, startApp } from './helpers.js';
import { TEST_API_PORT } from './env.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];
const base = `http://127.0.0.1:${TEST_API_PORT}`;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('webhooks de entrada', () => {
  it('dono cria, o POST no link vira mensagem com selo de app; membro comum não cria nem lista', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
    const voice = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'voice' } });
    expect(
      (
        await http.req('POST', `/servers/${serverId}/webhooks`, {
          token: owner.token,
          body: { name: 'x', channelId: voice.id },
        })
      ).status,
    ).toBe(400);
    const created = await http.req<Webhook>('POST', `/servers/${serverId}/webhooks`, {
      token: owner.token,
      body: { name: 'Servidor do jogo', channelId: text.id },
    });
    expect(created.status).toBe(201);
    expect(created.body.url).toMatch(new RegExp(`/webhooks/${created.body.id}/[0-9a-f]{64}$`));
    expect((await http.req('GET', `/servers/${serverId}/webhooks`, { token: alice.token })).status).toBe(403);
    expect(
      (
        await http.req('POST', `/servers/${serverId}/webhooks`, {
          token: alice.token,
          body: { name: 'x', channelId: text.id },
        })
      ).status,
    ).toBe(403);

    const sa = await connectSocket(alice.token);
    sockets.push(sa);
    const got = nextEvent<Message>(sa, 'chat:message:created', (m) => m.channelId === text.id);
    const url = created.body.url.replace(/^https?:\/\/[^/]+/, base);
    expect((await post(url, { content: 'Servidor reiniciado ✅' })).status).toBe(204);
    const m = await got;
    expect(m.body).toBe('Servidor reiniciado ✅');
    expect(m.author.bot).toBe(true);
    expect(m.author.displayName).toBe('Servidor do jogo');
    // estilo Slack também; vazio é 400
    expect((await post(url, { text: 'ok' })).status).toBe(204);
    expect((await post(url, { content: '   ' })).status).toBe(400);
    // token errado ou webhook inexistente: 404, sem revelar qual
    expect((await post(url.replace(/[0-9a-f]{64}$/, '0'.repeat(64)), { content: 'x' })).status).toBe(404);
    const list = await http.req<Message[]>('GET', `/channels/${text.id}/messages`, { token: alice.token });
    expect((list.body as unknown as { messages: Message[] }).messages.filter((x) => x.author.bot)).toHaveLength(2);

    expect((await http.req('DELETE', `/webhooks/${created.body.id}`, { token: alice.token })).status).toBe(404);
    expect((await http.req('DELETE', `/webhooks/${created.body.id}`, { token: owner.token })).status).toBe(204);
    expect((await post(url, { content: 'depois de apagar' })).status).toBe(404);
  });
});

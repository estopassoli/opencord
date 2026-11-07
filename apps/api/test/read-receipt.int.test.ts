/** Marcador "Visualizada" da DM: a lista de conversas traz até onde cada membro leu. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Conversation, Message } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Http, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('visualizada', () => {
  it('mostra até onde a outra pessoa leu, sem voltar atrás', async () => {
    const alice = await register(http);
    const bob = await register(http);
    await http.req('POST', '/friends/requests', { token: alice.token, body: { username: bob.auth.user.username } });
    await http.req('POST', `/friends/${alice.id}/accept`, { token: bob.token });
    const dm = await http.req<Conversation>('POST', '/conversations', {
      token: alice.token,
      body: { userIds: [bob.id] },
    });
    const send = async (body: string) =>
      (
        await http.req<Message>('POST', `/conversations/${dm.body.id}/messages`, {
          token: alice.token,
          body: { requestId: rid(), body },
        })
      ).body;
    const m1 = await send('oi');
    const m2 = await send('tudo bem?');
    const bobRead = async () => {
      const list = (await http.req<Conversation[]>('GET', '/conversations', { token: alice.token })).body;
      return list.find((c) => c.id === dm.body.id)?.reads?.find((r) => r.userId === bob.id);
    };
    expect(await bobRead()).toBeUndefined();

    const ack = (messageId: string) =>
      http.req('PUT', `/conversations/${dm.body.id}/read`, { token: bob.token, body: { messageId } });
    expect((await ack(m2.id)).status).toBe(204);
    const r = await bobRead();
    expect(r?.messageId).toBe(m2.id);
    expect(Number.isNaN(Date.parse(r!.at))).toBe(false);

    // marcar uma mais antiga não faz o marcador voltar
    await ack(m1.id);
    expect((await bobRead())?.messageId).toBe(m2.id);
    // quem mandou também aparece como leitor da própria mensagem
    const list = (await http.req<Conversation[]>('GET', '/conversations', { token: bob.token })).body;
    expect(list.find((c) => c.id === dm.body.id)?.reads?.find((x) => x.userId === alice.id)?.messageId).toBe(m2.id);
  });
});

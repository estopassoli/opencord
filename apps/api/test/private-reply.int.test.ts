/** Responder no privado (ADR-0042): DM 1:1 com o autor citando a mensagem do canal. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Channel, Message, MessagePage, ServerDetail } from '@opencord/contracts';
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

const dm = async (token: string, userIds: string[]) =>
  (await http.req<{ id: string }>('POST', '/conversations', { token, body: { userIds } })).body.id;

describe('responder no privado', () => {
  it('cita a mensagem do canal na DM com o autor; só ali e só para quem lê o canal', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    const original = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: ana.token,
      body: { requestId: rid(), body: 'minha ideia é um bot de lembretes' },
    });
    expect(original.status).toBe(201);

    const withAna = await dm(bruno.token, [ana.id]);
    const sent = await http.req<Message>('POST', `/conversations/${withAna}/messages`, {
      token: bruno.token,
      body: { requestId: rid(), body: 'curti, bora conversar', privateReplyToId: original.body.id },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.privateReplyTo).toMatchObject({
      id: original.body.id,
      author: { id: ana.id },
      bodyPreview: 'minha ideia é um bot de lembretes',
      channelId: text.id,
      channelName: text.name,
      serverId,
      deleted: false,
    });
    // a Ana vê a citação ao abrir a DM
    const page = await http.req<MessagePage>('GET', `/conversations/${withAna}/messages`, { token: ana.token });
    expect(page.body.messages.at(-1)!.privateReplyTo?.id).toBe(original.body.id);
    // não vira resposta/thread no canal
    const inChannel = await http.req<MessagePage>('GET', `/channels/${text.id}/messages`, { token: ana.token });
    expect(inChannel.body.messages.find((m) => m.id === original.body.id)!.replyCount).toBe(0);

    // fora da DM com o autor: recusado
    const withOwner = await dm(bruno.token, [owner.id]);
    const wrongDm = await http.req('POST', `/conversations/${withOwner}/messages`, {
      token: bruno.token,
      body: { requestId: rid(), body: 'oi', privateReplyToId: original.body.id },
    });
    expect(wrongDm.status).toBe(400);
    const group = await dm(bruno.token, [ana.id, owner.id]);
    expect(
      (
        await http.req('POST', `/conversations/${group}/messages`, {
          token: bruno.token,
          body: { requestId: rid(), body: 'oi', privateReplyToId: original.body.id },
        })
      ).status,
    ).toBe(400);
    // no canal não vale
    expect(
      (
        await http.req('POST', `/channels/${text.id}/messages`, {
          token: bruno.token,
          body: { requestId: rid(), body: 'oi', privateReplyToId: original.body.id },
        })
      ).status,
    ).toBe(400);

    // canal privado que o Bruno não vê: 404, nem confirma que a mensagem existe
    const secret = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'equipe', kind: 'text', private: true, allowedUserIds: [ana.id] },
    });
    const hidden = await http.req<Message>('POST', `/channels/${secret.body.id}/messages`, {
      token: ana.token,
      body: { requestId: rid(), body: 'segredo' },
    });
    expect(
      (
        await http.req('POST', `/conversations/${withAna}/messages`, {
          token: bruno.token,
          body: { requestId: rid(), body: 'vi isso', privateReplyToId: hidden.body.id },
        })
      ).status,
    ).toBe(404);

    // a original apagada: a citação fica marcada como excluída, sem o texto
    expect((await http.req('DELETE', `/messages/${original.body.id}`, { token: ana.token })).status).toBe(204);
    const after = await http.req<MessagePage>('GET', `/conversations/${withAna}/messages`, { token: bruno.token });
    expect(after.body.messages.at(-1)!.privateReplyTo).toMatchObject({ deleted: true, bodyPreview: '' });
  });
});

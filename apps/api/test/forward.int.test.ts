/** Encaminhar mensagem (ADR-0053). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Attachment, ForwardMessageResponse, Message, MessagePage } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, prisma, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const base = `http://127.0.0.1:${TEST_API_PORT}`;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const PNG_3x2 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000001249444154789c63f8cfc0f01f8481e1ff7f0018f603fd5f2e5b9e0000000049454e44ae426082',
  'hex',
);

async function upload(token: string) {
  const form = new FormData();
  form.append('file', new Blob([PNG_3x2], { type: 'image/png' }), 'foto.png');
  const res = await fetch(`${base}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return ((await res.json()) as { attachment: Attachment }).attachment;
}

const forward = (token: string, messageId: string, body: Record<string, unknown>) =>
  http.req<ForwardMessageResponse & { message?: string }>('POST', `/messages/${messageId}/forward`, {
    token,
    body: { requestId: rid(), ...body },
  });

const list = async (token: string, path: string) =>
  (await http.req<MessagePage>('GET', `${path}/messages`, { token })).body.messages;

describe('encaminhar', () => {
  it('copia texto e anexo para canal e DM, marca a origem, não menciona de novo e não duplica no reenvio', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bob = await register(http);
    const channels = await prisma.channel.findMany({ where: { serverId, kind: 'text' }, orderBy: { position: 'asc' } });
    const general = channels[0]!.id;
    const other = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'outro', kind: 'text' },
    });
    await http.req('POST', '/friends/requests', { token: alice.token, body: { username: bob.auth.user.username } });
    await http.req('POST', `/friends/${alice.id}/accept`, { token: bob.token });
    const dm = await http.req<{ id: string }>('POST', '/conversations', {
      token: alice.token,
      body: { userIds: [bob.id] },
    });

    const att = await upload(owner.token);
    const src = await http.req<Message>('POST', `/channels/${general}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: `olha isso <@${bob.id}>`, attachmentIds: [att.id] },
    });
    expect(src.status).toBe(201);

    const requestId = rid();
    const r = await http.req<ForwardMessageResponse>('POST', `/messages/${src.body.id}/forward`, {
      token: alice.token,
      body: { requestId, targets: [{ channelId: other.body.id }, { conversationId: dm.body.id }], note: 'viu?' },
    });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x) => x.error)).toEqual([null, null]);

    const inChannel = await list(alice.token, `/channels/${other.body.id}`);
    expect(inChannel.map((m) => m.body)).toEqual([`olha isso <@${bob.id}>`, 'viu?']);
    const copy = inChannel[0]!;
    expect(copy.author.id).toBe(alice.id);
    expect(copy.forwarded).toEqual({ messageId: src.body.id, channelId: general });
    expect(copy.mentions).toEqual([]);
    expect(copy.attachments).toHaveLength(1);
    expect(copy.attachments[0]!.id).not.toBe(att.id);
    // o arquivo da cópia é outro: abre mesmo com a original apagada
    await http.req('DELETE', `/messages/${src.body.id}`, { token: owner.token });
    const file = await fetch(copy.attachments[0]!.url.replace(/^https?:\/\/[^/]+/, base));
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG_3x2)).toBe(true);

    const inDm = await list(bob.token, `/conversations/${dm.body.id}`);
    expect(inDm.map((m) => m.body)).toEqual([`olha isso <@${bob.id}>`, 'viu?']);
    expect(inDm[1]!.forwarded ?? null).toBeNull();

    // mesmo pedido de novo: nada novo
    const again = await http.req<ForwardMessageResponse>('POST', `/messages/${copy.id}/forward`, {
      token: alice.token,
      body: { requestId, targets: [{ channelId: other.body.id }, { conversationId: dm.body.id }], note: 'viu?' },
    });
    expect(again.status).toBe(200);
    expect((await list(alice.token, `/channels/${other.body.id}`)).length).toBe(2);
  });

  it('só encaminha o que a pessoa lê, e cada destino falha sozinho', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bob = await register(http);
    const general = (await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } })).id;
    const src = await http.req<Message>('POST', `/channels/${general}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'oi' },
    });
    // DM da qual alice não participa
    await http.req('POST', '/friends/requests', { token: owner.token, body: { username: bob.auth.user.username } });
    await http.req('POST', `/friends/${owner.id}/accept`, { token: bob.token });
    const dm = await http.req<{ id: string }>('POST', '/conversations', {
      token: owner.token,
      body: { userIds: [bob.id] },
    });
    const dmMsg = await http.req<Message>('POST', `/conversations/${dm.body.id}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'segredo' },
    });
    expect((await forward(alice.token, dmMsg.body.id, { targets: [{ channelId: general }] })).status).toBe(404);

    const mixed = await forward(alice.token, src.body.id, {
      targets: [{ conversationId: dm.body.id }, { channelId: general }],
    });
    expect(mixed.status).toBe(200);
    expect(mixed.body.results[0]!.messageId).toBeNull();
    expect(mixed.body.results[0]!.error).toBeTruthy();
    expect(mixed.body.results[1]!.messageId).toBeTruthy();

    // mais de 5 destinos: recusado
    const six = Array.from({ length: 6 }, () => ({ channelId: general }));
    expect((await forward(alice.token, src.body.id, { targets: six })).status).toBe(400);
  });
});

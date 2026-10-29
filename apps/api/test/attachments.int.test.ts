import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Attachment, Message, MessagePage } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, prisma, register, resetDb, rid, startApp } from './helpers.js';
import { TEST_API_PORT } from './env.js';

let app: NestFastifyApplication;
let http: Http;
const base = `http://127.0.0.1:${TEST_API_PORT}`;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

// PNG 3x2 válido (gerado a partir de bytes conhecidos)
const PNG_3x2 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000001249444154789c63f8cfc0f01f8481e1ff7f0018f603fd5f2e5b9e0000000049454e44ae426082',
  'hex',
);

async function upload(token: string, name: string, mime: string, data: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime }), name);
  const res = await fetch(`${base}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as { attachment: Attachment; message?: string } };
}

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  return { ...b, alice, bob, channelId: channel.id };
}

describe('uploads seguros e anexos (F2.5)', () => {
  it('PNG válido: MIME real, dimensões, nome sanitizado; vincula a mensagem e baixa por URL assinada', async () => {
    const { alice, bob, channelId } = await setup();
    const up = await upload(alice.token, '..\\..\\evil<name>.png', 'image/png', PNG_3x2);
    expect(up.status).toBe(201);
    expect(up.body.attachment).toMatchObject({
      mime: 'image/png',
      width: 3,
      height: 2,
      originalName: 'evilname.png',
      sizeBytes: PNG_3x2.length,
    });
    const m = await http.req<Message>('POST', `/channels/${channelId}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: '', attachmentIds: [up.body.attachment.id] },
    });
    expect(m.status).toBe(201);
    const page = await http.req<MessagePage>('GET', `/channels/${channelId}/messages`, { token: bob.token });
    const url = page.body.messages[0]?.attachments[0]?.url as string;
    const dl = await fetch(url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await dl.arrayBuffer()).equals(PNG_3x2)).toBe(true);
  });

  it('assinatura adulterada ou expirada → 404', async () => {
    const { alice } = await setup();
    const up = await upload(alice.token, 'a.png', 'image/png', PNG_3x2);
    const u = new URL(up.body.attachment.url);
    u.searchParams.set('sig', 'AAAA' + (u.searchParams.get('sig') ?? '').slice(4));
    expect((await fetch(u)).status).toBe(404);
    const u2 = new URL(up.body.attachment.url);
    u2.searchParams.set('exp', '1000');
    expect((await fetch(u2)).status).toBe(404);
  });

  it('MIME spoofing: executável declarado como PNG é rejeitado', async () => {
    const { alice } = await setup();
    const exe = Buffer.concat([Buffer.from('4d5a90000300000004000000ffff0000', 'hex'), Buffer.alloc(200)]);
    const r = await upload(alice.token, 'foto.png', 'image/png', exe);
    expect(r.status).toBe(400);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('texto puro aceito; binário declarado como texto rejeitado; acima do limite → 413', async () => {
    const { alice } = await setup();
    expect((await upload(alice.token, 'nota.txt', 'text/plain', Buffer.from('olá mundo\n'))).status).toBe(201);
    expect((await upload(alice.token, 'x.txt', 'text/plain', Buffer.from([0, 1, 2, 3, 0]))).status).toBe(400);
    expect((await upload(alice.token, 'big.txt', 'text/plain', Buffer.alloc(3 * 1024 * 1024, 97))).status).toBe(413);
  });

  it('não é possível usar anexo de outro usuário nem reutilizar anexo', async () => {
    const { alice, bob, channelId } = await setup();
    const up = await upload(alice.token, 'a.png', 'image/png', PNG_3x2);
    const steal = await http.req('POST', `/channels/${channelId}/messages`, {
      token: bob.token,
      body: { requestId: rid(), body: 'x', attachmentIds: [up.body.attachment.id] },
    });
    expect(steal.status).toBe(400);
    await http.req('POST', `/channels/${channelId}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'x', attachmentIds: [up.body.attachment.id] },
    });
    const reuse = await http.req('POST', `/channels/${channelId}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'y', attachmentIds: [up.body.attachment.id] },
    });
    expect(reuse.status).toBe(400);
  });

  it('anexo de mensagem excluída deixa de ser servido', async () => {
    const { alice, channelId } = await setup();
    const up = await upload(alice.token, 'a.png', 'image/png', PNG_3x2);
    const m = await http.req<Message>('POST', `/channels/${channelId}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'x', attachmentIds: [up.body.attachment.id] },
    });
    await http.req('DELETE', `/messages/${m.body.id}`, { token: alice.token });
    expect((await fetch(up.body.attachment.url)).status).toBe(404);
  });

  it('upload exige autenticação', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG_3x2]), 'a.png');
    expect((await fetch(`${base}/attachments`, { method: 'POST', body: form })).status).toBe(401);
  });
});

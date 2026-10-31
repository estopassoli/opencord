/** Vídeo grande em partes (clipes compartilhados, até 1 GB): vira anexo comum que a mensagem usa. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Attachment, Message, ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const base = `http://127.0.0.1:${TEST_API_PORT}`;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

/** começo de um MP4 (caixa ftyp) seguido de bytes quaisquer */
const mp4 = (size: number) => {
  const b = Buffer.alloc(size, 7);
  Buffer.from([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f,
    0x32,
  ]).copy(b);
  return b;
};

async function part(token: string, id: string, n: number, data: Buffer) {
  const form = new FormData();
  form.append('n', String(n));
  form.append('file', new Blob([data]), 'parte');
  const r = await fetch(`${base}/attachments/large/${id}/parts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return r.status;
}

describe('vídeo grande em partes', () => {
  it('sobe em partes, confere o tipo e o tamanho, e a mensagem usa o anexo', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const PART = 8 * 1024 * 1024;
    const file = mp4(PART + 1000);
    const big = await http.req<{ id: string; partBytes: number }>('POST', '/attachments/large', {
      token: owner.token,
      body: { name: 'clipe.mp4', size: file.length },
    });
    expect(big.body.partBytes).toBe(PART);
    expect(await part(owner.token, big.body.id, 2, file.subarray(0, 10))).toBe(400);
    expect(await part(owner.token, big.body.id, 1, file.subarray(0, PART))).toBe(201);
    // ainda falta a última parte
    expect((await http.req('POST', `/attachments/large/${big.body.id}/complete`, { token: owner.token })).status).toBe(
      400,
    );
    expect(await part(owner.token, big.body.id, 2, file.subarray(PART))).toBe(201);
    const done = await http.req<{ attachment: Attachment }>('POST', `/attachments/large/${big.body.id}/complete`, {
      token: owner.token,
    });
    expect(done.status).toBe(201);
    expect(done.body.attachment).toMatchObject({
      mime: 'video/mp4',
      sizeBytes: file.length,
      originalName: 'clipe.mp4',
    });
    const got = await fetch(done.body.attachment.url.replace(/^https?:\/\/[^/]+/, base));
    expect(Buffer.from(await got.arrayBuffer()).equals(file)).toBe(true);

    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const text = d.body.channels.find((c) => c.kind === 'text')!.id;
    const msg = await http.req<Message>('POST', `/channels/${text}/messages`, {
      token: owner.token,
      body: { requestId: crypto.randomUUID(), body: 'meu clipe', attachmentIds: [done.body.attachment.id] },
    });
    expect(msg.status).toBe(201);
    expect(msg.body.attachments?.[0]?.id).toBe(done.body.attachment.id);
  });

  it('só vídeo, até 1 GB, e só quem começou envia', async () => {
    const { owner } = await bootstrapOwner(http);
    expect(
      (await http.req('POST', '/attachments/large', { token: owner.token, body: { name: 'x', size: 1024 ** 3 + 1 } }))
        .status,
    ).toBe(413);
    const up = await http.req<{ id: string }>('POST', '/attachments/large', {
      token: owner.token,
      body: { name: 'x.mp4', size: 100 },
    });
    expect(await part(owner.token, up.body.id, 1, Buffer.from('%PDF-1.4 nada de vídeo aqui...'))).toBe(400);
    expect((await http.req('POST', `/attachments/large/${up.body.id}/abort`, { token: owner.token })).status).toBe(204);
  });
});

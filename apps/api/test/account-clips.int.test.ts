/** Clipes na conta (ADR-0057): o vídeo sobe em partes, vira clipe da conta, não expira e pode ir para o perfil. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AccountClip, AccountClipsResponse, Attachment, ServerDetail, UserProfile } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, prisma, register, resetDb, startApp, tinyPng } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const base = `http://127.0.0.1:${TEST_API_PORT}`;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const mp4 = (size: number) => {
  const b = Buffer.alloc(size, 7);
  Buffer.from([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f,
    0x32,
  ]).copy(b);
  return b;
};

async function uploadVideo(token: string, size = 4000): Promise<Attachment> {
  const file = mp4(size);
  const big = await http.req<{ id: string }>('POST', '/attachments/large', {
    token,
    body: { name: 'clipe.mp4', size: file.length },
  });
  const form = new FormData();
  form.append('n', '1');
  form.append('file', new Blob([file]), 'parte');
  await fetch(`${base}/attachments/large/${big.body.id}/parts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const done = await http.req<{ attachment: Attachment }>('POST', `/attachments/large/${big.body.id}/complete`, {
    token,
  });
  return done.body.attachment;
}

async function uploadThumb(token: string): Promise<Attachment> {
  const form = new FormData();
  form.append('file', new Blob([tinyPng(32, 18)], { type: 'image/png' }), 'thumb.png');
  const r = await fetch(`${base}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return ((await r.json()) as { attachment: Attachment }).attachment;
}

describe('clipes na conta', () => {
  it('salva, lista em outro aparelho, destaca no perfil e apaga', async () => {
    const { owner } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const video = await uploadVideo(ana.token);
    const thumb = await uploadThumb(ana.token);
    const created = await http.req<AccountClip>('POST', '/me/clips', {
      token: ana.token,
      body: {
        videoId: video.id,
        thumbId: thumb.id,
        title: 'Clutch',
        game: 'Jogo X',
        durationMs: 30_000,
        recordedAt: 1_700_000_000_123,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: 'Clutch', game: 'Jogo X', featured: false, sizeBytes: 4000 });
    expect(created.body.recordedAt).toBe(1_700_000_000_123);
    const got = await fetch(created.body.url.replace(/^https?:\/\/[^/]+/, base));
    expect(got.status).toBe(200);

    // o mesmo vídeo não vira dois clipes nem vai para uma mensagem
    expect(
      (
        await http.req('POST', '/me/clips', {
          token: ana.token,
          body: { videoId: video.id, title: 'De novo', durationMs: 1, recordedAt: 1 },
        })
      ).status,
    ).toBe(400);
    const d = await http.req<ServerDetail>(
      'GET',
      `/servers/${(await prisma.serverMember.findFirstOrThrow({ where: { userId: ana.id } })).serverId}`,
      {
        token: ana.token,
      },
    );
    const text = d.body.channels.find((c) => c.kind === 'text')!.id;
    const msg = await http.req('POST', `/channels/${text}/messages`, {
      token: ana.token,
      body: { requestId: crypto.randomUUID(), body: 'x', attachmentIds: [video.id] },
    });
    expect(msg.status).toBe(400);

    // outra pessoa não usa o vídeo da Ana
    expect(
      (
        await http.req('POST', '/me/clips', {
          token: owner.token,
          body: { videoId: video.id, title: 'Meu', durationMs: 1, recordedAt: 1 },
        })
      ).status,
    ).toBe(400);

    // "outro aparelho": nova sessão vê o clipe
    const list = await http.req<AccountClipsResponse>('GET', '/me/clips', { token: ana.token });
    expect(list.body.clips.map((c) => c.id)).toEqual([created.body.id]);
    expect(list.body.usedBytes).toBe(4000);

    // sem destaque, o perfil não mostra
    let seen = await http.req<UserProfile>('GET', `/users/${ana.id}/profile`, { token: owner.token });
    expect(seen.body.clips).toEqual([]);
    const feat = await http.req<AccountClip>('PATCH', `/me/clips/${created.body.id}`, {
      token: ana.token,
      body: { featured: true },
    });
    expect(feat.body.featured).toBe(true);
    seen = await http.req<UserProfile>('GET', `/users/${ana.id}/profile`, { token: owner.token });
    expect(seen.body.clips?.map((c) => c.id)).toEqual([created.body.id]);

    // só a dona mexe
    expect(
      (await http.req('PATCH', `/me/clips/${created.body.id}`, { token: owner.token, body: { featured: false } }))
        .status,
    ).toBe(404);
    expect((await http.req('DELETE', `/me/clips/${created.body.id}`, { token: owner.token })).status).toBe(404);

    // a limpeza de órfãos não leva o vídeo do clipe
    await prisma.attachment.updateMany({
      where: { id: { in: [video.id, thumb.id] } },
      data: { createdAt: new Date(Date.now() - 48 * 3600_000) },
    });
    await app.get((await import('../src/attachments/attachments.service.js')).AttachmentsService).cleanupOrphans();
    expect(await prisma.attachment.count({ where: { id: { in: [video.id, thumb.id] } } })).toBe(2);

    expect((await http.req('DELETE', `/me/clips/${created.body.id}`, { token: ana.token })).status).toBe(204);
    expect(await prisma.attachment.count({ where: { id: { in: [video.id, thumb.id] } } })).toBe(0);
    expect((await http.req<AccountClipsResponse>('GET', '/me/clips', { token: ana.token })).body.clips).toEqual([]);
  });

  it('destaca no máximo 6', async () => {
    await bootstrapOwner(http);
    const ana = await register(http, 'Bia');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const v = await uploadVideo(ana.token, 1000);
      const c = await http.req<AccountClip>('POST', '/me/clips', {
        token: ana.token,
        body: { videoId: v.id, title: `C${i}`, durationMs: 1000, recordedAt: i },
      });
      ids.push(c.body.id);
    }
    for (const id of ids.slice(0, 6))
      expect((await http.req('PATCH', `/me/clips/${id}`, { token: ana.token, body: { featured: true } })).status).toBe(
        200,
      );
    expect(
      (await http.req('PATCH', `/me/clips/${ids[6]}`, { token: ana.token, body: { featured: true } })).status,
    ).toBe(400);
  });
});

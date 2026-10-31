/** Gravação de chamada (ADR-0023): quem está na chamada grava, envia em partes, todos veem o aviso; 24 h e some. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CallRecording, ChannelRecordings, ServerDetail } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RecordingsService } from '../src/recordings/recordings.service.js';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, connectSocket, Http, nextEvent, outsider, register, resetDb, startApp } from './helpers.js';

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

async function part(token: string, id: string, n: number, data: Buffer) {
  const form = new FormData();
  form.append('n', String(n));
  form.append('file', new Blob([data]), 'parte.mp4');
  const res = await fetch(`${base}/recordings/${id}/parts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
}

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const alice = await register(http);
  const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
  return { owner, alice, serverId, voiceId };
}

describe('gravação de chamada', () => {
  it('grava em partes, avisa a chamada, fica pronta por 24 h e só quem vê o canal baixa', async () => {
    const { owner, alice, voiceId } = await setup();
    const so = await connectSocket(owner.token);
    sockets.push(so);
    // fora da chamada não grava
    expect((await http.req('POST', `/voice/channels/${voiceId}/recordings`, { token: alice.token })).status).toBe(403);
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });

    const started = nextEvent<{ recording: { userId: string } | null }>(so, 'recording:state', (e) => !!e.recording);
    const rec = await http.req<{ id: string; partBytes: number }>('POST', `/voice/channels/${voiceId}/recordings`, {
      token: alice.token,
    });
    expect(rec.status).toBe(201);
    expect((await started).recording!.userId).toBe(alice.id);
    // uma gravação por chamada
    expect((await http.req('POST', `/voice/channels/${voiceId}/recordings`, { token: owner.token })).status).toBe(409);
    const listed = await http.req<ChannelRecordings>('GET', `/voice/channels/${voiceId}/recordings`, {
      token: owner.token,
    });
    expect(listed.body.active?.id).toBe(rec.body.id);

    // partes em ordem; só quem grava envia
    const a = Buffer.alloc(1000, 1);
    const b = Buffer.alloc(500, 2);
    expect(await part(alice.token, rec.body.id, 2, a)).toBe(400);
    expect(await part(owner.token, rec.body.id, 1, a)).toBe(404);
    expect(await part(alice.token, rec.body.id, 1, a)).toBe(201);
    expect(await part(alice.token, rec.body.id, 2, b)).toBe(201);

    const ready = nextEvent<{ recording: CallRecording }>(so, 'recording:ready');
    const stopped = nextEvent<{ recording: unknown }>(so, 'recording:state', (e) => e.recording === null);
    const done = await http.req<CallRecording>('POST', `/recordings/${rec.body.id}/complete`, {
      token: alice.token,
      body: { durationMs: 5000 },
    });
    expect(done.body).toMatchObject({ durationMs: 5000, sizeBytes: 1500 });
    expect(new Date(done.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    await stopped;
    expect((await ready).recording.id).toBe(rec.body.id);

    // download por link assinado: o arquivo é a junção das partes
    const link = await http.req<{ url: string }>('POST', `/recordings/${rec.body.id}/link`, { token: owner.token });
    const file = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, base));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/attachment/);
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.concat([a, b]))).toBe(true);
    expect((await fetch(`${base}/recordings/${rec.body.id}/download?exp=9999999999&sig=x`)).status).toBe(404);
    const stranger = await outsider(http);
    expect((await http.req('POST', `/recordings/${rec.body.id}/link`, { token: stranger.token })).status).toBe(404);

    // 24 h depois a varredura apaga arquivo e registro
    const svc = app.get(RecordingsService);
    await svc.sweep(new Date(Date.now() + 25 * 3600_000));
    expect((await http.req('POST', `/recordings/${rec.body.id}/link`, { token: owner.token })).status).toBe(404);
  });

  it('app de quem grava caiu: o que subiu vira gravação pronta; sem partes, é descartada', async () => {
    const { owner, alice, voiceId } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const rec = await http.req<{ id: string }>('POST', `/voice/channels/${voiceId}/recordings`, { token: alice.token });
    expect(await part(alice.token, rec.body.id, 1, Buffer.alloc(100, 3))).toBe(201);
    const svc = app.get(RecordingsService);
    // 7 h depois (o aviso "gravando" expirou há muito): fecha com o que já subiu
    await svc.sweep(new Date(Date.now() + 7 * 3600_000));
    const list = await http.req<ChannelRecordings>('GET', `/voice/channels/${voiceId}/recordings`, {
      token: owner.token,
    });
    expect(list.body.active).toBeNull();
    expect(list.body.ready.map((r) => r.id)).toEqual([rec.body.id]);

    const empty = await http.req<{ id: string }>('POST', `/voice/channels/${voiceId}/recordings`, {
      token: alice.token,
    });
    expect(
      (await http.req('POST', `/recordings/${empty.body.id}/complete`, { token: alice.token, body: { durationMs: 1 } }))
        .status,
    ).toBe(400);
    const after = await http.req<ChannelRecordings>('GET', `/voice/channels/${voiceId}/recordings`, {
      token: owner.token,
    });
    expect(after.body.ready).toHaveLength(1);
  });
});

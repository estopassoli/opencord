/** Efeitos sonoros: qualquer membro envia; tocar avisa a chamada; tipo pelos bytes; limite e anti-flood (ADR-0016). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerDetail, SoundEffect } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import {
  bootstrapOwner,
  command,
  connectSocket,
  Http,
  nextEvent,
  outsider,
  register,
  resetDb,
  startApp,
} from './helpers.js';

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

/** MP3 mínimo: tag ID3v2 vazia + cabeçalho de quadro MPEG-1 Layer III. */
const mp3 = () =>
  Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]),
    Buffer.from([0xff, 0xfb, 0x90, 0x64]),
    Buffer.alloc(413),
  ]);

async function upload(token: string, serverId: string, data: Buffer, name = 'buzina', mime = 'audio/mpeg') {
  const form = new FormData();
  form.append('name', name);
  form.append('volume', '0.8');
  form.append('durationMs', '1500');
  form.append('file', new Blob([data], { type: mime }), 'som.mp3');
  const res = await fetch(`${base}/servers/${serverId}/sounds`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as SoundEffect & { message?: string } };
}

describe('efeitos sonoros', () => {
  it('membro comum envia, todos listam, tocar avisa quem está na chamada; anti-flood; remoção', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const up = await upload(alice.token, serverId, mp3());
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'buzina', volume: 0.8, createdBy: { id: alice.id } });
    const list = await http.req<SoundEffect[]>('GET', `/servers/${serverId}/sounds`, { token: owner.token });
    expect(list.body.map((s) => s.id)).toEqual([up.body.id]);
    // arquivo para quem é membro; quem não é recebe 404
    expect(
      (await fetch(`${base}/sounds/${up.body.id}/file`, { headers: { authorization: `Bearer ${owner.token}` } }))
        .status,
    ).toBe(200);
    const stranger = await outsider(http);
    expect(
      (await fetch(`${base}/sounds/${up.body.id}/file`, { headers: { authorization: `Bearer ${stranger.token}` } }))
        .status,
    ).toBe(404);

    // tocar: só quem está na chamada; quem está nela recebe o aviso
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
    const [so, sa] = await Promise.all([owner, alice].map((u) => connectSocket(u.token)));
    sockets.push(so!, sa!);
    expect((await command(sa!, 'sound:play', { channelId: voiceId, soundId: up.body.id })).ok).toBe(false);
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const heard = nextEvent<{ soundId: string; userId: string }>(so!, 'sound:played', (e) => e.soundId === up.body.id);
    expect((await command(sa!, 'sound:play', { channelId: voiceId, soundId: up.body.id })).ok).toBe(true);
    expect(await heard).toMatchObject({ userId: alice.id });
    // anti-flood: segundo som logo em seguida é recusado
    expect((await command(sa!, 'sound:play', { channelId: voiceId, soundId: up.body.id })).ok).toBe(false);

    // outra pessoa não remove o som de alice; o dono (gerencia o servidor) remove
    const bob = await register(http);
    expect((await http.req('DELETE', `/servers/${serverId}/sounds/${up.body.id}`, { token: bob.token })).status).toBe(
      403,
    );
    expect((await http.req('DELETE', `/servers/${serverId}/sounds/${up.body.id}`, { token: owner.token })).status).toBe(
      204,
    );
  });

  it('som de outro servidor toca em qualquer chamada; quem ouve baixa o arquivo enquanto vale o aviso', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    // alice tem um servidor próprio, de que o dono não é membro
    const other = await http.req<ServerDetail>('POST', '/servers', { token: alice.token, body: { name: 'Sons' } });
    const up = await upload(alice.token, other.body.id, mp3(), 'risada');
    expect(up.status).toBe(201);
    const mine = await http.req<SoundEffect[]>('GET', '/sounds', { token: alice.token });
    expect(mine.body.map((s) => s.id)).toContain(up.body.id);
    expect(
      (await http.req<SoundEffect[]>('GET', '/sounds', { token: owner.token })).body.map((s) => s.id),
    ).not.toContain(up.body.id);
    const file = (token: string) =>
      fetch(`${base}/sounds/${up.body.id}/file`, { headers: { authorization: `Bearer ${token}` } }).then(
        (r) => r.status,
      );
    expect(await file(owner.token)).toBe(404);

    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
    const [so, sa] = await Promise.all([owner, alice].map((u) => connectSocket(u.token)));
    sockets.push(so!, sa!);
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const heard = nextEvent<{ soundId: string; serverId: string; volume: number }>(
      so!,
      'sound:played',
      (e) => e.soundId === up.body.id,
    );
    expect((await command(sa!, 'sound:play', { channelId: voiceId, soundId: up.body.id })).ok).toBe(true);
    expect(await heard).toMatchObject({ serverId, volume: 0.8 });
    // quem está na chamada baixa o som tocado nela; o dono não consegue tocar som de servidor alheio
    expect(await file(owner.token)).toBe(200);
    await new Promise((r) => setTimeout(r, 1600));
    expect((await command(so!, 'sound:play', { channelId: voiceId, soundId: up.body.id })).ok).toBe(false);
  });

  it('tipo pelos bytes, nome obrigatório e limite de 1 MB', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    expect((await upload(owner.token, serverId, Buffer.from('<svg/>'), 'x', 'audio/mpeg')).status).toBe(400);
    expect((await upload(owner.token, serverId, mp3(), '')).status).toBe(400);
    expect((await upload(owner.token, serverId, Buffer.concat([mp3(), Buffer.alloc(1024 * 1024)]))).status).toBe(413);
  });
});

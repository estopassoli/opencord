/** "Assistir juntos": estado sincronizado só entre quem está na chamada (ADR-0009). Sem rede externa (oEmbed off). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ActivityState, ServerDetail } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, command, connectSocket, Http, nextEvent, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
  for (const u of [owner, alice])
    expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token })).status).toBe(201);
  const [so, sa, sb] = await Promise.all([owner, alice, bob].map((u) => connectSocket(u.token)));
  sockets.push(so!, sa!, sb!);
  return { owner, alice, bob, voiceId, so: so!, sa: sa!, sb: sb! };
}

describe('Assistir juntos (YouTube)', () => {
  it('quem está na chamada inicia, controla e todos recebem o estado', async () => {
    const { voiceId, so, sa } = await setup();
    const got = nextEvent<ActivityState>(sa, 'activity:state', (s) => s.channelId === voiceId);
    const start = await command<ActivityState>(so, 'activity:youtube:start', {
      channelId: voiceId,
      videoId: 'dQw4w9WgXcQ',
    });
    expect(start.ok).toBe(true);
    const s1 = await got;
    expect(s1).toMatchObject({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', playing: true, positionSec: 0, revision: 1 });

    // alice pausa em 42 s; o dono recebe
    const paused = nextEvent<ActivityState>(so, 'activity:state', (s) => s.revision === 2);
    expect(
      (await command(sa, 'activity:youtube:control', { channelId: voiceId, action: 'pause', positionSec: 42 })).ok,
    ).toBe(true);
    expect(await paused).toMatchObject({ playing: false, positionSec: 42 });

    // quem entra depois pega o estado atual
    const now = await command<ActivityState>(sa, 'activity:get', { channelId: voiceId });
    expect(now.data).toMatchObject({ playing: false, positionSec: 42, revision: 2 });
    expect(Math.abs(now.data!.serverNow - Date.now())).toBeLessThan(5000);

    // trocar de vídeo reinicia do zero, tocando
    const changed = await command<ActivityState>(so, 'activity:youtube:start', {
      channelId: voiceId,
      videoId: 'jNQXAC9IVRw',
    });
    expect(changed.data).toMatchObject({ videoId: 'jNQXAC9IVRw', positionSec: 0, playing: true, revision: 3 });

    const ended = nextEvent(sa, 'activity:ended');
    expect((await command(so, 'activity:stop', { channelId: voiceId })).ok).toBe(true);
    await ended;
    expect((await command(sa, 'activity:get', { channelId: voiceId })).data).toBeNull();
  });

  it('quem não está na chamada não inicia nem controla; id de vídeo inválido é recusado', async () => {
    const { voiceId, so, sb } = await setup();
    const r = await command(sb, 'activity:youtube:start', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('403');
    expect((await command(so, 'activity:youtube:start', { channelId: voiceId, videoId: 'curto' })).ok).toBe(false);
    expect((await command(sb, 'activity:get', { channelId: voiceId })).ok).toBe(false);
  });

  it('a atividade acaba quando a chamada esvazia', async () => {
    const { owner, alice, voiceId, so, sb } = await setup();
    await command(so, 'activity:youtube:start', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' });
    const ended = nextEvent<{ channelId: string }>(sb, 'activity:ended', (e) => e.channelId === voiceId);
    for (const u of [owner, alice]) await http.req('POST', '/voice/leave', { token: u.token });
    await ended;
  });

  it('pesquisa sem YOUTUBE_API_KEY explica que é só por link', async () => {
    const { owner } = await setup();
    const r = await http.req<{ message: string }>('GET', '/activities/youtube/search?q=lofi', { token: owner.token });
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/cole um link/);
    const info = await http.req<{ youtubeSearch: boolean }>('GET', '/auth/instance');
    expect(info.body.youtubeSearch).toBe(false);
  });
});

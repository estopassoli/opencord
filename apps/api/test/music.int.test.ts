/** Música na chamada: DJ controla a fila, quem ouve não; fim da faixa avança uma vez só; DJ passa adiante (ADR-0014). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MusicState, ServerDetail } from '@opencord/contracts';
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

const data = <T>(r: { ok: boolean; data?: unknown }) => {
  expect(r.ok).toBe(true);
  return r.data as T;
};

describe('Música na chamada', () => {
  it('quem começa é o DJ: todos adicionam à fila, só o DJ controla; fim da faixa avança uma vez', async () => {
    const { owner, voiceId, so, sa } = await setup();
    const first = data<MusicState>(await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' }));
    expect(first).toMatchObject({ index: 0, playing: true, positionSec: 0, djId: owner.id });

    // alice ouve: adiciona à fila (o DJ continua o mesmo e todos recebem o estado)
    const got = nextEvent<MusicState>(so, 'music:state', (s) => s.queue.length === 2);
    const added = data<MusicState>(await command(sa, 'music:add', { channelId: voiceId, videoId: 'jNQXAC9IVRw' }));
    expect(added).toMatchObject({ index: 0, playing: true, djId: owner.id });
    expect((await got).queue.map((t) => t.videoId)).toEqual(['dQw4w9WgXcQ', 'jNQXAC9IVRw']);
    // mas não tira da fila, não pausa, não pula, não encerra
    const hers = added.queue[1]!.id;
    expect((await command(sa, 'music:control', { channelId: voiceId, action: 'remove', trackId: hers })).ok).toBe(
      false,
    );
    for (const action of ['pause', 'next', 'seek'] as const)
      expect((await command(sa, 'music:control', { channelId: voiceId, action, positionSec: 3 })).ok).toBe(false);
    expect((await command(sa, 'music:stop', { channelId: voiceId })).ok).toBe(false);

    // o DJ controla
    expect(data<MusicState>(await command(so, 'music:control', { channelId: voiceId, action: 'pause' })).playing).toBe(
      false,
    );
    const skipped = data<MusicState>(await command(so, 'music:control', { channelId: voiceId, action: 'next' }));
    expect(skipped).toMatchObject({ index: 1, playing: true, positionSec: 0 });

    // fim da faixa: o player de qualquer um avisa; só o primeiro aviso avança
    const cur = skipped.queue[1]!.id;
    const e1 = data<MusicState>(
      await command(sa, 'music:control', { channelId: voiceId, action: 'ended', trackId: cur }),
    );
    const e2 = data<MusicState>(
      await command(so, 'music:control', { channelId: voiceId, action: 'ended', trackId: cur }),
    );
    expect(e1).toMatchObject({ index: -1, playing: false });
    expect(e2.revision).toBe(e1.revision);

    // fila terminada: quem adicionar recomeça a música e vira o DJ
    const alices = data<MusicState>(await command(sa, 'music:add', { channelId: voiceId, videoId: 'M7lc1UVf-VE' }));
    expect(alices.index).toBe(0);
    expect(alices.queue.map((t) => t.videoId)).toEqual(['M7lc1UVf-VE']);
    expect(alices.djId).not.toBe(owner.id);
  });

  it('link de vídeo dentro de playlist sem chave do YouTube: entra só o vídeo; playlist sozinha é recusada', async () => {
    const { voiceId, so } = await setup();
    const s = data<MusicState>(
      await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ', playlistId: 'PLabcdefghijklmnop' }),
    );
    expect(s.queue.map((t) => t.videoId)).toEqual(['dQw4w9WgXcQ']);
    expect((await command(so, 'music:add', { channelId: voiceId, playlistId: 'PLabcdefghijklmnop' })).ok).toBe(false);
  });

  it('DJ sai: quem está na chamada há mais tempo assume; todos saem: a música acaba', async () => {
    const { owner, alice, bob, voiceId, so, sb } = await setup();
    expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: bob.token })).status).toBe(201);
    await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' });
    const handed = nextEvent<MusicState>(sb, 'music:state', (s) => s.djId !== owner.id);
    await http.req('POST', '/voice/leave', { token: owner.token });
    expect((await handed).djId).toBe(alice.id); // alice entrou antes de bob
    const ended = nextEvent<{ channelId: string }>(sb, 'music:ended', (e) => e.channelId === voiceId);
    await http.req('POST', '/voice/leave', { token: alice.token });
    await http.req('POST', '/voice/leave', { token: bob.token });
    expect((await ended).channelId).toBe(voiceId);
  });

  it('quem não está na chamada não vê nem controla; o DJ encerra e avisa todos', async () => {
    const { voiceId, so, sa, sb } = await setup();
    await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' });
    expect((await command(sb, 'music:get', { channelId: voiceId })).ok).toBe(false);
    expect((await command(sb, 'music:control', { channelId: voiceId, action: 'pause' })).ok).toBe(false);
    const ended = nextEvent<{ channelId: string }>(sa, 'music:ended', (e) => e.channelId === voiceId);
    expect((await command(so, 'music:stop', { channelId: voiceId })).ok).toBe(true);
    expect((await ended).channelId).toBe(voiceId);
    expect(data<MusicState | null>(await command(sa, 'music:get', { channelId: voiceId }))).toBeNull();
  });
});

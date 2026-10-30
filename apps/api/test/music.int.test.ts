/** Música na chamada: fila compartilhada, todos controlam, fim da faixa avança uma vez só (ADR-0014). */
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
  return { owner, alice, voiceId, so: so!, sa: sa!, sb: sb! };
}

const data = <T>(r: { ok: boolean; data?: unknown }) => {
  expect(r.ok).toBe(true);
  return r.data as T;
};

describe('Música na chamada', () => {
  it('fila: a primeira toca, as próximas entram na fila; todos na chamada controlam e recebem o estado', async () => {
    const { voiceId, so, sa } = await setup();
    const first = data<MusicState>(await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' }));
    expect(first).toMatchObject({ index: 0, playing: true, positionSec: 0 });
    const got = nextEvent<MusicState>(so, 'music:state', (s) => s.queue.length === 2);
    const second = data<MusicState>(await command(sa, 'music:add', { channelId: voiceId, videoId: 'jNQXAC9IVRw' }));
    expect(second.index).toBe(0);
    expect((await got).queue.map((t) => t.videoId)).toEqual(['dQw4w9WgXcQ', 'jNQXAC9IVRw']);

    // alice (não iniciou) pausa e pula: todos controlam
    expect(data<MusicState>(await command(sa, 'music:control', { channelId: voiceId, action: 'pause' })).playing).toBe(
      false,
    );
    const skipped = data<MusicState>(await command(sa, 'music:control', { channelId: voiceId, action: 'next' }));
    expect(skipped).toMatchObject({ index: 1, playing: true, positionSec: 0 });

    // fim da faixa: dois players avisam; só o primeiro aviso avança
    const cur = skipped.queue[1]!.id;
    const e1 = data<MusicState>(
      await command(so, 'music:control', { channelId: voiceId, action: 'ended', trackId: cur }),
    );
    const e2 = data<MusicState>(
      await command(sa, 'music:control', { channelId: voiceId, action: 'ended', trackId: cur }),
    );
    expect(e1).toMatchObject({ index: -1, playing: false });
    expect(e2.revision).toBe(e1.revision);

    // fila terminada: adicionar volta a tocar a faixa nova
    const again = data<MusicState>(await command(so, 'music:add', { channelId: voiceId, videoId: 'M7lc1UVf-VE' }));
    expect(again).toMatchObject({ index: 2, playing: true });

    // tirar a faixa atual segue para a que ocupou o lugar (aqui: nenhuma) e jump volta a uma anterior
    const jumped = data<MusicState>(
      await command(so, 'music:control', { channelId: voiceId, action: 'jump', trackId: again.queue[0]!.id }),
    );
    expect(jumped.index).toBe(0);
    const removed = data<MusicState>(
      await command(so, 'music:control', { channelId: voiceId, action: 'remove', trackId: again.queue[1]!.id }),
    );
    expect(removed.queue).toHaveLength(2);
    expect(removed.index).toBe(0);
  });

  it('quem não está na chamada não vê nem controla; encerrar avisa todos', async () => {
    const { voiceId, so, sa, sb } = await setup();
    await command(so, 'music:add', { channelId: voiceId, videoId: 'dQw4w9WgXcQ' });
    expect((await command(sb, 'music:get', { channelId: voiceId })).ok).toBe(false);
    expect((await command(sb, 'music:control', { channelId: voiceId, action: 'pause' })).ok).toBe(false);
    const ended = nextEvent<{ channelId: string }>(sa, 'music:ended', (e) => e.channelId === voiceId);
    expect((await command(sa, 'music:stop', { channelId: voiceId })).ok).toBe(true);
    expect((await ended).channelId).toBe(voiceId);
    expect(data<MusicState | null>(await command(so, 'music:get', { channelId: voiceId }))).toBeNull();
  });
});

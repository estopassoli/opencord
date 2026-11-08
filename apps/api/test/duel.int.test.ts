/** x1 no soco do Espaço 3D (ADR-0055): o servidor decide convite, contagem, golpes (alcance, mira, recarga, defesa). */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DUEL_HP, DUEL_JAB, DUEL_STRONG, type ServerDetail, type SpaceDuel } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  command,
  connectSocket,
  Http,
  nextEvent,
  register,
  resetDb,
  sleep,
  startApp,
} from './helpers.js';

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
  const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
  for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
  const [so, sa] = await Promise.all([owner, alice].map((u) => connectSocket(u.token)));
  sockets.push(so!, sa!);
  // posições no espaço: frente a frente, a 1 m (o dono olha para +z, a alice para -z)
  const place = async (s: Socket, z: number, ry: number, a = 0) => {
    s.emit('space:move', { channelId: voiceId, x: 0, y: 0, z, ry, a });
    await sleep(120);
  };
  await place(so!, 0, 0);
  await place(sa!, 1, Math.PI);
  return { owner, alice, voiceId, so: so!, sa: sa!, place };
}

describe('x1 no soco', () => {
  it('convite, contagem, golpes decididos pelo servidor e desistência', async () => {
    const { owner, alice, voiceId, so, sa, place } = await setup();

    // recusar
    const c1 = await command<SpaceDuel>(so, 'space:duel:challenge', { channelId: voiceId, targetId: alice.id });
    expect(c1.ok).toBe(true);
    expect(c1.data).toMatchObject({ status: 'pending', a: owner.id, b: alice.id, hp: { [owner.id]: DUEL_HP } });
    expect((await command(so, 'space:duel:answer', { duelId: c1.data!.id, accept: true })).ok).toBe(false); // só o desafiado
    const no = await command<SpaceDuel>(sa, 'space:duel:answer', { duelId: c1.data!.id, accept: false });
    expect(no.data).toMatchObject({ status: 'ended', reason: 'declined' });

    // aceitar: contagem e luta
    const c2 = await command<SpaceDuel>(so, 'space:duel:challenge', { channelId: voiceId, targetId: alice.id });
    const id = c2.data!.id;
    expect((await command(sa, 'space:duel:challenge', { channelId: voiceId, targetId: owner.id })).ok).toBe(false); // já em x1
    const fighting = nextEvent<SpaceDuel>(sa, 'space:duel', (d) => d.id === id && d.status === 'fighting', 6000);
    const yes = await command<SpaceDuel>(sa, 'space:duel:answer', { duelId: id, accept: true });
    expect(yes.data?.status).toBe('countdown');
    // golpe antes de valer não conta
    expect((await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: false })).data?.hp[alice.id]).toBe(
      DUEL_HP,
    );
    await fighting;
    // o app manda a posição a cada segundo mesmo parado; a contagem durou 3 s
    await place(so, 0, 0);
    await place(sa, 1, Math.PI);

    // soco rápido acerta
    let r = await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: false });
    expect(r.data?.hp[alice.id]).toBe(DUEL_HP - DUEL_JAB);
    // recarga: o segundo logo em seguida não conta
    r = await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: false });
    expect(r.data?.hp[alice.id]).toBe(DUEL_HP - DUEL_JAB);

    // de costas não acerta
    await place(so, 0, Math.PI);
    r = await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: true });
    expect(r.data?.hp[alice.id]).toBe(DUEL_HP - DUEL_JAB);

    // defendendo, o soco forte tira só um quarto
    await place(so, 0, 0);
    await place(sa, 1, Math.PI, 8);
    await sleep(1150);
    r = await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: true });
    expect(r.data?.hp[alice.id]).toBe(DUEL_HP - DUEL_JAB - Math.round(DUEL_STRONG / 4));
    expect(r.data?.lastHit).toMatchObject({ by: owner.id, on: alice.id, blocked: true });

    // longe demais não acerta
    await place(sa, 4, Math.PI);
    await sleep(450);
    const before = r.data!.hp[alice.id];
    r = await command<SpaceDuel>(so, 'space:duel:hit', { duelId: id, strong: false });
    expect(r.data?.hp[alice.id]).toBe(before);

    // desistir: o outro vence
    const end = nextEvent<SpaceDuel>(so, 'space:duel', (d) => d.id === id && d.status === 'ended');
    await command(sa, 'space:duel:forfeit', { duelId: id });
    expect(await end).toMatchObject({ winner: owner.id, reason: 'forfeit' });
  }, 20_000);

  it('quem sai do espaço perde a luta', async () => {
    const { owner, alice, voiceId, so, sa } = await setup();
    const c = await command<SpaceDuel>(so, 'space:duel:challenge', { channelId: voiceId, targetId: alice.id });
    await command(sa, 'space:duel:answer', { duelId: c.data!.id, accept: true });
    const end = nextEvent<SpaceDuel>(sa, 'space:duel', (d) => d.status === 'ended');
    so.emit('space:leave', { channelId: voiceId });
    expect(await end).toMatchObject({ winner: alice.id, reason: 'left' });
    expect(owner.id).not.toBe(alice.id);
  });
});

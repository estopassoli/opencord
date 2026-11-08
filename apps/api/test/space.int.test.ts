/** Espaço 3D (ADR-0055): ambiente por servidor (gerado ou editado com EDIT_SPACE), telão e posições só na chamada. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  generateSpace,
  Permission,
  type Role,
  type ServerDetail,
  type ServerSpace,
  type SpaceSession,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  command,
  connectSocket,
  Http,
  nextEvent,
  noEvent,
  register,
  resetDb,
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
  const bob = await register(http);
  const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
  const [so, sa, sb] = await Promise.all([owner, alice, bob].map((u) => connectSocket(u.token)));
  sockets.push(so!, sa!, sb!);
  return { owner, alice, bob, serverId, voiceId, so: so!, sa: sa!, sb: sb! };
}

describe('Espaço 3D', () => {
  it('sem edição devolve o ambiente gerado pelo id do servidor; servidores diferentes têm ambientes diferentes', async () => {
    const { alice, serverId } = await setup();
    const r = await http.req<ServerSpace>('GET', `/servers/${serverId}/space`, { token: alice.token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ serverId, revision: 0, updatedAt: null });
    expect(r.body.layout).toEqual(generateSpace(serverId));
    expect(generateSpace(serverId)).not.toEqual(generateSpace('01a1bc36-0000-7000-8000-000000000000'));
  });

  it('editar exige EDIT_SPACE; quem tem salva, todos do servidor recebem; revisão velha dá 409', async () => {
    const { owner, alice, serverId, sa } = await setup();
    const base = (await http.req<ServerSpace>('GET', `/servers/${serverId}/space`, { token: owner.token })).body;
    const layout = { ...base.layout, width: 30, items: base.layout.items.slice(0, 3) };

    const denied = await http.req('PUT', `/servers/${serverId}/space`, {
      token: alice.token,
      body: { layout, baseRevision: 0 },
    });
    expect(denied.status).toBe(403);

    const got = nextEvent<ServerSpace>(sa, 'space:layout', (s) => s.serverId === serverId);
    const saved = await http.req<ServerSpace>('PUT', `/servers/${serverId}/space`, {
      token: owner.token,
      body: { layout, baseRevision: 0 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ revision: 1, updatedBy: owner.id });
    expect(saved.body.layout.width).toBe(30);
    expect((await got).revision).toBe(1);

    const stale = await http.req('PUT', `/servers/${serverId}/space`, {
      token: owner.token,
      body: { layout, baseRevision: 0 },
    });
    expect(stale.status).toBe(409);

    // dar a permissão por cargo libera a edição
    const detail = await http.req<ServerDetail & { roles: Role[] }>('GET', `/servers/${serverId}`, {
      token: owner.token,
    });
    const everyone = detail.body.roles.find((r) => r.isEveryone)!;
    await http.req('PATCH', `/roles/${everyone.id}`, {
      token: owner.token,
      body: { permissions: everyone.permissions | Permission.EDIT_SPACE },
    });
    const ok = await http.req<ServerSpace>('PUT', `/servers/${serverId}/space`, {
      token: alice.token,
      body: { layout: { ...layout, theme: 'beach' }, baseRevision: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.revision).toBe(2);

    const reset = await http.req<ServerSpace>('DELETE', `/servers/${serverId}/space`, { token: alice.token });
    expect(reset.body.layout).toEqual(generateSpace(serverId));
  });

  it('ambiente inválido (peça fora do piso, id repetido) é recusado', async () => {
    const { owner, serverId } = await setup();
    const base = generateSpace(serverId);
    const out = { ...base, items: [{ id: 'a', kind: 'sofa', x: 999, z: 0, rot: 0 }] };
    const dup = { ...base, items: [base.items[0], base.items[0]] };
    for (const layout of [out, dup])
      expect(
        (await http.req('PUT', `/servers/${serverId}/space`, { token: owner.token, body: { layout, baseRevision: 0 } }))
          .status,
      ).toBe(400);
  });

  it('telão e posições: só quem está na chamada; a posição chega só a quem está nela', async () => {
    const { owner, alice, voiceId, so, sa, sb } = await setup();
    // fora da chamada não usa o telão
    expect((await command(sa, 'space:screen', { channelId: voiceId, screen: { kind: 'activity' } })).ok).toBe(false);

    for (const u of [owner, alice])
      expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token })).status).toBe(201);

    // só lives de quem está na chamada
    const bobLive = await command(so, 'space:screen', {
      channelId: voiceId,
      screen: { kind: 'stream', userId: (await register(http)).id },
    });
    expect(bobLive.ok).toBe(false);

    const state = nextEvent<SpaceSession>(sa, 'space:state', (s) => s.channelId === voiceId);
    const set = await command<SpaceSession>(so, 'space:screen', {
      channelId: voiceId,
      screen: { kind: 'stream', userId: alice.id },
    });
    expect(set.ok).toBe(true);
    expect((await state).screen).toEqual({ kind: 'stream', userId: alice.id });
    expect((await command<SpaceSession>(sa, 'space:get', { channelId: voiceId })).data?.revision).toBe(1);

    const moved = nextEvent<{ userId: string; x: number }>(sa, 'space:moved', (m) => m.userId === owner.id);
    const notBob = noEvent(sb, 'space:moved', () => true, 1200);
    const notSelf = noEvent(so, 'space:moved', () => true, 1200);
    so.emit('space:move', { channelId: voiceId, x: 1.5, y: 0, z: -2, ry: 0.3, a: 1 });
    expect((await moved).x).toBe(1.5);
    await notBob;
    await notSelf;

    // posição de quem não está na chamada é ignorada
    const ignored = noEvent(sa, 'space:moved', () => true, 1000);
    sb.emit('space:move', { channelId: voiceId, x: 0, y: 0, z: 0, ry: 0, a: 0 });
    await ignored;

    const left = nextEvent<{ userId: string }>(sa, 'space:left', (m) => m.userId === owner.id);
    so.emit('space:leave', { channelId: voiceId });
    expect((await left).userId).toBe(owner.id);

    // chamada vazia: o telão some
    const ended = nextEvent<{ channelId: string }>(so, 'space:ended', (e) => e.channelId === voiceId);
    for (const u of [owner, alice]) await http.req('POST', '/voice/leave', { token: u.token });
    expect((await ended).channelId).toBe(voiceId);
  });

  it('liga/desliga só luminária, lareira e fliperama do ambiente, para todos da chamada', async () => {
    const { owner, alice, serverId, voiceId, so, sa } = await setup();
    const base = generateSpace(serverId);
    const layout = {
      ...base,
      items: [
        { id: 'lamp1', kind: 'lamp', x: 0, z: 0, rot: 0 },
        { id: 'sofa1', kind: 'sofa', x: 2, z: 0, rot: 0 },
      ],
    };
    expect(
      (await http.req('PUT', `/servers/${serverId}/space`, { token: owner.token, body: { layout, baseRevision: 0 } }))
        .status,
    ).toBe(200);
    expect((await command(so, 'space:toggle', { channelId: voiceId, itemId: 'lamp1', on: false })).ok).toBe(false);
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });

    const got = nextEvent<SpaceSession>(sa, 'space:state', (s) => s.channelId === voiceId);
    const off = await command<SpaceSession>(so, 'space:toggle', { channelId: voiceId, itemId: 'lamp1', on: false });
    expect(off.ok).toBe(true);
    expect((await got).toggles).toEqual({ lamp1: false });
    // trocar o telão mantém as luzes
    const scr = await command<SpaceSession>(so, 'space:screen', { channelId: voiceId, screen: { kind: 'activity' } });
    expect(scr.data?.toggles).toEqual({ lamp1: false });

    expect((await command(so, 'space:toggle', { channelId: voiceId, itemId: 'sofa1', on: false })).ok).toBe(false);
    expect((await command(so, 'space:toggle', { channelId: voiceId, itemId: 'naoexiste', on: true })).ok).toBe(false);
  });

  it('esportes: bola repassada só na chamada; placar no servidor sem contar o mesmo lance duas vezes', async () => {
    const { owner, alice, voiceId, so, sa, sb } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const ball = { channelId: voiceId, zone: 2, x: 1, y: 0.2, z: 3, vx: 4, vy: 0, vz: -2, held: null, t: 1 };
    const got = nextEvent<{ by: string; vx: number }>(sa, 'space:ball', (b) => b.by === owner.id);
    const notBob = noEvent(sb, 'space:ball', () => true, 1000);
    so.emit('space:ball', ball);
    expect((await got).vx).toBe(4);
    await notBob;

    const s1 = await command<SpaceSession>(so, 'space:score', { channelId: voiceId, zone: 2, side: 'a', points: 1 });
    expect(s1.data?.scores?.['2']).toEqual({ a: 1, b: 0 });
    // o outro app viu o mesmo gol: não conta de novo
    const s2 = await command<SpaceSession>(sa, 'space:score', { channelId: voiceId, zone: 2, side: 'a', points: 1 });
    expect(s2.data?.scores?.['2']).toEqual({ a: 1, b: 0 });
    const r = await command<SpaceSession>(sa, 'space:score:reset', { channelId: voiceId, zone: 2 });
    expect(r.data?.scores?.['2']).toEqual({ a: 0, b: 0 });
  });
});

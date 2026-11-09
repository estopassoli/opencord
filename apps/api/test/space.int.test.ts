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

  it('gunfight: tiro, acerto e morte repassados só na chamada, com quem mandou', async () => {
    const { owner, alice, voiceId, so, sa, sb } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const hit = { channelId: voiceId, kind: 'hit', w: 'm4', target: alice.id, dmg: 28, head: false };
    const got = nextEvent<{ sender: string; dmg: number; target: string }>(
      sa,
      'space:gun',
      (g) => g.sender === owner.id,
    );
    const notBob = noEvent(sb, 'space:gun', () => true, 1000);
    so.emit('space:gun', hit);
    const g = await got;
    expect(g.dmg).toBe(28);
    expect(g.target).toBe(alice.id);
    await notBob;
    // arma que não existe é descartada
    const none = noEvent(sa, 'space:gun', () => true, 600);
    so.emit('space:gun', { ...hit, w: 'bazuca' });
    await none;
    // os acessórios da arma vão na pose (ADR-0059): repassados como vieram; código fora do formato descarta a pose
    const pose = { w: 'm4', pitch: 0, crouch: false, ads: false, alive: true, att: [1, 1, 0, 1] };
    const moved = nextEvent<{ userId: string; gun?: { att?: number[] } }>(
      sa,
      'space:moved',
      (m) => m.userId === owner.id,
    );
    so.emit('space:move', { channelId: voiceId, x: 0, y: 0, z: 0, ry: 0, a: 0, zone: 8, gun: pose });
    expect((await moved).gun?.att).toEqual([1, 1, 0, 1]);
    const bad = noEvent(sa, 'space:moved', () => true, 600);
    so.emit('space:move', { channelId: voiceId, x: 0, y: 0, z: 0, ry: 0, a: 0, zone: 8, gun: { ...pose, att: [99] } });
    await bad;
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

    const s1 = await command<SpaceSession>(so, 'space:score', {
      channelId: voiceId,
      zone: 2,
      side: 'a',
      points: 1,
      by: alice.id,
    });
    expect(s1.data?.scores?.['2']).toEqual({ a: 1, b: 0 });
    // classificação: o gol foi da alice
    expect(s1.data?.board?.['2']).toEqual({ [alice.id]: 1 });
    // o outro app viu o mesmo gol: não conta de novo
    const s2 = await command<SpaceSession>(sa, 'space:score', { channelId: voiceId, zone: 2, side: 'a', points: 1 });
    expect(s2.data?.scores?.['2']).toEqual({ a: 1, b: 0 });
    const r = await command<SpaceSession>(sa, 'space:score:reset', { channelId: voiceId, zone: 2 });
    expect(r.data?.scores?.['2']).toEqual({ a: 0, b: 0 });
    expect(r.data?.board?.['2']).toEqual({});
  });

  it('sinuca repassada só na chamada; corrida com largada para todos e chegadas conferidas', async () => {
    const { owner, alice, voiceId, so, sa, sb } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const pool = {
      channelId: voiceId,
      balls: [
        [0, 0.5, 0],
        [0.1, -0.5, 1],
      ],
      turn: 'b',
      moving: true,
      t: 3,
    };
    const got = nextEvent<{ by: string; turn: string }>(sa, 'space:pool', (p) => p.by === owner.id);
    const notBob = noEvent(sb, 'space:pool', () => true, 1000);
    so.emit('space:pool', pool);
    expect((await got).turn).toBe('b');
    await notBob;

    expect((await command(so, 'space:race:finish', { channelId: voiceId, ms: 60_000 })).ok).toBe(false); // sem corrida
    const started = await command<SpaceSession>(so, 'space:race:start', { channelId: voiceId });
    expect(started.data?.race).toMatchObject({ laps: 3, results: [] });
    // tempo maior que o tempo desde a largada: recusado
    expect((await command(sa, 'space:race:finish', { channelId: voiceId, ms: 60_000 })).ok).toBe(false);
    // finge que a largada foi há 2 minutos
    const { SpaceService } = await import('../src/voice/space.service.js');
    const svc = app.get(SpaceService);
    const raw = JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    raw.race!.startAt = Date.now() - 120_000;
    await svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(raw));
    expect((await command(sa, 'space:race:finish', { channelId: voiceId, ms: 1000 })).ok).toBe(false); // rápido demais
    const f1 = await command<SpaceSession>(sa, 'space:race:finish', { channelId: voiceId, ms: 90_000 });
    const f2 = await command<SpaceSession>(so, 'space:race:finish', { channelId: voiceId, ms: 80_000 });
    expect(f1.ok && f2.ok).toBe(true);
    expect(f2.data?.race?.results.map((r) => r.userId)).toEqual([owner.id, alice.id]);
    const again = await command<SpaceSession>(sa, 'space:race:finish', { channelId: voiceId, ms: 70_000 });
    expect(again.data?.race?.results).toHaveLength(2);
  });

  it('partida com alvo: ponto só em jogo, o ponto final encerra com o vencedor e zerar no meio não muda nada', async () => {
    const { owner, alice, voiceId, so, sa } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const { SpaceService } = await import('../src/voice/space.service.js');
    const svc = app.get(SpaceService);
    const raw = async () => JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    const put = (s: SpaceSession) => svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(s));
    const pt = (side: 'a' | 'b') =>
      command<SpaceSession>(so, 'space:score', { channelId: voiceId, zone: 5, side, points: 1, by: owner.id });

    // esperando o Jogar (idle): ponto recusado
    const idle = await command<SpaceSession>(sa, 'space:score:reset', { channelId: voiceId, zone: 5 });
    expect(idle.data?.matches?.['5']?.phase).toBe('idle');
    expect((await pt('a')).data?.scores?.['5']).toEqual({ a: 0, b: 0 });

    // Jogar: contagem de 3 s para todos; na contagem o ponto também não vale
    const started = await command<SpaceSession>(sa, 'space:match:start', { channelId: voiceId, zone: 5 });
    const m = started.data?.matches?.['5'];
    expect(m?.phase).toBe('countdown');
    expect(m!.startAt - Date.now()).toBeGreaterThan(2000);
    expect((await pt('a')).data?.scores?.['5']).toEqual({ a: 0, b: 0 });
    // Jogar de novo no meio não reinicia
    const again = await command<SpaceSession>(so, 'space:match:start', { channelId: voiceId, zone: 5 });
    expect(again.data?.matches?.['5']?.startAt).toBe(m!.startAt);

    // passou o VAI e o placar está 10 × 8: o ponto que fecha a partida põe a fase em ended com o vencedor
    const s = await raw();
    s.matches!['5'] = { phase: 'countdown', startAt: Date.now() - 1000 };
    s.scores = { ...s.scores, '5': { a: 10, b: 8 } };
    await put(s);
    const ended = nextEvent<SpaceSession>(sa, 'space:state', (x) => x.matches?.['5']?.phase === 'ended');
    const fin = await pt('a');
    expect(fin.data?.scores?.['5']).toEqual({ a: 11, b: 8 });
    expect(fin.data?.matches?.['5']).toMatchObject({ phase: 'ended', winner: 'a' });
    expect((await ended).matches?.['5']?.winner).toBe('a');
    // depois do fim, ponto não conta
    await new Promise((r) => setTimeout(r, 1600));
    expect((await pt('b')).data?.scores?.['5']).toEqual({ a: 11, b: 8 });

    // zerar em jogo não muda nada; encerrado, zera
    const s2 = await raw();
    s2.matches!['3'] = { phase: 'playing', startAt: Date.now() - 5000 };
    s2.scores = { ...s2.scores, '3': { a: 4, b: 2 } };
    await put(s2);
    const r1 = await command<SpaceSession>(sa, 'space:score:reset', { channelId: voiceId, zone: 3 });
    expect(r1.data?.scores?.['3']).toEqual({ a: 4, b: 2 });
    expect(r1.data?.matches?.['3']?.phase).toBe('playing');
    const r2 = await command<SpaceSession>(sa, 'space:score:reset', { channelId: voiceId, zone: 5 });
    expect(r2.data?.scores?.['5']).toEqual({ a: 0, b: 0 });
    expect(r2.data?.matches?.['5']?.phase).toBe('idle');
    // arena sem partida (sinuca) não aceita o Jogar de partida
    expect((await command(sa, 'space:match:start', { channelId: voiceId, zone: 6 })).ok).toBe(false);
  });

  it('partida com tempo: esgotado com placar diferente, encerra; treino (um lado vazio) não soma na classificação', async () => {
    const { owner, alice, voiceId, so, sa } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const { SpaceService } = await import('../src/voice/space.service.js');
    const svc = app.get(SpaceService);
    // os dois no futebol, no mesmo time: treino
    for (const sock of [so, sa])
      sock.emit('space:move', { channelId: voiceId, x: 0, y: 0, z: 0, ry: 0, a: 0, zone: 2, team: 'a' });
    await new Promise((r) => setTimeout(r, 300));
    await command(sa, 'space:match:start', { channelId: voiceId, zone: 2 });
    const s = JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    s.matches!['2'] = { phase: 'playing', startAt: Date.now() - 60_000 };
    await svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(s));
    const g = await command<SpaceSession>(so, 'space:score', {
      channelId: voiceId,
      zone: 2,
      side: 'a',
      points: 1,
      by: owner.id,
    });
    expect(g.data?.scores?.['2']).toEqual({ a: 1, b: 0 });
    expect(g.data?.board?.['2']).toEqual({});
    expect(g.data?.matches?.['2']?.phase).toBe('playing');
    // o tempo acabou com 1 × 0: a próxima leitura já vem encerrada
    const s2 = JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    s2.matches!['2'] = { phase: 'playing', startAt: Date.now() - 181_000 };
    await svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(s2));
    const got = await command<SpaceSession>(sa, 'space:get', { channelId: voiceId });
    expect(got.data?.matches?.['2']).toMatchObject({ phase: 'ended', winner: 'a' });
  });

  it('corrida fecha 30 s depois da chegada do 1º; quem não chegou fica como DNF', async () => {
    const { owner, alice, voiceId, so, sa } = await setup();
    for (const u of [owner, alice]) await http.req('POST', `/voice/channels/${voiceId}/join`, { token: u.token });
    const { SpaceService } = await import('../src/voice/space.service.js');
    const svc = app.get(SpaceService);
    for (const sock of [so, sa])
      sock.emit('space:move', { channelId: voiceId, x: 0, y: 0, z: 0, ry: 0, a: 0, zone: 7 });
    await new Promise((r) => setTimeout(r, 300));
    const started = await command<SpaceSession>(so, 'space:race:start', { channelId: voiceId });
    expect([...(started.data?.race?.racers ?? [])].sort()).toEqual([owner.id, alice.id].sort());
    const raw = JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    raw.race!.startAt = Date.now() - 120_000;
    await svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(raw));
    const f1 = await command<SpaceSession>(sa, 'space:race:finish', { channelId: voiceId, ms: 90_000 });
    const endsAt = f1.data?.race?.endsAt ?? 0;
    expect(endsAt - Date.now()).toBeGreaterThan(25_000);
    expect(f1.data?.race?.closed).toBeFalsy();
    // passaram os 30 s
    const r2 = JSON.parse((await svc['redis'].client.get(`space:${voiceId}`)) as string) as SpaceSession;
    r2.race!.endsAt = Date.now() - 1;
    await svc['redis'].client.set(`space:${voiceId}`, JSON.stringify(r2));
    const closed = await command<SpaceSession>(so, 'space:get', { channelId: voiceId });
    expect(closed.data?.race).toMatchObject({ closed: true, dnf: [owner.id] });
    // chegou depois do fechamento: não entra na chegada
    const late = await command<SpaceSession>(so, 'space:race:finish', { channelId: voiceId, ms: 100_000 });
    expect(late.data?.race?.results.map((r) => r.userId)).toEqual([alice.id]);
  });
});

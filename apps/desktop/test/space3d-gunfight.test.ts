/**
 * Gunfight do Espaço 3D (zona 8): equilíbrio das armas, acerto do raio, movimento tático (com os limites), caminhos e
 * nascer dos bots, e o controlador `GunGame` com uma cena falsa (morte, renascer, placar pela rede, gatilho preso,
 * clique curto, bots saindo quando alguém entra, nada agendado depois de sair). Sem som e sem arquivos de modelo.
 */
import { SpaceGun, SpaceGunPose } from '@opencord/contracts';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../src/features/space3d/events';

// os modelos .glb não carregam no teste: uma arma de mentira, com as mesmas peças que o jogo procura
vi.mock('../src/features/space3d/gunfight/models', () => {
  const fake = (id: string) => ({
    id,
    root: new THREE.Group(),
    parts: {},
    muzzle: new THREE.Vector3(0, 0.05, -0.6),
    sight: new THREE.Vector3(0, 0.08, -0.05),
    support: new THREE.Vector3(0, -0.02, -0.35),
    length: 0.8,
  });
  return {
    loadGuns: () => Promise.resolve(),
    gunsReady: () => true,
    makeGun: fake,
    movePart: () => undefined,
    disposeGun: (g: { root: THREE.Object3D }) => g.root.removeFromParent(),
    disposeSkeletons: () => undefined,
    partCenter: () => null,
    partBox: () => null,
  };
});

const { GunGame, bodyYaw, gunSeed } = await import('../src/features/space3d/gunfight/game');
const { shoulderCam } = await import('../src/features/space3d/gunfight/camera');
type GunHost = import('../src/features/space3d/gunfight/game').GunHost;
type GunPlayer = import('../src/features/space3d/gunfight/game').GunPlayer;
const { useGunHud, validLoadout } = await import('../src/features/space3d/gunfight/state');
const { findPath } = await import('../src/features/space3d/gunfight/bots');
const { GUN_BOXES, GUN_SPAWNS, blockedAt, gunObstacles, pickSpawn } =
  await import('../src/features/space3d/gunfight/map');
const mv = await import('../src/features/space3d/gunfight/movement');
const w = await import('../src/features/space3d/gunfight/weapons');
const {
  GUNS,
  RESPAWN_MS,
  WINNER_MS,
  aimDir,
  castShot,
  damageAt,
  lineOfSight,
  lookAt,
  maxDamage,
  shotInterval,
  shotsToKill,
} = w;

const ME = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

function fakeHost(over: Partial<GunHost> = {}) {
  const sent: Omit<SpaceGun, 'channelId'>[] = [];
  const events: GameEvent[] = [];
  const held = new Set<'fire' | 'ads' | 'run'>();
  const view = { yaw: 0, pitch: 0 };
  let players: GunPlayer[] = [];
  const host: GunHost = {
    selfId: ME,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(70, 1, 0.05, 200),
    obstacles: gunObstacles(),
    skin: 0xffffff,
    yaw: () => view.yaw,
    pitch: () => view.pitch,
    turn: (dy, dp) => {
      view.yaw += dy;
      view.pitch += dp;
    },
    wish: () => ({ f: 0, r: 0 }),
    held: (a) => held.has(a),
    players: () => players,
    nameOf: (id) => (id === BOB ? 'Bob' : id),
    send: (g) => void sent.push(g),
    emit: (e) => void events.push(e),
    place: () => undefined,
    spawnAvatar: () => ({ root: new THREE.Group(), place: () => undefined, dispose: () => undefined }),
    ...over,
  };
  return {
    host,
    sent,
    events,
    held,
    view,
    setPlayers: (p: GunPlayer[]) => (players = p),
  };
}

/** um jogo já nascido (o nascer espera a promessa dos modelos) */
async function started(over: Partial<GunHost> = {}) {
  const f = fakeHost(over);
  const g = new GunGame(f.host);
  await Promise.resolve();
  await Promise.resolve();
  return { g, ...f };
}

const fires = (sent: Omit<SpaceGun, 'channelId'>[]) => sent.filter((s) => s.kind === 'fire').length;

beforeEach(() => {
  // sem canvas 2D no jsdom: a textura do clarão fica vazia (sem o aviso a cada teste)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useGunHud.getState().set({
    loadout: { primary: 'm4', secondary: 'm9', melee: 'karambit' },
    feed: [],
    scores: [],
    winner: null,
    bot: null,
    notice: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('gunfight: armas e equilíbrio', () => {
  it('fuzil mata com 3–5 tiros no corpo; a AK bate mais forte e o M4 é mais rápido', () => {
    for (const id of ['m4', 'ak47'] as const) {
      const n = shotsToKill(GUNS[id], 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    const ttk = (id: keyof typeof GUNS, d: number) => (shotsToKill(GUNS[id], d) - 1) * shotInterval(GUNS[id]);
    // de perto a AK não perde para o M4 (bate mais forte); de longe empatam e a AK sobe mais
    expect(ttk('ak47', 5)).toBeLessThanOrEqual(ttk('m4', 5));
    expect(GUNS.ak47.recoil.up).toBeGreaterThan(GUNS.m4.recoil.up);
  });

  it('de perto a submetralhadora mata mais rápido que o fuzil; de longe, o fuzil', () => {
    const ttk = (id: keyof typeof GUNS, d: number) => (shotsToKill(GUNS[id], d) - 1) * shotInterval(GUNS[id]);
    for (const smg of ['mp7', 'mp5'] as const) {
      expect(ttk(smg, 5)).toBeLessThan(ttk('m4', 5));
      expect(ttk(smg, 35)).toBeGreaterThan(ttk('m4', 35));
      expect(ttk(smg, 35)).toBeGreaterThan(ttk('ak47', 35));
    }
    // a MP7 é a mais rápida de perto (nem a AK, com 3 tiros, passa dela)
    expect(ttk('mp7', 5)).toBeLessThan(ttk('ak47', 5));
  });

  it('L115 e M200 matam com 1 no peito em todo o mapa; a Kar98k só na cabeça', () => {
    for (const d of [5, 30, 68]) {
      expect(shotsToKill(GUNS.l115, d)).toBe(1);
      expect(shotsToKill(GUNS.m200, d)).toBe(1);
      expect(shotsToKill(GUNS.kar98k, d)).toBe(2);
      expect(shotsToKill(GUNS.kar98k, d, true)).toBe(1);
    }
  });

  it('dano cai em linha entre as distâncias e a cabeça multiplica', () => {
    const m4 = GUNS.m4;
    expect(damageAt(m4, 0, false)).toBe(28);
    expect(damageAt(m4, 100, false)).toBe(20);
    expect(damageAt(m4, (m4.range[0] + m4.range[1]) / 2, false)).toBe(24);
    expect(damageAt(m4, 0, true)).toBe(42);
    expect(maxDamage(m4)).toBe(55); // a coronhada é o golpe mais forte do M4
    expect(maxDamage(GUNS.karambit)).toBe(150);
  });

  it('equipamento salvo com id inválido volta para o padrão em cada espaço', () => {
    expect(validLoadout({ primary: 'bazuca', secondary: 'deagle', melee: 'm4' })).toEqual({
      primary: 'm4',
      secondary: 'deagle',
      melee: 'karambit',
    });
    expect(validLoadout('lixo')).toEqual({ primary: 'm4', secondary: 'm9', melee: 'karambit' });
  });
});

describe('gunfight: acerto do raio', () => {
  const t = { id: 'a', x: 0, y: 0, z: -10, crouch: false };
  it('cabeça, corpo e parede', () => {
    const eye = { x: 0, y: w.EYE.stand, z: 0 };
    const head = castShot(
      eye,
      aimDir(lookAt(eye, { x: 0, y: 1.16, z: -10 }).yaw, lookAt(eye, { x: 0, y: 1.16, z: -10 }).pitch, 0, 0, 0),
      [t],
      [],
    );
    expect(head).toMatchObject({ target: 'a', head: true });
    const chest = lookAt(eye, { x: 0, y: 0.7, z: -10 });
    expect(castShot(eye, aimDir(chest.yaw, chest.pitch, 0, 0, 0), [t], [])).toMatchObject({ target: 'a', head: false });
    const wall = { min: { x: -1, y: 0, z: -5.2 }, max: { x: 1, y: 3, z: -4.8 } };
    expect(castShot(eye, aimDir(chest.yaw, chest.pitch, 0, 0, 0), [t], [wall]).target).toBeNull();
  });

  it('agachado atrás da mureta não leva tiro de quem está em pé na mesma altura', () => {
    const low = { min: { x: -1, y: 0, z: -9.4 }, max: { x: 1, y: 1, z: -9 } };
    const hidden = { ...t, crouch: true };
    const eye = { x: 0, y: w.EYE.stand, z: 0 };
    for (const y of [0.3, 0.6, 0.86]) {
      const a = lookAt(eye, { x: 0, y, z: -10 });
      expect(castShot(eye, aimDir(a.yaw, a.pitch, 0, 0, 0), [hidden], [low]).target).toBeNull();
    }
    // em pé, a cabeça aparece
    const a = lookAt(eye, { x: 0, y: 1.16, z: -10 });
    expect(castShot(eye, aimDir(a.yaw, a.pitch, 0, 0, 0), [t], [low]).target).toBe('a');
  });

  it('lookAt e aimDir usam a mesma convenção (olhar para o ponto e atirar nele)', () => {
    const a = { x: 1, y: 1.1, z: 2 };
    for (const b of [
      { x: 5, y: 1, z: -3 },
      { x: -4, y: 2, z: 7 },
      { x: 1, y: 0, z: -9 },
    ]) {
      const l = lookAt(a, b);
      const d = aimDir(l.yaw, l.pitch, 0, 0, 0);
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(d.x).toBeCloseTo((b.x - a.x) / len, 5);
      expect(d.y).toBeCloseTo((b.y - a.y) / len, 5);
      expect(d.z).toBeCloseTo((b.z - a.z) / len, 5);
    }
  });
});

describe('gunfight: mapa e bots', () => {
  it('caminho pela grade não atravessa caixas e chega perto do destino', () => {
    const path = findPath({ x: -21, z: -21 }, { x: 21, z: 21 });
    expect(path.length).toBeGreaterThan(10);
    for (const p of path) expect(blockedAt(p.x, p.z, 0.5)).toBe(false);
    const end = path[path.length - 1]!;
    expect(Math.hypot(end.x - 21, end.z - 21)).toBeLessThan(1.5);
  });

  it('nasce longe dos inimigos e fora das caixas', () => {
    for (const s of GUN_SPAWNS) expect(blockedAt(s.x, s.z, 0.3)).toBe(false);
    const enemy = { x: -21, z: -21 };
    const s = pickSpawn([enemy], 0);
    expect(Math.hypot(s.x - enemy.x, s.z - enemy.z)).toBeGreaterThan(30);
    expect(lineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0.5 }, GUN_BOXES)).toBe(true);
  });

  it('a semente muda por pessoa (ninguém nasce sempre no mesmo ponto)', () => {
    expect(gunSeed(ME, 1000)).not.toBe(gunSeed(BOB, 1000));
    expect(gunSeed(ME, 1000)).not.toBe(gunSeed(ME, 2000));
  });
});

describe('gunfight: movimento tático', () => {
  const step = (
    s: ReturnType<typeof mv.newMove>,
    inp: Partial<Parameters<typeof mv.stepMove>[1]>,
    ms: number,
    t0 = 0,
  ) => {
    let t = t0;
    for (let i = 0; i < ms / 16; i++) {
      t += 16;
      mv.stepMove(
        s,
        { wx: 0, wz: -1, runHeld: false, forward: true, ads: false, gunK: 1, firing: false, ...inp },
        0.016,
        t,
      );
    }
    return t;
  };

  it('segurar o correr antes do W já corre (e volta a correr depois de atirar)', () => {
    const s = mv.newMove();
    step(s, { runHeld: true, wz: 0, forward: false }, 200);
    step(s, { runHeld: true }, 600, 200);
    expect(s.sprint).toBe(true);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(mv.MOVE.walk + 1);
    step(s, { runHeld: true, firing: true }, 100, 800);
    expect(s.sprint).toBe(false);
    step(s, { runHeld: true }, 100, 900);
    expect(s.sprint).toBe(true);
  });

  it('o deslize tem teto e recarga; C seguido não passa da tática', () => {
    const s = mv.newMove();
    let t = step(s, { runHeld: true }, 800);
    mv.pressRun(s, t);
    mv.pressRun(s, t + 100);
    t = step(s, { runHeld: true }, 600, t + 100);
    let top = 0;
    for (let i = 0; i < 40; i++) {
      mv.pressCrouch(s, t);
      top = Math.max(top, Math.hypot(s.vx, s.vz));
      t = step(s, { runHeld: true }, 48, t);
    }
    expect(top).toBeLessThanOrEqual(mv.MOVE.slideMax + 1e-6);
    // spam de C: a média de velocidade não chega ao teto do deslize
    const start = t;
    let dist = 0;
    for (let i = 0; i < 60; i++) {
      mv.pressCrouch(s, t);
      for (let k = 0; k < 3; k++) {
        t += 16;
        const r = mv.stepMove(
          s,
          { wx: 0, wz: -1, runHeld: true, forward: true, ads: false, gunK: 1, firing: false },
          0.016,
          t,
        );
        dist += Math.hypot(r.dx, r.dz);
      }
    }
    expect(dist / ((t - start) / 1000)).toBeLessThan(mv.MOVE.slideMax);
  });

  it('a tática acaba, recarrega aos poucos (não na hora ao soltar)', () => {
    const s = mv.newMove();
    let t = step(s, { runHeld: true }, 400);
    mv.pressRun(s, t);
    mv.pressRun(s, t + 100);
    t = step(s, { runHeld: true }, 1000, t + 100);
    expect(s.tactical).toBe(true);
    const left = s.tacLeft;
    t = step(s, { runHeld: false }, 100, t);
    expect(s.tactical).toBe(false);
    expect(s.tacLeft).toBeLessThan(left + 200);
    step(s, { runHeld: false }, 6000, t);
    expect(s.tacLeft).toBe(mv.MOVE.tacMs);
  });

  it('bunny hop não passa do teto da arma', () => {
    const s = mv.newMove();
    s.vz = -6;
    let t = 0;
    let top = 0;
    for (let i = 0; i < 600; i++) {
      t += 16;
      if (s.grounded) mv.pressJump(s, t);
      mv.stepMove(s, { wx: 0, wz: -1, runHeld: true, forward: true, ads: false, gunK: 0.86, firing: false }, 0.016, t);
      top = Math.max(top, Math.hypot(s.vx, s.vz));
    }
    expect(top).toBeLessThanOrEqual(mv.MOVE.bhopMax * 0.86 + 0.05);
  });
});

describe('gunfight: o controlador', () => {
  it('levar tiros da rede mata, avisa todos e renasce depois do tempo', async () => {
    const { g, sent, setPlayers } = await started();
    expect(g.isAlive).toBe(true);
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    const t0 = performance.now();
    for (let i = 0; i < 4; i++)
      g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 28, sender: BOB }, t0 + i * 200);
    expect(g.isAlive).toBe(false);
    expect(sent.find((s) => s.kind === 'die')).toMatchObject({ by: BOB, w: 'm4' });
    expect(g.pose().d).toBe(1);
    g.step(0.016, t0 + 800 + RESPAWN_MS + 10);
    expect(g.isAlive).toBe(true);
    expect(sent.filter((s) => s.kind === 'spawn').length).toBe(2);
    g.dispose();
  });

  it('recusa acerto impossível: de quem não está na arena, dano acima da arma ou rápido demais', async () => {
    const { g, setPlayers } = await started();
    const t0 = performance.now();
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 99, sender: BOB }, t0);
    expect(useGunHud.getState().hp).toBe(100);
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 1000, sender: BOB }, t0);
    expect(g.isAlive).toBe(true);
    // um fluxo acima da cadência: cabe uma rajada (2 + o que a arma dispara em 0,5 s), o resto é recusado
    for (let i = 0; i < 30; i++)
      g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 1, sender: BOB }, t0 + 100);
    const burst = Math.floor(2 + 500 / shotInterval(GUNS.m4));
    expect(useGunHud.getState().hp).toBe(100 - burst);
    g.dispose();
  });

  it('acertos que a rede entregou juntos valem todos (3 da MP7 a 10 ms um do outro)', async () => {
    const { g, setPlayers } = await started();
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    const t0 = performance.now();
    for (let i = 0; i < 3; i++)
      g.remote({ channelId: ME, kind: 'hit', w: 'mp7', target: ME, dmg: 22, sender: BOB }, t0 + i * 10);
    expect(useGunHud.getState().hp).toBe(34);
    // e o balde volta a encher no ritmo da arma
    for (let i = 0; i < 2; i++)
      g.remote({ channelId: ME, kind: 'hit', w: 'mp7', target: ME, dmg: 10, sender: BOB }, t0 + 2000 + i * 70);
    expect(useGunHud.getState().hp).toBe(14);
    g.dispose();
  });

  it('recomeçar e morrer só valem de quem está na arena; no meio da partida ninguém zera os outros', async () => {
    const { g, setPlayers } = await started();
    const OUT = '33333333-3333-4333-8333-333333333333';
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    // quem está fora da zona 8 não me dá abate nem zera nada
    g.remote({ channelId: ME, kind: 'die', w: 'm4', by: ME, sender: OUT });
    expect(g.pose().k).toBe(0);
    g.remote({ channelId: ME, kind: 'die', w: 'm4', by: ME, sender: BOB });
    expect(g.pose().k).toBe(1);
    g.remote({ channelId: ME, kind: 'restart', w: 'm4', sender: OUT });
    expect(g.pose().k).toBe(1);
    // o Bob, na arena, também não zera no meio da partida (já tem abate)
    g.remote({ channelId: ME, kind: 'restart', w: 'm4', sender: BOB });
    expect(g.pose().k).toBe(1);
    expect(g.canRestart).toBe(false);
    g.dispose();
  });

  it('a partida acaba em 30 e recomeça sozinha depois do tempo do vencedor', async () => {
    const { g, setPlayers } = await started();
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true, k: 0, d: 0 }]);
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) g.remote({ channelId: ME, kind: 'die', w: 'm4', by: ME, sender: BOB }, t0);
    expect(g.over).toBe(true);
    expect(useGunHud.getState().winner).toBe('Você');
    expect(g.canRestart).toBe(true);
    // ganhou: o recomeço da rede agora vale
    g.step(0.016, t0 + WINNER_MS - 100);
    expect(g.over).toBe(true);
    g.step(0.016, t0 + WINNER_MS + 100);
    expect(g.over).toBe(false);
    expect(g.pose().k).toBe(0);
    g.dispose();
  });

  it('o tranco do recuo não explode com quadro lento (20 qps)', async () => {
    const { g } = await started();
    useGunHud.getState().set({ loadout: { primary: 'l115', secondary: 'm9', melee: 'karambit' } });
    g.restart();
    let t = performance.now() + 2000;
    g.press('fire', t);
    g.release('fire');
    let maxAbs = 0;
    for (let i = 0; i < 60; i++) {
      g.step(0.05, (t += 50));
      maxAbs = Math.max(maxAbs, Math.abs(g.viewPunch));
      expect(Number.isFinite(g.viewPunch)).toBe(true);
    }
    expect(maxAbs).toBeGreaterThan(0);
    expect(maxAbs).toBeLessThanOrEqual(0.15);
    expect(Math.abs(g.viewPunch)).toBeLessThan(1e-3);
    g.dispose();
  });

  it('recarregando não mira (nem abre a luneta)', async () => {
    const { g, held } = await started();
    useGunHud.getState().set({ loadout: { primary: 'l115', secondary: 'm9', melee: 'karambit' } });
    g.restart();
    let t = performance.now() + 2000;
    for (let i = 0; i < 40; i++) g.step(0.016, (t += 16));
    g.press('fire', t);
    g.release('fire');
    for (let i = 0; i < 120; i++) g.step(0.016, (t += 16));
    g.press('reload', t);
    held.add('ads');
    for (let i = 0; i < 40; i++) g.step(0.016, (t += 16));
    expect(useGunHud.getState().reloading).toBe(true);
    expect(g.aiming).toBe(0);
    expect(g.scoped).toBe(false);
    g.dispose();
  });

  it('com o menu aberto (mouse solto) os bots do treino esperam', async () => {
    let paused = true;
    const { g } = await started({ paused: () => paused });
    g.setBots('dificil', 3);
    let t = performance.now() + 1000;
    const hp0 = useGunHud.getState().hp;
    for (let i = 0; i < 600; i++) g.step(0.016, (t += 16));
    expect(useGunHud.getState().hp).toBe(hp0);
    expect(g.isAlive).toBe(true);
    paused = false;
    g.dispose();
  });

  it('o abate de gente conta pelo `die` com by = eu, vai na pose e acende o marcador de abate', async () => {
    const { g, events, setPlayers } = await started();
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true, k: 0, d: 0 }]);
    g.remote({ channelId: ME, kind: 'die', w: 'm4', by: ME, sender: BOB });
    expect(g.pose().k).toBe(1);
    expect(useGunHud.getState().hitKill).toBe(true);
    expect(events.some((e) => e.kind === 'gunfx' && e.what === 'kill')).toBe(true);
    // o placar dos outros vem do que eles publicam (quem entra depois vê o mesmo)
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true, k: 7, d: 3 }]);
    const bob = g.scores().find((r) => r.id === BOB)!;
    expect([bob.kills, bob.deaths]).toEqual([7, 3]);
    g.dispose();
  });

  it('recomeçar zera e avisa todos; o recomeço que chega da rede não volta para a rede', async () => {
    const { g, sent } = await started();
    g.remote({ channelId: ME, kind: 'die', w: 'm4', by: ME, sender: BOB });
    g.restart();
    expect(g.pose().k).toBe(0);
    expect(sent.filter((s) => s.kind === 'restart').length).toBe(1);
    g.remote({ channelId: ME, kind: 'restart', w: 'm4', sender: BOB });
    expect(sent.filter((s) => s.kind === 'restart').length).toBe(1);
    g.dispose();
  });

  it('recomeçar não volta direto ao vencedor pelo placar velho que os outros ainda publicam', async () => {
    const { g, setPlayers } = await started();
    const bob = (k: number, d: number): GunPlayer => ({
      id: BOB,
      name: 'Bob',
      x: 0,
      y: 0,
      z: 0,
      ry: 0,
      crouch: false,
      alive: true,
      k,
      d,
    });
    setPlayers([bob(30, 2)]);
    g.remote({ channelId: ME, kind: 'spawn', w: 'm4', sender: BOB });
    expect(g.over).toBe(true);
    // R aqui (ou o recomeço da rede): a pose do Bob ainda diz 30 até ele recomeçar e publicar de novo
    g.restart();
    expect(g.over).toBe(false);
    expect(g.scores().find((r) => r.id === BOB)!.kills).toBe(0);
    // ele recomeçou e voltou a pontuar: o novo número vale
    setPlayers([bob(1, 0)]);
    expect(g.scores().find((r) => r.id === BOB)!.kills).toBe(1);
    g.dispose();
  });

  it('gatilho não fica preso: soltar fora da janela ou cancelar para a automática', async () => {
    const { g, sent, held } = await started();
    let t = performance.now() + 1000;
    held.add('fire');
    g.press('fire', t);
    for (let i = 0; i < 10; i++) g.step(0.016, (t += 16));
    const n = fires(sent);
    expect(n).toBeGreaterThan(1);
    // Esc/blur: as teclas somem sem o evento de soltar
    held.clear();
    for (let i = 0; i < 20; i++) g.step(0.016, (t += 16));
    expect(fires(sent)).toBe(n);
    // e o cancelar da cena também solta
    held.add('fire');
    g.press('fire', t);
    g.cancel();
    held.clear();
    const m = fires(sent);
    for (let i = 0; i < 20; i++) g.step(0.016, (t += 16));
    expect(fires(sent)).toBe(m);
    g.dispose();
  });

  it('clique curto da pistola atira mesmo soltando antes do próximo quadro', async () => {
    const { g, sent } = await started();
    let t = performance.now() + 100;
    g.switchTo('secondary', t);
    for (let i = 0; i < 40; i++) g.step(0.016, (t += 16));
    for (let k = 0; k < 3; k++) {
      g.press('fire', t);
      g.release('fire');
      for (let i = 0; i < 15; i++) g.step(0.016, (t += 16));
    }
    expect(fires(sent)).toBe(3);
    g.dispose();
  });

  it('bots saem quando alguém entra; morte por bot vai sem matador na rede', async () => {
    const { g, sent, setPlayers } = await started();
    g.setBots('dificil', 1);
    expect(useGunHud.getState().bot).toBe('dificil');
    const t0 = performance.now();
    // um bot mata (o id do bot não vai para a rede)
    g.hurt('bot:1', 200, 'm4', false, null, t0);
    const die = sent.find((s) => s.kind === 'die')!;
    expect(die.by).toBeUndefined();
    expect(SpaceGun.safeParse({ channelId: ME, ...die }).success).toBe(true);
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    g.step(0.016, t0 + 600);
    expect(useGunHud.getState().bot).toBeNull();
    expect(useGunHud.getState().notice).toMatch(/bots saíram/);
    g.dispose();
  });

  it('nada fica agendado nem roda depois de sair (sem setTimeout)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const { g, held, events } = await started();
    let t = performance.now() + 1000;
    held.add('fire');
    g.press('fire', t);
    for (let i = 0; i < 200; i++) g.step(0.016, (t += 16));
    g.press('reload', t);
    g.press('melee', t);
    expect(vi.getTimerCount()).toBe(0);
    expect(g.pending).toBeGreaterThan(0);
    g.dispose();
    expect(g.pending).toBe(0);
    const n = events.length;
    g.step(0.016, t + 5000);
    expect(events.length).toBe(n);
  });
});

describe('gunfight: câmera e corpo na terceira pessoa', () => {
  const inside = (p: { x: number; y: number; z: number }) =>
    GUN_BOXES.some(
      (b) =>
        p.x > b.min.x + 1e-3 &&
        p.x < b.max.x - 1e-3 &&
        p.y > b.min.y + 1e-3 &&
        p.y < b.max.y - 1e-3 &&
        p.z > b.min.z + 1e-3 &&
        p.z < b.max.z - 1e-3,
    );

  it('a câmera por cima do ombro nunca entra numa caixa (encostado em todas as faces, olhando para todo lado)', () => {
    let checked = 0;
    for (const b of GUN_BOXES) {
      if (b.max.y < 1.4) continue;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      // o olho a 0,3 m de cada face (onde o corpo consegue chegar)
      for (const [x, z] of [
        [b.min.x - 0.3, cz],
        [b.max.x + 0.3, cz],
        [cx, b.min.z - 0.3],
        [cx, b.max.z + 0.3],
      ] as const) {
        if (blockedAt(x, z, 0.25)) continue;
        const eye = { x, y: 1.12, z };
        for (let k = 0; k < 8; k++)
          for (const aiming of [0, 1]) {
            const c = shoulderCam(eye, (k * Math.PI) / 4, 0.1, { aiming, alive: true }, GUN_BOXES);
            expect(inside(c.pos)).toBe(false);
            checked++;
          }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('encostado na parede a câmera vai para o ombro e o meu boneco some; em campo aberto fica atrás', () => {
    const open = shoulderCam({ x: 0, y: 1.12, z: 0 }, 0, 0, { aiming: 0, alive: true }, []);
    expect(open.hideSelf).toBe(false);
    expect(open.pos.z).toBeCloseTo(2.3, 1);
    // uma parede logo atrás (+z) e outra à direita (+x)
    const walls = [
      { min: { x: -5, y: 0, z: 0.3 }, max: { x: 5, y: 3, z: 1 } },
      { min: { x: 0.35, y: 0, z: -5 }, max: { x: 1, y: 3, z: 5 } },
    ];
    const c = shoulderCam({ x: 0, y: 1.12, z: 0 }, 0, 0, { aiming: 0, alive: true }, walls);
    expect(c.pos.x).toBeLessThan(0.35);
    expect(c.pos.z).toBeLessThan(0.3);
    expect(c.hideSelf).toBe(true);
  });

  it('parado na 3ª pessoa o corpo gira para a mira depois de ~50°; mirando ou atirando, na hora', () => {
    // pouca diferença: fica
    expect(bodyYaw(0, 0.5, { moving: false, engaged: false, turning: false, dt: 0.016 }).ry).toBe(0);
    // muita: gira até ficar de frente, sem pular
    let s = { ry: 0, turning: false };
    let frames = 0;
    while ((frames === 0 || s.turning) && frames < 100) {
      s = bodyYaw(s.ry, 2.4, { moving: false, engaged: false, turning: s.turning, dt: 0.016 });
      frames++;
    }
    expect(frames).toBeGreaterThan(5);
    expect(frames * 0.016).toBeLessThan(0.3);
    expect(s.ry).toBeCloseTo(2.4, 6);
    // atirando: de uma vez
    expect(bodyYaw(0, 2.4, { moving: false, engaged: true, turning: false, dt: 0.016 }).ry).toBe(2.4);
  });
});

describe('gunfight: contrato', () => {
  it('SpaceGun aceita restart e die sem matador; a pose leva abates e mortes', () => {
    expect(SpaceGun.safeParse({ channelId: ME, kind: 'restart', w: 'm4' }).success).toBe(true);
    expect(SpaceGun.safeParse({ channelId: ME, kind: 'die', w: 'm4' }).success).toBe(true);
    expect(SpaceGun.safeParse({ channelId: ME, kind: 'die', w: 'm4', by: 'bot:1' }).success).toBe(false);
    expect(
      SpaceGunPose.safeParse({ w: 'm4', pitch: 0, crouch: false, ads: false, alive: true, k: 3, d: 1 }).success,
    ).toBe(true);
    expect(SpaceGunPose.safeParse({ w: 'm4', pitch: 0, crouch: false, ads: false, alive: true, k: -1 }).success).toBe(
      false,
    );
  });
});

describe('gunfight: rodada 3 (integração)', () => {
  const step = (
    s: ReturnType<typeof mv.newMove>,
    inp: Partial<Parameters<typeof mv.stepMove>[1]>,
    ms: number,
    fps: number,
    t0: number,
  ) => {
    let t = t0;
    let dist = 0;
    const dt = 1 / fps;
    for (let i = 0; i < Math.round((ms / 1000) * fps); i++) {
      t += dt * 1000;
      const r = mv.stepMove(
        s,
        { wx: 0, wz: -1, runHeld: false, forward: true, ads: false, gunK: 1, firing: false, ...inp },
        dt,
        t,
      );
      dist += Math.hypot(r.dx, r.dz);
    }
    return { t, dist };
  };
  /** corre até a velocidade de corrida e desliza: devolve o estado e a hora */
  const slideFrom = (fps: number) => {
    const s = mv.newMove();
    const { t } = step(s, { runHeld: true }, 800, fps, 0);
    expect(mv.pressCrouch(s, t)).toBe('slide');
    return { s, t };
  };

  it('depois do deslize, segurando o correr, levanta e volta a correr (não fica agachado)', () => {
    const { s, t } = slideFrom(60);
    const r = step(s, { runHeld: true }, mv.MOVE.slideMs + 600, 60, t);
    expect(s.crouch).toBe(false);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(5);
    // sem segurar o correr, termina agachado; apertar o correr levanta
    const b = slideFrom(60);
    const r2 = step(b.s, {}, mv.MOVE.slideMs + 100, 60, b.t);
    expect(b.s.crouch).toBe(true);
    mv.pressRun(b.s, r2.t);
    expect(b.s.crouch).toBe(false);
    expect(r.t).toBeGreaterThan(t);
  });

  it('o deslize anda o mesmo a 30 e a 240 qps (±2%) e cai em linha', () => {
    const d = [30, 240].map((fps) => {
      const { s, t } = slideFrom(fps);
      return step(s, {}, mv.MOVE.slideMs, fps, t).dist;
    });
    expect(Math.abs(d[0]! - d[1]!) / d[1]!).toBeLessThan(0.02);
    // em linha do começo (~7,4–7,8 m/s) até 2,4 m/s em 0,75 s: ~3,7 m
    expect(d[1]!).toBeGreaterThan(3.4);
  });

  it('a chave da pose muda com a ação (recarga parado sai no quadro seguinte)', async () => {
    const { SpaceScene } = await import('../src/features/space3d/scene');
    const key = Reflect.get(SpaceScene.prototype, 'gunPoseKey') as (this: unknown) => string;
    const { g } = await started();
    const t = performance.now() + 1000;
    // gasta uma bala para a recarga valer
    g.press('fire', t);
    g.release('fire');
    const before = key.call({ gun: g });
    g.press('reload', t + 400);
    expect(g.pose().act).toBe('reload');
    expect(key.call({ gun: g })).not.toBe(before);
    g.dispose();
  });

  it('o recomeço da cena só vale com `canRestart`', async () => {
    const { SpaceScene } = await import('../src/features/space3d/scene');
    let n = 0;
    const gun = { canRestart: false, restart: () => void n++ };
    SpaceScene.prototype.restartGun.call({ gun } as unknown as InstanceType<typeof SpaceScene>);
    expect(n).toBe(0);
    gun.canRestart = true;
    SpaceScene.prototype.restartGun.call({ gun } as unknown as InstanceType<typeof SpaceScene>);
    expect(n).toBe(1);
  });

  it('quem fica na tela do vencedor sai dela quando o vencedor recomeça (publica abates abaixo do alvo)', async () => {
    const { g, setPlayers } = await started();
    const bob = (k: number, d: number): GunPlayer => ({
      id: BOB,
      name: 'Bob',
      x: 0,
      y: 0,
      z: 0,
      ry: 0,
      crouch: false,
      alive: true,
      k,
      d,
    });
    setPlayers([bob(30, 4)]);
    g.remote({ channelId: ME, kind: 'spawn', w: 'm4', sender: BOB });
    expect(g.over).toBe(true);
    const t = performance.now();
    g.step(0.016, t + 600);
    expect(g.over).toBe(true);
    // o Bob recomeçou (o aviso de recomeço se perdeu ou chegou antes de eu entrar): a pose dele diz 0
    setPlayers([bob(0, 0)]);
    g.step(0.016, t + 1200);
    expect(g.over).toBe(false);
    expect(useGunHud.getState().winner).toBeNull();
    g.dispose();
  });

  it('acerto de outra arma que não a da pose, ou de faca de longe, é recusado', async () => {
    const { g, setPlayers } = await started();
    const t0 = performance.now();
    const eye = g.eye;
    const bob = (x: number, wpn: 'm4' | 'karambit'): GunPlayer => ({
      id: BOB,
      name: 'Bob',
      x,
      y: 0,
      z: eye.z,
      ry: 0,
      crouch: false,
      alive: true,
      w: wpn,
    });
    setPlayers([bob(eye.x + 20, 'm4')]);
    g.step(0.016, t0);
    // diz que é a karambit, mas a pose mostra o M4
    g.remote({ channelId: ME, kind: 'hit', w: 'karambit', target: ME, dmg: 150, sender: BOB }, t0 + 10);
    expect(g.isAlive).toBe(true);
    // trocou para a faca, mas está a 20 m
    setPlayers([bob(eye.x + 20, 'karambit')]);
    g.step(0.016, t0 + 2000);
    g.remote({ channelId: ME, kind: 'hit', w: 'karambit', target: ME, dmg: 150, sender: BOB }, t0 + 2010);
    expect(g.isAlive).toBe(true);
    // de perto vale; e um tiro do M4 trocado há pouco também
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 20, sender: BOB }, t0 + 2400);
    expect(useGunHud.getState().hp).toBe(80);
    setPlayers([bob(eye.x + 1, 'karambit')]);
    g.remote({ channelId: ME, kind: 'hit', w: 'karambit', target: ME, dmg: 150, sender: BOB }, t0 + 3200);
    expect(g.isAlive).toBe(false);
    g.dispose();
  });

  it('pente vazio com reserva recarrega sem clique seco; sem munição nenhuma, o clique seco', async () => {
    const { g, events, held } = await started();
    let t = performance.now() + 1000;
    held.add('fire');
    g.press('fire', t);
    // segura o gatilho até acabar tudo (pentes e reserva do M4)
    for (let i = 0; i < 4000; i++) g.step(0.016, (t += 16));
    const st = useGunHud.getState();
    expect([st.mag, st.reserve]).toEqual([0, 0]);
    const kinds = events.flatMap((e) => (e.kind === 'gunfx' ? [e.what] : []));
    const firstDry = kinds.indexOf('dry');
    expect(firstDry).toBeGreaterThan(-1);
    // nenhuma rajada que esvaziou o pente com reserva deu clique seco: o primeiro vem depois da última recarga
    expect(firstDry).toBeGreaterThan(kinds.lastIndexOf('magIn'));
    g.dispose();
  });

  it('bot que leva tiro reage mais cedo que o tempo de reação normal', async () => {
    const { GunBots } = await import('../src/features/space3d/gunfight/bots');
    const { BOT_SKILL } = await import('../src/features/space3d/bots/level');
    const { host } = fakeHost();
    // um par de pontos com linha de visão (bot olhando para mim)
    let pair: { a: { x: number; z: number }; b: { x: number; z: number } } | null = null;
    for (const s of GUN_SPAWNS)
      for (const [dx, dz] of [
        [0, -4],
        [0, 4],
        [4, 0],
        [-4, 0],
      ] as const) {
        const b = { x: s.x + dx, z: s.z + dz };
        if (pair || blockedAt(b.x, b.z, 0.5)) continue;
        if (lineOfSight({ x: s.x, y: 1.1, z: s.z }, { x: b.x, y: 1.1, z: b.z }, GUN_BOXES)) pair = { a: s, b };
      }
    expect(pair).not.toBeNull();
    const me = { id: ME, x: pair!.b.x, y: 0, z: pair!.b.z, crouch: false };
    const make = () => {
      const bots = new GunBots('facil', 1, { host, me: () => me, shoot: () => undefined, killed: () => undefined }, 3);
      const b = (
        Reflect.get(bots, 'list') as { x: number; z: number; yaw: number; reactAt: number; thinkAt: number }[]
      )[0]!;
      b.x = pair!.a.x;
      b.z = pair!.a.z;
      b.yaw = lookAt({ x: b.x, y: 1.1, z: b.z }, { x: me.x, y: 1, z: me.z }).yaw;
      b.thinkAt = 0;
      return { bots, b };
    };
    const reaction = BOT_SKILL.facil.reaction * 1000;
    const calm = make();
    const t = performance.now();
    calm.bots.update(0.016, t);
    expect(calm.b.reactAt - t).toBeGreaterThanOrEqual(reaction * 0.7 - 1);
    const shot = make();
    shot.bots.hurt('bot:1', 10, ME, 'm4', false);
    shot.bots.update(0.016, performance.now());
    expect(shot.b.reactAt - t).toBeLessThanOrEqual(reaction * 0.5 + 50);
    calm.bots.dispose();
    shot.bots.dispose();
  });

  it('bot andando não atravessa a pessoa (fica a um corpo de distância)', async () => {
    const { GunBots } = await import('../src/features/space3d/gunfight/bots');
    const { host } = fakeHost();
    let pair: { a: { x: number; z: number }; b: { x: number; z: number } } | null = null;
    for (const s of GUN_SPAWNS)
      for (const [dx, dz] of [
        [0, -4],
        [0, 4],
        [4, 0],
        [-4, 0],
      ] as const) {
        const b = { x: s.x + dx, z: s.z + dz };
        if (pair || blockedAt(b.x, b.z, 0.5)) continue;
        if (lineOfSight({ x: s.x, y: 1.1, z: s.z }, { x: b.x, y: 1.1, z: b.z }, GUN_BOXES)) pair = { a: s, b };
      }
    expect(pair).not.toBeNull();
    // eu no meio do caminho do bot
    const me = { id: ME, x: (pair!.a.x + pair!.b.x) / 2, y: 0, z: (pair!.a.z + pair!.b.z) / 2, crouch: false };
    const bots = new GunBots('facil', 1, { host, me: () => me, shoot: () => undefined, killed: () => undefined }, 3);
    const b = (
      Reflect.get(bots, 'list') as { x: number; z: number; thinkAt: number; path: { x: number; z: number }[] }[]
    )[0]!;
    b.x = pair!.a.x;
    b.z = pair!.a.z;
    b.thinkAt = Infinity;
    b.path = [{ x: pair!.b.x, z: pair!.b.z }];
    let t = performance.now();
    let closest = Infinity;
    for (let i = 0; i < 180; i++) {
      bots.update(1 / 60, (t += 1000 / 60));
      closest = Math.min(closest, Math.hypot(b.x - me.x, b.z - me.z));
    }
    expect(closest).toBeGreaterThan(0.65);
    bots.dispose();
  });

  it('o boneco libera todas as geometrias e materiais (a sombra também)', async () => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => undefined) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const { Avatar } = await import('../src/features/space3d/avatar');
    const av = new Avatar(BOB, 'Bob');
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    av.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Sprite)) return;
      if (o instanceof THREE.Mesh) spies.push(vi.spyOn(o.geometry, 'dispose'));
      spies.push(vi.spyOn(o.material as THREE.Material, 'dispose'));
    });
    expect(spies.length).toBeGreaterThanOrEqual(5);
    av.dispose();
    for (const sp of spies) expect(sp).toHaveBeenCalled();
  });

  it('na 3ª pessoa, o boneco a menos de 0,8 m da câmera some', async () => {
    const { nearCamera } = await import('../src/features/space3d/scene');
    expect(nearCamera({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 1, z: 0 })).toBe(true);
    expect(nearCamera({ x: 0, y: 0, z: 0 }, { x: 1.2, y: 1, z: 0 })).toBe(false);
    expect(nearCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 2.4, z: 0 })).toBe(false);
  });
});

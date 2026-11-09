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
const mapMod = await import('../src/features/space3d/gunfight/map');
const { GUN_BOXES, GUN_SPAWNS, blockedAt, gunObstacles, pickSpawn } = mapMod;
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
/** tira a proteção de quem acabou de nascer (os testes antigos atiram e levam tiro logo depois de nascer) */
function unshield(g: InstanceType<typeof GunGame>) {
  Reflect.set(g, 'protUntil', 0);
}

async function started(over: Partial<GunHost> = {}, o: { shield?: boolean } = {}) {
  const f = fakeHost(over);
  const g = new GunGame(f.host);
  await Promise.resolve();
  await Promise.resolve();
  if (!o.shield) unshield(g);
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
    expect(GUNS.ak47.recoil.pattern[0]!.up).toBeGreaterThan(GUNS.m4.recoil.pattern[0]!.up);
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
    unshield(g);
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

describe('gunfight: recuo (padrão, volta, cadência e molas)', () => {
  const D = 180 / Math.PI;
  /** subida e o maior desvio de lado (graus) de `n` tiros sem sorteio, no quadril */
  const spray = (id: keyof typeof GUNS, n: number) => {
    let up = 0;
    let side = 0;
    let maxSide = 0;
    for (let i = 1; i <= n; i++) {
      const k = w.recoilKick(GUNS[id], i);
      up += k.up * D;
      side += k.side * D;
      maxSide = Math.max(maxSide, Math.abs(side));
    }
    return { up, maxSide };
  };

  it('o padrão é fixo por arma: o mesmo tiro dá o mesmo recuo a cada pente', () => {
    for (const id of ['m4', 'ak47', 'mp7', 'mp5'] as const)
      for (let i = 1; i <= 30; i++) expect(w.recoilKick(GUNS[id], i)).toEqual(w.recoilKick(GUNS[id], i));
    // o sorteio só varia um pouco por cima (±noise)
    const a = w.recoilKick(GUNS.m4, 10, 0, 0).up;
    const b = w.recoilKick(GUNS.m4, 10, 0.999, 0.999).up;
    const mid = w.recoilKick(GUNS.m4, 10).up;
    expect(Math.abs(a - mid) / mid).toBeLessThanOrEqual(GUNS.m4.recoil.noise + 1e-6);
    expect(Math.abs(b - mid) / mid).toBeLessThanOrEqual(GUNS.m4.recoil.noise + 1e-6);
  });

  it('a AK sobe e desvia mais que o M4; a SMG é rápida e baixa', () => {
    const ak = spray('ak47', 30);
    const m4 = spray('m4', 30);
    const mp5 = spray('mp5', 30);
    const mp7 = spray('mp7', 30);
    expect(ak.up).toBeGreaterThan(m4.up);
    expect(m4.up).toBeGreaterThan(mp5.up);
    expect(mp5.up).toBeGreaterThan(mp7.up);
    expect(ak.maxSide).toBeGreaterThanOrEqual(1.8 * m4.maxSide);
    // mirando, 30 tiros: M4 ~7° e AK ~10° (o primeiro tiro sai com 60% do recuo)
    const ads = w.recoilMul(1, false).up;
    expect(m4.up * ads).toBeGreaterThan(5);
    expect(m4.up * ads).toBeLessThan(9);
    expect(ak.up * ads).toBeGreaterThan(m4.up * ads * 1.3);
    expect(w.recoilKick(GUNS.m4, 1).up).toBeCloseTo(w.recoilKick(GUNS.m4, 2).up * w.FIRST_SHOT, 6);
    // pistolas: a Desert Eagle coiceia muito mais que a M9, na mira e na arma
    expect(w.recoilKick(GUNS.deagle, 2).up).toBeGreaterThan(3 * w.recoilKick(GUNS.m9, 2).up);
    expect(GUNS.deagle.recoil.vm.rise).toBeGreaterThan(GUNS.m9.recoil.vm.rise);
    expect(GUNS.ak47.recoil.vm.rise).toBeGreaterThan(GUNS.m4.recoil.vm.rise);
  });

  it('mirar e agachar reduzem; a rajada esfria aos poucos e a dispersão abre com ela', () => {
    expect(w.recoilMul(1, false).up).toBeCloseTo(0.6);
    expect(w.recoilMul(0, true).up).toBeCloseTo(0.85);
    // clicar rápido não volta ao primeiro tiro; parar esfria
    expect(w.burstNow(GUNS.m9, 5, GUNS.m9.recoil.recover.delay)).toBe(5);
    expect(w.shotIndex(w.burstNow(GUNS.m9, 5, 1500))).toBe(1);
    expect(w.bloomNow(GUNS.m4, 15, 0)).toBeGreaterThan(w.bloomNow(GUNS.m4, 1, 0));
    expect(w.bloomNow(GUNS.m4, 10, 1)).toBeLessThan(w.bloomNow(GUNS.m4, 10, 0));
  });

  it('mola: o pico é o pedido e não muda com o fps', async () => {
    const { spring, kickSpring, stepSpring } = await import('../src/features/space3d/gunfight/spring');
    for (const id of ['m4', 'deagle', 'l115'] as const) {
      const v = GUNS[id].recoil.vm;
      /** onde a mola está em `at` s, andando a `fps`, e o maior valor visto */
      const run = (fps: number, at: number) => {
        const s = spring();
        kickSpring(s, v.k, v.c, v.rise);
        let peak = 0;
        for (let t = 0; t < at - 1e-9; t += 1 / fps) {
          stepSpring(s, v.k, v.c, 1 / fps);
          peak = Math.max(peak, s.x);
        }
        return { x: s.x, peak };
      };
      // o pico (visto de perto) é o pedido
      expect(Math.abs(run(480, 0.5).peak - v.rise) / v.rise).toBeLessThan(0.1);
      // no mesmo instante, a mola está no mesmo lugar a 30 e a 144 qps
      const a = run(30, 4 / 30).x;
      const b = run(144, 4 / 30).x;
      expect(Math.abs(a - b)).toBeLessThan(v.rise * 0.1);
      // e volta ao lugar em menos de 1 s
      expect(Math.abs(run(60, 1).x)).toBeLessThan(v.rise * 0.05);
    }
  });

  it('a cadência não depende do fps (3 s de M4 = 40 tiros a 30, 60 e 144 qps)', async () => {
    for (const fps of [30, 60, 144]) {
      const { g, sent, held } = await started();
      let t = performance.now() + 1000;
      for (let i = 0; i < 60; i++) g.step(0.016, (t += 16));
      held.add('fire');
      g.press('fire', t);
      const dt = 1000 / fps;
      // munição infinita: o pente não acaba no meio (o teste é da cadência)
      const ammo = (g as unknown as { ammo: Map<string, { mag: number }> }).ammo;
      const end = t + 3000;
      while (t < end - 1e-6) {
        ammo.get('m4')!.mag = 30;
        g.step(dt / 1000, (t += dt));
      }
      expect(Math.abs(fires(sent) - 40)).toBeLessThanOrEqual(1);
      held.clear();
      g.dispose();
    }
  });

  it('a mira volta sozinha depois da rajada, e o mouse puxando para baixo paga a conta', async () => {
    const { g, held, view } = await started();
    let t = performance.now() + 1000;
    for (let i = 0; i < 60; i++) g.step(0.016, (t += 16));
    const p0 = view.pitch;
    held.add('fire');
    g.press('fire', t);
    for (let i = 0; i < 48; i++) g.step(0.016, (t += 16));
    held.clear();
    g.release('fire');
    const rise = p0 - view.pitch;
    expect(rise).toBeGreaterThan(0.03);
    for (let i = 0; i < 38; i++) g.step(0.016, (t += 16));
    // 600 ms depois: no máximo 35% da subida
    expect(p0 - view.pitch).toBeLessThanOrEqual(rise * 0.35);
    expect(p0 - view.pitch).toBeGreaterThanOrEqual(0);

    // com o mouse compensando tudo durante a rajada, a volta não passa da mira inicial
    const p1 = view.pitch;
    held.add('fire');
    g.press('fire', t);
    for (let i = 0; i < 48; i++) {
      const before = view.pitch;
      g.step(0.016, (t += 16));
      view.pitch = before;
    }
    held.clear();
    g.release('fire');
    expect(g.recoilDebt).toBeLessThan(1e-3);
    for (let i = 0; i < 60; i++) g.step(0.016, (t += 16));
    expect(view.pitch).toBeLessThanOrEqual(p1 + 1e-3);
    g.dispose();
  });

  it('clicar rápido com a pistola sobe mais que tocar devagar (soltar não zera a rajada)', async () => {
    const climb = async (gap: number) => {
      const { g, view } = await started();
      let t = performance.now() + 1000;
      g.switchTo('secondary', t);
      for (let i = 0; i < 40; i++) g.step(0.016, (t += 16));
      const ups: number[] = [];
      for (let k = 0; k < 5; k++) {
        const p = view.pitch;
        g.press('fire', t);
        g.release('fire');
        g.step(0.001, (t += 1));
        ups.push(p - view.pitch);
        for (let i = 0; i < gap / 16; i++) g.step(0.016, (t += 16));
      }
      g.dispose();
      return ups;
    };
    const fast = await climb(160);
    const slow = await climb(800);
    // devagar, cada tiro é o primeiro (60% do recuo); rápido, a partir do segundo é o recuo inteiro
    expect(fast[3]!).toBeGreaterThan(slow[3]! * 1.3);
  });
});

describe('gunfight: rodada do jogo todo (Caio, pegada/recoil r1)', () => {
  it('nasce protegido: o dano é ignorado por 1,5 s ou até o primeiro tiro; a pose avisa os outros', async () => {
    const { g, setPlayers, held } = await started({}, { shield: true });
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    const t0 = performance.now();
    expect(g.shielded).toBe(true);
    expect(g.pose().prot).toBe(true);
    expect(SpaceGunPose.safeParse(g.pose()).success).toBe(true);
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 28, sender: BOB }, t0 + 100);
    expect(useGunHud.getState().hp).toBe(100);
    // atirar tira a proteção na hora
    held.add('fire');
    g.press('fire', t0 + 700);
    g.step(0.016, t0 + 700);
    held.delete('fire');
    g.release('fire');
    expect(g.shielded).toBe(false);
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 28, sender: BOB }, t0 + 900);
    expect(useGunHud.getState().hp).toBe(72);
    g.dispose();
  });

  it('a proteção acaba sozinha em 1,5 s', async () => {
    const { g, setPlayers } = await started({}, { shield: true });
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true }]);
    const t0 = performance.now();
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 28, sender: BOB }, t0 + 1400);
    expect(useGunHud.getState().hp).toBe(100);
    g.remote({ channelId: ME, kind: 'hit', w: 'm4', target: ME, dmg: 28, sender: BOB }, t0 + 1600);
    expect(useGunHud.getState().hp).toBe(72);
    g.dispose();
  });

  it('nunca nasce à vista de um inimigo a menos de 30 m (se houver um ponto seguro) e olha para a vista livre', () => {
    const eye = (p: { x: number; z: number }) => ({ x: p.x, y: 1.12, z: p.z });
    for (const e of GUN_SPAWNS) {
      for (const u of [0, 0.4, 0.99]) {
        const s = pickSpawn([e], u);
        const safe = GUN_SPAWNS.some(
          (o) => Math.hypot(o.x - e.x, o.z - e.z) >= 30 || !lineOfSight(eye(o), eye(e), GUN_BOXES),
        );
        if (!safe) continue;
        const near = Math.hypot(s.x - e.x, s.z - e.z) < 30;
        expect(near && lineOfSight(eye(s), eye(e), GUN_BOXES)).toBe(false);
      }
    }
    // a direção de nascer vê pelo menos 6 m livres em todo ponto
    const { spawnFacing } = mapMod;
    for (const s of GUN_SPAWNS) {
      const ry = spawnFacing(s);
      const o = { x: s.x, y: 1.12, z: s.z };
      const d = { x: Math.sin(ry), y: 0, z: Math.cos(ry) };
      const free = Math.min(25, ...GUN_BOXES.map((b) => w.rayBox(o, d, b)));
      expect(free).toBeGreaterThan(6);
    }
  });

  it('agachado atrás da mureta, a cabeça não aparece', () => {
    const low = GUN_BOXES.find((b) => b.kind === 'low')!;
    expect(low.max.y).toBeGreaterThan(w.headY(true) + w.HEAD_R);
  });

  it('o alvo de abates segue o tamanho da partida e a partida acaba no tempo', async () => {
    expect(w.ffaTarget(2)).toBe(15);
    expect(w.ffaTarget(4)).toBe(20);
    expect(w.ffaTarget(8)).toBe(25);
    const { g } = await started();
    g.setBots('facil', 3);
    expect(g.killTarget).toBe(20);
    unshield(g);
    const t0 = performance.now();
    g.hurt('bot:1', 200, 'm4', false, null, t0);
    // o bot 1 fez um abate; no fim do tempo, ele vence com 1
    g.step(0.016, t0 + w.MATCH_MS + 10);
    expect(g.over).toBe(true);
    expect(useGunHud.getState().winner).toBe('Bot 1');
    g.dispose();
  });

  it('o relógio da partida segue o de quem já estava jogando', async () => {
    const { g, setPlayers } = await started();
    const t0 = performance.now();
    setPlayers([{ id: BOB, name: 'Bob', x: 0, y: 0, z: 0, ry: 0, crouch: false, alive: true, ft: 20, fl: 120 }]);
    g.step(0.016, t0 + 3000);
    expect(g.killTarget).toBe(20);
    // 120 s a partir do quadro de 3 s (a pose conta pelo relógio de agora)
    expect(g.pose().fl).toBeLessThanOrEqual(124);
    expect(g.pose().fl).toBeGreaterThan(110);
    expect(SpaceGunPose.safeParse(g.pose()).success).toBe(true);
    g.dispose();
  });

  it('faca: o golpe rápido precisa de dois, o pesado derruba de uma vez', async () => {
    expect(GUNS.karambit.melee!.dmg * 2).toBeGreaterThanOrEqual(100);
    expect(GUNS.karambit.melee!.dmg).toBeLessThan(100);
    expect(GUNS.karambit.melee!.heavy).toBeGreaterThanOrEqual(100);
    expect(maxDamage(GUNS.bayonet)).toBe(GUNS.bayonet.melee!.heavy);
  });

  it('o tiro que acerta parede ou chão traz a normal da face (para a marca)', () => {
    const wall = { min: { x: -1, y: 0, z: -6 }, max: { x: 1, y: 3, z: -5 } };
    const o = { x: 0, y: 1.1, z: 0 };
    expect(castShot(o, { x: 0, y: 0, z: -1 }, [], [wall]).normal).toEqual({ x: 0, y: 0, z: 1 });
    const down = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };
    const g = castShot(o, down, [], []);
    expect(g.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(g.dist).toBeCloseTo(1.1 * Math.SQRT2, 3);
  });

  it('a dispersão lateral não cresce olhando para cima', () => {
    const ang = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const c = aimDir(0, -1.2, 0, 0, 0);
    // u1 = 1, u2 = 0: todo o espalhamento para o lado
    const side = aimDir(0, -1.2, 0.05, 0.999999, 0);
    expect(ang(c, side)).toBeCloseTo(0.05, 2);
  });

  it('as marcas de tiro ficam num pool de 64, a mais velha sai, e somem em 8 s', async () => {
    const { GunFx, MARKS, MARK_MS } = await import('../src/features/space3d/gunfight/fx');
    const scene = new THREE.Scene();
    const fx = new GunFx(scene);
    const before = scene.children.length;
    for (let i = 0; i < 100; i++) fx.mark({ x: i * 0.1, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, 1000);
    expect(fx.marksAlive(1000)).toBe(MARKS);
    // nada de malha nova por tiro
    expect(scene.children.length).toBe(before);
    fx.update(1000 + MARK_MS + 1, new THREE.Vector3());
    expect(fx.marksAlive(1000 + MARK_MS + 1)).toBe(0);
    fx.dispose();
  });

  it('câmera da morte: fora das caixas, vira para quem matou e sobe quando a parede encosta', async () => {
    const { deathCam, DEATH_CAM } = await import('../src/features/space3d/gunfight/camera');
    const inside = (p: { x: number; y: number; z: number }) =>
      GUN_BOXES.some(
        (b) => p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z,
      );
    const killer = { x: 0, y: 1.12, z: -12 };
    for (const s of GUN_SPAWNS) {
      const c = deathCam({ x: s.x, y: 0, z: s.z }, killer, 2000, 0, GUN_BOXES);
      expect(inside(c.pos)).toBe(false);
      // depois de virar, olha para o matador
      expect(c.look).toEqual(killer);
    }
    // no começo olha o corpo
    const c0 = deathCam({ x: 0, y: 0, z: 0 }, killer, 0, 0, GUN_BOXES);
    expect(c0.look).toEqual({ x: 0, y: 0.9, z: 0 });
    // de costas para o contêiner (x = -14, z = -12; a face leste fica em x ≈ -12,78): a câmera sobe
    const wallBody = { x: -12.5, y: 0, z: -12 };
    const top = deathCam(wallBody, { x: 10, y: 1.12, z: -12 }, 500, 0, GUN_BOXES);
    expect(top.pos.y).toBeGreaterThan(DEATH_CAM.top - 0.2);
    expect(inside(top.pos)).toBe(false);
  });

  it('o boneco ganha um passo a cada passada (0,55 m andando), agachado não', async () => {
    const { g, events, setPlayers } = await started();
    const t0 = performance.now();
    const steps = () => events.filter((e) => e.kind === 'gunfx' && e.what === 'step' && e.by === BOB).length;
    for (let i = 0; i <= 51; i++) {
      setPlayers([{ id: BOB, name: 'Bob', x: 10, y: 0, z: i * 0.11, ry: 0, crouch: false, alive: true }]);
      g.step(0.033, t0 + i * 33);
    }
    // 5,6 m andados = 10 passos
    expect(steps()).toBe(10);
    for (let i = 52; i <= 100; i++) {
      setPlayers([{ id: BOB, name: 'Bob', x: 10, y: 0, z: i * 0.11, ry: 0, crouch: true, alive: true }]);
      g.step(0.033, t0 + i * 33);
    }
    expect(steps()).toBe(10);
    g.dispose();
  });

  it('a aceleração no chão não depende do fps', () => {
    const t90 = (fps: number) => {
      const s = mv.newMove();
      const dt = 1 / fps;
      let t = 0;
      for (let i = 0; i < fps * 3; i++) {
        mv.stepMove(
          s,
          { wx: 0, wz: -1, runHeld: false, forward: true, ads: false, gunK: 1, firing: false },
          dt,
          1000 + t * 1000,
        );
        t += dt;
        if (Math.hypot(s.vx, s.vz) >= 0.9 * mv.MOVE.walk) return t;
      }
      return Infinity;
    };
    const a = t90(30);
    const b = t90(240);
    expect(Math.abs(a - b) / b).toBeLessThan(0.12);
  });

  it('os bots sentem o recuo (a mira sobe na rajada) e atiram na cadência certa com qualquer fps', async () => {
    const { GunBots, BOT_RECOIL_LEFT } = await import('../src/features/space3d/gunfight/bots');
    expect(BOT_RECOIL_LEFT.facil).toBeGreaterThan(BOT_RECOIL_LEFT.dificil);
    const { host } = fakeHost();
    let shots = 0;
    const bots = new GunBots('dificil', 1, { host, me: () => null, shoot: () => shots++, killed: () => undefined }, 5);
    const b = (Reflect.get(bots, 'list') as Record<string, unknown>[])[0]!;
    b.w = 'm4';
    b.mag = 999;
    b.burstLeft = 1e6;
    b.reactAt = 0;
    b.nextShot = 0;
    const trigger = Reflect.get(bots, 'trigger') as (this: unknown, b: unknown, now: number) => void;
    let t = 1000;
    for (let i = 0; i < 90; i++) {
      trigger.call(bots, b, t);
      t += 1000 / 30;
    }
    // 3 s de M4 (800 rpm) a 30 qps: 40 ± 1 tiros
    expect(Math.abs(shots - 40)).toBeLessThanOrEqual(1);
    // o recuo ficou na mira (sobe: pitch negativo)
    expect(b.errPitch as number).toBeLessThan(0);
    bots.dispose();
  });
});

describe('gunfight: som (passos, tiro de longe, lado)', () => {
  it('passo, tom por arma, tiro de longe e panorâmica maior no gunfight', async () => {
    const m = await import('../src/features/space3d/sfxmap');
    const at = { x: 0, y: 0, z: 0 };
    const step = m.sfxFor(
      { kind: 'gunfx', what: 'step', w: 'm4', by: BOB, power: 0.55, zone: 8, at },
      { me: ME, team: 'a' },
    );
    expect(step[0]).toMatchObject({ name: 'step', gain: 0.55 });
    const other = m.sfxFor({ kind: 'gunshot', by: BOB, w: 'kar98k', power: 1, zone: 8, at }, { me: ME, team: 'a' });
    expect(other[0]).toMatchObject({ name: 'shotSniper', pitch: 1.12, far: 'shotFar' });
    const mine = m.sfxFor({ kind: 'gunshot', by: ME, w: 'm4', power: 1, zone: 8, at }, { me: ME, team: 'a' });
    expect(mine[0]!.far).toBeUndefined();
    const right = { x: 10, z: 0 };
    expect(m.sfxPan({ x: 0, z: 0, yaw: 0, zone: 8 }, right)).toBeCloseTo(m.SFX_PAN_GUN, 5);
    expect(m.sfxPan({ x: 0, z: 0, yaw: 0, zone: 1 }, right)).toBeCloseTo(m.SFX_PAN_MAX, 5);
  });
});

describe('gunfight: recuo (Téo, pegada/recoil r2)', () => {
  const D = 180 / Math.PI;
  const holdFire = async (fps: number, ms: number) => {
    const { g, held, view, sent } = await started();
    // sem o sorteio por cima do padrão (o teste é do fps, não do ruído)
    Reflect.set(g, 'rand', () => 0.5);
    let t = performance.now() + 1000;
    for (let i = 0; i < 100; i++) g.step(0.016, (t += 16));
    const p0 = view.pitch;
    const ammo = (g as unknown as { ammo: Map<string, { mag: number }> }).ammo;
    held.add('fire');
    g.press('fire', t);
    const dt = 1000 / fps;
    const end = t + ms;
    while (t < end - 1e-6) {
      ammo.get(g.weapon)!.mag = 30;
      g.step(dt / 1000, (t += dt));
    }
    const rise = p0 - view.pitch;
    held.clear();
    g.release('fire');
    return { g, view, rise, p0, t, shots: fires(sent) };
  };

  it('a rajada esfria junto com a volta da mira: parar 600 ms volta ao primeiro tiro; tocar rápido, não', () => {
    const m4 = GUNS.m4;
    // 10 tiros e 600 ms parado: o próximo é o primeiro (com o bônus)
    expect(w.shotIndex(w.burstNow(m4, 10, 600))).toBe(1);
    // toques: a rajada fica no ponto em que esfria tanto quanto sobe a cada toque
    const steady = (gap: number) => {
      let b = 0;
      for (let i = 0; i < 30; i++) b = w.burstNow(m4, b, gap) + 1;
      return w.shotIndex(w.burstNow(m4, b, gap));
    };
    expect(steady(160)).toBeGreaterThanOrEqual(3);
    expect(steady(250)).toBeLessThanOrEqual(2);
    expect(steady(250)).toBeLessThan(steady(160));
    // a Desert Eagle a 450 ms entre tiros não acumula a rajada para sempre
    let b = 0;
    for (let i = 0; i < 10; i++) b = w.burstNow(GUNS.deagle, b, 450) + 1;
    expect(w.shotIndex(w.burstNow(GUNS.deagle, b, 450))).toBeLessThanOrEqual(2);
  });

  it('dispersão: o primeiro tiro só ajuda parado; pular, andar e deslizar nunca ficam perfeitos, nem com a luneta', () => {
    const st = { ads: 1, moving: 0, crouch: false, grounded: true, sliding: false, scoped: true, n: 1 };
    // parado e mirando: preciso
    expect(w.shotSpread(GUNS.l115, st)).toBeLessThan(1e-6);
    expect(w.shotSpread(GUNS.m4, st)).toBeLessThan(0.001);
    // no ar com a luneta: pelo menos 0,05 rad
    expect(w.shotSpread(GUNS.l115, { ...st, grounded: false })).toBeGreaterThanOrEqual(0.05);
    // no ar mirando o fuzil: longe de perfeito
    expect(w.shotSpread(GUNS.m4, { ...st, grounded: false, scoped: false })).toBeGreaterThan(0.02);
    // andando e deslizando somam por cima do primeiro tiro
    const still = w.shotSpread(GUNS.m4, { ...st, scoped: false });
    expect(w.shotSpread(GUNS.m4, { ...st, scoped: false, moving: 1 })).toBeGreaterThan(still + 0.005);
    expect(w.shotSpread(GUNS.m4, { ...st, scoped: false, sliding: true })).toBeGreaterThan(still + 0.019);
    // sniper sem a luneta (meio caminho da mira): a dispersão do quadril caindo com a mira, sem bônus de primeiro tiro
    const half = w.shotSpread(GUNS.l115, { ...st, ads: 0.5, scoped: false });
    expect(half).toBeCloseTo(GUNS.l115.spread.hip * 0.5, 4);
    // no quadril, o primeiro tiro do fuzil vai mais certo que o segundo
    const hip = { ...st, ads: 0, scoped: false };
    expect(w.shotSpread(GUNS.m4, hip)).toBeLessThan(w.shotSpread(GUNS.m4, { ...hip, n: 2 }));
  });

  it('o "S" da AK: vai para a esquerda, cruza o centro voltando e termina perto dele', () => {
    let side = 0;
    const at: number[] = [];
    for (let i = 1; i <= 30; i++) {
      side += w.recoilKick(GUNS.ak47, i).side * D;
      at.push(side);
    }
    expect(at[13]!).toBeLessThan(-2.5);
    const cross = at.findIndex((x, i) => i > 13 && x >= 0) + 1;
    expect(cross).toBeGreaterThanOrEqual(19);
    expect(cross).toBeLessThanOrEqual(24);
    expect(Math.abs(at[29]!)).toBeLessThan(1);
  });

  it('a subida da rajada não depende do fps (M4 por 1 s a 30, 60 e 144 qps)', async () => {
    const rises: number[] = [];
    for (const fps of [30, 60, 144]) {
      const r = await holdFire(fps, 1000);
      rises.push(r.rise);
      r.g.dispose();
    }
    const max = Math.max(...rises);
    const min = Math.min(...rises);
    expect(min).toBeGreaterThan(0.05);
    expect((max - min) / max).toBeLessThan(0.08);
  });

  it('trocar de arma depois da rajada não deixa a mira lá em cima', async () => {
    const r = await holdFire(60, 800);
    let t = r.t;
    r.g.switchTo('secondary', t);
    for (let i = 0; i < 90; i++) r.g.step(0.016, (t += 16));
    expect(r.p0 - r.view.pitch).toBeLessThan(r.rise * 0.35);
    r.g.dispose();
  });

  it('olhando quase para o alto, a volta do recuo não desce além de onde a mira começou', async () => {
    const lim = 1.35;
    const view = { yaw: 0, pitch: 0 };
    // o pitch preso como na cena
    const { g, held } = await started({
      yaw: () => view.yaw,
      pitch: () => view.pitch,
      turn: (dy, dp) => {
        view.yaw += dy;
        view.pitch = Math.max(-lim, Math.min(lim, view.pitch + dp));
      },
    });
    let t = performance.now() + 1000;
    for (let i = 0; i < 60; i++) g.step(0.016, (t += 16));
    view.pitch = -1.3;
    for (let i = 0; i < 5; i++) g.step(0.016, (t += 16));
    const p0 = view.pitch;
    held.add('fire');
    g.press('fire', t);
    for (let i = 0; i < 60; i++) g.step(0.016, (t += 16));
    held.clear();
    g.release('fire');
    for (let i = 0; i < 150; i++) g.step(0.016, (t += 16));
    expect(view.pitch).toBeLessThanOrEqual(p0 + 1e-3);
    g.dispose();
  });
});

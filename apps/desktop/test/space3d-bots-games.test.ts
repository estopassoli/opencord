/**
 * Bots do Espaço 3D jogando de verdade: o cérebro do bot (puro) comandando o `SportPlay` como segundo jogador local,
 * a física da sinuca, a moto e o x1. Sorteio com semente fixa (nada de Math.random): os resultados se repetem.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DuelBrain } from '../src/features/space3d/bots/duelbot';
import { botId, type BotLevel } from '../src/features/space3d/bots/level';
import { planPoolShot, poolCandidates } from '../src/features/space3d/bots/poolbot';
import { RaceBrain } from '../src/features/space3d/bots/racebot';
import { between, seeded } from '../src/features/space3d/bots/rng';
import { SportBrain, type BotCmd, type SportView } from '../src/features/space3d/bots/sportbot';
import { moving, POCKETS, POOL_HX, POOL_HZ, POOL_R, stepPool, type PoolBall } from '../src/features/space3d/pool';
import { startGrid, stepBike } from '../src/features/space3d/race';
import { attackHoop, clampToHalf, goodBand, netSideOf, type Team } from '../src/features/space3d/rules';
import { SportPlay, type Me } from '../src/features/space3d/sportplay';
import { ARENAS, hoopDist, lob, type BallState } from '../src/features/space3d/sports';
import type { SportZone } from '@opencord/contracts';

const LEVELS: BotLevel[] = ['facil', 'medio', 'dificil'];
const DT = 1 / 60;

interface Body {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
}

/**
 * Uma arena com o bot (time `botTeam`) e eu parado num canto (sem jogar): o bot joga "contra ninguém".
 * O corpo do bot anda como o da cena (sem colisão), e as ações vão para o `SportPlay` pelo `asBot`.
 */
function arena(zone: 1 | 2 | 3 | 4 | 5, level: BotLevel, seed: number, botTeam: Team = 'b') {
  const BOT = botId(level);
  const myTeam: Team = botTeam === 'a' ? 'b' : 'a';
  const scores: { side: 'a' | 'b'; points: number }[] = [];
  const a = ARENAS[zone];
  const corner = { x: netSideOf(myTeam) * (a.layout.width / 2 - 1), z: a.layout.depth / 2 - 1 };
  const me: Body = { x: corner.x, y: 0, z: corner.z, ry: 0, a: 0 };
  const side = netSideOf(botTeam);
  const bot: Body = { x: side * (zone === 5 ? 2.1 : zone === 4 ? 5 : zone === 3 ? 9.5 : 6), y: 0, z: 0, ry: 0, a: 0 };
  // a mão (ou o pé) de cada um; chamada só depois que a partida existe
  function handOf(id: string) {
    const p = id === BOT ? bot : id === 'eu' ? me : null;
    if (!p) return null;
    const fx = Math.sin(p.ry);
    const fz = Math.cos(p.ry);
    if (zone === 2) {
      const touch = p.a === 2 ? 0.95 : p.a === 1 ? 0.5 : 0.36;
      return { x: p.x + fx * touch, y: a.r, z: p.z + fz * touch };
    }
    if (id === BOT && s.botCharging !== null) return { x: p.x + fx * 0.14, y: p.y + 1.45, z: p.z + fz * 0.14 };
    return { x: p.x + fx * 0.3, y: p.y + 0.76, z: p.z + fz * 0.3 };
  }
  const s: SportPlay = new SportPlay(
    new THREE.Scene(),
    zone as SportZone,
    'eu',
    {
      sendBall: () => undefined,
      score: (sd, points) => scores.push({ side: sd, points }),
      team: () => myTeam,
      teamOf: (id) => (id === BOT ? botTeam : myTeam),
      poseOf: (id) => (id === BOT ? bot : id === 'eu' ? me : null),
    },
    handOf,
    (sd) => {
      const who = Math.sign(bot.x) === netSideOf(sd === 'a' ? 'a' : 'b') ? bot : null;
      return who ? { x: who.x + Math.sin(who.ry) * 0.7, y: 1.2, z: who.z + Math.cos(who.ry) * 0.7 } : null;
    },
  );
  s.setLocalBot(BOT);
  const brain = new SportBrain(level, seeded(seed));
  const meMe = (): Me => ({ ...me, moving: false, running: false });
  let now = 1000;
  let touches = 0;

  /** um quadro: eu parado, o bot pensa, anda e age */
  function frame(view: Partial<SportView> = {}) {
    now += DT * 1000;
    s.update(DT, now, meMe());
    const v: SportView = {
      zone,
      t: now / 1000,
      ball: s.ballNow(),
      parked: s.isParked,
      holder: s.holder === BOT ? 'bot' : s.holder ? 'foe' : null,
      heldFor: s.heldFor(now) / 1000,
      bot,
      team: botTeam,
      foe: { x: me.x, z: me.z, ry: me.ry },
      phase: null,
      charge: s.botCharging,
      band: s.asBot({ ...bot, moving: false, running: false }, botTeam, false, () => s.band()),
      ...view,
    };
    const cmd: BotCmd = brain.think(v);
    let moved = false;
    if (cmd.to) {
      const dx = cmd.to.x - bot.x;
      const dz = cmd.to.z - bot.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.12) {
        const step = Math.min(d, (cmd.run ? 6.2 : 3.2) * brain.skill.speed * DT);
        bot.x += (dx / d) * step;
        bot.z += (dz / d) * step;
        if (zone >= 3) bot.x = clampToHalf(bot.x, botTeam, 0.41);
        bot.ry = Math.atan2(dx, dz);
        moved = true;
      }
    }
    if (!moved && cmd.face !== null) bot.ry = cmd.face;
    bot.a = moved ? (cmd.run ? 2 : 1) : 0;
    const face = cmd.face ?? bot.ry;
    const bm: Me = { ...bot, moving: moved, running: cmd.run, aim: face, speed: moved ? 6.2 : 0 };
    s.botStep(DT, now, bm, botTeam, false);
    s.asBot(bm, botTeam, false, () => {
      if (zone === 1) {
        if (cmd.press) s.press(now);
        if (cmd.release) s.release(now);
      } else if (zone === 2) {
        if (cmd.press) s.footPress(now, true);
        else if (cmd.secondary) s.footPress(now, false);
      } else if (cmd.press) {
        bot.ry = face;
        s.press(now);
        touches++;
      }
    });
    return cmd;
  }
  return {
    s,
    bot,
    me,
    scores,
    frame,
    get now() {
      return now;
    },
    get touches() {
      return touches;
    },
  };
}

describe('bots: basquete', () => {
  it('vai até a bola solta e pega', () => {
    const g = arena(1, 'medio', 3);
    for (let i = 0; i < 60 * 6 && g.s.holder === null; i++) g.frame();
    expect(g.s.holder).toBe('bot:medio');
  });

  it('com a bola: arremessa na cesta de ataque e faz ponto contra ninguém', () => {
    const g = arena(1, 'dificil', 5);
    for (let i = 0; i < 60 * 60 && !g.scores.length; i++) g.frame();
    expect(g.scores[0]?.side).toBe('b');
  });

  it('o difícil solta a força na faixa verde mais vezes que o fácil', () => {
    const rate = (level: BotLevel) => {
      let inBand = 0;
      const N = 300;
      for (let k = 0; k < N; k++) {
        const brain = new SportBrain(level, seeded(1000 + k));
        const team: Team = 'a';
        const hoop = attackHoop(team);
        const base: SportView = {
          zone: 1,
          t: 10,
          ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 },
          parked: false,
          holder: 'bot',
          heldFor: 2,
          bot: { x: 0, y: 0, z: 0, ry: 0 },
          team,
          foe: null,
          phase: null,
          charge: null,
          band: null,
        };
        // pegou a bola (reage) e escolhe de onde arremessar; o bot "chega" lá
        brain.think(base);
        const go = brain.think({ ...base, t: 12 });
        const at = go.to ?? { x: 0, z: 0 };
        const band = goodBand(hoopDist(at, hoop));
        const there = { ...base, t: 12.1, bot: { x: at.x, y: 0, z: at.z, ry: 0 }, band };
        expect(brain.think(there).press).toBe(true);
        // a carga sobe até ele soltar
        let released = 1;
        for (let c = 0; c <= 1; c += 0.005)
          if (brain.think({ ...there, t: 12.2, charge: c }).release) {
            released = c;
            break;
          }
        if (released >= band.lo && released <= band.hi) inBand++;
      }
      return inBand / N;
    };
    const [f, m, d] = LEVELS.map(rate);
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeGreaterThan(m!);
    expect(m).toBeGreaterThan(f!);
  });

  it('com a pessoa com a bola, marca entre ela e a própria cesta', () => {
    const brain = new SportBrain('dificil', seeded(9));
    const view: SportView = {
      zone: 1,
      t: 5,
      ball: { x: 2, y: 0.8, z: 0, vx: 0, vy: 0, vz: 0 },
      parked: false,
      holder: 'foe',
      heldFor: 0.2,
      bot: { x: -6, y: 0, z: 0, ry: 0 },
      team: 'b',
      foe: { x: 2, z: 0, ry: 0 },
      phase: null,
      charge: null,
      band: null,
    };
    brain.think(view);
    const cmd = brain.think({ ...view, t: 6 });
    // o time b defende a cesta de +x: fica entre a pessoa (x = 2) e ela
    expect(cmd.to!.x).toBeGreaterThan(2);
  });
});

describe('bots: futebol', () => {
  it('domina, conduz e faz gol contra ninguém', () => {
    const g = arena(2, 'dificil', 11);
    for (let i = 0; i < 60 * 60 && !g.scores.length; i++) g.frame();
    expect(g.scores[0]?.side).toBe('b');
  });

  it('com a pessoa de bola no pé, chega e tenta o desarme (o fácil dá mais carrinho por trás)', () => {
    const tries = (level: BotLevel) => {
      let slidesBehind = 0;
      for (let k = 0; k < 200; k++) {
        const brain = new SportBrain(level, seeded(500 + k));
        // a pessoa vai para +x (de costas para o bot, que está atrás dela)
        const view: SportView = {
          zone: 2,
          t: 1,
          ball: { x: 0.4, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0 },
          parked: false,
          holder: 'foe',
          heldFor: 1,
          bot: { x: -2, y: 0, z: 0, ry: Math.PI / 2 },
          team: 'b',
          foe: { x: 0, z: 0, ry: Math.PI / 2 },
          phase: null,
          charge: null,
          band: null,
        };
        brain.think(view);
        for (let t = 2; t < 4; t += 0.05) if (brain.think({ ...view, t }).secondary) slidesBehind++;
      }
      return slidesBehind;
    };
    expect(tries('facil')).toBeGreaterThan(tries('dificil'));
  });
});

/** a pessoa rebate (de mentira, chegando pela rede) uma bola para o lado do bot */
function incoming(g: ReturnType<typeof arena>, zone: 3 | 4 | 5, rnd: () => number, t: number) {
  const c = ARENAS[zone].court!;
  const tb = ARENAS[zone].table;
  const from = { x: -c.hx * 0.7, y: zone === 4 ? 1.6 : zone === 5 ? 0.95 : 1.1, z: between(rnd, -0.5, 0.5) * c.hz };
  const to = {
    x: between(rnd, 0.35, 0.85) * c.hx,
    y: (tb?.y ?? 0) + ARENAS[zone].r,
    z: between(rnd, -0.7, 0.7) * c.hz,
  };
  const net = ARENAS[zone].net!;
  const apex = Math.max(zone === 5 ? 0.25 : zone === 4 ? 1 : 1.2, net.y0 + net.h + 0.4 - Math.max(from.y, to.y));
  const v = lob(from, to, apex);
  const b: BallState = { ...from, ...v };
  g.s.remote({ ...b, held: null, t, by: 'amigo' }, g.now);
}

describe('bots: tênis, vôlei e ping pong', () => {
  for (const zone of [3, 4, 5] as const) {
    it(`zona ${zone}: anda até a queda e rebate para o outro lado; o difícil devolve mais que o fácil`, () => {
      const rate = (level: BotLevel) => {
        let ok = 0;
        const N = 30;
        for (let k = 0; k < N; k++) {
          const g = arena(zone, level, 77 + k);
          for (let i = 0; i < 30; i++) g.frame();
          incoming(g, zone, seeded(4000 + k), 10);
          let back = false;
          for (let i = 0; i < 60 * 5 && !g.scores.length; i++) {
            g.frame();
            const b = g.s.ballNow();
            if (g.touches > 0 && b.vx < -0.5) back = true;
          }
          // devolveu e o ponto foi do bot (ninguém do meu lado)
          if (back && g.scores[0]?.side === 'b') ok++;
        }
        return ok / N;
      };
      const f = rate('facil');
      const d = rate('dificil');
      expect(d).toBeGreaterThan(0.5);
      expect(d).toBeGreaterThan(f);
    });
  }

  it('saca quando a bola parada é do lado dele e faz o ponto contra ninguém', () => {
    const g = arena(3, 'dificil', 21, 'a');
    g.s.resetMatch(g.now);
    for (let i = 0; i < 60 * 10 && !g.scores.length; i++) g.frame();
    expect(g.touches).toBeGreaterThan(0);
    expect(g.scores[0]?.side).toBe('a');
  });
});

describe('bots: sinuca', () => {
  /** uma bola colorida solta na mesa e a branca à esquerda */
  const table = (rnd: () => number): PoolBall[] => [
    { x: -POOL_HX / 2, z: between(rnd, -0.3, 0.3), vx: 0, vz: 0, in: false },
    { x: between(rnd, 0.1, 1.0), z: between(rnd, -0.45, 0.45), vx: 0, vz: 0, in: false },
  ];

  it('acha tacadas com caminho livre para as caçapas', () => {
    const c = poolCandidates(table(seeded(1)));
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]!.ball).toBe(1);
    expect(c[0]!.pocket).toBeGreaterThanOrEqual(0);
    expect(c[0]!.pocket).toBeLessThan(POCKETS.length);
  });

  it('o difícil encaçapa mais que o fácil (mira e força com erro do nível)', () => {
    const rate = (level: BotLevel) => {
      let pocketed = 0;
      const N = 80;
      for (let k = 0; k < N; k++) {
        const balls = table(seeded(9000 + k));
        const shot = planPoolShot(balls, level, seeded(k));
        const v = 0.3 + shot.charge * (4.2 - 0.3);
        balls[0]!.vx = Math.sin(shot.angle) * v;
        balls[0]!.vz = Math.cos(shot.angle) * v;
        for (let t = 0; t < 15 && (t === 0 || moving(balls)); t += DT) stepPool(balls, DT);
        if (balls[1]!.in && !balls[0]!.in) pocketed++;
      }
      return pocketed / N;
    };
    const f = rate('facil');
    const d = rate('dificil');
    expect(d).toBeGreaterThan(0.45);
    expect(d).toBeGreaterThan(f);
  });

  it('a tacada fica dentro da mesa: ângulo finito e força entre 0 e 1', () => {
    const balls = table(seeded(3));
    const shot = planPoolShot(balls, 'medio', seeded(3));
    expect(Number.isFinite(shot.angle)).toBe(true);
    expect(shot.charge).toBeGreaterThan(0);
    expect(shot.charge).toBeLessThanOrEqual(1);
    expect(Math.abs(balls[1]!.x)).toBeLessThan(POOL_HX);
    expect(Math.abs(balls[1]!.z)).toBeLessThan(POOL_HZ);
    expect(POOL_R).toBeGreaterThan(0);
  });
});

describe('bots: corrida', () => {
  /** quanto tempo (s) o bot leva para dar as 3 voltas (Infinity = não terminou em 4 min) */
  const lapTime = (level: BotLevel, seed: number) => {
    const brain = new RaceBrain(level, seeded(seed));
    const b = startGrid(1);
    let now = 0;
    for (let i = 0; i < 60 * 240; i++) {
      now += DT * 1000;
      const { input } = brain.drive(b, now);
      for (const e of stepBike(b, input, DT, now, true)) if (e.kind === 'lap' && e.lap >= 3) return now / 1000;
    }
    return Infinity;
  };

  it('pilota pela pista e completa as 3 voltas; o difícil é mais rápido que o fácil', () => {
    const d = lapTime('dificil', 1);
    const f = lapTime('facil', 1);
    expect(d).toBeLessThan(150);
    expect(f).toBeGreaterThan(d);
  });

  it('usa o turbo guardado', () => {
    const brain = new RaceBrain('dificil', seeded(2));
    const b = { ...startGrid(0), item: true };
    let used = false;
    for (let now = 0; now < 20_000 && !used; now += 100) used = brain.drive(b, now).boost;
    expect(used).toBe(true);
  });
});

describe('bots: x1', () => {
  const view = (over: Partial<Parameters<DuelBrain['think']>[0]> = {}) => ({
    now: 1000,
    bot: { x: 3, z: 0, ry: -Math.PI / 2 },
    foe: { x: 0, z: 0, ry: Math.PI / 2, a: 0 },
    hpBot: 100,
    hpFoe: 100,
    fighting: true,
    ...over,
  });

  it('longe, chega perto; perto, soca', () => {
    const brain = new DuelBrain('medio', seeded(4));
    const far = brain.think(view());
    expect(far.to).not.toBeNull();
    expect(Math.hypot(far.to!.x, far.to!.z)).toBeLessThan(3);
    let punches = 0;
    for (let t = 1000; t < 6000; t += 16)
      if (brain.think(view({ now: t, bot: { x: 1, z: 0, ry: -Math.PI / 2 } })).punch) punches++;
    expect(punches).toBeGreaterThan(2);
  });

  it('na contagem não faz nada', () => {
    const brain = new DuelBrain('dificil', seeded(5));
    const c = brain.think(view({ fighting: false, bot: { x: 1, z: 0, ry: 0 } }));
    expect(c.punch).toBeNull();
    expect(c.block).toBe(false);
  });

  it('o difícil levanta a guarda depois de ver um soco mais vezes que o fácil', () => {
    const guards = (level: BotLevel) => {
      let n = 0;
      for (let k = 0; k < 100; k++) {
        const brain = new DuelBrain(level, seeded(600 + k));
        const close = { x: 1, z: 0, ry: -Math.PI / 2 };
        brain.think(view({ now: 0, bot: close }));
        brain.think(view({ now: 16, bot: close, foe: { x: 0, z: 0, ry: Math.PI / 2, a: 6 } }));
        let blocked = false;
        for (let t = 32; t < 700; t += 16) if (brain.think(view({ now: t, bot: close })).block) blocked = true;
        if (blocked) n++;
      }
      return n;
    };
    expect(guards('dificil')).toBeGreaterThan(guards('facil'));
  });
});

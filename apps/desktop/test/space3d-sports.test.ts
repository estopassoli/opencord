import { describe, expect, it } from 'vitest';
import {
  ARENAS,
  basketShot,
  GOAL_X,
  HOOP_X,
  lob,
  stepBall,
  type BallEvent,
  type BallState,
} from '../src/features/space3d/sports';

function run(zone: 1 | 2 | 3 | 4 | 5, b: BallState, secs: number, from?: { x: number; y: number; z: number }) {
  const ev: BallEvent[] = [];
  for (let t = 0; t < secs; t += 1 / 60) ev.push(...stepBall(ARENAS[zone], b, 1 / 60, from));
  return ev;
}

describe('Espaço 3D: esportes', () => {
  it('basquete: força na faixa boa faz cesta de 2 perto e de 3 de longe; fraca demais erra', () => {
    for (const [x, pts] of [
      [HOOP_X - 4, 2],
      [HOOP_X - 8, 3],
    ] as const) {
      const from = { x, y: 2, z: 0.5 };
      const v = basketShot(from, 0.7, 1);
      const b = { ...from, ...v };
      const score = run(1, b, 4, from).find((e) => e.kind === 'score');
      expect(score).toEqual({ kind: 'score', side: 'a', points: pts });
    }
    const from = { x: HOOP_X - 6, y: 2, z: 0 };
    const b = { ...from, ...basketShot(from, 0.1, 1) };
    expect(run(1, b, 4, from).some((e) => e.kind === 'score')).toBe(false);
  });

  it('basquete: arremesso para o outro lado vale para o time B', () => {
    const from = { x: -HOOP_X + 4, y: 2, z: 0 };
    const b = { ...from, ...basketShot(from, 0.65, -1) };
    expect(run(1, b, 4, from).find((e) => e.kind === 'score')).toMatchObject({ side: 'b' });
  });

  it('futebol: chute no meio do gol é gol; na trave volta', () => {
    const b = { x: GOAL_X - 6, y: 0.11, z: 0, vx: 14, vy: 1, vz: 0 };
    expect(run(2, b, 2).find((e) => e.kind === 'score')).toEqual({ kind: 'score', side: 'a', points: 1 });
    const post = { x: GOAL_X - 6, y: 0.11, z: 2.6, vx: 14, vy: 0, vz: 0 };
    expect(run(2, post, 2).some((e) => e.kind === 'score')).toBe(false);
  });

  it('tênis: bola baixa para na rede; bola por cima passa', () => {
    const low = { x: -3, y: 0.5, z: 0, vx: 10, vy: 0, vz: 0 };
    expect(run(3, low, 1).some((e) => e.kind === 'net')).toBe(true);
    expect(low.x).toBeLessThan(0.5);
    const from = { x: -8, y: 1, z: 0 };
    const high = { ...from, ...lob(from, { x: 8, y: 0.08, z: 1 }, 2) };
    const ev = run(3, high, 3);
    expect(ev.some((e) => e.kind === 'net')).toBe(false);
    const bounce = ev.find((e) => e.kind === 'bounce');
    expect(bounce && bounce.kind === 'bounce' ? bounce.x : 0).toBeCloseTo(8, 0);
  });

  it('a bola nunca sai da arena', () => {
    const b = { x: 0, y: 1, z: 0, vx: 50, vy: 2, vz: -45 };
    run(2, b, 5);
    expect(Math.abs(b.x)).toBeLessThanOrEqual(ARENAS[2].layout.width / 2);
    expect(Math.abs(b.z)).toBeLessThanOrEqual(ARENAS[2].layout.depth / 2);
  });
});

describe('Espaço 3D: quem fica com a bola', () => {
  it('toque mais novo (contador) ganha, sem depender do relógio de cada PC', async () => {
    const { acceptBall } = await import('../src/features/space3d/sportplay');
    expect(acceptBall(5, 'amigo', 4, 'eu')).toBe(true);
    expect(acceptBall(3, 'amigo', 4, 'eu')).toBe(false);
    // empate: os dois apps escolhem o mesmo (maior id), e quem já mandava continua
    expect(acceptBall(4, 'zz', 4, 'aa')).toBe(true);
    expect(acceptBall(4, 'aa', 4, 'zz')).toBe(false);
    expect(acceptBall(4, 'aa', 4, 'aa')).toBe(true);
    expect(acceptBall(0, 'aa', 0, null)).toBe(true);
  });
});

describe('Espaço 3D: vôlei e ping pong', () => {
  it('regras de ponto', async () => {
    const { netPoint } = await import('../src/features/space3d/sportplay');
    // vôlei: A bateu; caiu dentro do lado B → ponto A; caiu dentro do lado A → ponto B; fora → ponto B
    expect(netPoint(4, 'a', { x: 3, z: 0, surface: 'floor' }, 0)).toBe('a');
    expect(netPoint(4, 'a', { x: -3, z: 0, surface: 'floor' }, 0)).toBe('b');
    expect(netPoint(4, 'a', { x: 12, z: 0, surface: 'floor' }, 0)).toBe('b');
    // ping pong: A bateu; quicou na mesa do B uma vez → conta; duas → ponto A; no chão sem quicar na mesa → ponto B
    expect(netPoint(5, 'a', { x: 0.8, z: 0, surface: 'table' }, 0)).toBe('bounce');
    expect(netPoint(5, 'a', { x: 0.8, z: 0, surface: 'table' }, 1)).toBe('a');
    expect(netPoint(5, 'a', { x: 3, z: 0, surface: 'floor' }, 0)).toBe('b');
    expect(netPoint(5, 'a', { x: 3, z: 0, surface: 'floor' }, 1)).toBe('a');
    expect(netPoint(5, 'a', { x: -0.8, z: 0, surface: 'table' }, 0)).toBe('b');
  });

  it('a bolinha quica na mesa e o lob passa por cima da rede', () => {
    const from = { x: -1.6, y: 0.95, z: 0 };
    const to = { x: 0.9, y: 0.76 + 0.025, z: 0.2 };
    const b = { ...from, ...lob(from, to, 0.25) };
    const ev = run(5, b, 1.5);
    expect(ev.some((e) => e.kind === 'net')).toBe(false);
    const first = ev.find((e) => e.kind === 'bounce');
    expect(first).toMatchObject({ surface: 'table' });
    const vfrom = { x: -6, y: 1.6, z: 0 };
    const vb = { ...vfrom, ...lob(vfrom, { x: 4, y: 0.11, z: 1 }, 1.6) };
    expect(run(4, vb, 3).some((e) => e.kind === 'net')).toBe(false);
  });
});

describe('Espaço 3D: tempo da rebatida e anel de queda (P5)', () => {
  it('hitQuality: perfeita dentro da janela; cedo e tarde fora', async () => {
    const { hitQuality, PERFECT_WINDOW } = await import('../src/features/space3d/sports');
    expect(hitQuality(0)).toBe('perfect');
    expect(hitQuality(0.1, 0.12)).toBe('perfect');
    expect(hitQuality(-0.1, 0.12)).toBe('perfect');
    expect(hitQuality(0.2, 0.12)).toBe('early');
    expect(hitQuality(-0.2, 0.12)).toBe('late');
    for (const w of Object.values(PERFECT_WINDOW)) {
      expect(hitQuality(w * 0.9, w)).toBe('perfect');
      expect(hitQuality(w * 1.1, w)).toBe('early');
      expect(hitQuality(-w * 1.1, w)).toBe('late');
    }
  });

  it('contactDt: a bola vindo é positivo, a bola que passou é negativo', async () => {
    const { contactDt } = await import('../src/features/space3d/sports');
    const me = { x: -10, y: 0, z: 0 };
    // tênis: a bola vem de +x para mim a 10 m/s, a 2 m
    expect(contactDt(3, { x: -8, y: 1, z: 0, vx: -10, vy: 0, vz: 0 }, me)).toBeCloseTo(0.2);
    expect(contactDt(3, { x: -11, y: 1, z: 0, vx: -10, vy: 0, vz: 0 }, me)).toBeCloseTo(-0.1);
    // vôlei: a bola cai de 3 m sobre mim (cedo); abaixo do peito, já passou (tarde)
    expect(contactDt(4, { x: -10, y: 3, z: 0, vx: 0, vy: 0, vz: 0 }, me)).toBeGreaterThan(0.3);
    expect(contactDt(4, { x: -10, y: 0.4, z: 0, vx: 0, vy: -6, vz: 0 }, me)).toBeLessThan(0);
  });

  it('a rebatida perfeita cai mais funda; cedo vai cruzada e tarde vai paralela, as duas mais curtas', async () => {
    const { netShotTarget } = await import('../src/features/space3d/sportplay');
    for (const zone of [3, 4, 5] as const)
      for (const rnd of [0, 0.5, 0.99]) {
        const perfect = netShotTarget(zone, 'a', 'perfect', 2, 2, rnd);
        const early = netShotTarget(zone, 'a', 'early', 2, 2, rnd);
        const late = netShotTarget(zone, 'a', 'late', 2, 2, rnd);
        // o azul rebate para o lado do vermelho (+x)
        expect(perfect.x).toBeGreaterThan(0);
        expect(Math.abs(perfect.x)).toBeGreaterThan(Math.abs(early.x));
        expect(Math.abs(perfect.x)).toBeGreaterThan(Math.abs(late.x));
        // perfeita mais reta (mais rápida)
        expect(perfect.apexK).toBeLessThan(early.apexK);
        // cedo: para o outro lado da quadra; tarde: na minha linha
        expect(Math.sign(early.z)).toBe(-1);
        const c = ARENAS[zone].court!;
        expect(Math.abs(late.z - Math.min(2, c.hz))).toBeLessThan(c.hz);
        expect(late.z).toBeGreaterThan(0);
      }
    // o vermelho rebate para −x
    expect(netShotTarget(3, 'b', 'perfect', 0, 0, 0.5).x).toBeLessThan(0);
  });

  it('o anel de queda erra menos de 0,3 m do quique simulado por stepBall', async () => {
    const { landingPoint } = await import('../src/features/space3d/sports');
    const cases: {
      zone: 3 | 4 | 5;
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      apex: number;
    }[] = [
      { zone: 3, from: { x: -10, y: 1, z: -2 }, to: { x: 8, y: 0.08, z: 3 }, apex: 1.2 },
      { zone: 3, from: { x: 10, y: 1.4, z: 1 }, to: { x: -5, y: 0.08, z: -4 }, apex: 0.9 },
      { zone: 4, from: { x: -6, y: 1.6, z: 0 }, to: { x: 4, y: 0.11, z: 1 }, apex: 1.6 },
      { zone: 5, from: { x: -1.6, y: 0.95, z: 0 }, to: { x: 0.9, y: 0.785, z: 0.2 }, apex: 0.25 },
    ];
    for (const c of cases) {
      const a = ARENAS[c.zone];
      const b: BallState = { ...c.from, ...lob(c.from, c.to, c.apex) };
      // de vários pontos do voo (o anel é recalculado a cada quadro)
      for (let step = 0; step < 40; step++) {
        const lp = landingPoint(a, b);
        if (!lp) break;
        const sim = { ...b };
        let hit: { x: number; z: number } | null = null;
        for (let i = 0; i < 600 && !hit; i++) {
          const ev = stepBall(a, sim, 1 / 60);
          const bounce = ev.find((e) => e.kind === 'bounce');
          if (bounce && bounce.kind === 'bounce') hit = { x: bounce.x, z: bounce.z };
        }
        expect(hit).not.toBeNull();
        expect(Math.hypot(hit!.x - lp.x, hit!.z - lp.z)).toBeLessThan(0.3);
        // até o primeiro quique (depois dele o anel mira o próximo)
        const ev = [...stepBall(a, b, 1 / 60), ...stepBall(a, b, 1 / 60)];
        if (ev.some((e) => e.kind === 'bounce')) break;
      }
    }
  });
});

describe('Espaço 3D: apertar sempre responde (P5)', () => {
  it('press() longe da bola devolve whiff e emite o evento whiff', async () => {
    const THREE = await import('three');
    const { SportPlay } = await import('../src/features/space3d/sportplay');
    for (const zone of [2, 3, 4, 5] as const) {
      const emitted: string[] = [];
      const s = new SportPlay(
        new THREE.Scene(),
        zone,
        'eu',
        { sendBall: () => undefined, score: () => undefined, emit: (e) => emitted.push(e.kind), team: () => 'a' },
        () => null,
      );
      s.update(1 / 60, 0, { x: -8, y: 0, z: 6, ry: 0, moving: false, running: false });
      expect(s.press(10)).toEqual({ result: 'whiff' });
      expect(emitted).toContain('whiff');
      s.dispose();
    }
  });

  it('rebatida em jogo devolve a qualidade do tempo; o saque não tem', async () => {
    const THREE = await import('three');
    const { SportPlay } = await import('../src/features/space3d/sportplay');
    const s = new SportPlay(
      new THREE.Scene(),
      3,
      'eu',
      { sendBall: () => undefined, score: () => undefined, team: () => 'a' },
      () => null,
    );
    const me = { x: -10, y: 0, z: 0, ry: Math.PI / 2, moving: false, running: false };
    // parada no saque, na minha frente
    s.remote({ x: -9.4, y: 1.2, z: 0, vx: 0, vy: 0, vz: 0, held: null, t: 1, by: 'amigo' }, 0);
    s.update(1 / 60, 10, me);
    expect(s.press(20)).toEqual({ result: 'hit' });
    // a bola vindo do outro lado, ainda a 1,8 m e a 6 m/s: cedo
    s.remote({ x: -8.2, y: 1.1, z: 0, vx: -6, vy: 0, vz: 0, held: null, t: 5, by: 'amigo' }, 100);
    s.update(1 / 60, 110, me);
    expect(s.press(120)).toEqual({ result: 'hit', quality: 'early' });
    // em cima de mim: perfeita
    s.remote({ x: -10, y: 1.1, z: 0.3, vx: -6, vy: 0, vz: 0, held: null, t: 9, by: 'amigo' }, 200);
    s.update(1 / 60, 210, me);
    expect(s.press(220)).toEqual({ result: 'hit', quality: 'perfect' });
    s.dispose();
  });

  it('o anel de queda aparece com a bola no ar e some com ela parada no saque', async () => {
    const THREE = await import('three');
    const { SportPlay } = await import('../src/features/space3d/sportplay');
    const s = new SportPlay(
      new THREE.Scene(),
      4,
      'eu',
      { sendBall: () => undefined, score: () => undefined, team: () => 'a' },
      () => null,
    );
    const me = { x: -12, y: 0, z: 6, ry: 0, moving: false, running: false };
    s.update(1 / 60, 0, me);
    expect(s.landingMark()).toBeNull();
    s.remote({ x: -6, y: 1.6, z: 0, vx: 3, vy: 6, vz: 0, held: null, t: 2, by: 'amigo' }, 10);
    s.update(1 / 60, 20, me);
    expect(s.landingMark()).not.toBeNull();
    expect(s.landingMark()!.x).toBeGreaterThan(-6);
    s.dispose();
  });
});

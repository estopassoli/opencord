/**
 * Gunfight do Espaço 3D: as partes puras do manuseio das armas — física dos estojos ejetados (gravidade, quique,
 * parar deitado, sumir), o limite do pool, a coreografia das recargas (pente velho sai antes do novo entrar, cai no
 * vazio e vai para o colete na tática, encaixa no momento do som) e o encaixe da mão (dedos fecham até tocar uma
 * superfície sem entrar nela).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIST_HOLE, handProbes } from '../src/features/space3d/gunfight/handrig';
import {
  CASINGS,
  CASING_MS,
  CasingPool,
  casingScale,
  ejectVelocity,
  stepCasing,
  type Casing,
} from '../src/features/space3d/gunfight/casings';
import { clearance, fitHand, soupOf, surfaceDist } from '../src/features/space3d/gunfight/contact';
import {
  CLIP_PRESS,
  CLIP_ROUNDS,
  CLIP_TOSS_AT,
  MAG_OUT_AT,
  MAG_SEAT_AT,
  clipPose,
  reloadPose,
  reloadStyle,
} from '../src/features/space3d/gunfight/reload';

function casing(over: Partial<Casing> = {}): Casing {
  return {
    x: 0,
    y: 1.4,
    z: 0,
    vx: 2.5,
    vy: 1.5,
    vz: 0.5,
    ax: 0,
    ay: 1,
    az: 0,
    spin: 20,
    angle: 0,
    floor: 0,
    r: 0.005,
    born: 0,
    resting: false,
    bounces: 0,
    ...over,
  };
}

describe('estojos', () => {
  it('sobem, caem com a gravidade, quicam perdendo força e param deitados no chão', () => {
    const c = casing();
    let maxY = c.y;
    let bounces = 0;
    for (let i = 0; i < 120 * 3 && !c.resting; i++) {
      if (stepCasing(c, 1 / 120)) bounces++;
      maxY = Math.max(maxY, c.y);
      expect(c.y).toBeGreaterThanOrEqual(c.floor + c.r - 1e-9);
    }
    expect(maxY).toBeGreaterThan(1.45);
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(c.resting).toBe(true);
    expect(c.y).toBeCloseTo(c.r, 6);
    // parado não anda mais
    const x = c.x;
    stepCasing(c, 0.1);
    expect(c.x).toBe(x);
  });

  it('o quique devolve só uma parte da velocidade (cada pulo é menor)', () => {
    const c = casing({ y: 0.5, vx: 0, vy: 0, vz: 0 });
    const peaks: number[] = [];
    let up = false;
    let last = c.y;
    for (let i = 0; i < 600 && !c.resting; i++) {
      stepCasing(c, 1 / 240);
      if (up && c.y < last) peaks.push(last);
      up = c.y > last;
      last = c.y;
    }
    expect(peaks.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
  });

  it('sai para a direita, para cima e para trás da arma; a pistola sobe mais e o ferrolho sai mais fraco', () => {
    const v = new THREE.Vector3();
    for (const r of [0, 0.5, 1]) {
      ejectVelocity('rifle', r, r, r, v);
      expect(v.x).toBeGreaterThan(1.5);
      expect(v.y).toBeGreaterThan(0.8);
      expect(v.z).toBeGreaterThan(0);
    }
    const rifle = ejectVelocity('rifle', 0.5, 0.5, 0.5, new THREE.Vector3());
    const pistol = ejectVelocity('pistol', 0.5, 0.5, 0.5, new THREE.Vector3());
    const bolt = ejectVelocity('bolt', 0.5, 0.5, 0.5, new THREE.Vector3());
    expect(pistol.y).toBeGreaterThan(rifle.y);
    expect(bolt.length()).toBeLessThan(rifle.length());
  });

  it('encolhem no fim e somem no tempo (e não aparecem antes de sair)', () => {
    expect(casingScale(0)).toBe(1);
    expect(casingScale(CASING_MS / 2)).toBe(1);
    expect(casingScale(CASING_MS - 100)).toBeGreaterThan(0);
    expect(casingScale(CASING_MS - 100)).toBeLessThan(1);
    expect(casingScale(CASING_MS)).toBe(0);
    expect(casingScale(-10)).toBe(0);
  });

  it('o pool nunca passa do limite: cheio, o mais velho é reaproveitado', () => {
    const pool = new CasingPool();
    expect(pool.size).toBe(CASINGS);
    expect(CASINGS).toBe(30);
    for (let i = 0; i < CASINGS; i++) pool.add(casing({ born: 100 + i }));
    expect(pool.live).toBe(CASINGS);
    // o 31º entra no lugar do de born 100
    const slot = pool.add(casing({ born: 999 }));
    expect(slot).toBe(0);
    expect(pool.live).toBe(CASINGS);
    expect(pool.items.some((c) => c?.born === 100)).toBe(false);
    // um buraco é usado antes de tirar alguém
    pool.items[7] = null;
    expect(pool.add(casing({ born: 1000 }))).toBe(7);
  });
});

describe('recarga', () => {
  const us = Array.from({ length: 201 }, (_, i) => i / 200);

  it('tática: pega o pente, tira, guarda no colete, volta com um cheio e encaixa no som', () => {
    const p = us.map((u) => ({ u, ...reloadPose('tactical', u) }));
    // nada se mexe antes de pegar; o pente sai no som de tirar
    expect(p[0]!.out).toBe(0);
    expect(p.filter((x) => x.u < MAG_OUT_AT).every((x) => x.out === 0)).toBe(true);
    // a mão está no pente quando ele sai
    expect(p.find((x) => x.u >= MAG_OUT_AT + 0.02)!.hold).toBeGreaterThan(0.95);
    // vai ao colete (fora da tela) e volta antes de encaixar
    const peak = p.reduce((a, b) => (b.pouch > a.pouch ? b : a));
    expect(peak.pouch).toBeGreaterThan(0.99);
    expect(peak.u).toBeGreaterThan(MAG_OUT_AT);
    expect(peak.u).toBeLessThan(MAG_SEAT_AT);
    // o que volta é o novo (o velho ficou no colete); nunca cai nada
    expect(p.filter((x) => x.u > peak.u + 0.01).every((x) => x.fresh)).toBe(true);
    expect(p.filter((x) => x.u < 0.3).every((x) => !x.fresh)).toBe(true);
    expect(p.every((x) => !x.dropped)).toBe(true);
    // encaixado no som de entrar e a mão volta ao apoio no fim
    expect(reloadPose('tactical', MAG_SEAT_AT).out).toBe(0);
    expect(reloadPose('tactical', MAG_SEAT_AT).pouch).toBe(0);
    expect(reloadPose('tactical', 1).hold).toBe(0);
    // a mão anda junto com o pente enquanto segura
    for (const x of p) {
      expect(x.handOut).toBe(x.out);
      expect(x.handPouch).toBe(x.pouch);
    }
  });

  it('vazia (e pistola): o pente velho cai, a mão já foi ao colete e volta com o novo', () => {
    expect(reloadStyle(true, false)).toBe('drop');
    expect(reloadStyle(false, true)).toBe('drop');
    expect(reloadStyle(false, false)).toBe('tactical');
    const before = reloadPose('drop', MAG_OUT_AT - 0.01);
    expect(before.dropped).toBe(false);
    expect(before.out).toBe(0);
    // a mão vai direto ao colete (não ao pente vazio)
    expect(before.handPouch).toBe(1);
    expect(before.hold).toBeGreaterThan(0.3);
    const after = reloadPose('drop', MAG_OUT_AT);
    expect(after.dropped).toBe(true);
    // o da arma já está no colete (é o novo, cheio) e o velho caiu
    expect(after.pouch).toBe(1);
    expect(after.fresh).toBe(true);
    // encaixa no som e a mão volta
    expect(reloadPose('drop', MAG_SEAT_AT).out).toBe(0);
    expect(reloadPose('drop', 1).hold).toBe(0);
    // depois de cair, a mão e o pente andam juntos
    for (const u of us.filter((x) => x >= MAG_OUT_AT)) {
      const r = reloadPose('drop', u);
      expect(r.handPouch).toBeCloseTo(r.pouch, 9);
      // e ela sobe com o novo até encaixar (a palma empurra a base)
      expect(r.handOut).toBeCloseTo(r.out, 9);
    }
  });

  it('a palma empurra a base só no fim do encaixe', () => {
    for (const s of ['tactical', 'drop'] as const) {
      expect(reloadPose(s, 0.3).palm).toBe(0);
      expect(reloadPose(s, MAG_SEAT_AT).palm).toBeGreaterThan(0.9);
      expect(reloadPose(s, 0.8).palm).toBe(0);
    }
  });

  it('pente-lâmina: abre, busca, encaixa, as cinco balas descem em dois empurrões e a lâmina sai no fechamento', () => {
    const p = us.map((u) => ({ u, ...clipPose(u) }));
    // a mão vai à cartucheira com o ferrolho já aberto
    const pouch = p.reduce((a, b) => (b.pouch > a.pouch ? b : a));
    expect(pouch.pouch).toBeGreaterThan(0.99);
    expect(pouch.back).toBeGreaterThan(0.99);
    // nenhuma bala desce antes do primeiro empurrão; 3 no primeiro e as 5 no segundo
    expect(clipPose(0.4).stripped).toBe(0);
    expect(clipPose(CLIP_PRESS[0]).stripped).toBeCloseTo(3, 6);
    expect(clipPose(CLIP_PRESS[1]).stripped).toBeCloseTo(CLIP_ROUNDS, 6);
    // a lâmina aparece depois de buscar e sai voando quando o ferrolho fecha
    expect(clipPose(0.2).clipShown).toBe(false);
    expect(clipPose(0.5).clipShown).toBe(true);
    expect(clipPose(CLIP_TOSS_AT - 0.01).tossed).toBe(false);
    expect(clipPose(CLIP_TOSS_AT).tossed).toBe(true);
    expect(clipPose(CLIP_TOSS_AT).clipShown).toBe(false);
    // o ferrolho só fecha depois das balas descerem
    expect(clipPose(CLIP_PRESS[1]).back).toBeGreaterThan(0.99);
    expect(clipPose(0.9).back).toBe(0);
    expect(clipPose(0.9).lift).toBe(0);
  });
});

describe('encaixe da mão', () => {
  /** um "punho" de arma: uma caixa de 2,6 × 10 × 3 cm, no espaço da arma */
  function grip(): THREE.Group {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.03), new THREE.MeshBasicMaterial()));
    return root;
  }

  it('a distância até a superfície bate com a geometria', () => {
    const soup = soupOf(grip());
    expect(surfaceDist(soup, new THREE.Vector3(0.033, 0, 0), 0.05)).toBeCloseTo(0.02, 5);
    expect(surfaceDist(soup, new THREE.Vector3(0, 0, 0.025), 0.05)).toBeCloseTo(0.01, 5);
    // longe: devolve o teto
    expect(surfaceDist(soup, new THREE.Vector3(1, 0, 0), 0.05)).toBe(0.05);
  });

  it('a palma encosta e os dedos fecham até tocar, sem entrar', () => {
    const soup = soupOf(grip());
    // mão direita de lado no punho (dorso para a direita, dedos para a frente), começando longe e de dedos abertos
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 1),
      ),
    );
    const pos = new THREE.Vector3(0.05, 0.03, 0.07);
    const curl: [number, number, number] = [0.3, 0.3, 0.3];
    const fit = fitHand(soup, 1, pos, quat, curl, {
      palm: true,
      palmIn: 0.04,
      palmOut: 0.01,
      fingers: ['index', 'middle', 'ring', 'pinky'],
    });
    // a palma chegou perto do punho (veio de 5 cm para ~1,3 + 1,7 cm do centro)
    expect(fit.pos.x).toBeLessThan(0.05);
    const palm = handProbes(1, ...curl, undefined, 'palm');
    expect(clearance(soup, [], palm, fit.pos, quat, 0.01)).toBeGreaterThanOrEqual(0);
    expect(clearance(soup, [], palm, fit.pos, quat, 0.01)).toBeLessThan(0.003);
    // cada dedo encosta (folga entre 0 e 3 mm); indicador, médio e anelar fecharam mais que o começo (o mindinho, com
    // a concha da palma, já chega perto do punho no começo e pode abrir um pouco até soltar)
    (['index', 'middle', 'ring', 'pinky'] as const).forEach((f, i) => {
      if (f !== 'pinky') expect(fit.offsets[i]).toBeGreaterThan(0);
      const pr = handProbes(1, ...curl, fit.offsets, f);
      const gap = clearance(soup, [], pr, fit.pos, quat, 0.01);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(0.003);
    });
  });
});

describe('mão dos braços com esqueleto (ADR-0060)', () => {
  it('as esferas seguem a pose: fechar leva as pontas para o lado da palma, sem mexer na palma', () => {
    const tip = (c: number, f: 'index' | 'pinky') =>
      handProbes(1, c, 0.5, c)
        .filter((p) => p.part === f)
        .at(-1)!.at;
    expect(tip(0.9, 'index').y).toBeLessThan(tip(0, 'index').y - 0.02);
    expect(tip(0.9, 'pinky').z).toBeGreaterThan(tip(0, 'pinky').z);
    const palm = (c: number) => handProbes(1, c, 0, c, undefined, 'palm').filter((p) => p.seg < 40);
    expect(palm(0.9).map((p) => p.at.toArray())).toEqual(palm(0).map((p) => p.at.toArray()));
  });

  it('a esquerda é o espelho da direita (no x do espaço da mão)', () => {
    const r = handProbes(1, 0.6, 0.4, 0.5);
    const l = handProbes(-1, 0.6, 0.4, 0.5);
    const mid = (a: typeof r) => a.filter((p) => p.part === 'middle').at(-1)!.at;
    expect(mid(l).x).toBeCloseTo(-mid(r).x, 2);
    expect(mid(l).y).toBeCloseTo(mid(r).y, 2);
    expect(mid(l).z).toBeCloseTo(mid(r).z, 2);
  });

  it('o vão do punho fechado fica embaixo da palma e cabe um cabo de ~2,5 cm', () => {
    expect(FIST_HOLE.y).toBeLessThan(-0.02);
    const pr = handProbes(1, 0.95, 0.8, 0.95).filter((p) => p.part === 'middle' || p.part === 'palm');
    const free = Math.min(...pr.map((p) => p.at.distanceTo(FIST_HOLE) - p.r));
    expect(free).toBeGreaterThan(0.011);
  });
});

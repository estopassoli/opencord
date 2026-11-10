/**
 * Onde as mãos encostam em cada arma, medido na malha dela (`contact.ts`), uma vez por arma (cache por id):
 * - a pegada da direita no punho e a da esquerda no guarda-mão (ou por fora da direita, na pistola), com a palma
 *   encostada e cada dedo fechado até tocar;
 * - a esquerda segurando o pente na recarga (pela lateral, os dedos dando a volta na frente dele; na pistola, a palma
 *   por baixo da base);
 * - a direita pegando a alavanca do ferrolho (sniper e Kar98k).
 * As poses do pente e da alavanca são guardadas em relação à peça parada: na animação, a mão anda junto com ela.
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';
import { ARM_HAND_FIT, FIST_HOLE, handProbes, type FingerOffsets } from './handrig';
import { clearance, fitHand, inside, soupOf, toSoup, type Soup, type Sphere } from './contact';
import { TRIGGER_OFF, leftGrip, rightGrip } from './grips';
import { disposeGun, makeGun, partBox, type GunModel, type Part } from './models';
import { GUNS, type GunClass } from './weapons';

export interface Hold {
  /** pulso e giro da mão no espaço da arma (com a peça parada) */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** dedos, polegar e indicador */
  curl: [number, number, number];
  /** o acerto de cada dedo do encaixe medido */
  off: FingerOffsets;
}

export interface Holds {
  right: Hold;
  left: Hold;
  /** a esquerda no pente (o pente parado); sem pente, nada */
  mag: Hold | null;
  /** a direita na alavanca do ferrolho (a alavanca parada) */
  pinch: Hold | null;
  /** o indicador fora do gatilho (correndo, recarregando): o fechamento em que ele fica sobre a armação, sem entrar */
  trigOff: number;
}

/** mesma conta da mão (`hand.ts`): o curl que ela usa de verdade */
const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) / 0.05) * 0.05;
const qc = (c: [number, number, number]): [number, number, number] => [q(c[0]), q(c[1]), q(c[2])];

function basis(x: THREE.Vector3Tuple, y: THREE.Vector3Tuple, z: THREE.Vector3Tuple): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
/** esquerda aninhando o tambor do revólver: palma para cima, dedos para a frente */
const CRADLE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
/** esquerda por baixo do pente da pistola: palma para cima, dedos para a direita (sobem pela lateral direita) */
const MAG_UNDER = basis([0, 0, -1], [0, -1, 0], [-1, 0, 0]);
/** a mão da pegada da alavanca (giro da pegada do punho, dedos em volta da bola) */
export const PINCH_CURL: readonly [number, number, number] = [0.85, 0.6, 0.85];
const PINCH: [number, number, number] = [...PINCH_CURL];

const cache = new Map<string, Holds>();

/** as pegadas medidas desta arma com a montagem dela (calcula na primeira vez, depois vem do cache) */
export function gunHolds(g: GunModel, cls: GunClass): Holds {
  const key = `${g.id}|${g.buildKey ?? ''}`;
  const hit = cache.get(key);
  if (hit) return clone(hit);
  const h = measure(g, cls);
  cache.set(key, h);
  return clone(h);
}

let warming = false;
/**
 * Mede as armas de fogo que ainda não estão no cache, uma por vez, quando o navegador está à toa (a medida leva
 * ~40–120 ms por arma: no `setGun` ela daria um tranco na troca). Chamado uma vez, quando a primeira arma aparece.
 */
export function warmHolds() {
  if (warming) return;
  warming = true;
  const ids = (Object.keys(GUNS) as GunId[]).filter((id) => GUNS[id].cls !== 'knife');
  const idle = (fn: () => void) => {
    const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 50);
  };
  const next = () => {
    const id = ids.shift();
    if (!id) return;
    if (!cache.has(`${id}|`)) {
      const g = makeGun(id);
      if (g) {
        gunHolds(g, GUNS[id].cls);
        disposeGun(g);
      }
    }
    idle(next);
  };
  idle(next);
}

function clone(h: Holds): Holds {
  const c = (x: Hold): Hold => ({ pos: x.pos.clone(), quat: x.quat.clone(), curl: [...x.curl], off: [...x.off] });
  return {
    right: c(h.right),
    left: c(h.left),
    mag: h.mag && c(h.mag),
    pinch: h.pinch && c(h.pinch),
    trigOff: h.trigOff,
  };
}

/** a sopa de triângulos perto de um ponto (a mão alcança ~0,16 m do pulso) */
const near = (g: GunModel, at: THREE.Vector3): Soup => soupOf(g.root, { at, r: 0.18 });

function measure(g: GunModel, cls: GunClass): Holds {
  rest(g);
  const pistol = cls === 'pistol';
  const rg = rightGrip(g, cls, ARM_HAND_FIT);
  const fix = RIGHT_FIX[g.id];
  let right: Hold;
  if (fix?.kind === 'hold') {
    right = {
      pos: new THREE.Vector3(...fix.pos),
      quat: new THREE.Quaternion(...fix.quat).normalize(),
      curl: [...fix.curl],
      off: [...fix.off],
    };
  } else if (fix?.kind === 'wrist') {
    // de lado, inclinada `incl`, ou a de sempre girada `yaw` em volta do y da arma
    const quat =
      fix.incl !== undefined
        ? inclined(fix.incl)
        : rg.quat.clone().premultiply(Y_TURN.setFromAxisAngle(Y_AXIS, fix.yaw ?? 0));
    right = fitRight(g, new THREE.Vector3(...fix.pos), quat, qc(rg.curl), pistol, true);
  } else {
    if (fix?.kind === 'nudge' || fix?.kind === 'hole') {
      // a mão anda e fica mais em pé em volta do vão dela (o meio do punho), não do pulso
      const hole =
        fix.kind === 'hole'
          ? new THREE.Vector3(...fix.at)
          : ARM_HAND_FIT.grip
              .clone()
              .applyQuaternion(rg.quat)
              .add(rg.pos)
              .add(new THREE.Vector3(...fix.at));
      rg.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fix.upright));
      rg.pos.copy(hole).sub(ARM_HAND_FIT.grip.clone().applyQuaternion(rg.quat));
    }
    right = fitRight(g, rg.pos, rg.quat, qc(rg.curl), pistol);
  }
  // a direita vira obstáculo para a esquerda (na pistola, os dedos da esquerda passam por cima dos dela)
  const rightBalls = balls(right, 1);
  const left = pistol
    ? fitLeft(g, pistolSupport(g), true, rightBalls)
    : g.foregrip?.kind === 'vertical'
      ? vgripHold(g, cls)
      : g.foregrip?.kind === 'angled'
        ? agripHold(g, cls)
        : clampHold(g, cls);
  const pk = PAD_PINCH[g.id];
  const pinch = pk ? padPinch(g, right, pk) : (AUTO_PAD.has(g.id) && autoPad(g, right)) || pinchHold(g, rg.quat);
  return { right, left, mag: magHold(g, cls, rightBalls), pinch, trigOff: TRIG_OFF[g.id] ?? trigOff(g, right) };
}

/**
 * O indicador fora do gatilho, por arma. SV-98: esticado ao longo da lateral direita do guarda-mato (a procura achava
 * o primeiro fechamento livre em 0,45, com a ponta ainda dentro do guarda-mato, na frente do gatilho).
 */
const TRIG_OFF: Partial<Record<GunId, number>> = { sv98: 0 };

/**
 * Pinça na bola da alavanca quando ela fica rente à coronha (SV-98): a pegada do punho sobe até a bola (a bola fica
 * logo acima do gatilho), girada `spin` rad em volta do eixo do cano; o indicador vai por baixo da bola e o polegar
 * por cima, os outros três fechados na palma. O indicador sai do ponto `from` (a polpa no gatilho) e vai para `to`.
 * A pegada genérica (o vão da mão fechada na bola) deixava a mão aberta em garra por cima da caixa da culatra.
 */
const PAD_PINCH: Partial<
  Record<GunId, { spin: number; from: THREE.Vector3Tuple; to: THREE.Vector3Tuple; fist: number }>
> = {
  sv98: { spin: -0.3, from: [0.003, 0.012, -0.033], to: [0.03, 0.052, -0.039], fist: 1.5 },
  l115: { spin: -0.4, from: [-0.0147, -0.0044, -0.0103], to: [0.0538, 0.0353, -0.0406], fist: 1.5 },
};

/**
 * A pinça medida a partir da bola da alavanca, para as armas sem o acerto à mão (RS9, Kar98k, M200): a mão no giro da
 * pegada do punho virado `AUTO_SPIN` em volta do cano, posta de forma que a bola fique entre a polpa do polegar e a
 * lateral da ponta do indicador; médio, anelar e mindinho fechados na palma. O indicador e o polegar fecham até
 * encostar nela. Com a pegada de cabo (`pinchHold`), a bola ficava no vão dos dedos fechados e eles paravam abertos
 * em volta dela, em garra (Kar98k), ou espalhados embaixo dela (RS9, M200).
 */
const AUTO_PAD: ReadonlySet<GunId> = new Set<GunId>(['rs9', 'kar98k', 'm200']);
const AUTO_SPIN = -0.35;
/** o fechamento do indicador e do polegar na pinça, antes do encaixe */
const AUTO_IX = 0.9;
const AUTO_TH = 0.75;
function autoPad(g: GunModel, right: Hold): Hold | null {
  const p = g.parts.boltRot ?? (g.id === 'kar98k' ? g.parts.charge : undefined);
  const knob = p ? knobOf(g, p) : null;
  if (!knob) return null;
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), AUTO_SPIN).multiply(right.quat);
  const fist = 1.5 - PINCH[0];
  const off: [number, number, number, number, number, number, number] = [
    AUTO_IX - PINCH[2],
    fist,
    fist,
    fist,
    AUTO_TH - PINCH[1],
    0,
    1,
  ];
  const pr = handProbes(1, ...PINCH, off);
  const tip = (part: 'index' | 'thumb') => pr.filter((q) => q.part === part).at(-1)!.at;
  const mid = tip('index').add(tip('thumb')).multiplyScalar(0.5);
  const pos = knob.sub(mid.applyQuaternion(quat));
  const f = fitHand(near(g, pos), 1, pos, quat, PINCH, { fingers: ['index', 'thumb'], base: off, maxCurl: 1.5 });
  return { pos: f.pos, quat, curl: [...PINCH], off: f.offsets };
}

function padPinch(g: GunModel, right: Hold, k: NonNullable<(typeof PAD_PINCH)[GunId]>): Hold {
  const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k.spin);
  const pos = right.pos
    .clone()
    .sub(new THREE.Vector3(...k.from))
    .applyQuaternion(r)
    .add(new THREE.Vector3(...k.to));
  const quat = r.multiply(right.quat);
  const fist = k.fist - PINCH[0];
  const f = fitHand(near(g, pos), 1, pos, quat, PINCH, {
    fingers: ['index', 'thumb'],
    // médio, anelar e mindinho fechados na palma e enrolados (juntos, sem ponta para fora)
    base: [right.curl[2] + right.off[0] - PINCH[2], fist, fist, fist, 0, 0, 1],
    maxCurl: 1.5,
  });
  return { pos: f.pos, quat, curl: [...PINCH], off: f.offsets };
}

/**
 * A pegada da direita acertada à mão por arma, onde a conta comum não fecha a mão (uma tabela só, um jeito por arma):
 * - `nudge`: quanto o vão da mão anda (m) e quanto a mão fica mais em pé (rad, o punho menos inclinado); a busca pelo
 *   punho continua. MSMC: o punho (com o pente dentro) é fino (~2 cm), quase em pé e fica bem à frente do de um fuzil;
 *   na pegada comum a mão ficava ~3 cm atrás e alta, com a base do polegar apoiada na caixa: a palma não chegava ao
 *   punho e anelar e mindinho ficavam abertos para a frente. Agora a palma encosta no punho e os dedos fecham na frente
 *   dele (o polegar é o `RIGHT_THUMB` do viewmodel).
 * - `wrist`: o pulso medido (espaço da arma) e a inclinação da mão de lado (rad), no lugar da busca. Desert Eagle: o
 *   punho tem ~6 cm de fundo, a frente quase em pé e o guarda-mato baixo; na pegada comum (mão inclinada ~17°, e a
 *   fileira dos nós dos dedos já desce para trás) o anelar e o mindinho nasciam atrás da frente do punho e ficavam
 *   esticados, e a palma ficava ~1 cm fora (o pé do polegar batia na trava do ferrolho). Aqui a mão vem mais baixa,
 *   inclinada um pouco para a frente: os nós ficam em pé na frente do punho e os dedos dão a volta até a lateral
 *   esquerda. Ou (`yaw`) a mão de sempre girada em volta do eixo y da arma (rad; positivo, os dedos viram para a
 *   esquerda e o pulso sai para a direita). L115: o punho da coronha de buraco é fundo (4,7 cm da frente ao buraco)
 *   e estreito (2,8 cm); a busca deixava os dedos em volta do ar, na frente dele, embaixo do guarda-mato. Virada, a
 *   mão fecha na frente do punho com as pontas na lateral esquerda (medido no harness: médio 0,99, anelar 0,84,
 *   palma encostada sem entrar).
 * - `hole`: como o `nudge`, mas o vão da mão vai a um ponto do punho (espaço da arma). Rhino: o punho fica ~1 cm mais
 *   para trás do gatilho e ~10° mais inclinado que o das outras pistolas; na pegada de sempre os dedos fechavam no ar
 *   na frente dele e a mão ficava baixa, com o alto do punho à mostra atrás dela (o vão 4 mm para fora do meio).
 * - `hold`: a pegada inteira medida no harness com a mão dos braços (pulso e giro no espaço da arma, fechamentos e
 *   acertos). AK-47: o gatilho fica ~8 cm à frente das costas do punho e o punho é estreito (2,4 cm); o encaixe punha
 *   o médio em cima da barra do guarda-mato, os dedos davam a volta 3–5 cm à frente do punho, soltos, e o polegar
 *   ficava em pé do lado direito, encostado na caixa. Aqui a mão desce 3,5 cm (o médio logo abaixo do guarda-mato),
 *   os dedos apontam ~9° para a esquerda, médio, anelar e mindinho dão a volta no punho com as pontas na lateral
 *   esquerda (encostados, nada entrando), o indicador alcança a frente do gatilho e o polegar dá a volta por trás do
 *   punho e deita na lateral esquerda, no alto (`RIGHT_THUMB` do viewmodel).
 */
type RightFix =
  | { kind: 'nudge' | 'hole'; at: THREE.Vector3Tuple; upright: number }
  | { kind: 'wrist'; pos: THREE.Vector3Tuple; incl?: number; yaw?: number }
  | {
      kind: 'hold';
      pos: THREE.Vector3Tuple;
      quat: [number, number, number, number];
      curl: [number, number, number];
      off: FingerOffsets;
    };
const RIGHT_FIX: Partial<Record<GunId, RightFix>> = {
  msmc: { kind: 'nudge', at: [-0.02, -0.01, -0.03], upright: 0.3 },
  rhino: { kind: 'hole', at: [0.004, -0.008, 0.054], upright: -0.15 },
  deagle: { kind: 'wrist', pos: [0.042, -0.036, 0.068], incl: -0.16 },
  l115: { kind: 'wrist', pos: [0.0488, 0.0021, 0.092], yaw: 0.15 },
  ak47: {
    kind: 'hold',
    pos: [0.0242, -0.0315, 0.099],
    quat: [0.053, -0.053, -0.7051, 0.7051],
    curl: [0.9, 0.5, 0.35],
    off: [0, 0.153, 0.047, -0.389, -0.15, 0.5],
  },
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Y_TURN = new THREE.Quaternion();

/** mão direita de lado no punho (dorso para a direita, dedos para a frente), a fileira dos dedos inclinada `a` */
function inclined(a: number): THREE.Quaternion {
  const x = new THREE.Vector3(0, -Math.cos(a), Math.sin(a));
  const y = new THREE.Vector3(1, 0, 0);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

type LeftGrip = {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  curl: [number, number, number];
  thumbUp?: number;
  /** o quanto os dedos enrolam (o sétimo acerto de `FingerOffsets`) */
  wrap?: number;
};

/** a esquerda na pegada pedida: a palma encosta e cada dedo fecha até tocar */
function fitLeft(g: GunModel, lg: LeftGrip, pistol = false, extra: Sphere[] = [], soup?: Soup): Hold {
  const lc = qc(lg.curl);
  const lf = fitHand(soup ?? near(g, lg.pos), -1, lg.pos, lg.quat, lc, {
    palm: true,
    palmIn: pistol ? 0 : 0.012,
    palmOut: pistol ? 0.04 : 0.025,
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
    extra,
    base: [0, 0, 0, 0, 0, lg.thumbUp ?? 0, lg.wrap ?? 0],
  });
  return { pos: lf.pos, quat: lg.quat.clone(), curl: lc, off: lf.offsets };
}

const LEFT_PARTS = ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'] as const;
/** a ponta de cada dedo (a última esfera) e a folga de cada parte até a arma (m; negativa = entrando) */
function leftContact(soup: Soup, h: Hold) {
  const pr = handProbes(-1, h.curl[0], h.curl[1], h.curl[2], h.off);
  const tip: Partial<Record<(typeof LEFT_PARTS)[number], THREE.Vector3>> = {};
  const gap: Record<string, number> = {};
  for (const part of LEFT_PARTS) {
    const mine = pr.filter((p) => p.part === part);
    tip[part] = mine[mine.length - 1]!.at.clone().applyQuaternion(h.quat).add(h.pos);
    gap[part] = clearance(soup, [], mine, h.pos, h.quat, 0.03);
  }
  return { tip, gap };
}

/**
 * Apoio em "C" (ADR-0060, adendo): a palma por baixo do guarda-mão, os dedos dando a volta pela direita até perto da
 * metade da altura (as três falanges dobradas, as pontas encostadas) e o polegar subindo pela esquerda. O jeito que a
 * mão gira (o quanto os dedos apontam para a frente e a palma vira para a esquerda), o deslocamento e o polegar
 * dependem da grossura e da altura do guarda-mão: tenta as variações de `CLAMP_TRY` e fica com a de menor custo —
 * nada entrando na arma, as pontas dos dedos na lateral direita perto da metade da altura (nunca acima do topo, onde
 * entram na mira) e o polegar na lateral esquerda, abaixo do topo.
 */
function clampHold(g: GunModel, cls: GunClass): Hold {
  const first = leftGrip(g, cls, ARM_HAND_FIT);
  const soup = near(g, first.pos);
  const sec = section(soup, g.support);
  let best: { cost: number; hold: Hold } | null = null;
  for (const [clampYaw, clampRoll, clamp, clampThumbUp] of CLAMP_TRY) {
    const lg = leftGrip(g, cls, { ...ARM_HAND_FIT, clampYaw, clampRoll, clamp, clampThumbUp });
    const hold = fitLeft(g, { ...lg, wrap: CLAMP_WRAP }, false, [], soup);
    const cost = clampCost(soup, hold, sec);
    if (!best || cost < best.cost) best = { cost, hold };
  }
  const nudge = LEFT_NUDGE[g.id];
  if (nudge) {
    const h = best!.hold;
    h.pos.add(new THREE.Vector3(...nudge.at));
    h.off = [
      h.off[0] + nudge.curl,
      h.off[1] + nudge.curl,
      h.off[2] + nudge.curl,
      h.off[3] + nudge.curl,
      h.off[4],
      h.off[5],
      h.off[6],
    ];
  }
  return best!.hold;
}

/**
 * Acerto do apoio em "C" por arma, conferido no harness (corte do guarda-mão e closes): o deslocamento do pulso (espaço
 * da arma) e quanto os quatro dedos fecham a mais. FN Ballista: o encaixe parava com a palma ~1 cm abaixo do bloco de
 * baixo do guarda-mão e as pontas dos dedos ~1 cm fora da lateral direita (mão aberta, solta); assim a palma encosta
 * embaixo dele e as pontas encostam na lateral, sem entrar.
 */
const LEFT_NUDGE: Partial<Record<GunId, { at: THREE.Vector3Tuple; curl: number }>> = {
  ballista: { at: [-0.002, 0.012, 0], curl: 0.08 },
};

/**
 * os dedos do apoio em "C" enrolam em volta do guarda-mão (`HAND_POSE.wrap`): com a base dobrando tanto quanto o meio
 * e a ponta, o primeiro toque (o nó do dedo no canto de baixo) parava cada dedo reto, inclinado para fora da lateral, e
 * os quatro abriam em leque (o indicador e o médio em "V")
 */
const CLAMP_WRAP = 1;

/** as variações do apoio em "C": [dedos para a frente (rad), palma para a esquerda (rad), deslocamento (m), polegar] */
const CLAMP_TRY: readonly (readonly [number, number, number, number])[] = [
  [ARM_HAND_FIT.clampYaw, ARM_HAND_FIT.clampRoll, ARM_HAND_FIT.clamp, ARM_HAND_FIT.clampThumbUp],
  [0.6, 0.3, 0.015, 0.3],
  [0.6, 0.15, 0.015, 0.6],
  [0.3, 0.15, 0.015, 0.6],
  [0.3, 0.3, 0.015, 0.9],
  [0.45, 0.3, 0.015, 0.6],
];

/** a fatia do guarda-mão no apoio: as laterais e a altura (do fundo ao topo) */
function section(soup: Soup, at: THREE.Vector3) {
  let lo = Infinity;
  let hi = -Infinity;
  let left = 0;
  let right = 0;
  const T = soup.tris;
  for (let i = 0; i < T.length; i += 3) {
    const x = T[i]!;
    const y = T[i + 1]!;
    if (Math.abs(T[i + 2]! - at.z) > 0.015 || Math.abs(x) > 0.06 || y < at.y - 0.03 || y > at.y + 0.09) continue;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  if (!Number.isFinite(lo)) return { lo: at.y, hi: at.y + 0.05, left: -0.025, right: 0.025 };
  return { lo, hi, left: Math.min(left, -0.01), right: Math.max(right, 0.01) };
}

/** o custo de uma pegada de apoio (ver `clampHold`) */
function clampCost(soup: Soup, h: Hold, s: ReturnType<typeof section>): number {
  const { tip, gap } = leftContact(soup, h);
  const ht = (v: THREE.Vector3) => (v.y - s.lo) / (s.hi - s.lo);
  let cost = 0;
  const worst = Math.min(...Object.values(gap));
  if (worst < 0.0003) cost += 100 + 10000 * (0.0003 - worst);
  for (const f of ['index', 'middle', 'ring'] as const) {
    const t = tip[f]!;
    cost += 4 * Math.abs(ht(t) - 0.5) + 20 * Math.max(0, ht(t) - 0.85) + 3 * Math.max(0, 0.85 - t.x / s.right);
    cost += 500 * Math.max(0, gap[f]! - 0.0015);
  }
  cost += 2 * Math.max(0, ht(tip.pinky!) - 0.55) + 300 * Math.max(0, gap.pinky! - 0.003);
  const curls = [h.curl[2] + h.off[0], h.curl[0] + h.off[1], h.curl[0] + h.off[2], h.curl[0] + h.off[3]];
  for (const c of curls) cost += 2 * Math.max(0, 0.55 - c) + 2 * Math.max(0, c - 1.3);
  cost += 500 * Math.max(0, gap.palm! - 0.002);
  const th = tip.thumb!;
  cost += 3 * Math.max(0, th.x / -s.left + 0.7) + 2 * Math.max(0, 0.3 - ht(th)) + 20 * Math.max(0, ht(th) - 0.9);
  cost += 300 * Math.max(0, gap.thumb! - 0.003);
  return cost;
}

/**
 * Esquerda na empunhadura angulada: a palma por baixo do guarda-mão, logo atrás da rampa, com o pé da mão (o lado do
 * indicador) encostado na face de trás dela, e os dedos deitados para a frente ao longo da lateral direita, juntos e
 * baixos (as pontas abaixo de ~60% da altura: no guarda-mão fino, os dedos em pé apareciam ao lado da alça de mira).
 * Antes era o "C" de sempre empurrado para trás: a mão ficava 3–4 cm atrás da rampa sem tocar nela (AK-47) ou com os
 * dedos subindo pela lateral até a altura da mira (StG 44, AKS-74U). Tenta os giros e recuos de `AGRIP_TRY` e fica com
 * o de menor custo: o do "C" (nada entrando, pontas encostadas), mais as pontas baixas e a palma encostada na rampa.
 */
function agripHold(g: GunModel, cls: GunClass): Hold {
  const fg = g.foregrip!;
  const base = leftGrip({ support: g.support, supportW: g.supportW }, cls, ARM_HAND_FIT);
  const soup = near(g, base.pos);
  const sec = section(soup, g.support);
  // a rampa: o que fica embaixo do guarda-mão na altura dela
  const list: number[] = [];
  const T = soup.tris;
  const top = g.support.y - 0.004;
  for (let i = 0; i < T.length; i += 9) {
    const cy = (T[i + 1]! + T[i + 4]! + T[i + 7]!) / 3;
    const cz = (T[i + 2]! + T[i + 5]! + T[i + 8]!) / 3;
    if (cy < top && cz > fg.at.z - 0.05 && cz < fg.at.z + 0.04) for (let k = 0; k < 9; k++) list.push(T[i + k]!);
  }
  const ramp = list.length ? toSoup(list) : null;
  let best: { cost: number; hold: Hold } | null = null;
  const tryAll = (up: number) => {
    for (const [clampYaw, clampRoll, back] of AGRIP_TRY) {
      const lg = leftGrip({ support: g.support, supportW: g.supportW }, cls, {
        ...ARM_HAND_FIT,
        clampYaw,
        clampRoll,
        clampThumbUp: up,
      });
      lg.pos.z += back;
      const hold = fitLeft(g, { ...lg, wrap: CLAMP_WRAP }, false, [], soup);
      let cost = clampCost(soup, hold, sec);
      const { tip } = leftContact(soup, hold);
      for (const f of ['index', 'middle', 'ring', 'pinky'] as const)
        cost += 4000 * Math.max(0, tip[f]!.y - g.support.y - AGRIP_TIP_UP);
      if (ramp) {
        const palm = handProbes(-1, hold.curl[0], hold.curl[1], hold.curl[2], hold.off, 'palm');
        cost += 300 * Math.max(0, clearance(ramp, [], palm, hold.pos, hold.quat, 0.05) - 0.004);
      }
      if (!best || cost < best.cost) best = { cost, hold };
    }
  };
  // o polegar de sempre; se tudo entra na arma (PDW: o polegar na lateral esquerda), outras aberturas dele
  tryAll(0.6);
  for (const up of [0.2, 0.9, 1.2]) if (best!.cost >= 100) tryAll(up);
  return best!.hold;
}

/**
 * até quanto acima do fundo do guarda-mão (m) as pontas dos dedos sobem na empunhadura angulada (a fatia do guarda-mão
 * pega a caixa e o tubo de gás em cima, e a fração da altura deixava os dedos à altura da mira)
 */
const AGRIP_TIP_UP = 0.014;
/** as variações da esquerda na angulada: [dedos para a frente (rad), palma para a esquerda (rad), recuo (m)] */
const AGRIP_TRY: readonly (readonly [number, number, number])[] = [0.45, 0.7, 0.95, 1.2].flatMap((yaw) =>
  [0.15, 0.35].flatMap((roll) =>
    [-0.015, -0.005, 0.005, 0.015, 0.025, 0.035, 0.045].map((back) => [yaw, roll, back] as const),
  ),
);

/** o polegar na empunhadura vertical: [fechamento, aberto para o lado da palma] (dando a volta por trás dela, ou
 * deitado na lateral esquerda quando por trás ele entra nela) */
const VGRIP_THUMB: readonly (readonly [number, number])[] = [
  [0.6, 0],
  [0.3, 0.5],
  [0.2, 0.9],
];

/**
 * Esquerda na empunhadura vertical: fecha em volta dela, logo abaixo do guarda-mão. Empunhadura curta (a da MSMC): o
 * indicador não cabia entre o guarda-mão e a mão e ficava esticado (ou entrava no guarda-mão); a mão desce pela
 * empunhadura (passos de 3 mm) até o indicador fechar em volta dela sem nada entrar.
 */
function vgripHold(g: GunModel, cls: GunClass): Hold {
  const lg = leftGrip(g, cls, ARM_HAND_FIT);
  const soup = near(g, lg.pos);
  const down = new THREE.Vector3(-1, 0, 0).applyQuaternion(lg.quat);
  let best: { cost: number; hold: Hold } | null = null;
  for (const [t, up] of VGRIP_THUMB)
    for (let d = 0; d <= 0.0301; d += 0.005) {
      const at = lg.pos.clone().addScaledVector(down, d);
      const hold = fitLeft(g, { ...lg, pos: at, curl: [lg.curl[0], t, lg.curl[2]], thumbUp: up }, false, [], soup);
      // o fechamento do polegar volta para o da pegada (a primeira pessoa parte dele) e a diferença vai no acerto
      const off: [number, number, number, number, number, number?, number?] = [...hold.off];
      off[4] = hold.off[4] + qc([0, t, 0])[1] - q(lg.curl[1]);
      hold.off = off;
      hold.curl = qc(lg.curl);
      const { gap } = leftContact(soup, hold);
      const worst = Math.min(...Object.values(gap));
      const ix = hold.curl[2] + hold.off[0];
      const cost = (worst < 0.0003 ? 100 + 10000 * (0.0003 - worst) : 0) + 4 * Math.max(0, 0.75 - ix) + 3 * d;
      if (!best || cost < best.cost) best = { cost, hold };
    }
  return best!.hold;
}

/**
 * Direita no punho. A pegada põe o indicador na altura do gatilho, mas em arma de guarda-mato baixo (Desert Eagle) o
 * médio caía em cima da barra de baixo do guarda-mato e ficava esticado: a mão desce pelo punho (passos de 3 mm) até
 * o médio fechar em volta do punho. Depois a palma encosta pela direita, médio/anelar/mindinho e polegar fecham até
 * tocar, e o indicador procura o gatilho: o fechamento em que a ponta fica mais perto da frente da lâmina sem encostar
 * no guarda-mato nem na armação.
 */
function fitRight(
  g: GunModel,
  pos0: THREE.Vector3,
  quat: THREE.Quaternion,
  rc: [number, number, number],
  pistol: boolean,
  /** o pulso já medido (`RIGHT_FIX` `wrist`): sem andar pelo punho, só os dedos se ajustam */
  fixed = false,
): Hold {
  const trig = g.parts.trigger;
  const soup = soupOf(g.root, { at: pos0, r: 0.18 }, undefined, trig?.obj);
  const box = trig ? partBox(g, trig) : null;
  // a frente da lâmina do gatilho, um pouco abaixo do meio; a polpa (o centro da esfera) fica encostada na frente dela,
  // não dentro (o gatilho fica fora da sopa para o dedo poder tocar, e o dedo reto atravessava a lâmina e o guarda-mato)
  const face = box
    ? new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.45, box.min.z)
    : (TRIGGER_AT[g.id]?.clone() ?? g.trigFace?.clone() ?? null);
  const target = face ? face.clone().add(new THREE.Vector3(PAD_X, 0, -PAD_R)) : null;
  const down = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  /** o indicador: o fechamento com a ponta mais perto do gatilho sem encostar no resto (e a distância) */
  const index = (pos: THREE.Vector3, deep = false): [number, number] => {
    if (!target) return [rc[2], 0];
    const tried: [number, number][] = [];
    const at = (ix: number) => {
      const o: [number, number, number, number, number] = [ix - rc[2], 0, 0, 0, 0];
      const pr = handProbes(1, rc[0], rc[1], rc[2], o, 'index');
      if (clearance(soup, [], pr, pos, quat, 0.004) < 0.0005) return;
      // a polpa da ponta: a penúltima esfera da falange da ponta; a ponta não passa da frente do gatilho (o dedo reto
      // saía pela frente do guarda-mato) e o dedo dobra como dedo de gatilho (esticado, ele atravessava a lâmina)
      const tip = pr[pr.length - 1]!.at.clone().applyQuaternion(quat).add(pos);
      // nem passa para o lado esquerdo do gatilho (vista da primeira pessoa, a ponta aparecia solta dentro do guarda-mato)
      const over = Math.max(0, face!.z - OVERSHOOT - tip.z) + Math.max(0, -LEFT_MAX - tip.x);
      const d = pr[pr.length - 2]!.at.clone().applyQuaternion(quat).add(pos).distanceTo(target);
      tried.push([ix, d + 2 * over + 0.12 * Math.max(0, HOOK - ix)]);
    };
    for (let ix = 0.2; ix <= 1.2001; ix += 0.05) at(ix);
    tried.sort((a, b) => a[1] - b[1]);
    const c = tried[0]?.[0];
    if (c !== undefined) for (let ix = c - 0.04; ix <= c + 0.0401; ix += 0.01) if (ix >= 0 && ix <= 1.2) at(ix);
    tried.sort((a, b) => a[1] - b[1]);
    // longe de qualquer superfície não quer dizer fora: o dedo pode estar inteiro dentro do punho (a malha é maciça);
    // na escolha final, o centro de cada esfera tem que estar fora da malha
    for (const [ix, d] of tried) {
      if (!deep) return [ix, d];
      const o: [number, number, number, number, number] = [ix - rc[2], 0, 0, 0, 0];
      const pr = handProbes(1, rc[0], rc[1], rc[2], o, 'index');
      if (pr.every((p) => !inside(whole(), p.at.clone().applyQuaternion(quat).add(pos)))) return [ix, d];
    }
    return [rc[2], Infinity];
  };
  let all: Soup | null = null;
  const whole = () => (all ??= soupOf(g.root, undefined, undefined, trig?.obj));
  // a mão anda pelo punho (para cima/baixo e para a frente/trás) até o indicador alcançar o gatilho com o médio
  // fechado em volta do punho (no guarda-mato baixo, o médio caía na barra de baixo dele e ficava esticado)
  const thumbProbe = handProbes(1, rc[0], 0.5, rc[2], [0, 0, 0, 0, 0, 0.3], 'thumb');
  let best = { score: Infinity, pos: pos0.clone(), ix: rc[2] };
  const cands: { score: number; pos: THREE.Vector3; ix: number }[] = [];
  // pegada medida à mão (`RIGHT_FIX` `wrist`): o pulso fica onde está, só os dedos se ajustam
  if (fixed) best = { score: 0, pos: pos0.clone(), ix: index(pos0)[0] };
  for (let dy = -0.03; !fixed && dy <= 0.0181; dy += 0.003)
    for (let dz = -0.01; dz <= 0.0301; dz += 0.005) {
      const p = pos0.clone().addScaledVector(down, dy).addScaledVector(fwd, dz);
      const f = fitHand(soup, 1, p, quat, rc, { palm: true, fingers: ['middle', 'ring'] });
      const mid = rc[0] + f.offsets[1];
      const ring = rc[0] + f.offsets[2];
      const [ix, tip] = index(f.pos);
      // o gatilho manda; o médio sem fechar e a mão longe da pegada pesam contra
      // o polegar (no meio do caminho entre os jeitos de `RIGHT_THUMB`) não pode ficar enterrado na caixa da culatra
      const thumb = clearance(soup, [], thumbProbe, f.pos, quat, 0.01);
      const score =
        tip +
        0.15 * (Math.max(0, MIDDLE_WRAP - mid) + Math.max(0, MIDDLE_WRAP - ring)) +
        0.1 * Math.hypot(dy, dz) +
        1.5 * Math.max(0, -thumb);
      cands.push({ score, pos: f.pos, ix });
    }
  // a melhor que tenha o indicador fora da malha (conferido só nas primeiras, que é caro)
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands.slice(0, 4)) {
    const [ix, tip] = index(c.pos, DEEP_CHECK);
    if (Number.isFinite(tip)) {
      best = { score: c.score, pos: c.pos, ix };
      break;
    }
  }
  const rf = fitHand(soup, 1, best.pos, quat, rc, { fingers: ['middle', 'ring', 'pinky'] });
  const off: [number, number, number, number, number, number] = [
    best.ix - rc[2],
    rf.offsets[1],
    rf.offsets[2],
    rf.offsets[3],
    0,
    0,
  ];
  // o polegar: fechado por cima do punho ele entrava ~7 mm na caixa da culatra; procura o fechamento e o quanto ele
  // abre para o lado da palma em que encosta na lateral esquerda sem entrar
  let bestT: { cost: number; t: number; up: number } | null = null;
  for (const [t0, up] of pistol ? RIGHT_THUMB.filter(([, u]) => u >= 0) : RIGHT_THUMB) {
    const f = fitHand(soup, 1, best.pos, quat, [rc[0], t0, rc[2]], {
      fingers: ['thumb'],
      base: [off[0], off[1], off[2], off[3], 0, up],
    });
    const t = t0 + f.offsets[4];
    const o: [number, number, number, number, number, number] = [...off];
    o[4] = t - rc[1];
    o[5] = up;
    const gap = clearance(soup, [], handProbes(1, rc[0], rc[1], rc[2], o, 'thumb'), best.pos, quat, 0.03);
    const cost = (gap < 0.0003 ? 100 + 10000 * (0.0003 - gap) : 0) + 300 * Math.max(0, gap - 0.003) + Math.abs(t - 0.5);
    if (!bestT || cost < bestT.cost) bestT = { cost, t, up };
  }
  off[4] = bestT!.t - rc[1];
  off[5] = bestT!.up;
  return { pos: best.pos, quat: quat.clone(), curl: rc, off };
}
/** o polegar da direita no punho: [fechamento de partida, aberto para o lado da palma] */
const RIGHT_THUMB: readonly (readonly [number, number])[] = [
  [0.5, 0],
  [0.5, 0.3],
  [0.35, 0.6],
  [0.7, 0.3],
  [0.2, 0.9],
  // aberto para o lado do dorso: por cima do punho, sem entrar na caixa da culatra (AK, L115, MP7, MSMC...); na
  // pistola, não (o polegar vai esticado para a frente, embaixo do da mão de apoio)
  [0.5, -0.4],
  [0.5, -0.7],
  [0.3, -0.6],
  [0.8, -0.4],
];
/**
 * gatilho das armas sem a peça separada: a frente da lâmina (os modelos do Sketchfab trazem a deles em `trigFace`;
 * aqui só o acerto de alguma que precise)
 */
const TRIGGER_AT: Partial<Record<GunId, THREE.Vector3>> = {};
/** conferir se o indicador ficou dentro da malha (número de voltas): os modelos feitos em código têm furos (o
 * guarda-mato) que a soma dos ângulos não entende, e o teste dava "dentro" no vão do guarda-mato */
const DEEP_CHECK = false;
/** raio da polpa do indicador (a esfera fica encostada na frente da lâmina) */
const PAD_R = 0.006;
/** a polpa um pouco à direita do meio da lâmina (o dedo entra pela direita) e até onde a ponta passa para a esquerda */
const PAD_X = 0.003;
const LEFT_MAX = 0.008;
/** quanto a ponta do indicador pode passar da frente do gatilho */
const OVERSHOOT = 0.01;
/** o dedo de gatilho dobrado: abaixo disso ele está quase reto */
const HOOK = 0.55;
/** o médio e o anelar têm que fechar pelo menos isto em volta do punho (senão a mão desce) */
const MIDDLE_WRAP = 0.7;

/**
 * Apoio da pistola: a esquerda pela lateral esquerda do punho, a palma encostando nos dedos da direita (que dão a
 * volta no punho), os dedos descendo ~37° para a frente e fechando por cima dos da direita, o indicador logo abaixo
 * do guarda-mato e o polegar esticado para a frente, embaixo do ferrolho. A palma vem de fora (−x) até encostar.
 */
function pistolSupport(g: GunModel): {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  curl: [number, number, number];
  thumbUp?: number;
} {
  const own = PISTOL_SUPPORT[g.id];
  if (own) {
    const z = new THREE.Vector3(...own.fingers).normalize().negate();
    const y = new THREE.Vector3(...own.back);
    y.addScaledVector(z, -y.dot(z)).normalize();
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z),
    );
    const pos = new THREE.Vector3(...own.palm).sub(new THREE.Vector3(0, 0, -0.046).applyQuaternion(quat));
    return { pos, quat, curl: [...own.curl], ...(own.thumbUp ? { thumbUp: own.thumbUp } : {}) };
  }
  const mag = g.parts.mag ? partBox(g, g.parts.mag) : null;
  const zc = mag ? (mag.min.z + mag.max.z) / 2 : 0.03;
  // o centro da palma ao lado do punho, um pouco abaixo do guarda-mato
  const palm = new THREE.Vector3(-0.034, -0.032, zc - 0.006);
  const quat = APOIO_LADO.clone();
  const pos = palm.sub(new THREE.Vector3(0, 0, -0.046).applyQuaternion(quat));
  return { pos, quat, curl: [0.7, 0.15, 0.7] };
}
/**
 * Apoio da pistola medido para uma arma (espaço da arma): o centro da palma, para onde apontam os dedos e o dorso, e os
 * fechamentos (dedos, polegar, indicador). Automag III: o punho é longo e o apoio de sempre parava a palma ~1,7 cm
 * fora dele, com os dedos abertos sem encostar em nada; aqui a palma cobre a lateral esquerda do punho, os dedos
 * descem por cima dos da direita e o polegar fica esticado para a frente embaixo do ferrolho (conferido no harness).
 * M9: a palma tapa a lateral esquerda do punho por cima das pontas dos dedos da direita, os dedos dão a volta na frente
 * por cima dos da direita (o indicador logo abaixo do guarda-mato) e o polegar vai esticado para a frente, embaixo do
 * da direita (no apoio de sempre a mão ficava baixa, com os dedos abertos e soltos embaixo do punho); os dedos descem
 * 0,4 rad. Desert Eagle: com a direita mais baixa no punho fundo, o apoio comum deixava o indicador da esquerda ~4 cm
 * abaixo do guarda-mato e o polegar dela atravessando a armação; aqui a palma sobe e cobre os dedos da direita, o
 * indicador logo abaixo do guarda-mato, e o polegar vai esticado para a frente na lateral esquerda, embaixo do da
 * direita (os dedos descem 0,45 rad; `thumbUp`: quanto o polegar abre para o lado do dorso). Rhino: o apoio de sempre
 * (`APOIO_LADO`) com a palma no punho (no revólver o "pente" é o tambor, lá na frente: a palma ficava 4,5 cm à frente
 * do punho, fechada no ar na frente do guarda-mato). BFR: o mesmo do Rhino (a palma ficava ~6 cm à frente do punho,
 * fechada no ar embaixo do tambor), com a palma no meio do punho.
 */
const PISTOL_SUPPORT: Partial<
  Record<
    GunId,
    {
      palm: THREE.Vector3Tuple;
      fingers: THREE.Vector3Tuple;
      back: THREE.Vector3Tuple;
      curl: [number, number, number];
      thumbUp?: number;
    }
  >
> = {
  automag3: { palm: [-0.032, -0.005, 0.03], fingers: [0, -0.6, -0.8], back: [-1, 0, 0.1], curl: [0.8, 0, 0.8] },
  m9: {
    palm: [-0.03, -0.02, 0.025],
    fingers: [0, -Math.sin(0.4), -Math.cos(0.4)],
    back: [-1, 0, 0],
    curl: [0.8, 0.1, 0.8],
  },
  deagle: {
    palm: [-0.04, -0.01, 0.004],
    fingers: [0, -Math.sin(0.45), -Math.cos(0.45)],
    back: [-1, 0, 0],
    curl: [0.8, 0.4, 0.8],
    thumbUp: -0.4,
  },
  rhino: {
    palm: [-0.034, -0.027, 0.03],
    fingers: [0, -0.6, -0.8],
    back: [-1, 0, 0],
    curl: [0.7, 0.15, 0.7],
    thumbUp: -0.2,
  },
  bfr: {
    palm: [-0.034, -0.035, 0.04],
    fingers: [0, -0.6, -0.8],
    back: [-1, 0, 0],
    curl: [0.7, 0.15, 0.7],
    thumbUp: -0.2,
  },
};
/** palma para +x, dedos para a frente e para baixo (0, −0,6, −0,8), indicador para cima */
const APOIO_LADO = basis([0, 0.8, -0.6], [-1, 0, 0], [0, 0.6, 0.8]);

/**
 * O indicador fora do gatilho: reto ao longo da lateral da armação, acima do guarda-mato. Procura o fechamento mais reto
 * em que ele só encosta na lateral (as sondas são uns mm mais gordas que a malha do dedo: até `INDEX_TOUCH` dentro é
 * encostar). A procura antiga (a partir de `TRIGGER_OFF`, o fechamento livre mais perto) achava 0,3–0,5 na maioria
 * das armas: o dedo ficava dobrado, enganchado dentro ou em volta do guarda-mato. Sem nenhum assim, fica a antiga.
 */
function trigOff(g: GunModel, right: Hold): number {
  const soup = soupOf(g.root, { at: right.pos, r: 0.18 });
  const gap = (ix: number) => {
    const o: [number, number, number, number, number] = [ix - right.curl[2], 0, 0, 0, 0];
    return clearance(soup, [], handProbes(1, ...right.curl, o, 'index'), right.pos, right.quat, 0.004);
  };
  for (let ix = 0; ix <= INDEX_STRAIGHT; ix += 0.025) if (gap(ix) >= -INDEX_TOUCH) return ix;
  const free = (ix: number) => gap(ix) >= 0.0005;
  for (let d = 0; d <= 0.5; d += 0.025) {
    if (free(TRIGGER_OFF - d) && TRIGGER_OFF - d >= 0) return TRIGGER_OFF - d;
    if (free(TRIGGER_OFF + d)) return TRIGGER_OFF + d;
  }
  return TRIGGER_OFF;
}

/** até onde o indicador reto pode fechar e quanto ele pode entrar na lateral encostando (m) */
const INDEX_STRAIGHT = 0.2;
const INDEX_TOUCH = 0.003;

/** tudo parado (pente, ferrolho e alavancas no lugar) antes de medir */
function rest(g: GunModel) {
  for (const p of Object.values(g.parts)) {
    if (!p) continue;
    p.obj.position.copy(p.rest);
    p.obj.quaternion.copy(p.restQ);
  }
  g.root.updateMatrixWorld(true);
}

function balls(h: Hold, side: 1 | -1): Sphere[] {
  return handProbes(side, h.curl[0], h.curl[1], h.curl[2], h.off).map((p) => ({
    at: p.at.clone().applyQuaternion(h.quat).add(h.pos),
    r: p.r,
  }));
}

/**
 * por baixo da base, os dedos partem quase fechados e fecham em volta do pente até encostar (partindo de 0,6 eles
 * paravam abertos na lateral e o pente parecia equilibrado na palma)
 */
const MAG_UNDER_CURL = 0.95;
/** pente curto ou dentro do punho (pistola, MP7, snipers): a mão segura por baixo da base */
const UNDER: ReadonlySet<GunId> = new Set<GunId>([
  'm9',
  'deagle',
  'mp7',
  'l115',
  'm200',
  'msmc',
  'rs9',
  'sv98',
  'ballista',
]);

/**
 * Pela lateral, os nós dos dedos ficam logo à frente da frente do pente (`MAG_KNUCKLE`, m atrás dela; negativo, à
 * frente) e os dedos partem quase fechados (`MAG_CURL`): dão a volta na frente dele e as pontas encostam na lateral
 * direita. Com os nós 1,2 cm atrás da frente e os dedos partindo de 0,5, o encaixe parava cada dedo na lateral do
 * pente (anelar e mindinho quase retos) e os quatro ficavam em garra no ar, passando da frente dele.
 */
const MAG_CURL = 0.8;
const MAG_KNUCKLE = -0.005;
/**
 * os nós dos dedos acima da base do pente (m) e o giro da mão em x (positivo, os dedos sobem): com os dedos descendo
 * ~20° (antes), a fileira dos nós ficava inclinada e o mindinho batia na lateral, esticado
 */
const MAG_UP = 0.06;
const MAG_TILT = 0.25;
/**
 * O mesmo por arma: `up` e `tilt` no lugar de `MAG_UP` e `MAG_TILT`. MCX: no pente curvo dela, a frente vai para a
 * frente embaixo e o anelar e o mindinho passavam da base, esticados e soltos; mais alta e com os dedos subindo mais,
 * a fileira dos nós acompanha a curva e os quatro dedos fecham na frente do pente.
 */
const MAG_SIDE_AT: Partial<Record<GunId, { up: number; tilt: number }>> = {
  mcx: { up: 0.09, tilt: 0.5 },
};
/** esquerda pela lateral do pente: palma para a arma (+x), dedos para a frente, indicador em cima, girada `tilt` em x */
const magSide = (tilt: number) =>
  new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt)
    .multiply(basis([0, 1, 0], [-1, 0, 0], [0, 0, 1]));
/**
 * Esquerda no pente. Fuzil: pela lateral esquerda, os nós dos dedos na frente do pente (os dedos dão a volta nela),
 * a palma na metade de baixo dele. Pente curto (pistola, MP7, sniper): palma por baixo da base, os dedos subindo pela
 * lateral direita (o pente parado fica quase todo dentro da arma: pela lateral, a mão entrava no punho).
 */
function magHold(g: GunModel, cls: GunClass, avoid: Sphere[]): Hold | null {
  const mag = g.parts.mag;
  const box = mag ? partBox(g, mag) : null;
  if (!mag || !box) return null;
  const only = magSoup(g, mag) ?? soupOf(g.root);
  if (GUNS[g.id].revolver) {
    // revólver: o tambor aberto fica à esquerda da armação; a mão vem por baixo dele, palma para cima e dedos para a
    // frente (aninhando o tambor), o antebraço vindo de baixo (pela lateral, o braço passava por cima da arma)
    const curl: [number, number, number] = [0.45, 0.35, 0.45];
    const quat = CRADLE.clone();
    const pos = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y - 0.019, (box.min.z + box.max.z) / 2 + 0.046);
    const f = fitHand(only, -1, pos, quat, curl, {
      palm: true,
      palmOut: 0.02,
      fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
    });
    return { pos: f.pos, quat, curl, off: f.offsets };
  }
  if (UNDER.has(g.id) || cls === 'pistol') {
    const curl: [number, number, number] = [MAG_UNDER_CURL, 0.5, MAG_UNDER_CURL];
    const quat = MAG_UNDER.clone();
    // os nós dos dedos (0,088 do pulso, aqui para +x) logo depois da lateral direita do pente: os dedos sobem por ela
    const pos = new THREE.Vector3(box.max.x + 0.006 - 0.088, box.min.y - 0.019, (box.min.z + box.max.z) / 2);
    const f = fitHand(only, -1, pos, quat, curl, {
      palm: true,
      palmOut: 0.02,
      fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
      extra: avoid,
    });
    return { pos: f.pos, quat, curl, off: f.offsets };
  }
  const curl: [number, number, number] = [MAG_CURL, 0.4, MAG_CURL];
  const side = MAG_SIDE_AT[g.id];
  const quat = magSide(side?.tilt ?? MAG_TILT);
  void avoid;
  // os nós dos dedos (0,088 do pulso pelos dedos) logo atrás da frente do pente; a palma na metade de baixo
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  const knuckle = new THREE.Vector3(box.min.x - 0.02, box.min.y + (side?.up ?? MAG_UP), box.min.z + MAG_KNUCKLE);
  const pos = knuckle.addScaledVector(fwd, -0.088);
  const f = fitHand(only, -1, pos, quat, curl, {
    palm: true,
    palmIn: 0.03,
    palmOut: 0.01,
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
    cap: { thumb: 0.75 },
  });
  return { pos: f.pos, quat, curl, off: f.offsets };
}

/** só os triângulos do pente (o que a mão segura fora da arma) */
function magSoup(g: GunModel, mag: Part): Soup | null {
  if (!(mag.obj instanceof THREE.Bone)) {
    // peça feita em código: a malha dela
    return soupOf(g.root, undefined, mag.obj);
  }
  const list: number[] = [];
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  const v = new THREE.Vector3();
  g.root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const bi = o.skeleton.bones.indexOf(mag.obj as THREE.Bone);
    if (bi < 0) return;
    const geo = o.geometry;
    const pos = geo.getAttribute('position');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    const idx = geo.index;
    if (!pos || !si || !sw) return;
    const onMag = (i: number) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
      return w >= 0.5;
    };
    const count = idx ? idx.count : pos.count;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let t = 0; t + 2 < count; t += 3) {
      const a = idx ? idx.getX(t) : t;
      const b = idx ? idx.getX(t + 1) : t + 1;
      const c = idx ? idx.getX(t + 2) : t + 2;
      if (!onMag(a) || !onMag(b) || !onMag(c)) continue;
      for (const i of [a, b, c]) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(m);
        list.push(v.x, v.y, v.z);
      }
    }
  });
  return list.length ? toSoup(list) : null;
}

/**
 * Direita na alavanca do ferrolho (sniper, Kar98k): o giro da pegada do punho, a bola da alavanca no vão dos dedos
 * fechados (como quem pega um cabo), os dedos fechando até encostar nela.
 */
function pinchHold(g: GunModel, quat: THREE.Quaternion): Hold | null {
  const p = g.parts.boltRot ?? (g.id === 'kar98k' ? g.parts.charge : undefined);
  const knob = p ? knobOf(g, p) : null;
  if (!knob) return null;
  const pos = knob.clone().sub(FIST_HOLE.clone().applyQuaternion(quat));
  const soup = near(g, pos);
  const f = fitHand(soup, 1, pos, quat, PINCH, {
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
  });
  return { pos: f.pos, quat: quat.clone(), curl: [...PINCH], off: f.offsets };
}

/** a bola da alavanca: o meio dos pontos da peça que ficam mais para a direita (os últimos 1,5 cm em x) */
function knobOf(g: GunModel, p: Part): THREE.Vector3 | null {
  const pts: THREE.Vector3[] = [];
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  g.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const skinned = o instanceof THREE.SkinnedMesh;
    const bi = skinned ? o.skeleton.bones.indexOf(p.obj as THREE.Bone) : -1;
    let inside = false;
    for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === p.obj) inside = true;
    if (!inside && bi < 0) return;
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    for (let i = 0; i < pos.count; i++) {
      if (bi >= 0 && si && sw) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
        if (w < 0.5) continue;
      }
      pts.push(o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m));
    }
  });
  if (!pts.length) return null;
  const maxX = Math.max(...pts.map((v) => v.x));
  const tip = pts.filter((v) => v.x > maxX - 0.015);
  return tip.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(tip.length);
}

/**
 * Encaixe numa pose qualquer (o gesto da recarga vazia): a palma vem pela normal até encostar e os dedos fecham até
 * tocar, com as peças na pose do gesto (`pose`). Não vai para o cache (o viewmodel guarda o acerto por arma).
 */
export function fitAt(
  g: GunModel,
  side: 1 | -1,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  curl: [number, number, number],
  pose?: () => void,
): Hold {
  rest(g);
  // as peças na pose do gesto (o ferrolho aberto, por exemplo)
  if (pose) {
    pose();
    g.root.updateMatrixWorld(true);
  }
  const c = qc(curl);
  const f = fitHand(near(g, pos), side, pos, quat, c, {
    palm: true,
    palmIn: 0.015,
    palmOut: 0.07,
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
  });
  return { pos: f.pos, quat: quat.clone(), curl: c, off: f.offsets };
}

/**
 * Uma cópia do pente sem os cartuchos (o vazio que cai na recarga), no espaço da arma, no lugar dele parado. Modelo
 * do arquivo: os triângulos presos ao osso do pente viram uma malha comum (com o material e a textura da arma);
 * feito em código: a cópia do grupo, sem o material dos cartuchos.
 */
export function magMesh(g: GunModel): THREE.Object3D | null {
  const mag = g.parts.mag;
  if (!mag) return null;
  rest(g);
  if (!(mag.obj instanceof THREE.Bone)) {
    const copy = mag.obj.clone(true);
    const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
    copy.matrixAutoUpdate = true;
    new THREE.Matrix4()
      .multiplyMatrices(inv, mag.obj.matrixWorld)
      .decompose(copy.position, copy.quaternion, copy.scale);
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === g.rounds) o.visible = false;
    });
    return copy;
  }
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  const group = new THREE.Group();
  const v = new THREE.Vector3();
  g.root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const bi = o.skeleton.bones.indexOf(mag.obj as THREE.Bone);
    if (bi < 0) return;
    const geo = o.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    const idx = geo.index;
    if (!pos || !si || !sw) return;
    const onMag = (i: number) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
      return w >= 0.5;
    };
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const P: number[] = [];
    const U: number[] = [];
    const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    // só o grupo do material da arma (o dos cartuchos fica de fora: o pente que cai está vazio)
    const all: { start: number; count: number; materialIndex?: number }[] = geo.groups.length
      ? geo.groups
      : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const gr = all.find((x) => (x.materialIndex ?? 0) === 0) ?? all[0]!;
    for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      if (!tri.every(onMag)) continue;
      for (const i of tri) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(m);
        P.push(v.x, v.y, v.z);
        if (uv) U.push(uv.getX(i), uv.getY(i));
      }
    }
    if (!P.length) return;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (U.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    out.computeVertexNormals();
    const mesh = new THREE.Mesh(out, mats[0]);
    // a geometria é desta cópia (o material é da arma: quem libera a arma libera ele)
    mesh.userData.ownGeo = true;
    group.add(mesh);
  });
  // o carregador estendido preso ao osso do pente cai junto (cópia com a mesma geometria: quem libera é a arma)
  mag.obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.att) return;
    const copy = new THREE.Mesh(o.geometry, o.material);
    new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).decompose(copy.position, copy.quaternion, copy.scale);
    group.add(copy);
  });
  return group.children.length ? group : null;
}

/** pente-lâmina da Kar98k (feito aqui): a lâmina de aço de pé e as cinco balas para a frente, uma em cima da outra */
/**
 * Carregador rápido do revólver: um disco escuro com o botão atrás e `n` cartuchos em volta, as pontas para a frente
 * (−z), no raio `ring` dos furos do tambor. A origem fica na face de trás dos cartuchos, no eixo.
 */
export function speedLoader(n: number, ring: number): { root: THREE.Group } {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.4, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a043, metalness: 0.85, roughness: 0.32 });
  const disk = new THREE.Mesh(
    new THREE.CylinderGeometry(ring + 0.007, ring + 0.007, 0.011, 16).rotateX(Math.PI / 2),
    body,
  );
  disk.position.z = 0.0055;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.014, 10).rotateX(Math.PI / 2), body);
  knob.position.z = 0.018;
  root.add(disk, knob);
  const caseGeo = new THREE.CylinderGeometry(0.0046, 0.0048, 0.03, 8).rotateX(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = new THREE.Mesh(caseGeo, brass);
    r.position.set(Math.cos(a) * ring, Math.sin(a) * ring, -0.015);
    root.add(r);
  }
  root.visible = false;
  return { root };
}

export function stripperClip(): { root: THREE.Group; rounds: THREE.Mesh[] } {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.7, roughness: 0.45 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a043, metalness: 0.85, roughness: 0.32 });
  const tip = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.6, roughness: 0.4 });
  // a lâmina: um "U" fino de pé (as balas presas pelo aro), atrás das balas
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.052, 0.003), steel);
  strip.position.set(0, -0.026, 0.0015);
  root.add(strip);
  const caseGeo = new THREE.CylinderGeometry(0.0059, 0.006, 0.057, 8).rotateX(Math.PI / 2);
  const tipGeo = new THREE.ConeGeometry(0.0041, 0.022, 8).rotateX(-Math.PI / 2);
  const rounds: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const r = new THREE.Mesh(caseGeo, brass);
    r.position.set(0, -0.0055 - i * 0.0102, -0.0285);
    const b = new THREE.Mesh(tipGeo, tip);
    b.position.set(0, 0, -0.039);
    r.add(b);
    root.add(r);
    rounds.push(r);
  }
  root.visible = false;
  return { root, rounds };
}

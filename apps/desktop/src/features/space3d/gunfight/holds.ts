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
/**
 * Esquerda pela lateral do pente: palma para a arma (+x), dedos para a frente (dão a volta na frente do pente),
 * indicador em cima. Inclinada ~20° (os dedos descendo um pouco, como quem puxa o pente para baixo).
 */
const MAG_SIDE = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35)
  .multiply(basis([0, 1, 0], [-1, 0, 0], [0, 0, 1]));
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
  const right = fitRight(g, rg.pos, rg.quat, qc(rg.curl));
  // a direita vira obstáculo para a esquerda (na pistola, os dedos da esquerda passam por cima dos dela)
  const rightBalls = balls(right, 1);
  const lg = pistol ? pistolSupport(g) : leftGrip(g, cls, ARM_HAND_FIT);
  const lc = qc(lg.curl);
  const ls = near(g, lg.pos);
  const lf = fitHand(ls, -1, lg.pos, lg.quat, lc, {
    palm: true,
    palmIn: pistol ? 0 : 0.012,
    palmOut: pistol ? 0.04 : 0.025,
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
    extra: pistol ? rightBalls : [],
  });
  const left: Hold = { pos: lf.pos, quat: lg.quat.clone(), curl: lc, off: lf.offsets };
  return { right, left, mag: magHold(g, cls, rightBalls), pinch: pinchHold(g, rg.quat), trigOff: trigOff(g, right) };
}

/**
 * Direita no punho. A pegada põe o indicador na altura do gatilho, mas em arma de guarda-mato baixo (Desert Eagle) o
 * médio caía em cima da barra de baixo do guarda-mato e ficava esticado: a mão desce pelo punho (passos de 3 mm) até
 * o médio fechar em volta do punho. Depois a palma encosta pela direita, médio/anelar/mindinho e polegar fecham até
 * tocar, e o indicador procura o gatilho: o fechamento em que a ponta fica mais perto da frente da lâmina sem encostar
 * no guarda-mato nem na armação.
 */
function fitRight(g: GunModel, pos0: THREE.Vector3, quat: THREE.Quaternion, rc: [number, number, number]): Hold {
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
  let best = { score: Infinity, pos: pos0.clone(), ix: rc[2] };
  const cands: { score: number; pos: THREE.Vector3; ix: number }[] = [];
  for (let dy = -0.03; dy <= 0.0181; dy += 0.003)
    for (let dz = -0.01; dz <= 0.0301; dz += 0.005) {
      const p = pos0.clone().addScaledVector(down, dy).addScaledVector(fwd, dz);
      const f = fitHand(soup, 1, p, quat, rc, { palm: true, fingers: ['middle', 'ring'] });
      const mid = rc[0] + f.offsets[1];
      const ring = rc[0] + f.offsets[2];
      const [ix, tip] = index(f.pos);
      // o gatilho manda; o médio sem fechar e a mão longe da pegada pesam contra
      const score =
        tip + 0.15 * (Math.max(0, MIDDLE_WRAP - mid) + Math.max(0, MIDDLE_WRAP - ring)) + 0.1 * Math.hypot(dy, dz);
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
  const rf = fitHand(soup, 1, best.pos, quat, rc, { fingers: ['middle', 'ring', 'pinky', 'thumb'] });
  const off: [number, number, number, number, number] = [...rf.offsets];
  off[0] = best.ix - rc[2];
  return { pos: best.pos, quat: quat.clone(), curl: rc, off };
}
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
function pistolSupport(g: GunModel): { pos: THREE.Vector3; quat: THREE.Quaternion; curl: [number, number, number] } {
  const mag = g.parts.mag ? partBox(g, g.parts.mag) : null;
  const zc = mag ? (mag.min.z + mag.max.z) / 2 : 0.03;
  // o centro da palma ao lado do punho, um pouco abaixo do guarda-mato
  const palm = new THREE.Vector3(-0.034, -0.032, zc - 0.006);
  const quat = APOIO_LADO.clone();
  const pos = palm.sub(new THREE.Vector3(0, 0, -0.046).applyQuaternion(quat));
  return { pos, quat, curl: [0.7, 0.15, 0.7] };
}
/** palma para +x, dedos para a frente e para baixo (0, −0,6, −0,8), indicador para cima */
const APOIO_LADO = basis([0, 0.8, -0.6], [-1, 0, 0], [0, 0.6, 0.8]);

/**
 * O indicador fora do gatilho: esticado sobre a armação (`TRIGGER_OFF`), ele entrava na lateral da caixa da culatra em
 * várias armas. Procura, a partir dele, o fechamento mais perto que fica livre (abrindo ou fechando um pouco).
 */
function trigOff(g: GunModel, right: Hold): number {
  const soup = soupOf(g.root, { at: right.pos, r: 0.18 });
  const free = (ix: number) => {
    const o: [number, number, number, number, number] = [ix - right.curl[2], 0, 0, 0, 0];
    return clearance(soup, [], handProbes(1, ...right.curl, o, 'index'), right.pos, right.quat, 0.004) >= 0.0005;
  };
  for (let d = 0; d <= 0.5; d += 0.025) {
    if (free(TRIGGER_OFF - d) && TRIGGER_OFF - d >= 0) return TRIGGER_OFF - d;
    if (free(TRIGGER_OFF + d)) return TRIGGER_OFF + d;
  }
  return TRIGGER_OFF;
}

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
    const curl: [number, number, number] = [0.6, 0.5, 0.6];
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
  const curl: [number, number, number] = [0.5, 0.4, 0.5];
  const quat = MAG_SIDE.clone();
  void avoid;
  // os nós dos dedos (0,088 do pulso pelos dedos) logo atrás da frente do pente; a palma na metade de baixo
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  const knuckle = new THREE.Vector3(box.min.x - 0.02, box.min.y + 0.05, box.min.z + 0.012);
  const pos = knuckle.addScaledVector(fwd, -0.088);
  const f = fitHand(only, -1, pos, quat, curl, {
    palm: true,
    palmIn: 0.03,
    palmOut: 0.01,
    fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
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

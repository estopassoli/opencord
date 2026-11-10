/**
 * Animações de primeira pessoa feitas à mão, quadro a quadro (ADR-0061). Hoje desligadas (`AUTHORED` vazio: o MP7 voltou
 * ao caminho de código até os clipes serem refeitos); todas as armas seguem com as animações feitas em código do
 * `viewmodel.ts`.
 *
 * O arquivo `assets/anims/<arma>.glb` tem só o esqueleto dos braços (os mesmos ossos de `assets/arms.glb`) mais o
 * encaixe da arma (`weapon`), o pente (`mag`), a alavanca (`charge`) e um osso de controle (`ctl`: na posição dele, a
 * mão de apoio no apoio, a mão no pente e os cartuchos à mostra), e os clipes. Um `AnimationMixer` toca os clipes num
 * esqueleto sem malha (`fpmix.ts` decide pesos e tempos); daqui saem, por quadro, no espaço em que foram escritos (a
 * câmera em repouso): a arma, a mão de cada lado, o cotovelo, o giro local de cada dedo, o pente e a alavanca.
 *
 * Camadas por montagem, por cima do clipe (o clipe é escrito com a empunhadura dobrável de fábrica e o pente normal):
 * - empunhadura vertical ou angulada: com a mão no apoio (`ctl.x`), a mão anda da pegada de fábrica para a do
 *   acessório (no espaço da arma) e os dedos vão para a pose medida nele;
 * - pente estendido: com a mão no pente (`ctl.y`), ela pega mais embaixo; e o pente desce o tanto que ele é mais
 *   comprido antes de sair (o curso é maior), a mão junto.
 * As camadas de sempre ficam no `viewmodel.ts` (mira, balanço, passo, coice, pulo, agachar): elas mexem no espaço em
 * que o clipe foi escrito, então a linha de mira continua a mesma de antes.
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import mp7Url from '../assets/anims/mp7.glb?url';
import { buildFromKey } from './attachments';
import { MP7_ANIM } from './fpclips-mp7';
import { FpMixer, blankLayers, type FpInput, type FpLayers, type FpLoop, type FpOneShot } from './fpmix';
import { Kit, mat, type GunModel } from './models';

/** armas cujo clipe foi escrito com a empunhadura dobrável aberta (hoje nenhuma) */
const FOLDING: ReadonlySet<GunId> = new Set<GunId>();

/**
 * armas com animação feita à mão (o resto segue no caminho de código). Hoje nenhuma: o MP7 voltou ao caminho de código
 * até os clipes serem refeitos (o QA reprovou a recarga: o braço esquerdo saltava acima do olho e o pente trocava sem
 * mão). O pipeline e o arquivo `assets/anims/mp7.glb` ficam, desligados.
 */
export const AUTHORED: ReadonlySet<GunId> = new Set<GunId>();

type Meta = typeof MP7_ANIM;
const META: Partial<Record<GunId, { url: string; meta: Meta }>> = { mp7: { url: mp7Url, meta: MP7_ANIM } };

interface Template {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}
const templates = new Map<GunId, Template>();
let loading: Promise<void> | null = null;

/** carrega os clipes uma vez (junto com as armas) */
export function loadFpAnims(): Promise<void> {
  loading ??= Promise.all(
    // só as armas que usam os clipes (o arquivo de uma arma desligada não é baixado)
    (Object.entries(META) as [GunId, { url: string; meta: Meta }][])
      .filter(([id]) => AUTHORED.has(id))
      .map(async ([id, m]) => {
        const g = await new GLTFLoader().loadAsync(m.url);
        registerFpAnims(id, g.scene, g.animations);
      }),
  ).then(() => undefined);
  return loading;
}

/** guarda o esqueleto e os clipes de uma arma (os testes leem o arquivo do disco e registram por aqui) */
export function registerFpAnims(id: GunId, scene: THREE.Object3D, animations: THREE.AnimationClip[]) {
  templates.set(id, fromGltf(scene, animations));
}

function fromGltf(scene: THREE.Object3D, animations: THREE.AnimationClip[]): Template {
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of animations) clips.set(c.name, c);
  const fire = clips.get('fire');
  // o tiro soma por cima da pose (o primeiro quadro dele é a pose parada)
  if (fire) clips.set('fire', THREE.AnimationUtils.makeClipAdditive(fire.clone(), 0));
  return { scene, clips };
}

export function hasAuthored(id: GunId): boolean {
  return AUTHORED.has(id) && templates.has(id);
}

const FINGERS = [
  'palm_index',
  'index1',
  'index2',
  'index3',
  'palm_middle',
  'middle1',
  'middle2',
  'middle3',
  'palm_ring',
  'ring1',
  'ring2',
  'ring3',
  'palm_pinky',
  'pinky1',
  'pinky2',
  'pinky3',
  'thumb1',
  'thumb2',
  'thumb3',
];
const LOOPS: FpLoop[] = ['idle', 'ads', 'sprint', 'tac'];
const ONES: FpOneShot[] = ['draw', 'holster', 'reload', 'reloadEmpty', 'inspect', 'melee'];

/** a pose de agora, no espaço em que o clipe foi escrito (a câmera em repouso); preenchida sem alocar */
export interface FpPose {
  gun: THREE.Matrix4;
  /** o deslocamento do pente (espaço da arma, a partir do lugar dele) e quanto a alavanca foi puxada (m) */
  mag: THREE.Matrix4;
  charge: number;
  hand: [THREE.Matrix4, THREE.Matrix4];
  elbow: [THREE.Vector3, THREE.Vector3];
  /** giro local de cada osso de dedo (sem o sufixo do lado), direita e esquerda */
  fingers: [Map<string, THREE.Quaternion>, Map<string, THREE.Quaternion>];
  rounds: boolean;
}

const M1 = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const M3 = new THREE.Matrix4();
const Q1 = new THREE.Quaternion();
const V1 = new THREE.Vector3();
const S1 = new THREE.Vector3();

/** matriz 4×4 do three a partir da lista do `fpclips` (coluna por coluna) */
function m16(a: readonly number[]): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(a as number[]);
}

/** a matriz `a` elevada a `k` (0–1): posição linear e giro esférico a partir da identidade */
function powMat(a: THREE.Matrix4, k: number, out: THREE.Matrix4): THREE.Matrix4 {
  if (k >= 0.999) return out.copy(a);
  if (k <= 0.001) return out.identity();
  a.decompose(V1, Q1, S1);
  V1.multiplyScalar(k);
  Q1.slerp(QI, 1 - k);
  return out.compose(V1, Q1, ONE);
}
const QI = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

/** os braços animados de uma arma (um por viewmodel e arma) */
export class AuthoredArms {
  readonly meta: Meta;
  /** a pose de quadril em que os clipes foram escritos (espaço da câmera) */
  readonly hip: THREE.Matrix4;
  readonly hipInv: THREE.Matrix4;
  readonly pose: FpPose;
  private readonly rig: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly fsm: FpMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly layers: FpLayers = blankLayers();
  /** a pegada de apoio do acessório em relação à de fábrica (espaço da arma), os dedos dela e o pente estendido */
  private readonly supportDelta: THREE.Matrix4 | null = null;
  private readonly supportFingers: Map<string, THREE.Quaternion> | null = null;
  private readonly magExt: number;
  private readonly grabDelta: THREE.Matrix4 | null = null;
  private readonly magRest: THREE.Matrix4;
  private readonly trigger = new Map<string, THREE.Quaternion>();
  private readonly extras: THREE.Object3D[] = [];

  constructor(id: GunId, g: GunModel) {
    const t = templates.get(id);
    const m = META[id];
    if (!t || !m) throw new Error('sem animação feita à mão: ' + id);
    this.meta = m.meta;
    this.rig = t.scene.clone(true);
    this.rig.traverse((o) => this.nodes.set(o.name, o));
    this.mixer = new THREE.AnimationMixer(this.rig);
    const lens: Record<string, number> = {};
    for (const [name, c] of Object.entries(this.meta.clips) as [string, { len: number }][]) lens[name] = c.len;
    this.fsm = new FpMixer(lens);
    for (const [name, clip] of t.clips) {
      const a = this.mixer.clipAction(clip);
      if (name === 'fire') a.blendMode = THREE.AdditiveAnimationBlendMode;
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      this.actions.set(name, a);
    }
    const h = this.meta.hip;
    this.hip = new THREE.Matrix4().compose(
      new THREE.Vector3(h.pos[0], h.pos[1], h.pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(h.rot[0], h.rot[1], h.rot[2], 'YXZ')),
      ONE,
    );
    this.hipInv = this.hip.clone().invert();
    const build = buildFromKey(g.buildKey ?? '');
    // empunhadura angulada: a pegada medida nela ficava aberta na frente da arma; a de fábrica (embaixo da caixa,
    // logo atrás dela) já deixa a base da mão encostada na rampa, como se segura esse acessório
    const sup =
      build.under && build.under !== 'agrip' ? this.meta.support[build.under as keyof Meta['support']] : undefined;
    if (sup) {
      this.supportDelta = m16(sup.anchor).multiply(m16(this.meta.support.base.anchor).invert());
      this.supportFingers = quatMap(sup.fingers, '_l');
    }
    this.magExt = g.magExt ?? 0;
    const ext = (this.meta.magGrab as { ext?: readonly number[] }).ext;
    if (this.magExt > 0 && ext) this.grabDelta = m16(ext).multiply(m16(this.meta.magGrab.base).invert());
    for (const [k, q] of quatMap(this.meta.trigger, '_r')) this.trigger.set(k, q);
    const mp = this.meta.magPivot;
    this.magRest = new THREE.Matrix4().makeTranslation(mp[0], mp[1], mp[2]);
    this.pose = {
      gun: new THREE.Matrix4(),
      mag: new THREE.Matrix4(),
      charge: 0,
      hand: [new THREE.Matrix4(), new THREE.Matrix4()],
      elbow: [new THREE.Vector3(), new THREE.Vector3()],
      fingers: [new Map(), new Map()],
      rounds: false,
    };
    // a empunhadura dobrável do MP7A1 só entra quando o clipe foi escrito com ela (o movimento de referência segura
    // por baixo da frente da caixa, como num guarda-mão)
    if (id === 'mp7' && !build.under && FOLDING.has(id)) this.extras.push(foldingGrip(g));
  }

  get busy(): FpOneShot | null {
    return this.fsm.busy;
  }

  play(kind: FpOneShot, ms: number) {
    if (ONES.includes(kind) && this.actions.has(kind)) this.fsm.play(kind, ms);
  }

  fire() {
    this.fsm.fire();
  }

  stop() {
    this.fsm.stop();
  }

  /** a duração escrita de um clipe (s) */
  length(kind: string): number {
    return (this.meta.clips as Record<string, { len: number }>)[kind]?.len ?? 0;
  }

  update(dt: number, inp: FpInput) {
    const L = this.fsm.step(dt, inp, this.layers);
    for (const k of LOOPS) {
      const a = this.actions.get(k);
      if (!a) continue;
      a.setEffectiveWeight(L.loops[k].w);
      a.time = L.loops[k].t;
    }
    for (const k of ONES) {
      const a = this.actions.get(k);
      if (!a) continue;
      const on = L.one?.kind === k;
      a.setEffectiveWeight(on ? L.one!.w : 0);
      if (on) a.time = Math.min(L.one!.t, a.getClip().duration - 1e-4);
    }
    const f = this.actions.get('fire');
    if (f) {
      f.setEffectiveWeight(L.fire ? L.fire.w : 0);
      f.time = L.fire ? Math.min(L.fire.t, f.getClip().duration - 1e-4) : 0;
    }
    this.mixer.update(0);
    this.rig.updateMatrixWorld(true);
    this.read(L.trigger);
  }

  private node(n: string): THREE.Object3D {
    const o = this.nodes.get(n);
    if (!o) throw new Error('osso faltando no clipe: ' + n);
    return o;
  }

  /** lê o esqueleto e aplica as camadas da montagem */
  private read(trigger: number) {
    const p = this.pose;
    const rigInv = M3.copy(this.rig.matrixWorld).invert();
    const W = p.gun.multiplyMatrices(rigInv, this.node('weapon').matrixWorld);
    const ctl = this.node('ctl').position;
    const support = ctl.x;
    const magHold = ctl.y;
    p.rounds = ctl.z > 0.5;
    // pente: o deslocamento no espaço da arma a partir do lugar dele
    M1.multiplyMatrices(rigInv, this.node('mag').matrixWorld);
    p.mag.copy(W).invert().multiply(M1).multiply(M2.copy(this.magRest).invert());
    // pente estendido: desce o tanto a mais antes de sair do punho (o curso maior), a mão junto
    let extDrop = 0;
    if (this.magExt > 0) {
      V1.setFromMatrixPosition(p.mag);
      extDrop = this.magExt * Math.min(1, V1.length() / 0.05);
      p.mag.premultiply(M2.makeTranslation(0, -extDrop, 0));
    }
    const ch = this.node('charge').position;
    const cp = this.meta.chargePivot;
    p.charge = Math.max(0, ch.z - cp[2]);
    for (let s = 0; s < 2; s++) {
      const sfx = s === 0 ? '_r' : '_l';
      const H = p.hand[s]!;
      H.multiplyMatrices(rigInv, this.node('hand' + sfx).matrixWorld);
      p.elbow[s]!.setFromMatrixPosition(M1.multiplyMatrices(rigInv, this.node('forearm' + sfx).matrixWorld));
      const fm = p.fingers[s]!;
      for (const n of FINGERS) {
        let q = fm.get(n);
        if (!q) fm.set(n, (q = new THREE.Quaternion()));
        q.copy(this.node(n + sfx).quaternion);
      }
    }
    // esquerda: pegada do acessório (no espaço da arma, pesando o tanto que a mão está no apoio)
    const left = p.hand[1];
    if (this.supportDelta && support > 0.001) {
      M1.copy(W)
        .multiply(powMat(this.supportDelta, support, M2))
        .multiply(M3.copy(W).invert());
      left.premultiply(M1);
      p.elbow[1].applyMatrix4(M1);
      for (const [n, q] of this.supportFingers ?? []) p.fingers[1].get(n)?.slerp(q, support);
    }
    if (magHold > 0.001 && (extDrop > 0 || this.grabDelta)) {
      // a mão no pente estendido: mais embaixo nele e descendo junto no curso maior
      M1.copy(W)
        .multiply(M2.makeTranslation(0, -extDrop * magHold, 0))
        .multiply(M3.copy(W).invert());
      if (this.grabDelta) {
        const Mg = M3.copy(W).multiply(p.mag).multiply(this.magRest);
        M1.multiply(Mg)
          .multiply(powMat(this.grabDelta, magHold, M2))
          .multiply(Mg.invert());
      }
      left.premultiply(M1);
      p.elbow[1].applyMatrix4(M1);
    }
    // indicador no gatilho
    if (trigger > 0.001) for (const [n, q] of this.trigger) p.fingers[0].get(n)?.slerp(q, trigger);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig);
    for (const e of this.extras) e.removeFromParent();
  }
}

function quatMap(o: Readonly<Record<string, readonly number[]>>, sfx: string): Map<string, THREE.Quaternion> {
  const m = new Map<string, THREE.Quaternion>();
  for (const [k, v] of Object.entries(o))
    m.set(k.endsWith(sfx) ? k.slice(0, -sfx.length) : k, new THREE.Quaternion(v[0], v[1], v[2], v[3]));
  return m;
}

/**
 * A empunhadura dobrável aberta do MP7A1, presa embaixo da frente da caixa e inclinada para a frente (as mesmas
 * medidas do `scripts/anims/fpanim/gun.py`, onde a pegada foi encaixada): só no modelo da primeira pessoa.
 */
export const FOLDING_GRIP = { top: [0, 0.024, -0.165] as const, tilt: (10 * Math.PI) / 180, len: 0.078, r: 0.012 };

function foldingGrip(g: GunModel): THREE.Object3D {
  const f = FOLDING_GRIP;
  const top = new THREE.Vector3(f.top[0], f.top[1], f.top[2]);
  const bot = top.clone().add(new THREE.Vector3(0, -Math.cos(f.tilt), -Math.sin(f.tilt)).multiplyScalar(f.len));
  const body = mat(0x1d1f22, 0.7, 0.2);
  const dark = mat(0x131416, 0.8, 0.1);
  const group = new THREE.Group();
  new Kit()
    .box(body, 0.022, 0.012, 0.03, top.x, top.y + 0.002, top.z)
    .rod(body, f.r, top, bot, 12)
    .rod(dark, f.r + 0.0012, bot.clone().lerp(top, 0.06), bot.clone().lerp(top, -0.02), 12)
    .bake(group);
  group.traverse((o) => {
    o.userData.att = true;
    if (o instanceof THREE.Mesh) o.frustumCulled = false;
  });
  g.root.add(group);
  return group;
}

export type { FpInput };

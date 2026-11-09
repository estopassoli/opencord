/**
 * Avatar do Espaço 3D (ADR-0055): boneco de massinha liso (doll.ts) animado pelas animações do esqueleto — parado,
 * conversando, andando, correndo, pulando, sentado, pilotando, socos, nocaute. Olhos que piscam sozinhos, boca que
 * abre com o volume da voz. Cor estável por pessoa; nome em cima; anel verde quando fala.
 */
import * as THREE from 'three';
import { bikeMesh } from './race';
import { makeHand, type Hand } from './hand';
import { disposeGun, disposeSkeletons, gunsReady, makeGun, type GunModel } from './gunfight/models';
import { TRIGGER_OFF, leftGrip, rightGrip } from './gunfight/grips';
import { MOVE } from './gunfight/movement';
import { kickSpring, spring, stepSpring } from './gunfight/spring';
import { GUNS } from './gunfight/weapons';
import type { GunAct, GunId } from '@opencord/contracts';
import {
  buildFace,
  cloneDoll,
  dollNow,
  DOLL_SCALE,
  loadDoll,
  type ClipName,
  type DollFace,
  type DollTemplate,
} from './doll';

export const AVATAR_COLORS = [
  '#e05a5a',
  '#3f8fe0',
  '#4fbf6a',
  '#f2c94c',
  '#b36ae0',
  '#f08a3c',
  '#3fd0c9',
  '#f06ab0',
  '#8a9bb0',
  '#a3d94f',
  '#6a5ae0',
  '#e0e0e0',
];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** altura do boneco no espaço (do chão ao topo da cabeça) */
export const AVATAR_HEIGHT = 1.31;

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 40px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.min(560, Math.ceil(ctx.measureText(text).width) + 36);
  c.width = w;
  c.height = 64;
  ctx.font = font;
  ctx.fillStyle = 'rgba(12,14,20,0.62)';
  const r = 24;
  ctx.beginPath();
  ctx.roundRect(0, 4, w, 56, r);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 34, w - 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set((w / 64) * 0.3, 0.3, 1);
  sp.renderOrder = 10;
  // perto da câmera (alguém passa na frente na terceira pessoa, ou encosta em mim na primeira) o nome cresce até
  // cobrir a tela: some aos poucos (some de vez a 1,6 m, inteiro a partir de 3 m)
  const at = new THREE.Vector3();
  sp.onBeforeRender = (_r, _s, cam) => {
    const d = sp.getWorldPosition(at).distanceTo(cam.position);
    sp.material.opacity = Math.min(1, Math.max(0, (d - 1.6) / 1.4));
  };
  return sp;
}

/**
 * Golpes de esporte (estado `a` 10–13 na rede, plano 2026-11-09 P5): pose procedural por cima da animação de base,
 * com antecipação (puxa para trás), impacto e recuo. Os outros jogadores veem o mesmo golpe pelo `a`.
 */
export const SWING_A = {
  kick: 10,
  forehand: 11,
  backhand: 12,
  bump: 13,
  elastico: 14,
  slide: 15,
  bike: 16,
} as const;
export type SwingA = (typeof SWING_A)[keyof typeof SWING_A];
/** duração de cada golpe (ms) */
export const SWING_MS: Record<SwingA, number> = { 10: 340, 11: 380, 12: 380, 13: 360, 14: 300, 15: 650, 16: 750 };
const isSwing = (a: number): a is SwingA => a >= 10 && a <= 16;
/** futebol: caído depois de levar falta */
export const A_FALLEN = 17;

type BoneName =
  | 'upperarm_l'
  | 'upperarm_r'
  | 'lowerarm_l'
  | 'lowerarm_r'
  | 'hand_l'
  | 'hand_r'
  | 'thigh_r'
  | 'calf_r'
  | 'foot_r'
  | 'thigh_l'
  | 'calf_l'
  | 'foot_l'
  | 'spine_01'
  | 'spine_02'
  | 'spine_03';
const BONES: readonly BoneName[] = [
  'upperarm_l',
  'upperarm_r',
  'lowerarm_l',
  'lowerarm_r',
  'hand_l',
  'hand_r',
  'thigh_r',
  'calf_r',
  'foot_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'spine_01',
  'spine_02',
  'spine_03',
];

export interface Pose {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
}

const ONCE: ReadonlySet<ClipName> = new Set(['Punch_Jab', 'Punch_Cross', 'Death01', 'Hit_Chest', 'Sword_Attack']);
const FADE = 0.18;

function disposeTree(o: THREE.Object3D) {
  o.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}

export class Avatar {
  readonly root = new THREE.Group();
  /** o boneco (escalado); sobe e desce para sentar no assento ou na moto */
  private readonly model = new THREE.Group();
  private doll: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private tpl: DollTemplate | null = null;
  private face: DollFace | null = null;
  /** mãos com dedos (presas aos ossos das mãos) */
  private hands: { r: Hand; l: Hand } | null = null;
  /** gunfight: a arma na mão (terceira pessoa) e como ela está */
  private gun: GunModel | null = null;
  private gunId: GunId | null = null;
  private gunPose: GunHold = { pitch: 0, crouch: false, ads: false, alive: true };
  /** coice do tiro (mola da arma, 0–~1,5: os tiros de uma rajada se somam) e a ação da mão que os outros veem */
  private readonly kick = spring();
  /** o cano mostrado (a pose chega da rede a cada ~100 ms: suaviza para a rajada não subir aos saltos) */
  private pitchShown: number | null = null;
  private gunAct: { kind: GunAct; t: number; s: number } | null = null;
  private lastAn: number | null = null;
  /** correndo com a arma (0–1, suave): o cano desce e vira para dentro, a mão esquerda solta */
  private runW = 0;
  /** protegido ao nascer: o corpo fica meio transparente */
  private ghost = false;
  /** comprimento do braço e do antebraço de cada lado (medidos no boneco, para a IK de dois ossos) */
  private armLen: Record<'l' | 'r', [number, number]> = { l: [0, 0], r: [0, 0] };
  /** tranco do tronco ao levar um tiro (s restantes) */
  private flinchT = 0;
  /** o tronco para trás neste quadro: quanto o ombro direito andou (espaço do boneco) e o giro (rad) */
  private readonly leanD = new THREE.Vector3();
  private leanA = 0;
  private skin: THREE.MeshStandardMaterial;
  private readonly ring: THREE.Mesh;
  /** sombra redonda no chão (do boneco: liberada no `dispose`) */
  private readonly shadow: THREE.Mesh;
  private nameSprite: THREE.Sprite;
  private blinkIn = 2 + Math.random() * 3;
  private target: Pose = { x: 0, y: 0, z: 0, ry: 0, a: 0 };
  private ry = 0;
  /** reação ao levar um golpe (s restantes) */
  private hitT = 0;
  private speaking = false;
  private level = 0;
  private mouthOpen = 0;
  private talkSeed = Math.random() * 100;
  private clip: ClipName | null = null;
  private action: THREE.AnimationAction | null = null;
  private lastA = -1;
  private disposed = false;
  /** velocidade no chão medida pelo deslocamento (m/s), para as pernas acompanharem sem escorregar */
  private speed = 0;
  private lastX = 0;
  private lastZ = 0;
  /** segurando a bola: onde ela está (mundo) — os braços vão até ela */
  private hold: THREE.Vector3 | null = null;
  private holdBoth = true;
  /** ossos usados pelas poses procedurais (guardados no build, sem procurar por nome a cada quadro) */
  private bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  /** golpe de esporte em andamento: tempo desde o começo (s; < 0 = nenhum) */
  private swingT = -1;

  constructor(
    readonly id: string,
    name: string,
    readonly color = avatarColor(id),
  ) {
    this.skin = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
    this.model.scale.setScalar(DOLL_SCALE);
    this.root.add(this.model);

    const shadow = (this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    ));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.root.add(shadow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.56, 24),
      new THREE.MeshBasicMaterial({ color: 0x3ad17a, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.nameSprite = label(name);
    this.nameSprite.position.y = AVATAR_HEIGHT + 0.42;
    this.root.add(this.nameSprite);

    const t = dollNow();
    if (t) this.build(t);
    else
      void loadDoll()
        .then((tp) => this.build(tp))
        .catch(() => {
          /* sem o modelo (arquivo faltando): fica só o nome e o anel */
        });
  }

  /** monta o boneco quando o modelo está carregado (o resto — time, raquete, moto — é reaplicado) */
  private build(t: DollTemplate) {
    if (this.disposed || this.doll) return;
    this.tpl = t;
    const doll = cloneDoll(t);
    doll.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.material = this.skin;
    });
    this.model.add(doll);
    this.doll = doll;
    for (const n of BONES) {
      const b = doll.getObjectByName(n);
      if (b) this.bones[n] = b;
    }
    this.face = buildFace(doll, t.info);
    this.root.updateMatrixWorld(true);
    for (const sd of ['l', 'r'] as const) {
      const up = this.bones[`upperarm_${sd}`];
      const low = this.bones[`lowerarm_${sd}`];
      const hand = this.bones[`hand_${sd}`];
      if (up && low && hand)
        this.armLen[sd] = [
          up.getWorldPosition(PA).distanceTo(low.getWorldPosition(PB)),
          low.getWorldPosition(PA).distanceTo(hand.getWorldPosition(PB)),
        ];
    }
    this.hands = { r: makeHand(this.color, 1), l: makeHand(this.color, -1) };
    this.attachHand(doll, 'r', this.hands.r);
    this.attachHand(doll, 'l', this.hands.l);
    this.mixer = new THREE.AnimationMixer(doll);
    const team = this.team;
    this.team = null;
    this.setTeam(team);
    const racket = this.racketKind;
    this.racketKind = null;
    this.setRacket(racket);
  }

  setName(name: string) {
    const old = this.nameSprite;
    const next = label(name);
    next.position.copy(old.position);
    this.root.remove(old);
    old.material.map?.dispose();
    old.material.dispose();
    this.root.add(next);
    this.nameSprite = next;
  }

  /** o meu nome não aparece para mim (ficaria na frente da câmera) */
  hideName() {
    this.nameSprite.visible = false;
  }

  /** time nas arenas: faixa na cintura e disco no chão da cor do time (null tira) */
  private teamBand: THREE.Object3D | null = null;
  private teamDisc: THREE.Mesh | null = null;
  private team: 'a' | 'b' | null = null;
  setTeam(team: 'a' | 'b' | null) {
    if (team === this.team) return;
    this.team = team;
    for (const m of [this.teamBand, this.teamDisc]) {
      if (!m) continue;
      m.parent?.remove(m);
      disposeTree(m);
    }
    this.teamBand = this.teamDisc = null;
    if (!team) return;
    const color = team === 'a' ? 0x3f8fe0 : 0xe04848;
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.44, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.015;
    this.root.add(disc);
    this.teamDisc = disc;
    const pelvis = this.doll?.getObjectByName('spine_01');
    if (!pelvis || !this.doll) return;
    // faixa na barriga, presa ao osso para acompanhar o corpo
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.03, 8, 28),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    band.rotation.x = Math.PI / 2;
    band.scale.set(1, 0.8, 1);
    const g = new THREE.Group();
    g.add(band);
    this.inBindPose(() => {
      const at = pelvis.getWorldPosition(new THREE.Vector3());
      this.doll!.worldToLocal(at);
      g.position.copy(at);
      attachTo(pelvis, g, this.doll!);
    });
    this.teamBand = g;
  }

  /** raquete na mão direita (tênis ou ping pong) */
  private racket: THREE.Group | null = null;
  private racketKind: 'tennis' | 'pingpong' | null = null;
  setRacket(kind: 'tennis' | 'pingpong' | null) {
    if (kind === this.racketKind) return;
    this.racketKind = kind;
    if (this.racket) {
      this.racket.parent?.remove(this.racket);
      disposeTree(this.racket);
      this.racket = null;
    }
    const hand = this.doll?.getObjectByName('hand_r');
    const fore = this.doll?.getObjectByName('lowerarm_r');
    if (!kind || !hand || !fore || !this.doll) return;
    const g = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, kind === 'tennis' ? 0.34 : 0.14, 6),
      new THREE.MeshLambertMaterial({ color: kind === 'tennis' ? 0x2b2e36 : 0x8b5a2b }),
    );
    handle.position.y = kind === 'tennis' ? -0.17 : -0.07;
    g.add(handle);
    if (kind === 'tennis') {
      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.02, 6, 20),
        new THREE.MeshLambertMaterial({ color: 0xe0e4ea }),
      );
      frame.scale.set(1, 1.3, 1);
      frame.position.y = -0.58;
      g.add(frame);
      const strings = new THREE.Mesh(
        new THREE.CircleGeometry(0.18, 16),
        new THREE.MeshBasicMaterial({ color: 0xd7f24a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      strings.scale.set(1, 1.3, 1);
      strings.position.y = -0.58;
      g.add(strings);
    } else {
      const paddle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.02, 16),
        new THREE.MeshLambertMaterial({ color: 0xc0392b }),
      );
      paddle.rotation.x = Math.PI / 2;
      paddle.position.y = -0.24;
      g.add(paddle);
    }
    // na mão, continuando a linha do antebraço
    this.inBindPose(() => {
      const doll = this.doll!;
      const h = doll.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
      const f = doll.worldToLocal(fore.getWorldPosition(new THREE.Vector3()));
      const dir = h.clone().sub(f).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      g.position.copy(h.addScaledVector(dir, 0.06));
      attachTo(hand, g, doll);
    });
    this.racket = g;
  }

  /** corrida: a moto embaixo do boneco (pilotando) */
  private bike: THREE.Group | null = null;
  setBike(on: boolean) {
    if (on === !!this.bike) return;
    if (this.bike) {
      this.root.remove(this.bike);
      disposeTree(this.bike);
      this.bike = null;
      return;
    }
    const g = bikeMesh(new THREE.Color(this.color).getHex());
    // o boneco fica a ~0,45 m do chão: a moto vai abaixo dele
    g.position.y = -0.45;
    this.root.add(g);
    this.bike = g;
  }

  /** gira as rodas conforme a velocidade */
  spinWheels(v: number, dt: number) {
    this.bike?.traverse((o) => {
      if (o.name === 'wheel') o.rotation.x += (v / 0.28) * dt;
    });
  }

  /** o golpe de esporte (a 10–13) recomeça agora (eu: cada apertar; os outros: quando o estado muda) */
  strike() {
    this.swingT = 0;
  }

  /** material do corpo (o brilho do impacto acende nele) */
  get material(): THREE.MeshStandardMaterial {
    return this.skin;
  }

  /** levou um golpe: encolhe e recua */
  hitReact() {
    this.hitT = 0.45;
  }

  /** atirou: a arma dá um coice na mão pela mola da arma (Desert Eagle alta e lenta, SMG curta), e o tronco recua */
  gunKick() {
    const v = this.gunId ? GUNS[this.gunId].recoil.vm : null;
    if (v) kickSpring(this.kick, v.k, v.c, 1);
  }

  /** levou um tiro: um tranco curto do tronco para trás (não a animação inteira, que travaria numa rajada) */
  flinch() {
    this.flinchT = FLINCH_S;
  }

  /** boca da arma na mão (mundo), se está com uma arma visível */
  muzzleWorld(): { x: number; y: number; z: number } | null {
    const g = this.gun;
    if (!g || !g.root.visible) return null;
    const p = g.root.localToWorld(G_M.copy(g.muzzle));
    return { x: p.x, y: p.y, z: p.z };
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
    this.ring.visible = on;
  }

  /** segurando a bola em `at` (mundo); `both` = as duas mãos (parado/arremesso), senão só a direita (quicando) */
  setHold(at: THREE.Vector3 | null, both = true) {
    if (!at) this.hold = null;
    else (this.hold ??= new THREE.Vector3()).copy(at);
    this.holdBoth = both;
  }

  /** volume da voz agora (0..1) — abre a boca; sem volume (0) e falando, a boca mexe num ritmo de fala */
  setVoiceLevel(v: number) {
    this.level = Math.max(0, Math.min(1, v));
  }

  /** posição vinda da rede (os outros) — a animação anda até lá suavemente */
  setTarget(p: Pose, snap = false) {
    this.target = p;
    if (snap) {
      this.root.position.set(p.x, p.y, p.z);
      this.ry = p.ry;
    }
  }

  /** dono do avatar (eu): posição exata */
  place(p: Pose) {
    this.target = p;
    this.root.position.set(p.x, p.y, p.z);
    this.ry = p.ry;
  }

  /** qual animação para o estado: 0 parado, 1 andando, 2 correndo, 3 no ar, 4 acenando, 5 sentado/pilotando, 6–9 x1 */
  private clipFor(a: number): ClipName {
    if (this.hitT > 0 && a !== 9) return 'Hit_Chest';
    // carrinho: deitado de lado com as pernas à frente (a base é a de sentado); bicicleta: no ar; falta: cai
    if (a === SWING_A.slide) return 'Sitting_Idle_Loop';
    if (a === SWING_A.bike) return 'Jump_Loop';
    if (a === A_FALLEN) return 'Death01';
    // golpe de esporte: a base é andar ou parado (a pose do golpe vem por cima)
    if (isSwing(a)) a = this.speed > 0.4 ? 1 : 0;
    switch (a) {
      case 1:
      case 2: {
        // pela velocidade de verdade: andar, trotar ou correr
        const g = this.tpl?.gait ?? {};
        const walk = g.Walk_Loop ?? 1;
        const jog = g.Jog_Fwd_Loop ?? 2.5;
        if (this.speed < walk * 1.5) return 'Walk_Loop';
        return this.speed < jog * 1.35 ? 'Jog_Fwd_Loop' : 'Sprint_Loop';
      }
      case 3:
        return 'Jump_Loop';
      case 5:
        return this.bike ? 'Driving_Loop' : this.speaking ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop';
      case 6:
        return this.racketKind ? 'Sword_Attack' : 'Punch_Jab';
      case 7:
        return 'Punch_Cross';
      case 8:
        return 'Punch_Jab';
      case 9:
        return 'Death01';
      default:
        return this.speaking ? 'Idle_Talking_Loop' : 'Idle_Loop';
    }
  }

  private play(name: ClipName, restart: boolean) {
    const mixer = this.mixer;
    const clip = this.tpl?.clips.get(name);
    if (!mixer || !clip) return;
    if (name === this.clip && !restart) return;
    const next = mixer.clipAction(clip);
    next.reset();
    if (ONCE.has(name)) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else next.setLoop(THREE.LoopRepeat, Infinity);
    next.timeScale = name === 'Punch_Jab' || name === 'Punch_Cross' ? 1.6 : 1;
    next.play();
    if (this.action && this.action !== next) this.action.crossFadeTo(next, name === 'Hit_Chest' ? 0.06 : FADE, false);
    this.action = next;
    this.clip = name;
  }

  /** `dt` é o tempo do jogo (para na pausa de impacto); `realDt` anda sempre (o golpe continua durante a pausa) */
  update(dt: number, t: number, realDt = dt) {
    const k = 1 - Math.exp(-dt * 12);
    const pos = this.root.position;
    pos.x += (this.target.x - pos.x) * k;
    pos.y += (this.target.y - pos.y) * k;
    pos.z += (this.target.z - pos.z) * k;
    let d = this.target.ry - this.ry;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.ry += d * Math.min(1, k * 1.3);
    this.root.rotation.y = this.ry;
    if (this.hitT > 0) this.hitT = Math.max(0, this.hitT - dt);
    if (this.flinchT > 0) this.flinchT = Math.max(0, this.flinchT - realDt);
    if (this.gunId) {
      const v = GUNS[this.gunId].recoil.vm;
      stepSpring(this.kick, v.k, v.c, realDt);
    }
    if (this.gunAct && (this.gunAct.t += realDt) >= this.gunAct.s) this.gunAct = null;

    const a = this.target.a;
    if (isSwing(a)) {
      if (a !== this.lastA) this.swingT = 0;
      if (this.swingT >= 0) this.swingT += realDt;
    } else this.swingT = -1;
    const name = this.clipFor(a);
    // golpe repetido (mesmo estado de novo) recomeça a animação
    this.play(name, a !== this.lastA && (a === 6 || a === 7 || a === 8));
    this.lastA = a;
    // guarda do x1: a pose de base do jab, parada
    if (this.action) this.action.paused = a === 8 && this.action.time > 0.12;

    // sentado ou pilotando: o quadril vai para a altura do assento (raiz = assento)
    const tpl = this.tpl;
    if (tpl && a === 5) {
      // raiz = assento − 0,14 (scene.ts): o quadril fica ~7 cm acima do assento (o bumbum apoiado em cima),
      // centrado sobre o lugar (a animação de sentar leva o quadril para trás)
      const p = this.bike ? tpl.drivePelvis : tpl.sitPelvis;
      this.model.position.set(0, (this.bike ? 0.1 : 0.21) - p.y * DOLL_SCALE, this.bike ? 0 : -p.z * DOLL_SCALE);
    } else this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    // o deslize do gunfight dura o tempo do movimento (o carrinho do futebol é mais curto)
    const swingMs = isSwing(a) ? (a === SWING_A.slide && this.gun ? MOVE.slideMs : SWING_MS[a]) : 0;
    const swingU = isSwing(a) && this.swingT >= 0 ? this.swingT / (swingMs / 1000) : -1;
    if (a === SWING_A.bump && swingU >= 0 && swingU < 1) this.model.position.y += bumpDip(swingU);
    if (tpl && a === SWING_A.slide) {
      // carrinho: o corpo deita para trás, quase no chão, com as pernas (da pose de sentado) à frente
      const k = swingU < 0 ? 1 : swingU > 0.85 ? 1 - seg(swingU, 0.85, 1) : ease(Math.min(1, swingU * 5));
      const th = -0.5 * k;
      // gira em volta do quadril (que fica a ~20 cm do chão)
      const py = tpl.sitPelvis.y * DOLL_SCALE;
      const pz = tpl.sitPelvis.z * DOLL_SCALE;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      this.model.rotation.x = th;
      this.model.position.set(0, 0.2 - py + (py - (py * c - pz * sn)), -pz + (pz - (py * sn + pz * c)));
    }
    if (a === SWING_A.bike && swingU >= 0 && swingU < 1) {
      // bicicleta: o corpo gira para trás em volta do quadril até ficar de costas no ar, e volta
      const th = -(swingU < 0.55 ? ease(seg(swingU, 0, 0.55)) : 1 - ease(seg(swingU, 0.55, 1))) * 2.3;
      const h = 0.62;
      this.model.rotation.x = th;
      this.model.position.set(0, h - h * Math.cos(th), -h * Math.sin(th));
    }
    if (a === SWING_A.elastico && swingU >= 0 && swingU < 1) {
      // elástico: o corpo pende para fora e volta (o pé leva a bola)
      this.model.rotation.z = Math.sin(swingU * Math.PI) * 0.28;
    }

    // velocidade no chão (suavizada)
    if (dt > 0) {
      const v = Math.hypot(pos.x - this.lastX, pos.z - this.lastZ) / dt;
      this.speed += (Math.min(v, 12) - this.speed) * Math.min(1, dt * 8);
    }
    this.lastX = pos.x;
    this.lastZ = pos.z;
    // pernas no ritmo do deslocamento
    const g = this.tpl?.gait[name];
    if (this.action && g) this.action.timeScale = Math.max(0.5, Math.min(2.4, this.speed / g));

    this.mixer?.update(dt);
    if (isSwing(a) && swingU >= 0 && swingU < 1) this.swingPose(a, swingU);
    if (a === 4) this.wave(t);
    if (this.hold && a !== 5 && a < 6) this.reach(this.hold, this.holdBoth);
    // morto (ou caído): a arma some junto, não fica flutuando no lugar
    if (this.gun) this.gun.root.visible = this.gunPose.alive && a !== 9;
    if (this.gun && a !== 9) {
      if (this.gunPose.crouch && a !== 15) {
        this.model.position.y -= 0.26;
        this.crouchPose();
      }
      // o tronco (levar tiro, coice) antes das mãos: a arma vai junto com o ombro e as mãos não soltam dela
      this.leanPose();
      this.holdGun(a === SWING_A.slide, realDt, a === 2);
    } else if (this.hands) {
      // sem nada na mão: dedos relaxados (no soco do x1, fechados)
      const fist = a >= 6 && a <= 8;
      this.hands.r.setCurl(fist ? 1 : 0.18, fist ? 0.9 : 0.15);
      this.hands.l.setCurl(fist ? 1 : 0.18, fist ? 0.9 : 0.15);
    }
    this.faceUpdate(dt, t);
  }

  /**
   * Pose do golpe (u = 0…1 do golpe), no espaço do boneco: +z frente, +x esquerda dele, +y cima. Cada osso gira para
   * a direção da pose, misturado com a animação pelo peso `w` (entra rápido, sai suave).
   */
  private swingPose(a: SwingA, u: number) {
    const doll = this.doll;
    const B = this.bones;
    if (!doll) return;
    doll.updateMatrixWorld(true);
    doll.getWorldQuaternion(DQ);
    if (a === SWING_A.slide) {
      // perna direita esticada à frente, rente ao chão (a esquerda dobrada embaixo); braços para trás apoiando
      const w = 1;
      if (B.thigh_r && B.calf_r) aimBlend(B.thigh_r, B.calf_r, dirIn(0, -0.2, 1), w);
      if (B.calf_r && B.foot_r) aimBlend(B.calf_r, B.foot_r, dirIn(0, -0.15, 1), w);
      if (B.thigh_l && B.calf_l) aimBlend(B.thigh_l, B.calf_l, dirIn(0.1, -0.35, 0.9), w);
      if (B.calf_l && B.foot_l) aimBlend(B.calf_l, B.foot_l, dirIn(0.1, -0.6, -0.2), w);
      if (B.upperarm_l && B.lowerarm_l) aimBlend(B.upperarm_l, B.lowerarm_l, dirIn(0.5, -0.6, -0.6), w);
      if (B.upperarm_r && B.lowerarm_r) aimBlend(B.upperarm_r, B.lowerarm_r, dirIn(-0.5, -0.6, -0.6), w);
      return;
    }
    if (a === SWING_A.bike) {
      // bicicleta: a perna direita chuta para cima e por cima da cabeça no meio do giro
      const w = u < 0.85 ? 1 : 1 - seg(u, 0.85, 1);
      const th = u < 0.3 ? lerp(0, -0.4, seg(u, 0, 0.3)) : u < 0.55 ? lerp(-0.4, 2.3, ease(seg(u, 0.3, 0.55))) : 2.3;
      if (B.thigh_r && B.calf_r) aimBlend(B.thigh_r, B.calf_r, dirIn(0, -Math.cos(th), Math.sin(th)), w);
      if (B.calf_r && B.foot_r) aimBlend(B.calf_r, B.foot_r, dirIn(0, -Math.cos(th), Math.sin(th)), w);
      if (B.upperarm_l && B.lowerarm_l) aimBlend(B.upperarm_l, B.lowerarm_l, dirIn(0.8, -0.2, -0.3), w);
      if (B.upperarm_r && B.lowerarm_r) aimBlend(B.upperarm_r, B.lowerarm_r, dirIn(-0.8, -0.2, -0.3), w);
      return;
    }
    if (a === SWING_A.elastico) {
      // elástico: a perna direita abre para fora e volta para dentro levando a bola
      const w = u < 0.85 ? 1 : 1 - seg(u, 0.85, 1);
      const out = Math.sin(u * Math.PI);
      if (B.thigh_r && B.calf_r) aimBlend(B.thigh_r, B.calf_r, dirIn(-0.6 * out, -0.9, 0.3), w);
      if (B.calf_r && B.foot_r) aimBlend(B.calf_r, B.foot_r, dirIn(-0.7 * out, -0.85, 0.35), w);
      return;
    }
    if (a === SWING_A.kick) {
      // perna direita: puxa para trás dobrando o joelho, chuta para a frente esticada, volta
      const w = u < 0.8 ? 1 : 1 - seg(u, 0.8, 1);
      const th =
        u < 0.25
          ? -0.7 * ease(seg(u, 0, 0.25))
          : u < 0.42
            ? lerp(-0.7, 1.4, ease(seg(u, 0.25, 0.42)))
            : lerp(1.4, 0, ease(seg(u, 0.42, 1)));
      const knee = u < 0.25 ? 1.3 * ease(seg(u, 0, 0.25)) : u < 0.42 ? lerp(1.3, 0, seg(u, 0.25, 0.42)) : 0;
      if (B.thigh_r && B.calf_r) aimBlend(B.thigh_r, B.calf_r, dirIn(0, -Math.cos(th), Math.sin(th)), w);
      if (B.calf_r && B.foot_r) aimBlend(B.calf_r, B.foot_r, dirIn(0, -Math.cos(th - knee), Math.sin(th - knee)), w);
      // braços abertos para o equilíbrio
      if (B.upperarm_l && B.lowerarm_l) aimBlend(B.upperarm_l, B.lowerarm_l, dirIn(0.45, -0.7, 0.5), w * 0.7);
      if (B.upperarm_r && B.lowerarm_r) aimBlend(B.upperarm_r, B.lowerarm_r, dirIn(-0.5, -0.75, -0.4), w * 0.7);
      return;
    }
    if (a === SWING_A.forehand || a === SWING_A.backhand) {
      // raquete na mão direita: o braço varre de trás para a frente (forehand pela direita, backhand pela esquerda),
      // com o tronco girando junto
      const fore = a === SWING_A.forehand;
      const w = u < 0.12 ? ease(seg(u, 0, 0.12)) : u < 0.75 ? 1 : 1 - ease(seg(u, 0.75, 1));
      const back = fore ? 2 : -1.75;
      const end = fore ? -1.3 : 1.4;
      const ph =
        u < 0.3
          ? lerp(back * 0.55, back, ease(seg(u, 0, 0.3)))
          : u < 0.55
            ? lerp(back, end, ease(seg(u, 0.3, 0.55)))
            : end;
      const el = u < 0.3 ? 0.15 : u < 0.55 ? lerp(0.15, -0.05, seg(u, 0.3, 0.42)) : lerp(-0.05, 0.5, seg(u, 0.55, 1));
      const twist =
        (u < 0.3
          ? fore
            ? -0.45
            : 0.45
          : u < 0.55
            ? lerp(fore ? -0.45 : 0.45, fore ? 0.5 : -0.5, seg(u, 0.3, 0.55))
            : fore
              ? 0.5
              : -0.5) * w;
      if (B.spine_02) twistBone(B.spine_02, twist * 0.5);
      if (B.spine_03) twistBone(B.spine_03, twist * 0.5);
      // direção do braço: ângulo `ph` a partir da frente, para a direita dele (−x) quando positivo
      const ce = Math.cos(el);
      const dx = -Math.sin(ph) * ce;
      const dy = Math.sin(el);
      const dz = Math.cos(ph) * ce;
      if (B.upperarm_r && B.lowerarm_r) aimBlend(B.upperarm_r, B.lowerarm_r, dirIn(dx, dy - 0.25, dz), w);
      if (B.lowerarm_r && B.hand_r) aimBlend(B.lowerarm_r, B.hand_r, dirIn(dx, dy, dz), w);
      // braço livre à frente, para o equilíbrio
      if (B.upperarm_l && B.lowerarm_l) aimBlend(B.upperarm_l, B.lowerarm_l, dirIn(0.4, -0.55, 0.6), w * 0.6);
      return;
    }
    // manchete: braços juntos, esticados à frente e baixos; desce (dobra as pernas) e sobe empurrando a bola
    const w = u < 0.15 ? ease(seg(u, 0, 0.15)) : u < 0.7 ? 1 : 1 - ease(seg(u, 0.7, 1));
    const lift = u < 0.35 ? 0 : u < 0.55 ? ease(seg(u, 0.35, 0.55)) : 1 - seg(u, 0.55, 1) * 0.5;
    const ey = lerp(-0.78, -0.25, lift);
    const ez = lerp(0.62, 0.95, lift);
    for (const sd of ['l', 'r'] as const) {
      const sx = sd === 'l' ? 1 : -1;
      const up = B[`upperarm_${sd}`];
      const low = B[`lowerarm_${sd}`];
      const hand = B[`hand_${sd}`];
      if (up && low) aimBlend(up, low, dirIn(sx * 0.12, ey, ez), w);
      // antebraços se juntam na frente (as mãos se encontram)
      if (low && hand) aimBlend(low, hand, dirIn(-sx * 0.22, ey, ez), w);
    }
  }

  /** aceno: braço direito para o alto, antebraço balançando (por cima da animação de parado) */
  private wave(t: number) {
    const doll = this.doll;
    const { upperarm_r: up, lowerarm_r: low, hand_r: hand } = this.bones;
    if (!doll || !up || !low || !hand) return;
    doll.updateMatrixWorld(true);
    doll.getWorldQuaternion(DQ);
    aim(up, low, dirIn(-0.55, 0.83, 0.08));
    aim(low, hand, dirIn(Math.sin(t * 10) * 0.45, 1, 0.1));
  }

  /** braços até a bola (por cima da animação) */
  private reach(target: THREE.Vector3, both: boolean) {
    const doll = this.doll;
    if (!doll) return;
    doll.updateMatrixWorld(true);
    doll.getWorldQuaternion(DQ);
    for (const sd of both ? (['l', 'r'] as const) : (['r'] as const)) {
      const up = this.bones[`upperarm_${sd}`];
      const low = this.bones[`lowerarm_${sd}`];
      const hand = this.bones[`hand_${sd}`];
      if (!up || !low || !hand) continue;
      // a mão vai para o lado da bola (as duas mãos em volta dela)
      const off = (sd === 'l' ? 0.11 : -0.11) * (both ? 1 : 0.3);
      const goal = R_GOAL.set(off, 0, 0).applyQuaternion(DQ).add(target);
      const dir = up.getWorldPosition(R_DIR).negate().add(goal);
      const len = dir.length();
      dir.normalize();
      // braço reto se a bola está longe; dobra no cotovelo se está perto
      const reachLen = 0.55 * DOLL_SCALE * 1.0;
      const bend = Math.acos(Math.min(1, len / reachLen)) * 0.9;
      R_AXIS.crossVectors(dir, DOWN).normalize();
      aim(up, low, dir.applyAxisAngle(R_AXIS, -bend));
      aim(low, hand, low.getWorldPosition(R_DIR).negate().add(goal));
    }
  }

  private faceUpdate(dt: number, t: number) {
    const f = this.face;
    if (!f) return;
    // piscar de tempos em tempos (no nocaute, olhos fechados)
    this.blinkIn -= dt;
    const closed = this.target.a === 9 || (this.blinkIn < 0.12 && this.blinkIn > 0);
    for (const e of f.eyes) e.scale.y = closed ? 0.12 : 1;
    if (this.blinkIn <= 0) this.blinkIn = 2 + Math.random() * 4;
    // boca: o volume da voz; sem volume medido, um ritmo de fala enquanto o anel está aceso
    let want = 0;
    if (this.speaking) {
      if (this.level > 0.01) want = Math.min(1, 0.25 + this.level * 2.2);
      else {
        const s = t * 9 + this.talkSeed;
        want = Math.max(0, Math.sin(s) * 0.6 + Math.sin(s * 2.3) * 0.4) * 0.9;
      }
    }
    this.mouthOpen += (want - this.mouthOpen) * Math.min(1, dt * 18);
    const o = this.mouthOpen;
    f.lip.scale.set(0.034 - o * 0.008, 0.006 + o * 0.016, 0.012);
    f.inner.scale.set(0.028 - o * 0.008, 0.004 + o * 0.016, 0.011);
  }

  /** roda `fn` com o boneco na pose de referência (para prender objetos aos ossos na orientação certa) */
  private inBindPose(fn: () => void) {
    const doll = this.doll;
    if (!doll) return;
    const saved: [THREE.Object3D, THREE.Quaternion, THREE.Vector3][] = [];
    doll.traverse((o) => {
      if (o instanceof THREE.Bone) saved.push([o, o.quaternion.clone(), o.position.clone()]);
    });
    let skel: THREE.Skeleton | null = null;
    doll.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skel = o.skeleton;
    });
    (skel as THREE.Skeleton | null)?.pose();
    const rot = this.root.rotation.y;
    this.root.rotation.y = 0;
    this.root.updateMatrixWorld(true);
    fn();
    this.root.rotation.y = rot;
    for (const [b, q, p] of saved) {
      b.quaternion.copy(q);
      b.position.copy(p);
    }
    this.root.updateMatrixWorld(true);
  }

  /**
   * Prende a mão ao osso da mão, com os dedos seguindo o antebraço e a palma virada para o corpo (pose de referência).
   * A mão é de tamanho real; o boneco é menor, então ela vai na mesma escala dele.
   */
  private attachHand(doll: THREE.Object3D, sd: 'l' | 'r', h: Hand) {
    const hand = doll.getObjectByName(`hand_${sd}`);
    const low = doll.getObjectByName(`lowerarm_${sd}`);
    if (!hand || !low) return;
    this.root.updateMatrixWorld(true);
    const hp = hand.getWorldPosition(new THREE.Vector3());
    const f = hp.clone().sub(low.getWorldPosition(new THREE.Vector3())).normalize();
    // a palma olha para o corpo: a mão direita (−x do boneco) para +x, a esquerda para −x
    const palm = new THREE.Vector3(sd === 'r' ? 1 : -1, 0, 0).applyQuaternion(
      doll.getWorldQuaternion(new THREE.Quaternion()),
    );
    const z = f.clone().negate();
    const y = palm.clone().negate();
    y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const parentQ = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    h.root.quaternion.copy(parentQ.multiply(world));
    const s = hand.getWorldScale(new THREE.Vector3()).x;
    // a mão do arquivo é de adulto de 1,88 m; no mundo ela fica na escala do boneco
    // boneco de massinha: mão um pouco mais cheia que a de gente
    h.root.scale.setScalar((DOLL_SCALE * 1.35 * this.root.getWorldScale(new THREE.Vector3()).x) / (s || 1));
    // o pulso sai da ponta arredondada do braço (senão a palma fica dentro dela)
    h.root.position.set(0, 0, 0);
    h.root.translateZ(-0.075 / (s || 1));
    hand.add(h.root);
    h.setCurl(0.35, 0.3);
  }

  /** gunfight: a arma na mão (null = sem arma) */
  setGun(id: GunId | null) {
    if (id === this.gunId && (this.gun || !id)) return;
    if (this.gun) disposeGun(this.gun);
    this.gun = null;
    this.gunId = id;
    if (!id || !gunsReady()) return;
    const g = makeGun(id);
    if (!g) return;
    g.root.scale.setScalar(gunScale(id));
    // na escala do boneco a sombra da arma não aparece, mas cada luz com sombra a desenharia de novo
    g.root.traverse((o) => (o.castShadow = false));
    this.root.add(g.root);
    this.gun = g;
  }

  setGunPose(p: GunHold) {
    this.gunPose = p;
    if (!!p.prot !== this.ghost) {
      this.ghost = !!p.prot;
      this.skin.transparent = this.ghost;
      this.skin.opacity = this.ghost ? 0.45 : 1;
      this.skin.needsUpdate = true;
    }
    // ação nova (o contador mudou): toca no boneco. A primeira pose que chega só marca (não repete o passado)
    if (p.an === undefined || p.an === this.lastAn) return;
    const first = this.lastAn === null;
    this.lastAn = p.an;
    if (first || !p.act || !this.gunId) return;
    const spec = GUNS[this.gunId];
    const s =
      p.act === 'reload'
        ? spec.reloadMs / 1000
        : p.act === 'bolt'
          ? Math.max(0.3, (spec.boltMs ?? 600) / 1000 - 0.12)
          : p.act === 'melee'
            ? (spec.melee?.ms ?? 500) / 1000
            : p.act === 'inspect'
              ? spec.cls === 'knife'
                ? 2
                : 2.4
              : 0.5;
    this.gunAct = { kind: p.act, t: 0, s };
  }

  /**
   * A arma em terceira pessoa, apontada pela mira. Fuzil, submetralhadora e sniper com a coronha no ombro direito e o
   * cano para a frente (aparece por trás, na visão por cima do ombro); mirando, sobe para o rosto. Pistola esticada à
   * frente, faca na mão baixa. Deslizando, a arma vai junto com o corpo deitado. Os braços chegam às pegadas (as mesmas
   * da primeira pessoa) por IK de dois ossos, e a mão gira para a pegada.
   */
  private holdGun(slide: boolean, dt: number, running: boolean) {
    const g = this.gun;
    const id = this.gunId;
    if (!g || !id) return;
    const p = this.gunPose;
    if (!p.alive) return;
    const spec = GUNS[id];
    const knife = spec.cls === 'knife';
    const pistol = spec.cls === 'pistol';
    // faca não mira (o botão direito dela é o golpe pesado): sem o braço esticado como se apontasse
    const ads = p.ads && !knife;
    this.pitchShown =
      this.pitchShown === null ? p.pitch : this.pitchShown + (p.pitch - this.pitchShown) * (1 - Math.exp(-dt * 15));
    const pitch = this.pitchShown;
    const crouch = p.crouch && !slide ? -0.26 : 0;
    // a ação da mão (os outros veem): recarga inclina e baixa a arma (a mão esquerda vai ao pente), golpe empurra (a
    // faca corta de lado), ferrolho baixa um pouco (a mão direita vai à alavanca), sacar vem de baixo; e o coice
    const act = this.gunAct;
    const u = act ? Math.min(1, act.t / act.s) : 0;
    const w = act ? hump01(u) : 0;
    // mirando com a coronha no ombro, o corpo segura o coice (a pistola, esticada, pula igual)
    const kick = Math.max(0, this.kick.x) * (ads && !pistol && !knife ? TP_KICK_ADS : 1);
    const vk = spec.recoil.vm;
    const reload = act?.kind === 'reload' ? w : 0;
    const melee = act?.kind === 'melee' ? w : 0;
    const bolt = act?.kind === 'bolt' ? w : 0;
    const draw = act?.kind === 'draw' ? 1 - ease(u) : 0;
    const inspect = act?.kind === 'inspect' ? w : 0;
    // correndo (sem mirar): o cano desce e vira para dentro, a mão esquerda solta (quem vê sabe que não dá para atirar)
    this.runW += ((running && !ads && !knife ? 1 : 0) - this.runW) * Math.min(1, dt * 8);
    const run = this.runW;
    // no quadril o cano desce um pouco e vira para dentro (de trás, aparece ao lado do corpo); mirando, reto. A boca
    // fica em −z: x positivo levanta o cano (o coice levanta; o sacar vem com o cano para baixo)
    const hipYaw = knife || pistol ? 0.06 : 0;
    // o coice do boneco é o da 1ª pessoa, maior (de longe tem que se ler): a Desert Eagle pula, o fuzil treme
    g.root.rotation.set(
      -pitch -
        (ads || knife ? 0 : pistol ? 0.18 : 0.15) +
        reload * 0.35 +
        bolt * 0.12 -
        draw * 0.9 +
        kick * vk.rise * TP_KICK +
        this.leanA -
        (knife ? melee * 0.6 : 0) -
        run * 0.6,
      Math.PI + (ads ? 0 : hipYaw) + (knife ? melee * 0.9 : 0) + run * 0.4,
      reload * 0.5 + (knife ? 0 : melee * 0.4) + inspect * 0.6,
      'YXZ',
    );
    if (knife || pistol) {
      // na frente do corpo: faca baixa, pistola esticada (mirando, na altura dos olhos)
      const y = (ads ? 0.98 : knife ? 0.72 : 0.84) + crouch;
      g.root.position.set(ads ? -0.06 : -0.1, y, ads ? 0.4 : knife ? 0.14 : 0.28);
    } else {
      // coronha encostada no ombro direito (que fica em ~(−0,12, 0,99, −0,09)): a origem (punho) fica à frente dela pelo
      // comprimento da coronha; a arma na escala do braço do boneco (curto), para a mão de apoio chegar ao guarda-mão
      G_Q.setFromEuler(g.root.rotation);
      // coronha curta (MP7) com um mínimo: senão a arma fica longe do corpo e os braços esticam
      const back = Math.max(0.28, g.length + g.muzzle.z);
      G_OFF.set(0, 0.035, back).multiplyScalar(gunScale(id)).applyQuaternion(G_Q);
      if (ads) SHOULDER_PT.set(-0.08, 0.96 + crouch, -0.04);
      else SHOULDER_PT.set(-0.1, 0.92 + crouch, -0.03);
      g.root.position.copy(SHOULDER_PT).sub(G_OFF);
    }
    // o tronco recuou ou levou tiro: a arma vai junto com o ombro
    g.root.position.add(this.leanD);
    // recarga baixa a arma; golpe empurra para a frente; coice para trás; sacar vem de baixo
    g.root.position.y += -reload * 0.06 - draw * 0.22;
    g.root.position.z += melee * 0.16 - kick * vk.back * TP_KICK_BACK;
    if (slide) {
      // presa ao corpo inclinado do deslize
      g.root.position.applyEuler(this.model.rotation).add(this.model.position);
      g.root.quaternion.premultiply(G_Q.setFromEuler(this.model.rotation));
    }
    g.root.updateMatrixWorld(true);
    g.root.getWorldQuaternion(G_WQ);
    // mão direita no punho; a esquerda no guarda-mão (ou envolvendo a direita, na pistola)
    const rg = rightGrip(g, spec.cls);
    // ferrolho: a mão direita sobe e vai para trás, até a alavanca
    G_R.copy(rg.pos).add(G_AN.set(0.02, 0.05, 0.04).multiplyScalar(bolt));
    this.reachTo('r', g.root.localToWorld(G_R), G_HQ.copy(G_WQ).multiply(rg.quat));
    // o indicador no gatilho; recarregando ou no ferrolho, esticado fora dele
    const off = Math.max(reload, bolt);
    this.hands?.r.setCurl(rg.curl[0] - bolt * 0.3, rg.curl[1], knife ? rg.curl[2] : lerp(rg.curl[2], TRIGGER_OFF, off));
    if (!knife && run < 0.5) {
      const lg = leftGrip(g, spec.cls);
      // recarga: a mão esquerda desce até o pente (embaixo do punho) e volta
      G_L.copy(lg.pos).lerp(G_AN.set(-0.04, -0.12, 0.02), reload);
      G_HQ.copy(G_WQ).multiply(lg.quat);
      g.root.localToWorld(G_L);
      // o braço do boneco é curto: se o apoio fica longe do ombro, a mão escorrega pelo cano em direção ao punho até
      // alcançar (senão a IK estica e a mão fica aberta no ar, longe da arma)
      this.pullInReach('l', G_L, g.root.localToWorld(G_M.copy(rg.pos)), G_HQ);
      this.reachTo('l', G_L, G_HQ);
      this.hands?.l.setCurl(lg.curl[0] - reload * 0.2, lg.curl[1], lg.curl[2] - reload * 0.2);
    } else this.hands?.l.setCurl(0.35, 0.3);
  }

  /**
   * Traz `wrist` (mundo) pela reta até `toward` até o ombro alcançar com folga (≤ 95% do braço esticado), contando o
   * recuo do osso da mão que o `reachTo` soma.
   */
  private pullInReach(sd: 'l' | 'r', wrist: THREE.Vector3, toward: THREE.Vector3, handQ: THREE.Quaternion) {
    const up = this.bones[`upperarm_${sd}`];
    const [l1, l2] = this.armLen[sd];
    if (!up || !(l1 > 0 && l2 > 0)) return;
    const reach = 0.95 * (l1 + l2);
    const sh = up.getWorldPosition(R_SH);
    const back = R_BACK.set(0, 0, HAND_OFFSET).applyQuaternion(handQ);
    const far = (t: number) => R_GOAL2.copy(wrist).lerp(toward, t).add(back).distanceTo(sh) > reach;
    if (!far(0)) return;
    // busca binária em [0, 1] (a distância ao ombro cai ao longo da reta até o punho)
    // no máximo até a metade do caminho (no pior caso a mão para no pente, nunca em cima da direita)
    let lo = 0;
    let hi = PULL_MAX;
    if (far(hi)) {
      wrist.lerp(toward, hi);
      return;
    }
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (far(mid)) lo = mid;
      else hi = mid;
    }
    wrist.lerp(toward, hi);
  }

  /**
   * IK de dois ossos: o pulso de um lado vai até `wrist` (mundo). Cotovelo pela lei dos cossenos com os comprimentos
   * medidos no boneco, dobrando para baixo e para fora. Com `handQ`, a mão (a `Hand`) gira para esse giro no mundo.
   */
  private reachTo(sd: 'l' | 'r', wrist: THREE.Vector3, handQ: THREE.Quaternion | null) {
    const up = this.bones[`upperarm_${sd}`];
    const low = this.bones[`lowerarm_${sd}`];
    const hand = this.bones[`hand_${sd}`];
    const h = this.hands?.[sd];
    if (!up || !low || !hand) return;
    const [l1, l2] = this.armLen[sd];
    if (!(l1 > 0 && l2 > 0)) return;
    // o osso da mão fica atrás do pulso da `Hand` (ela sai da ponta do braço, ver attachHand)
    const goal = R_GOAL2.copy(wrist);
    if (handQ) goal.add(R_BACK.set(0, 0, HAND_OFFSET).applyQuaternion(handQ));
    const sh = up.getWorldPosition(R_SH);
    const dir = R_DIR.copy(goal).sub(sh);
    const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, dir.length()));
    dir.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    // polo: para baixo, para fora do lado do braço e um pouco para trás (espaço do boneco: +x esquerda, +z frente)
    const doll = this.doll;
    if (doll) doll.getWorldQuaternion(DQ);
    R_AXIS.set(sd === 'l' ? 0.6 : -0.6, -1, -0.25).applyQuaternion(DQ);
    R_AXIS.addScaledVector(dir, -R_AXIS.dot(dir)).normalize();
    const elbow = R_ELBOW.copy(sh).addScaledVector(dir, along).addScaledVector(R_AXIS, hgt);
    aim(up, low, R_DIR.copy(elbow).sub(sh));
    aim(low, hand, low.getWorldPosition(R_DIR).negate().add(goal));
    if (handQ && h) {
      // mundo do osso = giro da mão × (giro da Hand no osso)⁻¹; no pai: pai⁻¹ × mundo
      QTARGET.copy(handQ).multiply(QSAVE.copy(h.root.quaternion).invert());
      if (hand.parent) hand.parent.getWorldQuaternion(QPARENT);
      else QPARENT.identity();
      hand.quaternion.copy(QPARENT.invert().multiply(QTARGET));
      hand.updateMatrixWorld(true);
    }
  }

  /**
   * O tronco: para trás ao levar tiro (tranco curto) e no coice da arma (o fuzil pouco, a sniper e a Desert Eagle mais),
   * e curvado pela mira (olhando para baixo, o peito desce junto com a arma; para cima, sobe), senão a arma ficava
   * pendurada de um tronco reto e a mão de apoio escorregava pelo cano. Gira a coluna (`spine_01`–`03`, um terço em
   * cada) e guarda quanto o ombro direito andou (`leanD`, espaço do boneco) e o giro do coice (`leanA`): a arma vai
   * junto (`holdGun` roda depois), e as mãos não saem dela.
   */
  private leanPose() {
    this.leanD.set(0, 0, 0);
    this.leanA = 0;
    const B = this.bones;
    const doll = this.doll;
    if (!doll || !B.spine_02 || !B.upperarm_r) return;
    const u = this.flinchT > 0 ? 1 - this.flinchT / FLINCH_S : 1;
    const body = this.gunId ? GUNS[this.gunId].recoil.body * Math.max(0, this.kick.x) : 0;
    const k = (this.flinchT > 0 ? Math.sin(Math.min(1, u) * Math.PI) * 0.22 : 0) + body;
    // a mira curva a coluna (pitch positivo = olhando para baixo = peito para a frente); faca não aponta
    const knife = !this.gunId || GUNS[this.gunId].cls === 'knife';
    const pitch = this.pitchShown ?? this.gunPose.pitch;
    const bend = knife ? 0 : Math.max(-AIM_BEND_MAX, Math.min(AIM_BEND_MAX, AIM_BEND * pitch));
    const total = k - bend;
    if (Math.abs(total) < 1e-4) return;
    this.root.updateMatrixWorld(true);
    this.root.worldToLocal(B.upperarm_r.getWorldPosition(LEAN0));
    doll.getWorldQuaternion(DQ);
    AXIS_UP.set(1, 0, 0).applyQuaternion(DQ);
    const spine = [B.spine_01, B.spine_02, B.spine_03].filter((b): b is THREE.Object3D => !!b);
    QROT.setFromAxisAngle(AXIS_UP, -total / spine.length);
    for (const b of spine) {
      b.getWorldQuaternion(QWORLD);
      if (b.parent) b.parent.getWorldQuaternion(QPARENT);
      else QPARENT.identity();
      b.quaternion.copy(QPARENT.invert().multiply(QWORLD.premultiply(QROT)));
      b.updateMatrixWorld(true);
    }
    this.root.worldToLocal(B.upperarm_r.getWorldPosition(this.leanD)).sub(LEAN0);
    this.leanA = k;
  }

  /** agachado: quadril desce, coxas para a frente, canelas para trás */
  private crouchPose() {
    const B = this.bones;
    for (const sd of ['l', 'r'] as const) {
      const sx = sd === 'l' ? 1 : -1;
      const th = B[`thigh_${sd}`];
      const ca = B[`calf_${sd}`];
      const ft = B[`foot_${sd}`];
      if (th && ca) aimBlend(th, ca, dirIn(sx * 0.18, -0.35, 0.92), 1);
      if (ca && ft) aimBlend(ca, ft, dirIn(0, -0.92, -0.38), 1);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.gun) disposeGun(this.gun);
    this.gun = null;
    // cada boneco tem o seu esqueleto (SkeletonUtils.clone): a textura dos ossos é dele e tem que ser liberada
    disposeSkeletons(this.root);
    this.hands?.r.dispose();
    this.hands?.l.dispose();
    this.mixer?.stopAllAction();
    if (this.doll) this.mixer?.uncacheRoot(this.doll);
    this.setTeam(null);
    this.setRacket(null);
    this.setBike(false);
    this.skin.dispose();
    for (const m of [this.ring, this.shadow]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.nameSprite.material.map?.dispose();
    this.nameSprite.material.dispose();
  }
}

/** prende `obj` (posição e orientação no espaço do boneco) ao osso, mantendo onde ele está */
function attachTo(bone: THREE.Object3D, obj: THREE.Object3D, doll: THREE.Object3D) {
  doll.updateMatrixWorld(true);
  const m = new THREE.Matrix4()
    .copy(bone.matrixWorld)
    .invert()
    .multiply(doll.matrixWorld)
    .multiply(new THREE.Matrix4().compose(obj.position, obj.quaternion, obj.scale));
  m.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

// temporários reaproveitados (as poses rodam a cada quadro em cada boneco: nada de alocar)
const PA = new THREE.Vector3();
const PB = new THREE.Vector3();
const DIR = new THREE.Vector3();
const AXIS_UP = new THREE.Vector3();
const QROT = new THREE.Quaternion();
const QWORLD = new THREE.Quaternion();
const QPARENT = new THREE.Quaternion();
const QSAVE = new THREE.Quaternion();
const QTARGET = new THREE.Quaternion();
/** orientação do boneco no mundo (preenchida no começo de cada pose) */
const DQ = new THREE.Quaternion();
const R_GOAL = new THREE.Vector3();
const R_DIR = new THREE.Vector3();
const R_AXIS = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** gira o osso `a` para que o filho `b` fique na direção `dir` (mundo) */
const G_R = new THREE.Vector3();
const R_SH = new THREE.Vector3();
const R_GOAL2 = new THREE.Vector3();
const R_BACK = new THREE.Vector3();
const G_L = new THREE.Vector3();
const G_OFF = new THREE.Vector3();
const G_M = new THREE.Vector3();
const G_Q = new THREE.Quaternion();
const G_WQ = new THREE.Quaternion();
const G_HQ = new THREE.Quaternion();
const SHOULDER_PT = new THREE.Vector3();
const R_ELBOW = new THREE.Vector3();
/** quanto a raiz da `Hand` fica à frente do osso da mão (m, ver attachHand) */
const HAND_OFFSET = 0.075;
/** duração do tranco de levar tiro (s) */
const FLINCH_S = 0.16;
const LEAN0 = new THREE.Vector3();
/** o coice do boneco em relação ao da 1ª pessoa (giro e recuo); mirando, com a coronha no ombro, `TP_KICK_ADS` disso */
const TP_KICK = 2;
const TP_KICK_BACK = 1.2;
const TP_KICK_ADS = 0.55;
/** a coluna curva com a mira (rad por rad de pitch, no total) até um limite */
const AIM_BEND = 0.6;
const AIM_BEND_MAX = 0.35;
/** a mão de apoio escorrega no máximo até aqui do caminho apoio → punho (`pullInReach`) */
const PULL_MAX = 0.5;
/** arma longa no boneco um pouco menor que a escala dele: o braço curto do boneco chega ao guarda-mão */
const LONG_GUN_SCALE = 0.86;
/** sniper (coronha e cano compridos): um pouco menor ainda, senão a mão de apoio ficava perto do punho no quadril */
const SNIPER_SCALE = 0.78;
function gunScale(id: GunId): number {
  const c = GUNS[id].cls;
  return DOLL_SCALE * (c === 'pistol' || c === 'knife' ? 1 : c === 'sniper' ? SNIPER_SCALE : LONG_GUN_SCALE);
}
const G_AN = new THREE.Vector3();
/** sobe no começo, fica, e desce no fim (0–1) */
const hump01 = (u: number) => ease(Math.min(1, u / 0.15)) * (1 - ease(Math.max(0, (u - 0.85) / 0.15)));

/** a pose da arma que o boneco recebe (a da rede, com a ação opcional) */
export interface GunHold {
  pitch: number;
  crouch: boolean;
  ads: boolean;
  alive: boolean;
  act?: GunAct;
  an?: number;
  /** acabou de nascer (protegido): o boneco fica meio transparente */
  prot?: boolean;
}

function aim(a: THREE.Object3D, b: THREE.Object3D, dir: THREE.Vector3) {
  a.getWorldPosition(PA);
  b.getWorldPosition(PB);
  const cur = PB.sub(PA).normalize();
  QROT.setFromUnitVectors(cur, PA.copy(dir).normalize());
  a.getWorldQuaternion(QWORLD);
  if (a.parent) a.parent.getWorldQuaternion(QPARENT);
  else QPARENT.identity();
  a.quaternion.copy(QPARENT.invert().multiply(QROT.multiply(QWORLD)));
  a.updateMatrixWorld(true);
}

/** como `aim`, misturado com a pose que a animação deu (`w` = 0 animação, 1 pose) */
function aimBlend(a: THREE.Object3D, b: THREE.Object3D, dir: THREE.Vector3, w: number) {
  if (w <= 0) return;
  QSAVE.copy(a.quaternion);
  aim(a, b, dir);
  if (w >= 1) return;
  QTARGET.copy(a.quaternion);
  a.quaternion.copy(QSAVE).slerp(QTARGET, w);
  a.updateMatrixWorld(true);
}

/** gira o osso em torno do eixo vertical do boneco (tronco virando) */
function twistBone(bone: THREE.Object3D, angle: number) {
  if (!angle) return;
  AXIS_UP.set(0, 1, 0).applyQuaternion(DQ);
  QROT.setFromAxisAngle(AXIS_UP, angle);
  bone.getWorldQuaternion(QWORLD);
  if (bone.parent) bone.parent.getWorldQuaternion(QPARENT);
  else QPARENT.identity();
  bone.quaternion.copy(QPARENT.invert().multiply(QROT.multiply(QWORLD)));
  bone.updateMatrixWorld(true);
}

/** direção no espaço do boneco (+z frente, +x esquerda dele) levada para o mundo (vetor reaproveitado) */
function dirIn(x: number, y: number, z: number): THREE.Vector3 {
  return DIR.set(x, y, z).normalize().applyQuaternion(DQ);
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (u: number) => u * u * (3 - 2 * u);
/** quanto de [a, b] já passou (0–1) */
const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
/** manchete: desce dobrando as pernas na antecipação e sobe um pouco no impacto (m) */
function bumpDip(u: number): number {
  if (u < 0.35) return -0.06 * ease(seg(u, 0, 0.35));
  if (u < 0.55) return lerp(-0.06, 0.03, ease(seg(u, 0.35, 0.55)));
  return lerp(0.03, 0, seg(u, 0.55, 1));
}

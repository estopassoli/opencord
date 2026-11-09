/**
 * Avatar do Espaço 3D (ADR-0055): boneco de massinha liso (doll.ts) animado pelas animações do esqueleto — parado,
 * conversando, andando, correndo, pulando, sentado, pilotando, socos, nocaute. Olhos que piscam sozinhos, boca que
 * abre com o volume da voz. Cor estável por pessoa; nome em cima; anel verde quando fala.
 */
import * as THREE from 'three';
import { bikeMesh } from './race';
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
  return sp;
}

/**
 * Golpes de esporte (estado `a` 10–13 na rede, plano 2026-11-09 P5): pose procedural por cima da animação de base,
 * com antecipação (puxa para trás), impacto e recuo. Os outros jogadores veem o mesmo golpe pelo `a`.
 */
export const SWING_A = { kick: 10, forehand: 11, backhand: 12, bump: 13 } as const;
export type SwingA = (typeof SWING_A)[keyof typeof SWING_A];
/** duração de cada golpe (ms) */
export const SWING_MS: Record<SwingA, number> = { 10: 340, 11: 380, 12: 380, 13: 360 };
const isSwing = (a: number): a is SwingA => a >= 10 && a <= 13;

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
  private skin: THREE.MeshStandardMaterial;
  private readonly ring: THREE.Mesh;
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

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
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
    const swingU = isSwing(a) && this.swingT >= 0 ? this.swingT / (SWING_MS[a] / 1000) : -1;
    if (a === SWING_A.bump && swingU >= 0 && swingU < 1) this.model.position.y += bumpDip(swingU);

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

  dispose() {
    this.disposed = true;
    this.mixer?.stopAllAction();
    if (this.doll) this.mixer?.uncacheRoot(this.doll);
    this.setTeam(null);
    this.setRacket(null);
    this.setBike(false);
    this.skin.dispose();
    for (const m of [this.ring]) {
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

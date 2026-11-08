/**
 * Avatar do Espaço 3D (ADR-0055): boneco de massinha liso (doll.ts) animado pelas animações do esqueleto — parado,
 * conversando, andando, correndo, pulando, sentado, pilotando, socos, nocaute. Olhos que piscam sozinhos, boca que
 * abre com o volume da voz, antena com a cor da pessoa. Cor estável por pessoa; nome em cima; anel verde quando fala.
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
    this.face = buildFace(doll, t.info, this.color);
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

  /** levou um golpe: encolhe e recua */
  hitReact() {
    this.hitT = 0.45;
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
    this.ring.visible = on;
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
    switch (a) {
      case 1:
        return 'Walk_Loop';
      case 2:
        return 'Jog_Fwd_Loop';
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

  update(dt: number, t: number) {
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
    const name = this.clipFor(a);
    // golpe repetido (mesmo estado de novo) recomeça a animação
    this.play(name, a !== this.lastA && (a === 6 || a === 7 || a === 8));
    this.lastA = a;
    // guarda do x1: a pose de base do jab, parada
    if (this.action) this.action.paused = a === 8 && this.action.time > 0.12;

    // sentado ou pilotando: o quadril vai para a altura do assento (raiz = assento)
    const tpl = this.tpl;
    if (tpl && a === 5) {
      const pelvis = this.bike ? tpl.drivePelvis : tpl.sitPelvis;
      this.model.position.y = (0.12 - pelvis) * DOLL_SCALE + (this.bike ? 0.02 : 0.06);
    } else this.model.position.y = 0;

    this.mixer?.update(dt);
    if (a === 4) this.wave(t);
    this.faceUpdate(dt, t);
  }

  /** aceno: braço direito para o alto, antebraço balançando (por cima da animação de parado) */
  private wave(t: number) {
    const doll = this.doll;
    const up = doll?.getObjectByName('upperarm_r');
    const low = doll?.getObjectByName('lowerarm_r');
    const hand = doll?.getObjectByName('hand_r');
    if (!doll || !up || !low || !hand) return;
    doll.updateMatrixWorld(true);
    aim(up, low, new THREE.Vector3(-0.55, 0.83, 0.08).applyQuaternion(doll.getWorldQuaternion(new THREE.Quaternion())));
    const side = new THREE.Vector3(Math.sin(t * 10) * 0.45, 1, 0.1)
      .normalize()
      .applyQuaternion(doll.getWorldQuaternion(new THREE.Quaternion()));
    aim(low, hand, side);
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
    this.face?.tip.geometry.dispose();
    (this.face?.tip.material as THREE.Material | undefined)?.dispose();
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

/** gira o osso `a` para que o filho `b` fique na direção `dir` (mundo) */
function aim(a: THREE.Object3D, b: THREE.Object3D, dir: THREE.Vector3) {
  const pa = a.getWorldPosition(new THREE.Vector3());
  const pb = b.getWorldPosition(new THREE.Vector3());
  const cur = pb.sub(pa).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  const world = a.getWorldQuaternion(new THREE.Quaternion());
  const parent = a.parent ? a.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  a.quaternion.copy(parent.invert().multiply(q.multiply(world)));
  a.updateMatrixWorld(true);
}

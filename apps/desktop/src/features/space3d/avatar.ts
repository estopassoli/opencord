/**
 * Avatar do Espaço 3D (ADR-0055): boneco original low poly — corpo de cápsula, rosto de tela com dois olhos que
 * piscam, antena, braços e pés que balançam ao andar. Cor estável por pessoa; nome em cima; anel verde quando fala.
 */
import * as THREE from 'three';
import { mat } from './models';

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

const FEET = 0.12;
const BODY_R = 0.32;
const BODY_LEN = 0.52;
export const AVATAR_HEIGHT = FEET + BODY_R * 2 + BODY_LEN;

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

export class Avatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly feet: THREE.Mesh[] = [];
  private readonly ring: THREE.Mesh;
  private nameSprite: THREE.Sprite;
  private phase = Math.random() * 10;
  private blinkIn = 2 + Math.random() * 3;
  private target: Pose = { x: 0, y: 0, z: 0, ry: 0, a: 0 };
  private ry = 0;

  constructor(
    readonly id: string,
    name: string,
    color = avatarColor(id),
  ) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_R, BODY_LEN, 3, 8), mat(color));
    body.position.y = FEET + BODY_R + BODY_LEN / 2;
    this.body.add(body);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.08), mat('#151821'));
    face.position.set(0, FEET + BODY_R + BODY_LEN * 0.82, BODY_R - 0.04);
    this.body.add(face);
    for (const x of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.02), mat('#e8fbff', { emissive: 0x9fdcff }));
      eye.position.set(x, face.position.y, face.position.z + 0.05);
      this.eyes.push(eye);
      this.body.add(eye);
    }
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 5), mat('#2b2e36'));
    stalk.position.set(0.08, AVATAR_HEIGHT + 0.08, -0.04);
    this.body.add(stalk);
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(color, { emissive: 0x222222 }));
    tip.position.set(0.08, AVATAR_HEIGHT + 0.2, -0.04);
    this.body.add(tip);

    for (const x of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 2, 6), mat(color));
      arm.geometry.translate(0, -0.13, 0);
      arm.position.set(x * (BODY_R + 0.05), FEET + BODY_R + BODY_LEN * 0.55, 0);
      arm.rotation.z = x * 0.18;
      this.arms.push(arm);
      this.body.add(arm);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, FEET, 0.24), mat('#2b2e36'));
      foot.position.set(x * 0.13, FEET / 2, 0.03);
      this.feet.push(foot);
      this.root.add(foot);
    }
    this.root.add(this.body);

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
    this.nameSprite.position.y = AVATAR_HEIGHT + 0.5;
    this.root.add(this.nameSprite);
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

  setSpeaking(on: boolean) {
    this.ring.visible = on;
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

    const a = this.target.a;
    const moving = a === 1 || a === 2;
    this.phase += dt * (a === 2 ? 14 : 9) * (moving ? 1 : 0);
    const s = moving ? Math.sin(this.phase) : 0;
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.06 : Math.sin(t * 1.6) * 0.01;
    this.body.rotation.z = s * 0.05;
    this.feet[0]!.position.z = 0.03 + s * 0.14;
    this.feet[1]!.position.z = 0.03 - s * 0.14;
    this.feet[0]!.position.y = FEET / 2 + Math.max(0, s) * 0.06;
    this.feet[1]!.position.y = FEET / 2 + Math.max(0, -s) * 0.06;
    this.arms[0]!.rotation.x = -s * 0.7;
    if (a === 4) {
      // acenando com o braço direito
      this.arms[1]!.rotation.x = 0;
      this.arms[1]!.rotation.z = 2.5 + Math.sin(t * 12) * 0.35;
    } else {
      this.arms[1]!.rotation.x = s * 0.7;
      this.arms[1]!.rotation.z = 0.18;
    }

    this.blinkIn -= dt;
    const blink = this.blinkIn < 0.12 && this.blinkIn > 0;
    for (const e of this.eyes) e.scale.y = blink ? 0.15 : 1;
    if (this.blinkIn <= 0) this.blinkIn = 2 + Math.random() * 4;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.nameSprite.material.map?.dispose();
    this.nameSprite.material.dispose();
  }
}

/**
 * Efeitos do tiro no mundo (gunfight): traçantes e clarões da boca da arma, em pools fixos (nada de geometria nova por
 * bala). O traçante é um traço curto, fino e aditivo, virado para a câmera, que anda da boca até o impacto em ~2
 * quadros; o clarão é um sprite aditivo de ~40 ms na boca da arma de quem atirou (bots, os outros e eu em 3ª pessoa —
 * na 1ª pessoa o clarão é o do viewmodel).
 */
import * as THREE from 'three';
import type { V3 } from './weapons';

/** quantos traçantes e clarões podem estar na tela ao mesmo tempo (o mais velho é reaproveitado) */
const TRACERS = 32;
const FLASHES = 12;
/** velocidade aparente da bala (m/s), comprimento do traço (m) e duração mínima (ms) */
const SPEED = 650;
const LEN = 2.6;
const MIN_MS = 34;
const FLASH_MS = 40;

interface TracerSlot {
  mesh: THREE.Mesh;
  a: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  start: number;
  ms: number;
  on: boolean;
}

interface FlashSlot {
  sprite: THREE.Sprite;
  until: number;
}

const HEAD = new THREE.Vector3();
const TAIL = new THREE.Vector3();
const MID = new THREE.Vector3();
const TO_CAM = new THREE.Vector3();
const AX = new THREE.Vector3();
const AY = new THREE.Vector3();
const BASIS = new THREE.Matrix4();

export class GunFx {
  private readonly tracers: TracerSlot[] = [];
  private readonly flashes: FlashSlot[] = [];
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffd890,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly flashMat: THREE.SpriteMaterial;
  private nextTracer = 0;
  private nextFlash = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.flashMat = new THREE.SpriteMaterial({
      map: flashTexture(),
      color: 0xffd8a0,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /** um traçante de `a` até `b` */
  tracer(a: V3, b: V3, now: number) {
    let s = this.tracers[this.nextTracer];
    if (!s) {
      const mesh = new THREE.Mesh(this.geo, this.tracerMat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.scene.add(mesh);
      s = { mesh, a: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, start: 0, ms: 0, on: false };
      this.tracers[this.nextTracer] = s;
    }
    this.nextTracer = (this.nextTracer + 1) % TRACERS;
    s.a.set(a.x, a.y, a.z);
    s.dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
    s.dist = s.dir.length();
    if (s.dist < 0.05) return;
    s.dir.divideScalar(s.dist);
    s.start = now;
    s.ms = Math.max(MIN_MS, (s.dist / SPEED) * 1000);
    s.on = true;
  }

  /** clarão da boca da arma em `at` */
  flash(at: V3, now: number, size = 0.32) {
    let s = this.flashes[this.nextFlash];
    if (!s) {
      const sprite = new THREE.Sprite(this.flashMat);
      sprite.visible = false;
      this.scene.add(sprite);
      s = { sprite, until: 0 };
      this.flashes[this.nextFlash] = s;
    }
    this.nextFlash = (this.nextFlash + 1) % FLASHES;
    s.sprite.position.set(at.x, at.y, at.z);
    s.sprite.scale.setScalar(size * (0.85 + Math.random() * 0.3));
    s.sprite.material.rotation = Math.random() * Math.PI;
    s.sprite.visible = true;
    s.until = now + FLASH_MS;
  }

  /** anda os traçantes (virados para a câmera) e apaga o que acabou */
  update(now: number, cam: THREE.Vector3) {
    for (const s of this.tracers) {
      if (!s.on) continue;
      const u = (now - s.start) / s.ms;
      if (u >= 1 || u < 0) {
        s.on = false;
        s.mesh.visible = false;
        continue;
      }
      // a cabeça vai da boca ao impacto; a cauda vem atrás (presa à boca no começo)
      const head = s.dist * Math.min(1, u * 1.15 + 0.08);
      const tail = Math.max(0, head - Math.min(LEN, s.dist * 0.45));
      HEAD.copy(s.a).addScaledVector(s.dir, head);
      TAIL.copy(s.a).addScaledVector(s.dir, tail);
      const len = head - tail;
      if (len < 1e-3) {
        s.mesh.visible = false;
        continue;
      }
      MID.addVectors(HEAD, TAIL).multiplyScalar(0.5);
      // o plano (normal em y) olha para a câmera girando em volta do eixo do traço (z)
      TO_CAM.copy(cam).sub(MID);
      AY.copy(TO_CAM).addScaledVector(s.dir, -TO_CAM.dot(s.dir));
      if (AY.lengthSq() < 1e-8) AY.set(0, 1, 0);
      AY.normalize();
      AX.crossVectors(AY, s.dir).normalize();
      // fica mais grosso de longe (senão some em 1 px)
      const w = Math.min(0.06, 0.012 + TO_CAM.length() * 0.0016);
      BASIS.makeBasis(AX.multiplyScalar(w), AY, TAIL.copy(s.dir).multiplyScalar(len));
      BASIS.setPosition(MID);
      s.mesh.matrix.copy(BASIS);
      s.mesh.matrixWorldNeedsUpdate = true;
      s.mesh.visible = true;
    }
    for (const f of this.flashes) if (f.sprite.visible && now >= f.until) f.sprite.visible = false;
  }

  dispose() {
    for (const s of this.tracers) this.scene.remove(s.mesh);
    for (const f of this.flashes) this.scene.remove(f.sprite);
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.geo.dispose();
    this.tracerMat.dispose();
    this.flashMat.dispose();
  }
}

let flashTex: THREE.Texture | null = null;
/** estrela de clarão desenhada num canvas (sem arquivo); a mesma do viewmodel */
export function flashTexture(): THREE.Texture | null {
  if (flashTex || typeof document === 'undefined') return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (!x) return null;
  const grd = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,190,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,30,0)');
  x.fillStyle = grd;
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 30;
    const ang = (i / 10) * Math.PI * 2;
    x.lineTo(32 + Math.cos(ang) * r, 32 + Math.sin(ang) * r);
  }
  x.closePath();
  x.fill();
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

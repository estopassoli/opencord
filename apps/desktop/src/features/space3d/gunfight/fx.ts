/**
 * Efeitos do tiro no mundo (gunfight): traçantes e clarões da boca da arma, em pools fixos (nada de geometria nova por
 * bala). O traçante é um traço curto, fino e aditivo, virado para a câmera, que anda da boca até o impacto em ~2
 * quadros; o clarão é um sprite aditivo de ~40 ms na boca da arma de quem atirou (bots, os outros e eu em 3ª pessoa —
 * na 1ª pessoa o clarão é o do viewmodel). A marca do tiro fica na parede (e no chão) por 8 s: dá para ver onde a
 * rajada foi e aprender o recuo. Marcas num pool fixo de uma malha só (uma chamada de desenho), a mais velha sai primeiro.
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
/** marcas de tiro: quantas, tamanho (m), quanto duram e quanto do fim elas encolhem (ms) */
export const MARKS = 64;
const MARK_SIZE = 0.085;
export const MARK_MS = 8000;
const MARK_FADE_MS = 1200;

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
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const M_POS = new THREE.Vector3();
const M_NRM = new THREE.Vector3();
const M_Q = new THREE.Quaternion();
const M_ROLL = new THREE.Quaternion();
const M_SCALE = new THREE.Vector3();
const M_MAT = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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
  /** marcas: uma malha só; cada marca guarda onde está, o giro e quando nasceu */
  private readonly markMat = new THREE.MeshBasicMaterial({
    map: markTexture(),
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly markGeo = new THREE.PlaneGeometry(MARK_SIZE, MARK_SIZE);
  private readonly marks: THREE.InstancedMesh;
  private readonly markAt = new Float64Array(MARKS).fill(-1);
  private readonly markPos = new Float32Array(MARKS * 3);
  private readonly markQ = new Float32Array(MARKS * 4);
  private nextMark = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.marks = new THREE.InstancedMesh(this.markGeo, this.markMat, MARKS);
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MARKS; i++) this.marks.setMatrixAt(i, HIDDEN);
    // o pool espalha pelo mapa todo: a esfera de corte de uma instância não vale para as outras
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.scene.add(this.marks);
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

  /** marca de tiro em `at` (a face com a normal `n`, unitária); a mais velha dá lugar */
  mark(at: V3, n: V3, now: number) {
    const i = this.nextMark;
    this.nextMark = (i + 1) % MARKS;
    // 2 mm para fora da face (com o `polygonOffset`, sem brigar com a parede)
    this.markPos.set([at.x + n.x * 0.002, at.y + n.y * 0.002, at.z + n.z * 0.002], i * 3);
    M_Q.setFromUnitVectors(Z_AXIS, M_NRM.set(n.x, n.y, n.z));
    M_Q.multiply(M_ROLL.setFromAxisAngle(Z_AXIS, Math.random() * Math.PI * 2));
    this.markQ.set([M_Q.x, M_Q.y, M_Q.z, M_Q.w], i * 4);
    this.markAt[i] = now;
    this.placeMark(i, 1);
  }

  /** quantas marcas estão na parede agora (para os testes) */
  marksAlive(now: number): number {
    let n = 0;
    for (let i = 0; i < MARKS; i++) if (this.markAt[i]! >= 0 && now - this.markAt[i]! < MARK_MS) n++;
    return n;
  }

  private placeMark(i: number, k: number) {
    if (k <= 0) {
      this.marks.setMatrixAt(i, HIDDEN);
    } else {
      M_POS.fromArray(this.markPos, i * 3);
      M_Q.fromArray(this.markQ, i * 4);
      M_MAT.compose(M_POS, M_Q, M_SCALE.setScalar(k));
      this.marks.setMatrixAt(i, M_MAT);
    }
    this.marks.instanceMatrix.needsUpdate = true;
  }

  /** anda os traçantes (virados para a câmera) e apaga o que acabou */
  update(now: number, cam: THREE.Vector3) {
    // as marcas encolhem no fim e somem (só mexe nas que estão saindo)
    for (let i = 0; i < MARKS; i++) {
      const t = this.markAt[i]!;
      if (t < 0) continue;
      const left = MARK_MS - (now - t);
      if (left <= 0) {
        this.markAt[i] = -1;
        this.placeMark(i, 0);
      } else if (left < MARK_FADE_MS) this.placeMark(i, left / MARK_FADE_MS);
    }
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
    this.scene.remove(this.marks);
    this.marks.dispose();
    this.markGeo.dispose();
    this.markMat.dispose();
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.geo.dispose();
    this.tracerMat.dispose();
    this.flashMat.dispose();
  }
}

let markTex: THREE.Texture | null = null;
/**
 * A marca do tiro: um furo escuro com a borda queimada e um anel claro de poeira em volta (o furo sozinho sumia na
 * parede escura; o anel faz a rajada se ler de longe). Canvas, sem arquivo.
 */
function markTexture(): THREE.Texture | null {
  if (markTex || typeof document === 'undefined') return markTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  if (!x) return null;
  const grd = x.createRadialGradient(16, 16, 1, 16, 16, 15);
  grd.addColorStop(0, 'rgba(4,4,4,1)');
  grd.addColorStop(0.25, 'rgba(10,9,8,0.95)');
  grd.addColorStop(0.4, 'rgba(22,19,16,0.7)');
  // a poeira some aos poucos para fora (anel de opacidade igual com borda seca parecia um alvo colado, de perto)
  grd.addColorStop(0.5, 'rgba(170,160,145,0.42)');
  grd.addColorStop(0.68, 'rgba(170,160,145,0.22)');
  grd.addColorStop(1, 'rgba(170,160,145,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 32, 32);
  markTex = new THREE.CanvasTexture(c);
  // as cores do canvas são sRGB (sem isso o furo escuro sai cinza claro)
  markTex.colorSpace = THREE.SRGBColorSpace;
  return markTex;
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

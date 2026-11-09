/**
 * Sensação de impacto do Espaço 3D (plano 2026-11-09, P5): o que o mundo faz quando algo acontece. Ouve o barramento
 * de eventos (ADR-0056) e responde com pausa de impacto (hitstop), partículas, brilho no que foi atingido, tremor da
 * câmera, comemoração do ponto (confete na cor do time, rede ou cesta balançando) e o texto do resultado junto do
 * boneco ("Perfeito!", "Cedo", "Tarde", "Curto", "Longo", "Longe").
 *
 * Regras de bom gosto: o tremor só sai em golpe forte e no ponto; a pausa vai de 40 a 90 ms, no máximo uma a cada
 * 150 ms; com "reduzir movimento" (`motion` = 0) não há tremor nem câmera lenta, e as partículas e a pausa caem pela
 * metade. Desempenho: tudo é criado no começo (pool fixo de partículas, texturas dos textos); o laço de quadro só
 * escreve em arrays e em objetos que já existem — nada de `new THREE.*` por quadro.
 */
import * as THREE from 'three';
import type { GameBus, GameEvent } from './events';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---------- pausa de impacto ----------

/** limites da pausa de impacto (ms) */
export const HITSTOP = { min: 40, max: 90, gap: 150 } as const;

/** Pausa de impacto: o tempo do jogo para por alguns ms no golpe (o golpe "pesa"). Também a câmera lenta do nocaute. */
export class HitStop {
  private until = 0;
  private lastAt = -Infinity;
  private slowUntil = 0;
  private slowK = 1;

  /** pede uma pausa pela força (0–1); devolve os ms aplicados (0 = recusada, a anterior foi há menos de 150 ms) */
  trigger(now: number, power: number, motion = 1): number {
    if (now - this.lastAt < HITSTOP.gap) return 0;
    const full = HITSTOP.min + (HITSTOP.max - HITSTOP.min) * clamp01(power);
    const ms = Math.min(HITSTOP.max, full * (0.5 + 0.5 * clamp01(motion)));
    this.lastAt = now;
    this.until = Math.max(this.until, now + ms);
    return ms;
  }

  /** câmera lenta (nocaute): `k` é a velocidade do tempo (0–1) por `ms` */
  slow(now: number, ms: number, k: number) {
    this.slowUntil = now + ms;
    this.slowK = clamp01(k);
  }

  /** velocidade do tempo do jogo agora: 0 na pausa, `k` na câmera lenta, 1 no resto */
  scale(now: number): number {
    if (now < this.until) return 0;
    return now < this.slowUntil ? this.slowK : 1;
  }
}

// ---------- tremor da câmera ----------

/** Tremor curto da câmera: amplitude (m) que decai rápido; com `motion` = 0 é sempre zero. */
export class Shake {
  private amp = 0;
  private t = 0;

  kick(amp: number, motion = 1) {
    this.amp = Math.max(this.amp, amp * clamp01(motion));
  }

  get amplitude() {
    return this.amp;
  }

  step(dt: number) {
    this.t += dt;
    this.amp *= Math.exp(-dt * 9);
    if (this.amp < 1e-4) this.amp = 0;
  }

  /** deslocamento da câmera agora (escreve em `out`, sem alocar) */
  offset(out: { x: number; y: number; z: number }) {
    const a = this.amp;
    const t = this.t;
    out.x = a * Math.sin(t * 53);
    out.y = a * Math.sin(t * 61 + 1.3) * 0.6;
    out.z = a * Math.sin(t * 47 + 2.1);
    return out;
  }
}

// ---------- partículas (pool fixo) ----------

const MAX_PARTICLES = 256;

const VERT = /* glsl */ `
attribute float alpha;
attribute float size;
attribute float shape;
attribute vec3 tint;
uniform float uScale;
varying float vA;
varying float vShape;
varying vec3 vC;
void main() {
  vA = alpha;
  vC = tint;
  vShape = shape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vA;
varying float vShape;
varying vec3 vC;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (vShape < 0.5 && d > 0.5) discard;
  float edge = vShape < 0.5 ? smoothstep(0.5, 0.3, d) : 1.0;
  gl_FragColor = vec4(vC, vA * edge);
}`;

interface Burst {
  count: number;
  /** cor (0xRRGGBB) e uma segunda cor alternada (confete) */
  color: number;
  color2?: number;
  /** velocidade inicial (m/s): espalhada em todas as direções, mais `up` para cima */
  speed: number;
  up: number;
  /** gravidade (m/s²) e arrasto (1/s) */
  gravity: number;
  drag: number;
  /** vida (s) e tamanho (m) */
  life: number;
  size: number;
  /** 0 redonda, 1 quadrada (confete) */
  shape?: 0 | 1;
  /** só espalha no plano do chão (poeira) */
  flat?: boolean;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly tint = new Float32Array(MAX_PARTICLES * 3);
  private readonly alpha = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly shape = new Float32Array(MAX_PARTICLES);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly grav = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly size0 = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private live = 0;
  private dirty = false;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.raycast = () => undefined;
  }

  /** quantas partículas estão vivas */
  get alive() {
    return this.live;
  }

  /** escala do tamanho na tela: altura do quadro em px / (2·tan(fov/2)) */
  setScale(pxPerUnit: number) {
    this.mat.uniforms.uScale!.value = pxPerUnit;
  }

  burst(at: { x: number; y: number; z: number }, b: Burst, k = 1) {
    const n = Math.max(1, Math.round(b.count * k));
    const c1r = ((b.color >> 16) & 255) / 255;
    const c1g = ((b.color >> 8) & 255) / 255;
    const c1b = (b.color & 255) / 255;
    const c2 = b.color2 ?? b.color;
    const c2r = ((c2 >> 16) & 255) / 255;
    const c2g = ((c2 >> 8) & 255) / 255;
    const c2b = (c2 & 255) / 255;
    for (let j = 0; j < n; j++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      if (this.life[i]! <= 0) this.live++;
      const i3 = i * 3;
      this.pos[i3] = at.x;
      this.pos[i3 + 1] = at.y;
      this.pos[i3 + 2] = at.z;
      // direção aleatória (no chão, só no plano)
      const th = Math.random() * Math.PI * 2;
      const ph = b.flat ? 0 : Math.acos(2 * Math.random() - 1) - Math.PI / 2;
      const s = b.speed * (0.45 + Math.random() * 0.55);
      this.vel[i3] = Math.cos(th) * Math.cos(ph) * s;
      this.vel[i3 + 1] = Math.sin(ph) * s * (b.flat ? 0 : 1) + b.up * (0.6 + Math.random() * 0.4);
      this.vel[i3 + 2] = Math.sin(th) * Math.cos(ph) * s;
      const alt = j % 2 === 1;
      this.tint[i3] = alt ? c2r : c1r;
      this.tint[i3 + 1] = alt ? c2g : c1g;
      this.tint[i3 + 2] = alt ? c2b : c1b;
      const life = b.life * (0.7 + Math.random() * 0.3);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.grav[i] = b.gravity;
      this.drag[i] = b.drag;
      this.size0[i] = b.size * (0.7 + Math.random() * 0.6);
      this.size[i] = this.size0[i]!;
      this.alpha[i] = 1;
      this.shape[i] = b.shape ?? 0;
    }
    this.dirty = true;
  }

  update(dt: number) {
    if (this.live === 0 && !this.dirty) return;
    let live = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      let l = this.life[i]!;
      if (l <= 0) continue;
      l -= dt;
      const i3 = i * 3;
      if (l <= 0) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      live++;
      this.life[i] = l;
      const k = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i3] = this.vel[i3]! * k;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * k - this.grav[i]! * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * k;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = Math.max(0.02, this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt);
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
      const f = l / this.maxLife[i]!;
      // some no fim da vida (o último terço apaga)
      this.alpha[i] = Math.min(1, f * 3);
      this.size[i] = this.size0[i]! * (0.6 + 0.4 * f);
    }
    this.live = live;
    for (const name of ['position', 'tint', 'alpha', 'size', 'shape'] as const)
      (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------- receitas ----------

const TEAM_COLOR = { a: 0x3f8fe0, b: 0xe04848 } as const;

const FX = {
  dust: { count: 8, color: 0xcfc2a4, speed: 1.6, up: 0.6, gravity: 2, drag: 3, life: 0.55, size: 0.11, flat: true },
  sand: { count: 10, color: 0xe9d7a6, speed: 1.8, up: 1, gravity: 5, drag: 2.5, life: 0.6, size: 0.08, flat: true },
  spark: {
    count: 8,
    color: 0xfff3c4,
    color2: 0xffffff,
    speed: 3.2,
    up: 0.4,
    gravity: 6,
    drag: 4,
    life: 0.28,
    size: 0.05,
  },
  rim: {
    count: 10,
    color: 0xff8a2a,
    color2: 0xffd27a,
    speed: 2.6,
    up: 0.6,
    gravity: 9,
    drag: 2,
    life: 0.4,
    size: 0.045,
  },
  puff: { count: 5, color: 0xffffff, speed: 0.9, up: 0.2, gravity: 0, drag: 5, life: 0.25, size: 0.09 },
  chalk: { count: 7, color: 0x6fb6ff, speed: 0.6, up: 0.3, gravity: 2, drag: 3, life: 0.45, size: 0.025 },
  pocket: { count: 6, color: 0x2a2a2a, speed: 0.4, up: 0.2, gravity: 0, drag: 4, life: 0.35, size: 0.05 },
  boost: {
    count: 8,
    color: 0xff9a2a,
    color2: 0xfff07a,
    speed: 1.6,
    up: 0.5,
    gravity: -1,
    drag: 4,
    life: 0.35,
    size: 0.12,
  },
  punch: {
    count: 10,
    color: 0xffffff,
    color2: 0xffe08a,
    speed: 3.4,
    up: 0.3,
    gravity: 3,
    drag: 5,
    life: 0.25,
    size: 0.07,
  },
  confetti: { count: 70, color: 0xffffff, speed: 3.6, up: 4.2, gravity: 4, drag: 1.6, life: 1.6, size: 0.07, shape: 1 },
} satisfies Record<string, Burst>;

// ---------- texto do resultado ----------

export type JuiceLabel =
  | 'perfect'
  | 'early'
  | 'late'
  | 'short'
  | 'long'
  | 'whiff'
  | 'carretilha'
  | 'elastico'
  | 'bicicleta'
  | 'falta'
  | 'desarme';

export const LABEL_TEXT: Record<JuiceLabel, string> = {
  perfect: 'Perfeito!',
  early: 'Cedo',
  late: 'Tarde',
  short: 'Curto',
  long: 'Longo',
  whiff: 'Longe',
  carretilha: 'Carretilha!',
  elastico: 'Elástico!',
  bicicleta: 'Bicicleta!',
  falta: 'Falta!',
  desarme: 'Desarme!',
};

const LABEL_COLOR: Record<JuiceLabel, string> = {
  perfect: '#5be37d',
  early: '#f2c94c',
  late: '#f2c94c',
  short: '#f2c94c',
  long: '#f2c94c',
  whiff: '#c8ccd4',
  carretilha: '#7fd8ff',
  elastico: '#7fd8ff',
  bicicleta: '#ffd34d',
  falta: '#ff6b5e',
  desarme: '#c8ccd4',
};

const LABEL_MS = 750;

function labelTexture(text: string, color: string): THREE.CanvasTexture | null {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  c.width = 256;
  c.height = 72;
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(12,14,20,0.85)';
  ctx.strokeText(text, 128, 38, 240);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 38, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- juice ----------

type Emissive = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

interface FlashSlot {
  mat: Emissive | null;
  base: THREE.Color;
  until: number;
  ms: number;
}

interface Wobble {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  basePos: THREE.Vector3;
  /** −1/1 gol ou cesta de cada lado; 0 rede do meio */
  side: number;
  t: number;
  amp: number;
}

export interface JuiceOptions {
  /** 1 = movimento normal; 0 = "reduzir movimento" (sem tremor nem câmera lenta, metade das partículas e da pausa) */
  motion: number;
  /** cria as texturas do texto do resultado (precisa de canvas 2D; nos testes fica desligado) */
  labels?: boolean;
}

const WHITE = new THREE.Color(0xffffff);

export class Juice {
  readonly hitstop = new HitStop();
  readonly shake = new Shake();
  readonly particles = new Particles();
  motion: number;
  private zone = 0;
  private ball: THREE.Mesh | null = null;
  private readonly flashes: FlashSlot[] = Array.from({ length: 6 }, () => ({
    mat: null,
    base: new THREE.Color(),
    until: 0,
    ms: 1,
  }));
  private wobbles: Wobble[] = [];
  private readonly sprite: THREE.Sprite;
  private readonly spriteMat: THREE.SpriteMaterial;
  private readonly textures = new Map<JuiceLabel, THREE.CanvasTexture>();
  private labelAt = 0;
  private labelY0 = 0;
  private now = 0;

  constructor(
    private readonly scene: THREE.Scene,
    opts: JuiceOptions,
  ) {
    this.motion = clamp01(opts.motion);
    scene.add(this.particles.points);
    this.spriteMat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.sprite = new THREE.Sprite(this.spriteMat);
    this.sprite.scale.set(0.9, 0.253, 1);
    this.sprite.renderOrder = 12;
    this.sprite.visible = false;
    this.sprite.raycast = () => undefined;
    scene.add(this.sprite);
    if (opts.labels !== false && typeof document !== 'undefined')
      for (const k of Object.keys(LABEL_TEXT) as JuiceLabel[]) {
        const tex = labelTexture(LABEL_TEXT[k], LABEL_COLOR[k]);
        if (tex) this.textures.set(k, tex);
      }
  }

  /** partículas e pausa caem pela metade com "reduzir movimento" */
  private get fxK() {
    return 0.5 + 0.5 * this.motion;
  }

  setZone(z: number) {
    this.zone = z;
  }

  setBall(m: THREE.Mesh | null) {
    this.ball = m;
  }

  /** as redes da arena (`net:1`, `net:-1` gol/cesta de cada lado, `net:0` a do meio) para balançar no ponto */
  setDecor(g: THREE.Object3D | null) {
    for (const w of this.wobbles) {
      w.obj.scale.copy(w.base);
      w.obj.position.copy(w.basePos);
    }
    this.wobbles = [];
    g?.traverse((o) => {
      if (!o.name.startsWith('net:')) return;
      this.wobbles.push({
        obj: o,
        base: o.scale.clone(),
        basePos: o.position.clone(),
        side: Number(o.name.slice(4)),
        t: 0,
        amp: 0,
      });
    });
  }

  /** escala do tamanho das partículas pela altura do quadro (px) e pelo campo de visão vertical (graus) */
  setView(heightPx: number, fovDeg: number) {
    this.particles.setScale(heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)));
  }

  /** liga ao barramento de eventos; devolve o "desligar" */
  attach(bus: GameBus): () => void {
    return bus.on((e) => this.onEvent(e, performance.now()));
  }

  /** brilho rápido (emissive) num material: o que foi atingido acende e apaga */
  flash(mat: THREE.Material | null | undefined, ms = 90, now = this.now) {
    if (!mat || !('emissive' in mat) || !(mat.emissive instanceof THREE.Color)) return;
    const m = mat as Emissive;
    let slot = this.flashes.find((f) => f.mat === m);
    if (!slot) {
      slot = this.flashes.find((f) => !f.mat) ?? this.flashes.reduce((a, b) => (a.until < b.until ? a : b));
      if (slot.mat) slot.mat.emissive.copy(slot.base);
      slot.mat = m;
      slot.base.copy(m.emissive);
    }
    slot.until = now + ms;
    slot.ms = ms;
  }

  /** texto do resultado subindo da cabeça de quem bateu */
  label(kind: JuiceLabel, at: { x: number; y: number; z: number }, now = this.now) {
    const tex = this.textures.get(kind);
    if (!tex) return;
    this.spriteMat.map = tex;
    this.spriteMat.needsUpdate = true;
    this.sprite.position.set(at.x, at.y, at.z);
    this.labelY0 = at.y;
    this.sprite.visible = true;
    this.spriteMat.opacity = 1;
    this.labelAt = now;
  }

  private wobble(side: number, amp: number) {
    for (const w of this.wobbles)
      if (w.side === side) {
        const left = w.amp * Math.exp(-w.t * 4.5);
        w.t = 0;
        w.amp = Math.max(left, amp * this.fxK);
      }
  }

  onEvent(e: GameEvent, now: number) {
    if (e.zone !== this.zone) return;
    this.now = now;
    const k = this.fxK;
    const p = this.particles;
    const at = e.at;
    switch (e.kind) {
      case 'kick':
        if (e.power >= 0.5) p.burst(floorAt(at), this.zone === 2 ? FX.dust : FX.sand, k * (0.6 + e.power * 0.6));
        this.flash(this.ball?.material as THREE.Material | undefined, 80, now);
        if (e.power >= 0.7) this.hitstop.trigger(now, e.power, this.motion);
        if (e.power >= 0.95) this.shake.kick(0.05, this.motion);
        break;
      case 'hit':
        // basquete: o arremesso não pausa (a bola sai da mão)
        if (this.zone === 1) break;
        p.burst(at, FX.spark, k * (0.5 + e.power * 0.7));
        this.flash(this.ball?.material as THREE.Material | undefined, 90, now);
        if (e.power >= 0.25) this.hitstop.trigger(now, e.power, this.motion);
        if (e.power >= 0.9) this.shake.kick(0.035, this.motion);
        break;
      case 'whiff':
        p.burst(at, FX.puff, k * 0.6);
        break;
      case 'bounce':
        if (e.surface === 'floor' && e.power >= 0.45)
          p.burst(floorAt(at), this.zone === 2 || this.zone === 4 ? FX.sand : FX.dust, k * e.power);
        break;
      case 'surface':
        if (e.surface === 'rim') p.burst(at, FX.rim, k * (0.5 + e.power));
        else if (e.surface === 'post') p.burst(at, FX.spark, k * (0.5 + e.power));
        else if (e.surface === 'board') p.burst(at, FX.puff, k);
        else if (e.surface === 'net') this.wobble(0, 0.4 + e.power * 0.6);
        else if (e.surface === 'wall' && e.power >= 0.5) p.burst(at, FX.puff, k * 0.6);
        break;
      case 'score': {
        const lift = { x: at.x, y: Math.max(at.y, 1), z: at.z };
        const c = TEAM_COLOR[e.side];
        if (this.zone === 6) p.burst(lift, { ...FX.confetti, count: 30, color: c }, k);
        else p.burst(lift, { ...FX.confetti, color: c }, k);
        if (e.reason === 'gol' || e.reason === 'cesta') {
          this.wobble(e.side === 'a' ? 1 : -1, 1);
          this.shake.kick(0.07, this.motion);
        } else if (e.reason === 'rede') this.wobble(0, 0.8);
        break;
      }
      case 'pocket':
        p.burst(at, FX.pocket, k);
        break;
      case 'cue':
        p.burst(at, FX.chalk, k);
        break;
      case 'boost':
        p.burst(at, FX.boost, k);
        break;
      case 'finish':
        p.burst({ x: at.x, y: at.y + 1, z: at.z }, { ...FX.confetti, color: 0xf2c94c }, k);
        break;
      case 'punch':
        if (!e.landed) break;
        p.burst(at, FX.punch, k);
        this.hitstop.trigger(now, e.strong ? 1 : 0.6, this.motion);
        if (e.strong) this.shake.kick(0.06, this.motion);
        break;
      case 'ko':
        p.burst(at, { ...FX.punch, count: 22, speed: 4.5 }, k);
        this.hitstop.trigger(now, 1, this.motion);
        this.shake.kick(0.1, this.motion);
        if (this.motion > 0) this.hitstop.slow(now + HITSTOP.max, 400, 0.35);
        break;
      case 'trick': {
        // drible: o nome do lance sobe da cabeça; a bicicleta ainda freia o tempo e treme a câmera
        const head = { x: at.x, y: at.y + 0.9, z: at.z };
        this.label(e.trick, head, now);
        p.burst(floorAt(at), FX.dust, k * (e.trick === 'bicicleta' ? 1.4 : 0.7));
        if (e.trick === 'bicicleta') {
          p.burst(head, { ...FX.spark, count: 18, color: 0xffd34d }, k);
          this.shake.kick(0.05, this.motion);
          if (this.motion > 0) this.hitstop.slow(now, 550, 0.35);
        }
        break;
      }
      case 'impact':
        // tiro na parede: faísca e poeira; no corpo: um borrifo escuro (sem sangue vermelho)
        if (e.flesh) {
          // um borrifo escuro e um brilho curto (o acerto se lê de longe; o corpo pisca e dá um tranco pela cena)
          p.burst(at, { ...FX.puff, count: e.head ? 9 : 6, color: 0x4a2a2a }, k);
          p.burst(at, { ...FX.spark, count: e.head ? 6 : 4, color: 0xffe2b8 }, k * 0.6);
        } else {
          p.burst(at, { ...FX.spark, count: 6 }, k * 0.7);
          p.burst(at, FX.puff, k * 0.5);
        }
        break;
      case 'tackle':
        p.burst(floorAt(at), FX.dust, k * (e.slide ? 1.5 : 0.8));
        this.label(e.foul ? 'falta' : 'desarme', { x: at.x, y: at.y + 1.6, z: at.z }, now);
        if (e.foul) this.shake.kick(0.04, this.motion);
        break;
      default:
        break;
    }
  }

  /** velocidade do tempo do jogo agora (0 na pausa de impacto) */
  timeScale(now: number): number {
    return this.hitstop.scale(now);
  }

  /** deslocamento da câmera pelo tremor (escreve em `out`) */
  shakeOffset(out: THREE.Vector3): THREE.Vector3 {
    this.shake.offset(out);
    return out;
  }

  /** um quadro (tempo real, não o do jogo: a pausa não congela o efeito) */
  update(dt: number, now: number) {
    this.now = now;
    this.particles.update(dt);
    this.shake.step(dt);
    for (const f of this.flashes) {
      const m = f.mat;
      if (!m) continue;
      const left = f.until - now;
      if (left <= 0) {
        m.emissive.copy(f.base);
        f.mat = null;
        continue;
      }
      m.emissive.copy(f.base).lerp(WHITE, 0.85 * Math.min(1, left / f.ms));
    }
    for (const w of this.wobbles) {
      if (w.amp <= 0) continue;
      w.t += dt;
      const s = w.amp * Math.exp(-w.t * 4.5) * Math.sin(w.t * 20);
      if (w.t > 1.4) {
        w.amp = 0;
        w.obj.scale.copy(w.base);
        w.obj.position.copy(w.basePos);
        continue;
      }
      if (w.side === 0) {
        // rede do meio: empurra um pouco para o lado e volta
        w.obj.position.x = w.basePos.x + s * 0.06;
      } else if (this.zone === 2) {
        // rede do gol: estufa para trás
        w.obj.scale.x = w.base.x * (1 + Math.abs(s) * 0.45);
        w.obj.position.x = w.basePos.x + w.side * Math.abs(s) * 0.3;
      } else {
        // rede da cesta: estica e balança
        w.obj.scale.y = w.base.y * (1 + s * 0.3);
        w.obj.scale.x = w.base.x * (1 - s * 0.12);
        w.obj.scale.z = w.base.z * (1 - s * 0.12);
      }
    }
    if (this.sprite.visible) {
      const u = (now - this.labelAt) / LABEL_MS;
      if (u >= 1) this.sprite.visible = false;
      else {
        this.sprite.position.y = this.labelY0 + u * 0.45;
        this.spriteMat.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      }
    }
  }

  dispose() {
    this.setDecor(null);
    for (const f of this.flashes) if (f.mat) f.mat.emissive.copy(f.base);
    this.scene.remove(this.particles.points);
    this.scene.remove(this.sprite);
    this.particles.dispose();
    this.spriteMat.dispose();
    for (const t of this.textures.values()) t.dispose();
  }
}

/** a poeira sai do chão, embaixo de onde aconteceu */
function floorAt(at: { x: number; y: number; z: number }) {
  return { x: at.x, y: 0.05, z: at.z };
}

/**
 * Primeira pessoa do gunfight: braços e arma desenhados por cima da cena (cena e câmera próprias, profundidade
 * limpa antes), para a arma nunca entrar na parede. Toda animação é feita aqui, em código, por cima das peças do
 * modelo: sacar, guardar, respirar, balançar com o mouse, passo, corrida (e a corrida tática, arma para cima), mirar,
 * coice do tiro com o ferrolho indo e voltando, recarga (pente sai e entra; vazio, puxa a alavanca), ferrolho do
 * sniper, golpes da faca (alternando os lados) e a inspeção.
 */
import * as THREE from 'three';
import { makeHand, type Hand } from '../hand';
import { movePart, type GunModel } from './models';
import type { GunSpec } from './weapons';

export type VmAction = 'draw' | 'fire' | 'reload' | 'reloadEmpty' | 'bolt' | 'melee' | 'inspect';

export interface VmInput {
  /** 0 (quadril) a 1 (mirando) */
  ads: number;
  /** 0 parado a 1 andando */
  moving: number;
  sprint: boolean;
  tactical: boolean;
  slide: boolean;
  crouch: boolean;
  airborne: boolean;
  /** quanto o mouse mexeu neste quadro (rad) */
  lookX: number;
  lookY: number;
}

const ease = (u: number) => u * u * (3 - 2 * u);
const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** sai rápido e chega devagar (sem elástico) */
const expOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
/** sobe em [a,b] e desce em [c,d] (0–1) */
const hump = (u: number, a: number, b: number, c: number, d: number) => ease(seg(u, a, b)) * (1 - ease(seg(u, c, d)));

const V = new THREE.Vector3();
const W1 = new THREE.Vector3();

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private readonly sway = new THREE.Group();
  private readonly armR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly handR: Hand;
  private readonly handL: Hand;
  /** onde fica a mão esquerda no espaço da arma (muda na recarga) */
  private readonly leftAt = new THREE.Vector3();
  private gun: GunModel | null = null;
  private spec: GunSpec | null = null;
  private action: { kind: VmAction; t: number; ms: number; side: number } | null = null;
  private kick = 0;
  private kickV = 0;
  /** tranco curto (mola): pente encaixando, ferrolho fechando, fim do saque, fim do corte */
  private jolt = 0;
  private joltV = 0;
  private joltDone = new Set<string>();
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  private sprintK = 0;
  private tacK = 0;
  private slideK = 0;
  private airK = 0;
  private meleeSide = 1;
  private flash: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private flashUntil = 0;
  private now = 0;

  constructor(skin: THREE.ColorRepresentation) {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 0.6);
    this.scene.add(key);
    this.scene.add(this.sway);
    this.sway.add(this.holder);
    this.armR = arm();
    this.armL = arm();
    this.sway.add(this.armR, this.armL);
    this.handR = makeHand(skin, 1);
    this.handL = makeHand(skin, -1);
    this.holder.add(this.handR.root, this.handL.root);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        map: flashTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 2);
    this.holder.add(this.flash, this.flashLight);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** troca a arma (com a animação de sacar) */
  setGun(g: GunModel, spec: GunSpec) {
    if (this.gun) this.holder.remove(this.gun.root);
    this.gun = g;
    this.spec = spec;
    this.holder.add(g.root);
    this.armL.visible = spec.cls !== 'knife';
    this.handL.root.visible = spec.cls !== 'knife';
    gripRight(this.handR, spec.cls, g.id);
    this.leftAt.copy(g.support);
    gripLeft(this.handL, spec.cls, g.support);
    this.play('draw', spec.cls === 'knife' ? 380 : spec.cls === 'pistol' ? 420 : 600);
  }

  play(kind: VmAction, ms: number) {
    // faca: cada golpe sai de um lado
    if (kind === 'melee') this.meleeSide = -this.meleeSide;
    this.action = { kind, t: 0, ms: Math.max(1, ms), side: this.meleeSide };
    this.joltDone.clear();
    if (kind === 'fire') {
      this.kickV += this.spec?.cls === 'sniper' ? 2.6 : this.spec?.cls === 'pistol' ? 1.8 : 1.2;
      this.flashUntil = this.now + 45;
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.scale.setScalar(this.spec?.cls === 'sniper' ? 1.8 : this.spec?.cls === 'smg' ? 0.9 : 1.2);
    }
  }

  get busy(): VmAction | null {
    return this.action && this.action.kind !== 'fire' ? this.action.kind : null;
  }

  update(dt: number, now: number, inp: VmInput) {
    this.now = now;
    const g = this.gun;
    const spec = this.spec;
    if (!g || !spec) return;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.sprintK += ((inp.sprint && !inp.slide ? 1 : 0) - this.sprintK) * k(10);
    this.tacK += ((inp.tactical && !inp.slide ? 1 : 0) - this.tacK) * k(10);
    this.slideK += ((inp.slide ? 1 : 0) - this.slideK) * k(12);
    this.airK += ((inp.airborne ? 1 : 0) - this.airK) * k(8);
    // balanço: a arma fica para trás do mouse e volta (menos mirando)
    const swayK = 1 - inp.ads * 0.85;
    this.swayX += (-inp.lookX * 0.9 * swayK - this.swayX) * k(14);
    this.swayY += (inp.lookY * 0.9 * swayK - this.swayY) * k(14);
    // passo: um oito, mais largo correndo
    const pace = inp.sprint ? (inp.tactical ? 15 : 12) : 8;
    if (inp.moving > 0.05 && !inp.airborne && !inp.slide) this.bob += dt * pace;
    // coice: mola (sobe e volta)
    this.kickV += (-this.kick * 170 - this.kickV * 18) * dt;
    this.kick += this.kickV * dt;
    this.joltV += (-this.jolt * 260 - this.joltV * 16) * dt;
    this.jolt += this.joltV * dt;

    // faca não mira (o botão direito dela é o golpe pesado)
    const ads = spec.cls === 'knife' ? 0 : ease(inp.ads);
    const hip =
      spec.cls === 'knife'
        ? new THREE.Vector3(0.17, -0.19, -0.42)
        : spec.cls === 'pistol'
          ? new THREE.Vector3(0.11, -0.13, -0.33)
          : new THREE.Vector3(0.14, -0.17, -0.46);
    // mirando: a linha de mira passa pelo centro da tela, um pouco à frente do olho
    const eyeZ = spec.cls === 'pistol' ? -0.34 : spec.scope ? -0.12 : -0.2;
    const aimAt = new THREE.Vector3(-g.sight.x, -g.sight.y, eyeZ - g.sight.z);
    const pos = hip.lerp(aimAt, ads);
    const rot = new THREE.Euler(0, 0, 0, 'YXZ');
    // no quadril, o cano aponta um pouco para o centro da tela (e a faca com a ponta para cima)
    rot.y += (spec.cls === 'knife' ? 0.35 : 0.06) * (1 - ads);
    rot.z += spec.cls === 'knife' ? 0 : -0.08 * (1 - ads);
    rot.x += spec.cls === 'knife' ? 0.35 : 0;
    const bobA = inp.moving * (1 - ads * 0.85) * (inp.crouch ? 0.6 : 1);
    pos.x += Math.sin(this.bob) * 0.012 * bobA;
    pos.y += Math.abs(Math.cos(this.bob)) * -0.012 * bobA;
    // respirar parado
    const breathe = Math.sin(now / 900) * 0.0025 * (1 - ads * 0.8);
    pos.y += breathe;
    rot.y += this.swayX;
    rot.x += this.swayY;
    pos.x += this.swayX * 0.05;
    pos.y -= this.swayY * 0.05;
    // corrida: arma atravessada e baixa; corrida tática: arma para cima, cano para o alto
    const sp = this.sprintK * (1 - this.tacK);
    pos.x += sp * -0.03;
    pos.y += sp * -0.05;
    rot.y += sp * 0.65;
    rot.z += sp * 0.35;
    rot.x += sp * -0.15 + Math.sin(this.bob * 2) * 0.03 * this.sprintK;
    pos.y += this.tacK * 0.04;
    pos.x += this.tacK * -0.04;
    rot.x += this.tacK * 0.9;
    rot.z += this.tacK * 0.5;
    // deslizando: a arma inclina; no ar, sobe um pouco
    rot.z += this.slideK * 0.45;
    pos.y += this.slideK * 0.02 + this.airK * 0.015;
    // tranco dos encaixes
    rot.x += this.jolt * 0.035;
    pos.y += this.jolt * 0.004;
    // coice
    pos.z += this.kick * (spec.cls === 'sniper' ? 0.06 : 0.04);
    rot.x += this.kick * (spec.cls === 'sniper' ? 0.22 : 0.1);
    // ferrolho / ferrolho da pistola indo e voltando no tiro
    let boltBack = 0;
    let boltRot = 0;
    let magDrop = 0;
    let chargeBack = 0;
    let bladeRot = 0;

    const a = this.action;
    if (a) {
      a.t += dt * 1000;
      const u = Math.min(1, a.t / a.ms);
      const joltAt = (key: string, at: number, v: number) => {
        if (u >= at && !this.joltDone.has(key)) {
          this.joltDone.add(key);
          this.joltV += v;
        }
      };
      switch (a.kind) {
        case 'draw': {
          // vem de baixo, girando, passa um pouco do ponto e assenta (tranco no fim)
          const w = 1 - expOut(u);
          joltAt('end', 0.8, 1.6);
          pos.y -= 0.25 * w;
          rot.x -= 0.9 * w;
          rot.z += 0.3 * w;
          break;
        }
        case 'fire':
          if (spec.cls !== 'sniper') boltBack = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.035;
          break;
        case 'reload':
        case 'reloadEmpty': {
          const empty = a.kind === 'reloadEmpty';
          // inclina a arma, o pente sai para baixo, o novo entra, (vazio) puxa a alavanca, volta
          const tilt = hump(u, 0, 0.15, 0.85, 1);
          rot.z -= tilt * 0.55;
          rot.x += tilt * 0.18;
          pos.y += tilt * 0.03;
          pos.x -= tilt * 0.03;
          const out = ease(seg(u, 0.15, 0.32));
          const back = expOut(seg(u, 0.45, 0.62));
          // o pente sai com um puxão e entra com um tapa
          joltAt('out', 0.16, -1.2);
          joltAt('seat', 0.62, 2.4);
          if (empty) joltAt('release', 0.84, 2);
          magDrop = out * (1 - back) * 0.3 + (u > 0.32 && u < 0.45 ? 0.3 : 0);
          // a mão de apoio vai buscar o pente novo (e volta com ele)
          const fetch = hump(u, 0.22, 0.34, 0.5, 0.64);
          this.handL.root.position.copy(this.leftAt).lerp(V.set(0.0, -0.16, 0.0), fetch * 0.85);
          this.handL.setCurl(lerp(this.spec?.cls === 'pistol' ? 0.75 : 0.7, 0.45, fetch));
          if (empty) {
            const pull = hump(u, 0.66, 0.74, 0.76, 0.84);
            chargeBack = pull * 0.07;
            boltBack = pull * 0.05;
            rot.x += pull * 0.06;
          }
          break;
        }
        case 'bolt': {
          // sniper: abaixa um pouco, gira o ferrolho, puxa, empurra, gira de volta
          const w = hump(u, 0, 0.12, 0.85, 1);
          pos.y -= w * 0.02;
          rot.z -= w * 0.15;
          boltRot = hump(u, 0.12, 0.28, 0.66, 0.8) * 1.2;
          boltBack = hump(u, 0.28, 0.45, 0.48, 0.66) * 0.09;
          joltAt('back', 0.45, -1);
          joltAt('close', 0.8, 1.8);
          break;
        }
        case 'melee': {
          if (spec.cls === 'knife') {
            // antecipa (puxa para trás e para o lado), corta em arco rápido, segue e volta
            const s = a.side;
            const w = hump(u, 0, 0.18, 0.7, 1);
            const wind = hump(u, 0, 0.12, 0.12, 0.22);
            pos.z += 0.05 * wind;
            rot.y += 0.35 * s * wind;
            const sw = expOut(seg(u, 0.14, 0.4));
            joltAt('cut', 0.3, 1.4);
            pos.x += lerp(0.12 * s, -0.16 * s, sw) * w;
            pos.y += 0.05 * w;
            pos.z -= 0.12 * w;
            rot.y += lerp(0.9 * s, -0.9 * s, sw) * w;
            rot.z += lerp(-0.8 * s, 0.8 * s, sw) * w;
            bladeRot = 0;
          } else {
            // golpe com a arma: empurra a arma para a frente e para o lado
            const w = hump(u, 0, 0.25, 0.5, 1);
            pos.z -= 0.15 * w;
            pos.x -= 0.08 * w;
            rot.z += 0.6 * w;
          }
          break;
        }
        case 'inspect': {
          // vira a arma para ver o lado, levanta e devolve; a faca gira na mão
          const w = hump(u, 0, 0.2, 0.8, 1);
          rot.y += w * (spec.cls === 'knife' ? 0 : -1.1);
          rot.z += w * 0.5;
          pos.x -= w * 0.08;
          pos.y += w * 0.04;
          if (spec.cls === 'knife') bladeRot = ease(seg(u, 0.2, 0.7)) * Math.PI * 2;
          break;
        }
      }
      if (u >= 1) {
        this.action = null;
        gripLeft(this.handL, spec.cls, g.support);
      }
    }

    this.sway.position.set(0, 0, 0);
    this.holder.position.copy(pos);
    this.holder.rotation.copy(rot);
    movePart(g.parts.mag, V.set(0, -magDrop, 0));
    if (g.parts.mag) g.parts.mag.obj.visible = !(magDrop > 0.25);
    movePart(g.parts.bolt, V.set(0, 0, boltBack), 0);
    movePart(g.parts.slide, V.set(0, 0, boltBack));
    movePart(g.parts.charge, V.set(0, 0, chargeBack));
    movePart(g.parts.boltRot, V.set(0, 0, boltBack), boltRot);
    if (g.parts.blade) g.parts.blade.obj.rotation.z = bladeRot;
    // mangas: do pulso de cada mão (presa à arma) até o cotovelo, que sai da tela
    this.holder.updateMatrixWorld(true);
    placeArm(this.armR, this.handR.root.getWorldPosition(W1), 1);
    if (this.armL.visible) placeArm(this.armL, this.handL.root.getWorldPosition(W1), -1);
    // clarão da boca
    const on = now < this.flashUntil;
    this.flash.visible = on;
    this.flash.position.copy(g.muzzle).add(V.set(0, 0, -0.03));
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = on ? 3 : 0;
  }

  /** desenha por cima do que já está na tela */
  render(r: THREE.WebGLRenderer, visible: boolean) {
    if (!visible || !this.gun) return;
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.vm) o.geometry.dispose();
    });
  }
}

/** manga do antebraço (a mão é a `Hand`, presa à arma) */
function arm(): THREE.Group {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.036, 0.42, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x3b4436, roughness: 0.9 }),
  );
  sleeve.userData.vm = true;
  sleeve.name = 'sleeve';
  g.add(sleeve);
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a3026, roughness: 0.9 }),
  );
  cuff.userData.vm = true;
  cuff.name = 'cuff';
  g.add(cuff);
  return g;
}

const ELBOW = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DIRV = new THREE.Vector3();
/** manga do pulso `at` até o cotovelo (para trás, para baixo e para fora), no espaço da câmera */
function placeArm(g: THREE.Group, at: THREE.Vector3, side: number) {
  const sleeve = g.getObjectByName('sleeve')!;
  const cuff = g.getObjectByName('cuff')!;
  ELBOW.set(at.x + side * 0.16, at.y - 0.3, at.z + 0.42);
  DIRV.copy(at).sub(ELBOW).normalize();
  sleeve.position.copy(at).lerp(ELBOW, 0.5);
  sleeve.quaternion.setFromUnitVectors(UP, DIRV);
  cuff.position.copy(at).addScaledVector(DIRV, -0.035);
  cuff.quaternion.copy(sleeve.quaternion);
}

/** base a partir dos eixos da mão escritos no espaço da arma (x, y e z da mão) */
function basis(h: THREE.Object3D, x: THREE.Vector3Tuple, y: THREE.Vector3Tuple, z: THREE.Vector3Tuple) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  h.quaternion.setFromRotationMatrix(m);
}

/**
 * Mão direita: no punho (dorso para a direita, dedos dando a volta no punho, polegar por cima); na faca, empunhadura
 * de martelo (o cabo atravessa a mão fechada).
 */
function gripRight(h: Hand, cls: string, id: string) {
  if (id === 'karambit') {
    // karambit: cabo em pé dentro da mão fechada (argola em cima, no indicador), como o punho de uma pistola
    basis(h.root, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
    h.root.position.set(0.016, 0.004, 0.045);
    h.setCurl(0.92, 0.6);
    return;
  }
  if (cls === 'knife') {
    basis(h.root, [0, 0, 1], [1, 0, 0], [0, -1, 0]);
    h.root.position.set(0.012, 0.055, 0.0);
    h.setCurl(0.95, 0.7);
    return;
  }
  basis(h.root, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  h.root.position.set(0.018, -0.035, 0.075);
  h.setCurl(0.88, 0.5);
}

/** mão esquerda: no guarda-mão por baixo (dedos subindo pela direita); na pistola, por fora da direita */
function gripLeft(h: Hand, cls: string, support: THREE.Vector3) {
  if (cls === 'pistol') {
    basis(h.root, [0, 1, 0], [-1, 0, 0], [0, 0, 1]);
    h.root.position.set(-0.03, -0.05, 0.07);
    h.setCurl(0.75, 0.4);
    return;
  }
  // por baixo do guarda-mão, dedos subindo pela direita e o polegar por cima (C-clamp)
  basis(h.root, [0, 0, -1], [0, -1, 0], [-1, 0, 0]);
  h.root.position.copy(support).add(new THREE.Vector3(-0.045, -0.03, 0));
  h.setCurl(0.75, 0.85);
}

let flashTex: THREE.Texture | null = null;
/** estrela de clarão desenhada num canvas (sem arquivo) */
function flashTexture(): THREE.Texture | null {
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

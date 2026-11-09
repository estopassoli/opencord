/**
 * Primeira pessoa do gunfight: braços e arma desenhados por cima da cena (cena e câmera próprias, profundidade
 * limpa antes), para a arma nunca entrar na parede. Toda animação é feita aqui, em código, por cima das peças do
 * modelo: sacar, guardar, respirar, balançar com o mouse, passo, corrida (e a corrida tática, arma para cima), mirar,
 * coice do tiro com o ferrolho indo e voltando, recarga (a mão de apoio tira o pente, traz o novo e encaixa; vazio, puxa
 * a alavanca), ferrolho do sniper (a mão direita sai do punho e puxa), golpes da faca (alternando os lados) e a
 * inspeção. Os braços vão do ombro (fixo na câmera) até o pulso, com o cotovelo resolvido entre os dois.
 *
 * "Reduzir movimento": passo, balanço, inclinações e o giro do saque ficam em ~30%.
 */
import * as THREE from 'three';
import { FIST_HOLE, makeHand, type Hand } from '../hand';
import { flashTexture } from './fx';
import { leftGrip, rightGrip, type Grip } from './grips';
import { disposeGun, movePart, partBox, partCenter, type GunModel, type Part } from './models';
import type { GunSpec } from './weapons';

/** `reloadClip`: recarga por pente-lâmina (Kar98k); `heavy`: golpe pesado da faca (antecipa e estoca) */
export type VmAction =
  'draw' | 'fire' | 'reload' | 'reloadEmpty' | 'reloadClip' | 'bolt' | 'melee' | 'heavy' | 'inspect';

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
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
/** sai rápido e chega devagar (sem elástico) */
const expOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
/** sobe em [a,b] e desce em [c,d] (0–1) */
const hump = (u: number, a: number, b: number, c: number, d: number) => ease(seg(u, a, b)) * (1 - ease(seg(u, c, d)));

/** limites do balanço: quanto um quadro de mouse pode empurrar e quanto a arma pode ficar para trás (rad) */
const LOOK_MAX = 0.05;
const SWAY_MAX = 0.12;
/** ombros (fixos no espaço da câmera), braço e antebraço (m) e o z mais perto da câmera que a manga pode chegar */
const SHOULDER = { x: 0.2, y: -0.35, z: 0.1 };
const UPPER = 0.34;
const FORE = 0.28;
const ELBOW_MAX_Z = -0.08;
/** puxando a alavanca por cima: o cotovelo esquerdo fica mais longe da câmera, baixo e para fora */
const ELBOW_MAX_Z_OVER = -0.2;

// temporários do módulo (o update roda todo quadro: nada de alocar)
const V = new THREE.Vector3();
const W1 = new THREE.Vector3();
const POS = new THREE.Vector3();
const AIM = new THREE.Vector3();
const ROT = new THREE.Euler(0, 0, 0, 'YXZ');
// karambit: alto o bastante para a lâmina curva aparecer (senão parece um punho fechado)
const HIP_KNIFE = new THREE.Vector3(0.17, -0.16, -0.42);
// baioneta: o pulso fica 7 cm abaixo do cabo (pegada de martelo); sobe para a mão aparecer na tela
const HIP_BAYONET = new THREE.Vector3(0.16, -0.13, -0.42);
const HIP_PISTOL = new THREE.Vector3(0.11, -0.105, -0.31);
const HIP_LONG = new THREE.Vector3(0.14, -0.17, -0.46);
const GRIP_R = new THREE.Vector3();
const LEFT = new THREE.Vector3();
const MAG = new THREE.Vector3();
const HANDLE = new THREE.Vector3();
/** corrida tática: a mão esquerda solta a arma e desce para fora da tela (espaço da câmera) */
const LEFT_OFF = new THREE.Vector3(-0.22, -0.6, -0.2);
/** pegando a alavanca por cima: palma para baixo, dedos para a frente (o vão da mão fechada atravessa a alavanca) */
const OVER_Q = new THREE.Quaternion();
const OVER_AT = FIST_HOLE.clone().negate();
/** na recarga, o pulso esquerdo em relação ao fundo do pente: a palma (para cima) encosta embaixo dele (ver grips) */
const UNDER_MAG = new THREE.Vector3(-0.046, -0.04, 0);
const LEFT_Q = new THREE.Quaternion();

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private readonly sway = new THREE.Group();
  private readonly armR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly handR: Hand;
  private readonly handL: Hand;
  /** onde ficam as mãos no espaço da arma quando seguram (a animação sai e volta para cá) */
  private readonly rightAt = new THREE.Vector3();
  private readonly leftAt = new THREE.Vector3();
  private rightCurl: [number, number] = [0.88, 0.5];
  private leftCurl: [number, number] = [0.75, 0.85];
  /** onde fica o pente parado (espaço da arma), para a mão ir buscar, e o fundo dele (onde a palma encosta) */
  private readonly magHome = new THREE.Vector3();
  private readonly magBottom = new THREE.Vector3();
  /** a alavanca que se vê, parada (espaço da arma): a mão vai até ela na recarga vazia */
  private chargeHome: THREE.Vector3 | null = null;
  private readonly leftQ = new THREE.Quaternion();
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
  private readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly flashLight: THREE.PointLight;
  private flashUntil = 0;
  private now = 0;
  /** 1 normal; ~0,3 com "reduzir movimento" */
  private readonly motion: number;

  constructor(skin: THREE.ColorRepresentation, reducedMotion = false) {
    this.motion = reducedMotion ? 0.3 : 1;
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
    if (Math.abs(this.camera.aspect - a) < 1e-4) return;
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** troca a arma (com a animação de sacar); o modelo de antes é liberado */
  setGun(g: GunModel, spec: GunSpec) {
    if (this.gun && this.gun !== g) disposeGun(this.gun);
    this.gun = g;
    this.spec = spec;
    this.holder.add(g.root);
    // a primeira pessoa vê a arma com o próprio frustum (a câmera é outra): nunca some pelas bordas
    g.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.frustumCulled = false;
    });
    const knife = spec.cls === 'knife';
    this.armL.visible = !knife;
    this.handL.root.visible = !knife;
    applyGrip(this.handR, rightGrip(spec.cls, g.id, g.handle));
    this.rightAt.copy(this.handR.root.position);
    this.rightCurl = curlOf(this.handR);
    applyGrip(this.handL, leftGrip(spec.cls, g.support));
    this.leftAt.copy(this.handL.root.position);
    this.leftQ.copy(this.handL.root.quaternion);
    this.leftCurl = curlOf(this.handL);
    this.magHome.set(0, -0.06, 0.03);
    const mag = g.parts.mag;
    if (mag) {
      this.holder.updateMatrixWorld(true);
      partHome(mag, this.holder, this.magHome);
    }
    // o fundo do pente (o meio da caixa dele, embaixo); sem a caixa, um palpite abaixo do osso
    const box = mag ? partBox(g, mag) : null;
    if (box) this.magBottom.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    else this.magBottom.copy(this.magHome).add(V.set(0, -0.08, 0));
    const handle = g.parts.charge ?? g.parts.slide ?? g.parts.bolt;
    this.chargeHome = handle ? partCenter(g, handle) : null;
    this.play('draw', knife ? 380 : spec.cls === 'pistol' ? 420 : 600);
  }

  play(kind: VmAction, ms: number) {
    // faca: cada golpe leve sai de um lado
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

  /** a boca da arma no espaço da câmera do viewmodel (para o traçante sair dela) */
  muzzleView(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.gun) return null;
    return this.gun.root.localToWorld(out.copy(this.gun.muzzle));
  }

  update(dt: number, now: number, inp: VmInput) {
    this.now = now;
    const g = this.gun;
    const spec = this.spec;
    if (!g || !spec) return;
    const mo = this.motion;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.sprintK += ((inp.sprint && !inp.slide ? 1 : 0) - this.sprintK) * k(10);
    this.tacK += ((inp.tactical && !inp.slide ? 1 : 0) - this.tacK) * k(10);
    this.slideK += ((inp.slide ? 1 : 0) - this.slideK) * k(12);
    this.airK += ((inp.airborne ? 1 : 0) - this.airK) * k(8);
    // balanço: a arma fica para trás do mouse e volta (menos mirando); um tranco de mouse (ou a câmera virando de uma
    // vez) não joga a arma de lado
    const swayK = (1 - inp.ads * 0.85) * mo;
    const lx = clamp(inp.lookX, LOOK_MAX);
    const ly = clamp(inp.lookY, LOOK_MAX);
    this.swayX = clamp(this.swayX + (-lx * 0.9 * swayK - this.swayX) * k(14), SWAY_MAX);
    this.swayY = clamp(this.swayY + (ly * 0.9 * swayK - this.swayY) * k(14), SWAY_MAX);
    // passo: um oito, mais largo correndo
    const pace = inp.sprint ? (inp.tactical ? 15 : 12) : 8;
    if (inp.moving > 0.05 && !inp.airborne && !inp.slide) this.bob += dt * pace;
    // coice: mola (sobe e volta)
    this.kickV += (-this.kick * 170 - this.kickV * 18) * dt;
    this.kick += this.kickV * dt;
    this.joltV += (-this.jolt * 260 - this.joltV * 16) * dt;
    this.jolt += this.joltV * dt;

    // faca não mira (o botão direito dela é o golpe pesado)
    const knife = spec.cls === 'knife';
    const ads = knife ? 0 : ease(inp.ads);
    const hip = knife ? (g.id === 'bayonet' ? HIP_BAYONET : HIP_KNIFE) : spec.cls === 'pistol' ? HIP_PISTOL : HIP_LONG;
    // mirando: a linha de mira passa pelo centro da tela, um pouco à frente do olho (na luneta, o olho na ocular)
    const eyeZ = spec.cls === 'pistol' ? -0.34 : spec.scope ? -0.07 : -0.2;
    AIM.set(-g.sight.x, -g.sight.y, eyeZ - g.sight.z);
    const pos = POS.copy(hip).lerp(AIM, ads);
    const rot = ROT.set(0, 0, 0, 'YXZ');
    // no quadril, o cano aponta um pouco para o centro da tela (e a faca com a ponta para cima)
    rot.y += (knife ? 0.35 : 0.06) * (1 - ads);
    rot.z += knife ? 0 : -0.08 * (1 - ads);
    rot.x += knife ? 0.35 : 0;
    // karambit: a ponta vira para dentro e o pulso gira para a face da lâmina aparecer (de fio, ela some)
    if (g.id === 'karambit') {
      rot.z -= 0.3 * (1 - ads);
      rot.y += 0.4;
    }
    const bobA = inp.moving * (1 - ads * 0.85) * (inp.crouch ? 0.6 : 1) * mo;
    pos.x += Math.sin(this.bob) * 0.012 * bobA;
    pos.y += Math.abs(Math.cos(this.bob)) * -0.012 * bobA;
    // respirar parado
    pos.y += Math.sin(now / 900) * 0.0025 * (1 - ads * 0.8) * mo;
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
    rot.x += sp * -0.15 + Math.sin(this.bob * 2) * 0.03 * this.sprintK * mo;
    // tática: a arma vai mais para a direita com o cano virado para dentro (a mão esquerda solta, ver abaixo)
    pos.y += this.tacK * 0.04;
    pos.x += this.tacK * 0.06;
    rot.x += this.tacK * 0.9;
    rot.z += this.tacK * 0.5;
    rot.y += this.tacK * 0.25;
    // deslizando: a arma inclina; no ar, sobe um pouco
    rot.z += this.slideK * 0.45 * mo;
    pos.y += this.slideK * 0.02 + this.airK * 0.015;
    // tranco dos encaixes
    rot.x += this.jolt * 0.035 * mo;
    pos.y += this.jolt * 0.004;
    // coice
    pos.z += this.kick * (spec.cls === 'sniper' ? 0.06 : 0.04);
    rot.x += this.kick * (spec.cls === 'sniper' ? 0.22 : 0.1);
    // peças: ferrolho (e o da pistola) indo e voltando, pente, alavanca, lâmina
    let boltBack = 0;
    let boltRot = 0;
    let chargeBack = 0;
    let bladeRot = 0;
    /** deslocamento do pente (espaço da arma) */
    MAG.set(0, 0, 0);
    // mãos: onde seguram (a animação puxa para outro ponto e devolve)
    GRIP_R.copy(this.rightAt);
    let rightK = 0;
    let rightCurl = this.rightCurl[0];
    LEFT.copy(this.leftAt);
    let leftCurl = this.leftCurl[0];
    let leftThumb = this.leftCurl[1];
    /** a mão esquerda vira para pegar a alavanca por cima (0 no apoio, 1 na alavanca) */
    let leftOver = 0;

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
          rot.x -= 0.9 * w * mo;
          rot.z += 0.3 * w * mo;
          break;
        }
        case 'fire':
          if (spec.cls !== 'sniper') boltBack = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.035;
          break;
        case 'reload':
        case 'reloadEmpty': {
          const empty = a.kind === 'reloadEmpty';
          const pistol = spec.cls === 'pistol';
          // inclina a arma; a mão de apoio vai ao fundo do pente, ele sai na mão, ela leva embora e traz o novo, encaixa
          // com um tapa; (vazio) a mão puxa a alavanca; volta para o apoio. A arma sobe e inclina para o pente e a mão
          // ficarem na tela (a pistola, que fica baixa, sobe mais)
          const tilt = hump(u, 0, 0.15, 0.85, 1);
          rot.z -= tilt * 0.55 * mo;
          rot.x += tilt * (pistol ? 0.45 : 0.3);
          pos.y += tilt * (pistol ? 0.1 : 0.06);
          pos.x -= tilt * 0.03;
          joltAt('out', 0.2, -1.2);
          joltAt('seat', 0.62, 2.4);
          if (empty) joltAt('release', 0.84, 2);
          // a mão chega ao pente (0,08–0,18) e fica com ele até encaixar (0,62); o pente desce na mão (0,18–0,32), vai
          // embora com ela e volta (0,32–0,55) e encaixa (0,55–0,62)
          const reachK = pistol ? 0.05 : 0.12;
          const drop = ease(seg(u, 0.18, 0.32)) * (1 - ease(seg(u, 0.55, 0.62))) * reachK;
          const away = hump(u, 0.32, 0.43, 0.44, 0.55);
          MAG.set(-0.06 * away, -drop - (pistol ? 0.05 : 0.1) * away, 0.04 * away);
          const toMag = hump(u, 0.08, 0.18, 0.62, 0.74);
          if (pistol)
            V.copy(this.magHome)
              .add(MAG)
              .add(W1.set(-0.03, -0.075, 0.02));
          else V.copy(this.magBottom).add(MAG).add(UNDER_MAG);
          LEFT.lerp(V, toMag);
          leftCurl = lerp(leftCurl, 0.75, toMag);
          leftThumb = lerp(leftThumb, 0.6, toMag);
          if (empty) {
            // a mão esquerda vai até a alavanca, puxa e solta
            const reach = hump(u, 0.64, 0.7, 0.82, 0.9);
            const pull = hump(u, 0.7, 0.75, 0.77, 0.82);
            chargeBack = pull * 0.07;
            boltBack = Math.max(boltBack, pull * 0.05);
            rot.x += pull * 0.06;
            // a alavanca que se vê (não a origem do osso): a mão vem por cima, fecha nela e puxa para trás
            if (this.chargeHome) {
              HANDLE.copy(this.chargeHome);
              HANDLE.z += Math.max(chargeBack, boltBack);
              LEFT.lerp(HANDLE.add(OVER_AT), reach);
              leftCurl = lerp(leftCurl, 0.8, reach);
              leftThumb = lerp(leftThumb, 0.7, reach);
              leftOver = reach;
            }
          }
          break;
        }
        case 'reloadClip': {
          // pente-lâmina (Kar98k): a mão direita abre o ferrolho (gira e puxa), o polegar esquerdo empurra as balas duas
          // vezes por cima do receptor, o ferrolho fecha e a mão direita volta ao punho
          const tilt = hump(u, 0, 0.12, 0.85, 1);
          rot.z -= tilt * 0.3 * mo;
          rot.x += tilt * 0.15;
          pos.y += tilt * 0.04;
          boltRot = hump(u, 0.08, 0.18, 0.74, 0.82) * 1.2;
          boltBack = hump(u, 0.18, 0.3, 0.66, 0.74) * 0.09;
          rightK = hump(u, 0.0, 0.08, 0.84, 0.94);
          rightCurl = lerp(rightCurl, 0.6, rightK);
          joltAt('open', 0.3, -1);
          joltAt('press1', 0.46, 1.2);
          joltAt('press2', 0.58, 1.2);
          joltAt('close', 0.8, 1.8);
          if (this.chargeHome) {
            // a mão esquerda por cima do receptor (na frente do ferrolho aberto), o polegar empurra para baixo duas vezes
            const over = hump(u, 0.26, 0.36, 0.62, 0.7);
            const press = hump(u, 0.4, 0.44, 0.46, 0.5) + hump(u, 0.52, 0.56, 0.58, 0.62);
            HANDLE.copy(this.chargeHome).add(OVER_AT);
            HANDLE.y += 0.03 - press * 0.025;
            HANDLE.z -= 0.04;
            LEFT.lerp(HANDLE, over);
            leftCurl = lerp(leftCurl, 0.5, over);
            leftThumb = lerp(leftThumb, 0.2 + press * 0.6, over);
            leftOver = over;
          }
          break;
        }
        case 'bolt': {
          // sniper: abaixa um pouco; a mão direita sai do punho, pega a alavanca, gira, puxa, empurra, gira de volta
          // e volta para o punho
          const w = hump(u, 0, 0.12, 0.85, 1);
          pos.y -= w * 0.02;
          rot.z -= w * 0.15 * mo;
          boltRot = hump(u, 0.12, 0.28, 0.66, 0.8) * 1.2;
          boltBack = hump(u, 0.28, 0.45, 0.48, 0.66) * 0.09;
          joltAt('back', 0.45, -1);
          joltAt('close', 0.8, 1.8);
          rightK = hump(u, 0.02, 0.12, 0.8, 0.95);
          rightCurl = lerp(rightCurl, 0.6, rightK);
          break;
        }
        case 'melee': {
          if (knife) {
            // antecipa (puxa para trás e para o lado, ~100 ms), corta em arco rápido passando pela mira, segue e volta
            const s = a.side;
            const w = hump(u, 0, 0.18, 0.7, 1);
            const wind = hump(u, 0, 0.16, 0.18, 0.28);
            pos.z += 0.05 * wind;
            rot.y += 0.35 * s * wind;
            const sw = expOut(seg(u, 0.2, 0.45));
            joltAt('cut', 0.32, 1.4);
            // o arco dos dois lados cruza o centro da tela (o da esquerda começa mais para dentro)
            const inward = s < 0 ? -0.08 : 0;
            pos.x += (lerp(0.12 * s, -0.16 * s, sw) + inward) * w;
            pos.y += 0.05 * w;
            pos.z -= 0.12 * w;
            rot.y += lerp(0.9 * s, -0.9 * s, sw) * w;
            rot.z += lerp(-0.8 * s, 0.8 * s, sw) * w;
          } else {
            // golpe com a arma: empurra a arma para a frente e para o lado
            const w = hump(u, 0, 0.25, 0.5, 1);
            pos.z -= 0.15 * w;
            pos.x -= 0.08 * w;
            rot.z += 0.6 * w * mo;
          }
          break;
        }
        case 'heavy': {
          // golpe pesado da faca: antecipação longa (a mão recua e sobe), estocada reta para a frente (sem arco) com a
          // ponta para a frente, tranco forte no fim da estocada e volta devagar
          const wind = ease(seg(u, 0, 0.35)) * (1 - expOut(seg(u, 0.35, 0.5)));
          const thrust = expOut(seg(u, 0.35, 0.5)) * (1 - ease(seg(u, 0.68, 1)));
          joltAt('stab', 0.47, 3);
          pos.z += 0.06 * wind - 0.2 * thrust;
          pos.y += 0.03 * wind + 0.02 * thrust;
          pos.x -= 0.06 * thrust;
          // a ponta inclina para a frente só até a metade: alinhada com a vista, a lâmina some atrás da mão
          rot.x += 0.2 * wind * mo - 0.22 * thrust;
          rot.y -= 0.1 * thrust;
          break;
        }
        case 'inspect': {
          // vira a arma para ver o lado, levanta e devolve. Karambit: a lâmina gira na mão; baioneta: o pulso vira e
          // mostra uma face e depois a outra (girar a lâmina no eixo comprido, de fio para a câmera, não mostraria nada)
          const w = hump(u, 0, 0.2, 0.8, 1);
          rot.y += w * (knife ? 0 : -1.1);
          rot.z += w * 0.5;
          pos.x -= w * 0.08;
          pos.y += w * 0.04;
          if (g.id === 'bayonet') {
            rot.y += w * lerp(0.9, -0.9, ease(seg(u, 0.4, 0.6)));
            rot.x -= w * 0.3;
          } else if (knife) bladeRot = ease(seg(u, 0.2, 0.7)) * Math.PI * 2;
          break;
        }
      }
      if (u >= 1) this.action = null;
    }
    // pegando a alavanca por cima: a arma vai para a frente e para a esquerda e inclina, a alavanca vem para a mão (o
    // antebraço esquerdo não passa na frente da câmera)
    if (leftOver > 0) {
      pos.z -= 0.1 * leftOver;
      pos.x -= 0.05 * leftOver;
      pos.y -= 0.02 * leftOver;
      rot.z += 0.25 * leftOver;
    }

    this.sway.position.set(0, 0, 0);
    this.holder.position.copy(pos);
    this.holder.rotation.copy(rot);
    movePart(g.parts.mag, MAG);
    movePart(g.parts.bolt, V.set(0, 0, boltBack), 0);
    movePart(g.parts.slide, V.set(0, 0, boltBack));
    movePart(g.parts.charge, V.set(0, 0, chargeBack));
    movePart(g.parts.boltRot, V.set(0, 0, boltBack), boltRot);
    if (g.parts.blade) g.parts.blade.obj.rotation.z = bladeRot;
    this.holder.updateMatrixWorld(true);
    // ferrolho: a mão direita segue a alavanca (que já está no lugar deste quadro)
    if (rightK > 0) {
      const handle = g.parts.charge ?? g.parts.boltRot ?? g.parts.bolt;
      if (handle) {
        partNow(handle, this.holder, HANDLE);
        GRIP_R.lerp(HANDLE.add(V.set(0.03, -0.025, 0.06)), rightK);
      }
    }
    this.handR.root.position.copy(GRIP_R);
    this.handR.setCurl(rightCurl, this.rightCurl[1]);
    // corrida tática: a mão esquerda solta e desce para fora da tela (o braço não estica até a arma)
    if (this.tacK > 0.01) LEFT.lerp(this.holder.worldToLocal(V.copy(LEFT_OFF)), this.tacK);
    this.handL.root.position.copy(LEFT);
    this.handL.root.quaternion.copy(LEFT_Q.copy(this.leftQ).slerp(OVER_Q, leftOver));
    this.handL.setCurl(leftCurl, leftThumb);
    this.handR.root.updateMatrixWorld(true);
    this.handL.root.updateMatrixWorld(true);
    // braços: do ombro (fixo na câmera) até o pulso de cada mão
    placeArm(this.armR, this.handR.root.getWorldPosition(W1), 1);
    if (this.armL.visible) placeArm(this.armL, this.handL.root.getWorldPosition(W1), -1, leftOver);
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

  /** libera tudo: a arma, as mãos, as mangas e o clarão */
  dispose() {
    if (this.gun) disposeGun(this.gun);
    this.gun = null;
    this.handR.dispose();
    this.handL.dispose();
    for (const g of [this.armR, this.armL])
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    this.flash.geometry.dispose();
    this.flash.material.dispose();
    this.flashLight.dispose();
  }
}

/** a posição de uma peça agora, no espaço do `holder` (a arma) */
function partNow(p: Part, holder: THREE.Object3D, out: THREE.Vector3) {
  p.obj.getWorldPosition(out);
  return holder.worldToLocal(out);
}
/** a posição da peça parada (o pente no lugar) */
function partHome(p: Part, holder: THREE.Object3D, out: THREE.Vector3) {
  movePart(p, V.set(0, 0, 0));
  p.obj.updateMatrixWorld(true);
  return partNow(p, holder, out);
}

function curlOf(h: Hand): [number, number] {
  return (h.root.userData.curl as [number, number] | undefined) ?? [0.8, 0.6];
}
function setGrip(h: Hand, c: number, t: number) {
  h.root.userData.curl = [c, t];
  h.setCurl(c, t);
}

/** manga do braço (do ombro ao cotovelo) e do antebraço (do cotovelo ao pulso); a mão é a `Hand`, presa à arma */
function arm(): THREE.Group {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3b4436, roughness: 0.9 });
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, FORE, 4, 10), cloth);
  fore.name = 'fore';
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, UPPER, 4, 10), cloth.clone());
  upper.name = 'upper';
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a3026, roughness: 0.9 }),
  );
  cuff.name = 'cuff';
  g.add(fore, upper, cuff);
  return g;
}

const ELBOW = new THREE.Vector3();
const SH = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DIRV = new THREE.Vector3();
const POLE = new THREE.Vector3();
/**
 * O ombro no espaço da câmera. Com `over` (a mão por cima da arma), o ombro esquerdo abre para fora e para a frente: o
 * braço chega à alavanca vindo do lado, sem atravessar a tela na frente da arma.
 */
function shoulderAt(side: number, over: number, out: THREE.Vector3) {
  return out.set(SHOULDER.x * side * (1 + 0.7 * over), SHOULDER.y + 0.05 * over, SHOULDER.z - 0.1 * over);
}

/**
 * Braço de dois ossos no espaço da câmera: ombro fixo, pulso em `at`, cotovelo pela lei dos cossenos, dobrando para
 * baixo e para fora. O cotovelo nunca chega perto da câmera (senão a manga cobre a tela na corrida tática).
 */
export function solveElbow(at: THREE.Vector3, side: number, out: THREE.Vector3, over = 0): THREE.Vector3 {
  shoulderAt(side, over, SH);
  DIRV.copy(at).sub(SH);
  const d = Math.max(Math.abs(UPPER - FORE) + 1e-3, Math.min(UPPER + FORE - 1e-3, DIRV.length()));
  DIRV.normalize();
  const along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
  // `over` (a mão por cima da arma, puxando a alavanca): o cotovelo vai mais para fora e para longe da câmera
  POLE.set(lerp(side * 0.7, side, over), lerp(-1, -0.6, over), lerp(0.15, 0, over));
  POLE.addScaledVector(DIRV, -POLE.dot(DIRV)).normalize();
  out.copy(SH).addScaledVector(DIRV, along).addScaledVector(POLE, h);
  out.z = Math.min(out.z, lerp(ELBOW_MAX_Z, ELBOW_MAX_Z_OVER, over));
  return out;
}

function placeArm(g: THREE.Group, at: THREE.Vector3, side: number, over = 0) {
  const fore = g.getObjectByName('fore')!;
  const upper = g.getObjectByName('upper')!;
  const cuff = g.getObjectByName('cuff')!;
  solveElbow(at, side, ELBOW, over);
  // antebraço: do cotovelo ao pulso (estica a cápsula se o cotovelo foi empurrado)
  DIRV.copy(at).sub(ELBOW);
  const fl = DIRV.length();
  DIRV.divideScalar(fl || 1);
  // nunca estica a manga além do tamanho (vira um tubo atravessando a tela): presa no pulso; se a mão não alcança, o
  // vão fica no cotovelo
  const k = Math.min(1, fl / (FORE + 0.072));
  fore.position.copy(at).addScaledVector(DIRV, (-(FORE + 0.072) * k) / 2);
  fore.quaternion.setFromUnitVectors(UP, DIRV);
  fore.scale.set(1, k, 1);
  cuff.position.copy(at).addScaledVector(DIRV, -0.035);
  cuff.quaternion.copy(fore.quaternion);
  // braço: do ombro ao cotovelo
  shoulderAt(side, over, SH);
  DIRV.copy(ELBOW).sub(SH);
  const ul = DIRV.length();
  DIRV.divideScalar(ul || 1);
  upper.position.copy(SH).lerp(ELBOW, 0.5);
  upper.quaternion.setFromUnitVectors(UP, DIRV);
  upper.scale.set(1, ul / (UPPER + 0.09), 1);
}

/** põe a mão na pegada (posição, giro e dedos) e guarda os dedos para a animação voltar a eles */
function applyGrip(h: Hand, g: Grip) {
  h.root.position.copy(g.pos);
  h.root.quaternion.copy(g.quat);
  setGrip(h, g.curl[0], g.curl[1]);
}

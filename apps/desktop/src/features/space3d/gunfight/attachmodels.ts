/**
 * Os acessórios do armeiro em 3D, feitos em código no estilo das armas (poucos polígonos, peças juntadas por material
 * com o `Kit`): miras no trilho de cima (ponto vermelho, holográfica, luneta 3x, ponto de pistola no ferrolho, luneta
 * clássica da Kar98k e a alavanca da luneta variável), peças da boca rosqueadas no fim do cano (supressor,
 * compensador, quebra-chamas), empunhaduras sob o guarda-mão (vertical e angulada) e o carregador estendido preso ao
 * pente (desce e volta com ele na recarga).
 *
 * `makeBuiltGun` monta e ajusta o modelo: a linha de mira passa a ser a da mira (a primeira pessoa alinha o olho
 * nela), a boca anda para a ponta da peça nova, a mão de apoio vai para a empunhadura vertical e o vidro das miras de
 * ponto ganha o retículo aceso (`aimReticles` põe o ponto onde a linha do olho cruza o vidro, a cada quadro: ele fica
 * no centro da tela mesmo com a arma balançando, como numa mira sem paralaxe). Tudo é do modelo (`disposeGun` libera).
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';
import { buildKey, type GunBuild, type MuzzleId, type OpticId } from './attachments';
import { Kit, chamfered, makeGun, mat, meshG, own, type GunModel, type Part, type Reticle } from './models';
import { GUNS, type GunClass } from './weapons';

/** onde cada arma recebe os acessórios (espaço da arma: frente em −z, cima em +y, origem no punho, metros) */
interface Mount {
  /** topo do trilho (y) e o meio da mira (z) */
  top?: [number, number];
  /** a mira vai presa ao ferrolho da pistola (anda junto no tiro) */
  slide?: boolean;
  /** raio do cano na boca (a peça da boca encaixa em volta) */
  r: number;
  /** a empunhadura fica tanto à frente (−) ou atrás (+) da mão de apoio de fábrica (m) */
  gripDz?: number;
  /** a peça da boca entra tanto por cima da ponta do cano (cobre o quebra-chamas de fábrica), em m */
  over?: number;
}

const MOUNT: Partial<Record<GunId, Mount>> = {
  m4: { top: [0.11, -0.13], r: 0.011, over: 0.035 },
  ak47: { top: [0.0975, -0.02], r: 0.009, gripDz: -0.04, over: 0.04 },
  mp7: { top: [0.1, -0.005], r: 0.008, gripDz: 0.01, over: 0.02 },
  mp5: { top: [0.131, -0.055], r: 0.008, over: 0.012 },
  l115: { r: 0.012 },
  m200: { r: 0.024 },
  kar98k: { top: [0.096, -0.385], r: 0.009 },
  m9: { top: [0.074, -0.005], slide: true, r: 0.01 },
  deagle: { top: [0.094, -0.125], r: 0.012 },
};

/**
 * A anilha de zoom da luneta variável, na ocular da luneta de cada sniper: z do anel, raio do tubo ali e a altura do
 * eixo óptico (medidos no modelo).
 */
const EYEPIECE: Partial<Record<GunId, { z: number; r: number }>> = {
  l115: { z: 0.045, r: 0.0175 },
  m200: { z: 0.066, r: 0.0172 },
};

/** a arma montada: o modelo de fábrica com os acessórios da montagem (sem montagem, o de fábrica) */
export function makeBuiltGun(id: GunId, build?: GunBuild): GunModel | null {
  const g = makeGun(id);
  if (!g) return null;
  if (build && buildKey(build)) mountAttachments(g, build);
  return g;
}

/** monta os acessórios no modelo (uma vez, logo depois de criar) e ajusta os pontos dele */
export function mountAttachments(g: GunModel, build: GunBuild) {
  const spec = GUNS[g.id];
  const m = MOUNT[g.id];
  if (!m || spec.cls === 'knife') return;
  g.root.updateMatrixWorld(true);
  if (build.optic) mountOptic(g, m, build.optic);
  if (build.muzzle) mountMuzzle(g, m, build.muzzle, spec.cls);
  if (build.under) mountUnder(g, m, build.under);
  if (build.mag) mountMag(g, spec.cls);
  g.buildKey = buildKey(build);
  g.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.att) o.castShadow = true;
  });
}

// ---------------------------------------------------------------- materiais

/** corpo dos acessórios: polímero e alumínio escuros, um pouco mais claros que as armas (lê como peça à parte) */
function mats() {
  return {
    body: mat(0x24262a, 0.55, 0.45),
    /** tubo aberto (o vidro fica dentro): desenhado dos dois lados */
    tube: own(
      new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
    ),
    dark: mat(0x141517, 0.8, 0.15),
    metal: mat(0x3a3d42, 0.4, 0.7),
    glass: mat(0x1c3442, 0.08, 0.9),
    accent: mat(0xc0392b, 0.5, 0.2),
  };
}
type Mats = ReturnType<typeof mats>;

/** marca as malhas como acessório (o `partBox` conta as do pente; a sombra liga depois) */
function tag(o: THREE.Object3D): THREE.Object3D {
  o.traverse((x) => {
    x.userData.att = true;
  });
  return o;
}

/** cilindro aberto deitado ao longo de z, de `z0` (trás) a `z1` (frente) */
function openTube(r: number, z0: number, z1: number, y: number, seg = 16): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, Math.abs(z0 - z1), seg, 1, true)
    .rotateX(-Math.PI / 2)
    .translate(0, y, (z0 + z1) / 2);
}

// ---------------------------------------------------------------- miras

const RETICLE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Retículo aceso no vidro: o ponto (e o anel da holográfica) é desenhado pelo ângulo até o ponto em que a linha do
 * olho cruza o vidro (`uDot`, na mesma unidade do vidro; `uDist` = a distância do olho até ele): tamanho fixo na tela,
 * de qualquer distância. Vidro levemente azulado, mais forte na borda.
 */
const RETICLE_FRAG = /* glsl */ `
uniform vec2 uDot;
uniform float uDist;
uniform float uKind;
uniform float uR;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float a = length(vP - uDot) / max(uDist, 1e-4);
  float aa = max(fwidth(a), 1e-5);
  float dotR = uKind > 1.5 ? 0.0046 : 0.0038;
  float m = 1.0 - smoothstep(dotR - aa, dotR + aa, a);
  if (uKind > 0.5 && uKind < 1.5) {
    float ring = 1.0 - smoothstep(0.0016 - aa, 0.0016 + aa, abs(a - 0.03));
    m = max(m, ring * 0.95);
  }
  float glow = exp(-a * a / (2.0 * 0.006 * 0.006)) * 0.5;
  float edge = smoothstep(uR * 0.7, uR, length(vP));
  vec3 tint = vec3(0.30, 0.50, 0.62);
  float k = clamp(m + glow, 0.0, 1.0);
  gl_FragColor = vec4(mix(tint, uColor, k), clamp(0.06 + edge * 0.22 + m + glow * 0.5, 0.0, 1.0));
}`;

/** o vidro com o retículo (0 ponto, 1 anel e ponto, 2 ponto de pistola), já no lugar dentro da mira */
function reticle(geo: THREE.BufferGeometry, kind: 0 | 1 | 2, r: number, y: number, z: number): Reticle {
  const uniforms = {
    uDot: { value: new THREE.Vector2(0, 0) },
    uDist: { value: 0.3 },
    uKind: { value: kind },
    uR: { value: r },
    uColor: { value: new THREE.Color(1, 0.16, 0.12) },
  };
  const m = own(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: RETICLE_VERT,
      fragmentShader: RETICLE_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  const mesh = meshG(geo, m);
  mesh.position.set(0, y, z);
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

interface Optic {
  group: THREE.Group;
  /** altura da linha de mira acima da base */
  axis: number;
  reticle?: Reticle;
}

/** ponto vermelho em tubo: base com elevação, tubo aberto com o vidro do retículo na frente, botão do brilho */
function redDot(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.038;
  new Kit()
    .box(t.body, 0.024, 0.008, 0.034, 0, 0.004, 0)
    .box(t.dark, 0.026, 0.004, 0.012, 0, 0.004, 0.006)
    .front(t.body, chamfered(0.016, 0.008, A - 0.012, 0.003), 0.014, -0.014)
    .add(openTube(0.0172, 0.03, -0.03, A, 18), t.tube)
    .add(openTube(0.0188, 0.03, 0.022, A, 18), t.dark)
    .add(openTube(0.0192, -0.026, -0.036, A, 18), t.dark)
    .add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.009, 10).rotateZ(Math.PI / 2).translate(0.021, A, 0.004), t.body)
    .add(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10).rotateZ(Math.PI / 2).translate(0.0265, A, 0.004), t.accent)
    .add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 10).translate(0, A + 0.021, 0.004), t.body)
    .bake(group);
  const r = reticle(new THREE.CircleGeometry(0.0158, 24), 0, 0.0158, A, -0.024);
  group.add(r.mesh);
  return { group, axis: A, reticle: r };
}

/**
 * holográfica: base longa com a caixa da eletrônica atrás, e a janela retangular à frente dela num capuz de quatro
 * colunas finas (vazado dos lados: de perfil se vê através), com a ponte de cima; vidro grande com o retículo
 */
function holo(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.033;
  const W = 0.038;
  const Z0 = 0.008;
  const Z1 = -0.036;
  const k = new Kit()
    .box(t.body, 0.03, 0.011, 0.084, 0, 0.0055, -0.006)
    .box(t.dark, 0.032, 0.004, 0.016, 0, 0.004, 0.022)
    // a caixa da eletrônica atrás da janela, com os botões e a marca acesa
    .front(t.body, chamfered(0.03, 0.011, 0.019, 0.004, 0), 0.034, Z0)
    .box(t.dark, 0.008, 0.003, 0.008, -0.008, 0.02, 0.024)
    .box(t.dark, 0.008, 0.003, 0.008, 0.002, 0.02, 0.024)
    .box(t.accent, 0.004, 0.0025, 0.004, 0.011, 0.0195, 0.024)
    // fundo da janela e as quatro colunas do capuz
    .box(t.dark, W, 0.003, Z0 - Z1, 0, 0.0125, (Z0 + Z1) / 2);
  for (const sx of [1, -1])
    for (const z of [Z0 - 0.003, Z1 + 0.003]) k.box(t.body, 0.004, 0.042, 0.006, sx * (W / 2 + 0.002), 0.032, z);
  k.front(t.body, chamfered(W + 0.008, 0.053, 0.058, 0.0025, 0), Z0, Z1)
    .box(t.body, 0.004, 0.003, Z0 - Z1, W / 2 + 0.002, 0.0125, (Z0 + Z1) / 2)
    .box(t.body, 0.004, 0.003, Z0 - Z1, -W / 2 - 0.002, 0.0125, (Z0 + Z1) / 2)
    .bake(group);
  const r = reticle(new THREE.PlaneGeometry(W - 0.002, 0.039), 1, 0.021, A, Z1 + 0.012);
  group.add(r.mesh);
  return { group, axis: A, reticle: r };
}

/** luneta 3x de prisma: corpo alto e chanfrado, objetiva na frente, ocular com borracha, a fibra acesa em cima */
function prism(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.04;
  new Kit()
    .box(t.body, 0.026, 0.01, 0.05, 0, 0.005, 0)
    .box(t.metal, 0.03, 0.006, 0.014, 0, 0.006, 0.01)
    .front(t.body, chamfered(0.036, 0.01, 0.058, 0.009, 0.004), 0.034, -0.036)
    .tube(t.body, 0.0185, 0.0205, -0.036, -0.072, 0, A, 16)
    .tube(t.dark, 0.021, 0.021, -0.072, -0.08, 0, A, 16)
    .add(new THREE.CircleGeometry(0.0185, 16).rotateY(Math.PI).translate(0, A, -0.0802), t.glass)
    .tube(t.body, 0.0145, 0.0155, 0.034, 0.056, 0, A, 16)
    .tube(t.dark, 0.0165, 0.0165, 0.056, 0.068, 0, A, 16)
    .add(new THREE.CircleGeometry(0.0145, 16).translate(0, A, 0.0682), t.glass)
    .box(t.accent, 0.005, 0.004, 0.044, 0, 0.06, 0.002)
    .add(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10).rotateZ(Math.PI / 2).translate(0.022, A, 0), t.body)
    .bake(group);
  return { group, axis: A };
}

/** ponto de pistola: base baixa, janela inclinada de duas colunas e o vidro; a lente do retículo na janela */
function pistolDot(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.0155;
  new Kit()
    .box(t.body, 0.021, 0.006, 0.032, 0, 0.003, 0)
    .box(t.body, 0.003, 0.02, 0.008, 0.0095, 0.014, -0.01)
    .box(t.body, 0.003, 0.02, 0.008, -0.0095, 0.014, -0.01)
    .box(t.body, 0.022, 0.004, 0.009, 0, 0.0255, -0.01)
    .box(t.dark, 0.012, 0.006, 0.01, 0, 0.007, 0.011)
    .box(t.accent, 0.003, 0.003, 0.003, 0.007, 0.0075, 0.012)
    .bake(group);
  const r = reticle(new THREE.PlaneGeometry(0.016, 0.019), 2, 0.011, A, -0.0095);
  group.add(r.mesh);
  return { group, axis: A, reticle: r };
}

/**
 * Luneta clássica da Kar98k: tubo fino e longo à frente da culatra (o pente-lâmina ainda entra por cima), nos dois
 * anéis em pé sobre o cano; a base em 0 é o topo do cano, o eixo 3,2 cm acima.
 */
function classicScope(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.032;
  const k = new Kit()
    .tube(t.body, 0.0105, 0.0105, 0.105, -0.1, 0, A, 14)
    .tube(t.body, 0.0105, 0.0135, 0.105, 0.125, 0, A, 14)
    .tube(t.dark, 0.0135, 0.0135, 0.125, 0.134, 0, A, 14)
    .add(new THREE.CircleGeometry(0.012, 14).translate(0, A, 0.1342), t.glass)
    .tube(t.body, 0.0105, 0.015, -0.1, -0.125, 0, A, 14)
    .tube(t.body, 0.015, 0.015, -0.125, -0.14, 0, A, 14)
    .add(new THREE.CircleGeometry(0.0145, 14).rotateY(Math.PI).translate(0, A, -0.1402), t.glass);
  for (const z of [0.06, -0.06]) {
    k.add(new THREE.TorusGeometry(0.0118, 0.0028, 6, 14).translate(0, A, z), t.metal);
    k.box(t.metal, 0.008, A - 0.012, 0.012, 0, (A - 0.012) / 2, z);
    k.box(t.metal, 0.018, 0.006, 0.02, 0, 0.003, z);
  }
  k.bake(group);
  return { group, axis: A };
}

/** a luneta variável: anel de zoom com a marca e a alavanca de troca, por cima da ocular da luneta da sniper */
function zoomLever(g: GunModel, t: Mats): THREE.Group | null {
  const e = EYEPIECE[g.id];
  if (!e) return null;
  const group = new THREE.Group();
  const y = g.sight.y;
  new Kit()
    .tube(t.dark, e.r + 0.002, e.r + 0.002, e.z + 0.009, e.z - 0.009, 0, y, 18)
    .box(t.accent, 0.003, 0.004, 0.012, 0, y + e.r + 0.003, e.z)
    .box(t.metal, 0.005, 0.028, 0.006, e.r + 0.003, y + 0.012, e.z)
    .box(t.dark, 0.008, 0.008, 0.008, e.r + 0.004, y + 0.027, e.z)
    .bake(group);
  return group;
}

function mountOptic(g: GunModel, m: Mount, id: OpticId) {
  const t = mats();
  if (id === 'lpvo') {
    const lever = zoomLever(g, t);
    if (lever) g.root.add(tag(lever));
    return;
  }
  if (!m.top) return;
  const o =
    id === 'reddot'
      ? redDot(t)
      : id === 'holo'
        ? holo(t)
        : id === 'scope3'
          ? prism(t)
          : id === 'pdot'
            ? pistolDot(t)
            : classicScope(t);
  const [y, z] = m.top;
  o.group.position.set(0, y, z);
  tag(o.group);
  g.root.add(o.group);
  const slide = m.slide ? g.parts.slide : undefined;
  if (slide) attachTo(g, slide, o.group);
  // a alça e a massa dobráveis deitam (somem): a alça alta da M4 ficava na frente do ponto
  if (g.irons) g.irons.visible = false;
  // a linha de mira passa a ser a da mira (paralela ao cano): mirando, o olho fica nela
  g.sight.set(0, y + o.axis, g.sight.z);
  delete g.sightPitch;
  if (o.reticle) g.reticles = [...(g.reticles ?? []), o.reticle];
}

/** prende um objeto já no lugar (espaço da arma) a uma peça que mexe, sem mudar onde ele está */
function attachTo(g: GunModel, p: Part, o: THREE.Object3D) {
  g.root.updateMatrixWorld(true);
  p.obj.updateMatrixWorld(true);
  p.obj.attach(o);
}

// ---------------------------------------------------------------- boca

/** comprimento de cada peça da boca por classe (m) */
const MUZZLE_LEN: Record<MuzzleId, Partial<Record<GunClass, number>>> = {
  sup: { ar: 0.15, smg: 0.13, sniper: 0.19, pistol: 0.11 },
  comp: { ar: 0.05, smg: 0.045, sniper: 0.07, pistol: 0.035 },
  flash: { ar: 0.055, smg: 0.05, sniper: 0.06, pistol: 0.04 },
};

function mountMuzzle(g: GunModel, m: Mount, id: MuzzleId, cls: GunClass) {
  const t = mats();
  const at = (g.bore ?? g.muzzle).clone();
  at.z += m.over ?? 0;
  const len = MUZZLE_LEN[id][cls] ?? 0.05;
  const r = m.r;
  const group = new THREE.Group();
  const k = new Kit();
  if (id === 'sup') {
    // supressor: colar rosqueado, corpo grosso com as faixas de aperto e a tampa da frente com o furo
    const R = Math.max(r + 0.006, cls === 'pistol' ? 0.0135 : 0.016);
    k.tube(t.metal, r + 0.002, r + 0.002, 0.004, -0.012, 0, 0, 12)
      .tube(t.body, R, R, -0.012, -len + 0.008, 0, 0, 16)
      .tube(t.dark, R + 0.0008, R + 0.0008, -0.02, -0.03, 0, 0, 16)
      .tube(t.dark, R + 0.0008, R + 0.0008, -len + 0.022, -len + 0.03, 0, 0, 16)
      .tube(t.metal, R, R * 0.9, -len + 0.008, -len, 0, 0, 16)
      .add(new THREE.CircleGeometry(r * 0.55, 10).rotateY(Math.PI).translate(0, 0, -len - 0.0003), t.dark);
  } else if (id === 'comp') {
    // compensador: bloco curto de oito faces com as janelas abertas em cima (o gás sobe e segura o cano)
    const R = r + 0.004;
    k.add(
      new THREE.CylinderGeometry(R, R, len, 8)
        .rotateX(-Math.PI / 2)
        .rotateZ(Math.PI / 8)
        .translate(0, 0, -len / 2),
      t.metal,
    );
    for (let i = 0; i < 3; i++) {
      const z = -len * (0.25 + i * 0.25);
      k.box(t.dark, R * 1.1, 0.003, len * 0.12, 0, R * 0.86, z);
      for (const sx of [1, -1]) k.box(t.dark, 0.003, R * 0.7, len * 0.12, sx * R * 0.86, R * 0.25, z);
    }
    k.add(new THREE.CircleGeometry(r * 0.6, 10).rotateY(Math.PI).translate(0, 0, -len - 0.0003), t.dark);
  } else {
    // quebra-chamas: tubo de dentes (quatro garras abertas na frente)
    const R = r + 0.0025;
    k.tube(t.metal, R, R, 0, -len * 0.45, 0, 0, 12);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.add(
        new THREE.BoxGeometry(0.0045, 0.0045, len * 0.58)
          .translate(0, 0, -len * 0.45 - len * 0.27)
          .translate(Math.cos(a) * (R - 0.0012), Math.sin(a) * (R - 0.0012), 0),
        t.metal,
      );
    }
  }
  k.bake(group);
  group.position.copy(at);
  g.root.add(tag(group));
  g.muzzle.set(0, at.y, at.z - len);
  if (g.bore) g.bore.z = at.z - len;
  g.length += Math.max(0, len - (m.over ?? 0));
}

// ---------------------------------------------------------------- sob o cano

function mountUnder(g: GunModel, m: Mount, id: 'vgrip' | 'agrip') {
  const t = mats();
  const group = new THREE.Group();
  const y = g.support.y;
  const z = g.support.z + (m.gripDz ?? 0);
  const k = new Kit();
  if (id === 'vgrip') {
    // vertical: presilha no trilho, o punho um pouco inclinado para a frente, os sulcos dos dedos e a tampa
    const H = 0.085;
    const top = new THREE.Vector3(0, -0.01, 0);
    const bot = new THREE.Vector3(0, -0.01 - H, -0.012);
    k.box(t.body, 0.024, 0.011, 0.044, 0, -0.0055, 0)
      .box(t.dark, 0.026, 0.003, 0.012, 0, -0.002, 0.012)
      .rod(t.body, 0.0145, top, bot, 12)
      .rod(t.dark, 0.0162, bot.clone().lerp(top, 0.04), bot.clone().lerp(top, -0.05), 12);
    for (const f of [0.28, 0.5, 0.72]) {
      const c = bot.clone().lerp(top, f);
      k.add(new THREE.TorusGeometry(0.0146, 0.0016, 4, 14).rotateX(Math.PI / 2).translate(c.x, c.y, c.z), t.dark);
    }
    k.bake(group);
    // o meio do punho, onde a mão de apoio fecha
    const mid = top.clone().lerp(bot, 0.5);
    g.foregrip = { kind: 'vertical', at: new THREE.Vector3(0, y + mid.y, z + mid.z), h: H };
  } else {
    // angulada: rampa à frente da mão (a palma encosta atrás dela e empurra), com a presilha no trilho
    k.box(t.body, 0.022, 0.009, 0.06, 0, -0.0045, -0.045);
    k.side(
      t.body,
      [
        [-0.012, -0.008],
        [-0.075, -0.008],
        [-0.072, -0.02],
        [-0.03, -0.042],
        [-0.016, -0.04],
      ],
      0.02,
    );
    k.box(t.dark, 0.021, 0.003, 0.03, 0, -0.035, -0.05);
    k.bake(group);
    g.foregrip = { kind: 'angled', at: new THREE.Vector3(0, y - 0.03, z - 0.04), h: 0.035 };
  }
  group.position.set(0, y, z);
  g.root.add(tag(group));
}

// ---------------------------------------------------------------- carregador

/** quanto o carregador estendido desce (m) */
const MAG_EXT: Record<GunClass, number> = { ar: 0.05, smg: 0.045, sniper: 0.032, pistol: 0.024, knife: 0 };

/** os pontos do pente parado no espaço da arma (osso: os presos a ele; peça feita em código: a malha) */
function partPoints(g: GunModel, p: Part): THREE.Vector3[] {
  g.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  const out: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  if (p.obj instanceof THREE.Bone) {
    g.root.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      const bi = o.skeleton.bones.indexOf(p.obj as THREE.Bone);
      const idx = o.geometry.getAttribute('skinIndex');
      const wt = o.geometry.getAttribute('skinWeight');
      if (bi < 0 || !idx || !wt) return;
      for (let i = 0; i < idx.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bi) w += wt.getComponent(i, k);
        if (w < 0.5) continue;
        o.getVertexPosition(i, v);
        out.push(v.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv));
      }
    });
    return out;
  }
  p.obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++)
      out.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv).clone());
  });
  return out;
}

/**
 * Carregador estendido: um prolongamento da base do pente, na direção em que o fim dele desce (o pente curvo da AK
 * desce para a frente), com a base nova um pouco mais larga. Fica preso ao pente: sai e volta com ele na recarga.
 */
function mountMag(g: GunModel, cls: GunClass) {
  const mag = g.parts.mag;
  if (!mag) return;
  const pts = partPoints(g, mag);
  if (pts.length < 4) return;
  const minY = Math.min(...pts.map((p) => p.y));
  const bottom = pts.filter((p) => p.y < minY + 0.012);
  const band = pts.filter((p) => p.y > minY + 0.025 && p.y < minY + 0.055);
  const c = (list: THREE.Vector3[]) => list.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(list.length);
  const x0 = Math.min(...bottom.map((p) => p.x));
  const x1 = Math.max(...bottom.map((p) => p.x));
  const z0 = Math.min(...bottom.map((p) => p.z));
  const z1 = Math.max(...bottom.map((p) => p.z));
  const foot = new THREE.Vector3((x0 + x1) / 2, minY, (z0 + z1) / 2);
  const axis = band.length ? foot.clone().sub(c(band)).normalize() : new THREE.Vector3(0, -1, 0);
  // um pente reto pode dar um eixo torto por pontos de um lado só: no máximo ~35° da vertical
  if (axis.y > -0.8) axis.set(axis.x * 0.3, -1, axis.z * 0.6).normalize();
  const L = MAG_EXT[cls];
  const w = Math.max(0.014, x1 - x0);
  const d = Math.max(0.02, z1 - z0);
  const t = mats();
  const group = new THREE.Group();
  new Kit()
    .box(t.body, w * 0.96, L, d * 0.96, 0, -L / 2 + 0.002, 0)
    .box(t.dark, w + 0.004, 0.008, d + 0.006, 0, -L - 0.002, 0)
    .box(t.metal, w * 0.5, 0.003, d * 0.4, 0, -L * 0.45, d * 0.49)
    .bake(group);
  group.position.copy(foot);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
  g.root.add(tag(group));
  attachTo(g, mag, group);
  g.magExt = L;
}

// ---------------------------------------------------------------- retículo

const O = new THREE.Vector3();
const D = new THREE.Vector3();
const M = new THREE.Matrix4();

/**
 * Põe o retículo de cada mira de ponto onde a linha do centro da câmera cruza o vidro: o ponto fica no centro da
 * tela e só aparece quando o vidro está na frente do olho (mirando). Chamado depois de a arma ir para o lugar.
 */
export function aimReticles(g: GunModel, cam: THREE.Camera) {
  if (!g.reticles?.length) return;
  cam.updateMatrixWorld();
  for (const r of g.reticles) {
    r.mesh.updateWorldMatrix(true, false);
    M.copy(r.mesh.matrixWorld).invert();
    O.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(M);
    D.set(0, 0, -1).transformDirection(cam.matrixWorld).transformDirection(M);
    if (Math.abs(D.z) < 1e-4) continue;
    const s = -O.z / D.z;
    r.uniforms.uDot.value.set(O.x + D.x * s, O.y + D.y * s);
    r.uniforms.uDist.value = Math.abs(s);
  }
}

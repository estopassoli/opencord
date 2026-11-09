/**
 * Os acessórios do armeiro em 3D, feitos em código no estilo das armas (poucos polígonos, peças juntadas por material
 * com o `Kit`): miras no trilho de cima (ponto vermelho, reflexa pequena, luneta 3x, ponto de pistola no ferrolho, luneta
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
  m200: { r: 0.024, over: 0.03 },
  kar98k: { top: [0.096, -0.385], r: 0.009 },
  m9: { top: [0.074, -0.005], slide: true, r: 0.01 },
  deagle: { top: [0.074, 0.004], slide: true, r: 0.012 },
  // armas do Sketchfab: o topo do trilho (ou da caixa da culatra, sem trilho) medido nas vistas de lado
  rs9: { r: 0.013, over: 0.04 },
  sv98: { r: 0.011 },
  ballista: { r: 0.012, over: 0.03 },
  scarl: { top: [0.114, -0.02], r: 0.011, over: 0.03 },
  mcx: { top: [0.121, -0.119], r: 0.011, over: 0.03 },
  mpx: { top: [0.116, -0.034], r: 0.009, over: 0.02 },
  pdw: { top: [0.099, -0.094], r: 0.009, over: 0.02 },
  msmc: { top: [0.091, -0.003], r: 0.008, over: 0.02 },
  aks74u: { top: [0.094, -0.024], r: 0.012, over: 0.03 },
  stg44: { top: [0.084, -0.087], r: 0.009 },
  automag3: { top: [0.0607, 0.007], slide: true, r: 0.008 },
  bfr: { top: [0.089, -0.055], r: 0.011 },
  rhino: { top: [0.085, -0.064], r: 0.009 },
};

/**
 * A anilha de zoom da luneta variável, na ocular da luneta de cada sniper: z do anel, raio do tubo ali e a altura do
 * eixo óptico (medidos no modelo).
 */
const EYEPIECE: Partial<Record<GunId, { z: number; r: number }>> = {
  l115: { z: 0.045, r: 0.0175 },
  m200: { z: 0.013, r: 0.0228 },
  rs9: { z: 0.038, r: 0.0214 },
  sv98: { z: 0.032, r: 0.019 },
  ballista: { z: 0.026, r: 0.0208 },
};

/** a arma montada: o modelo de fábrica com os acessórios da montagem (sem montagem, o de fábrica) */
export function makeBuiltGun(id: GunId, build?: GunBuild): GunModel | null {
  const g = makeGun(id);
  if (!g) return null;
  // mira de fábrica com ponto aceso (MSMC, MCX): o retículo no vidro dela
  if (g.ownSight) {
    const s = g.ownSight;
    const r = reticle(new THREE.CircleGeometry(s.r, 24), 0, s.r, s.y, s.z);
    g.root.add(r.mesh);
    g.reticles = [r];
  }
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
 * Retículo aceso no vidro: o ponto (e o anel, no tipo 1) é desenhado pelo ângulo até o ponto em que a linha do
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
 * mira reflexa pequena e aberta: um degrau de montagem com a trava do lado, a base baixa com a eletrônica inclinada
 * atrás e, na frente, só o aro fino da janela (cantos de cima bem chanfrados), inclinado para trás; o resto da vista
 * fica livre, sem tubo nem capuz
 */
function miniReflex(t: Mats): Optic {
  const group = new THREE.Group();
  const A = 0.037;
  const W = 0.027;
  const RIM = 0.0026;
  const ZW = -0.016;
  // o aro da janela de frente: contorno chanfrado com o furo do mesmo jeito, puxado 4 mm e deitado ~10° para trás
  const y0 = 0.02;
  const y1 = 0.055;
  const outer = chamfered(W + RIM * 2, y0, y1, 0.009, 0);
  const hole = chamfered(W, y0 + 0.002, y1 - RIM, 0.0075, 0);
  outer.holes.push(new THREE.Path(hole.getPoints()));
  const rimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.004, bevelEnabled: false, curveSegments: 2 })
    .translate(0, -y0, -0.002)
    .rotateX(0.17)
    .translate(0, y0, ZW);
  new Kit()
    // degrau de montagem no trilho e a trava (botão redondo do lado direito)
    .box(t.dark, 0.022, 0.009, 0.034, 0, 0.0045, 0.002)
    .box(t.metal, 0.026, 0.003, 0.02, 0, 0.0015, 0.002)
    .add(
      new THREE.CylinderGeometry(0.005, 0.005, 0.005, 10).rotateZ(Math.PI / 2).translate(0.0145, 0.0045, 0.002),
      t.body,
    )
    // a base da mira: chapa baixa e a caixa da eletrônica atrás, descendo em rampa para a janela
    .front(t.body, chamfered(W + RIM * 2, 0.009, 0.019, 0.0025, 0.001), 0.022, ZW - 0.004)
    .side(
      t.body,
      [
        [0.022, 0.019],
        [0.022, 0.0235],
        [0.014, 0.0255],
        [0.004, 0.0225],
        [-0.004, 0.019],
      ],
      W,
    )
    .box(t.dark, 0.012, 0.002, 0.008, 0, 0.0245, 0.016)
    .box(t.accent, 0.0035, 0.0025, 0.0035, (W + RIM * 2) / 2, 0.014, 0.012)
    .add(rimGeo, t.body)
    .bake(group);
  // o vidro no formato da janela (cantos chanfrados), centrado na linha de mira
  const glass = new THREE.ShapeGeometry(chamfered(W + 0.0006, y0 + 0.002, y1 - RIM + 0.0003, 0.0075, 0), 2).translate(
    0,
    -A,
    0,
  );
  const r = reticle(glass, 0, 0.016, A, ZW + (A - y0) * Math.sin(0.17));
  r.mesh.rotation.x = 0.17;
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
  // a mira de fábrica sai (com o retículo dela)
  if (g.ownOptic) g.ownOptic.visible = false;
  if (g.reticles) {
    for (const r of g.reticles) r.mesh.visible = false;
    delete g.reticles;
  }
  const o =
    id === 'reddot'
      ? redDot(t)
      : id === 'holo'
        ? miniReflex(t)
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
  // a empunhadura de fábrica sai: a nova vai no lugar dela, encostada no guarda-mão
  if (g.ownGrip) g.ownGrip.visible = false;
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

/** os triângulos do pente parado no espaço da arma (osso: os com os três vértices presos a ele) */
function partTris(g: GunModel, p: Part): THREE.Triangle[] {
  g.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  const out: THREE.Triangle[] = [];
  const v = new THREE.Vector3();
  const take = (o: THREE.Mesh, keep: (i: number) => boolean) => {
    const geo = o.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let t = 0; t + 2 < n; t += 3) {
      const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      if (!ids.every(keep)) continue;
      const [a, b, c] = ids.map((i) => {
        o.getVertexPosition(i, v);
        return v.clone().applyMatrix4(m);
      });
      out.push(new THREE.Triangle(a, b, c));
    }
  };
  if (p.obj instanceof THREE.Bone) {
    const bone = p.obj;
    g.root.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      const bi = o.skeleton.bones.indexOf(bone);
      const si = o.geometry.getAttribute('skinIndex');
      const sw = o.geometry.getAttribute('skinWeight');
      if (bi < 0 || !si || !sw) return;
      take(o, (i) => {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
        return w >= 0.5;
      });
    });
  } else {
    p.obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible && !o.userData.att) take(o, () => true);
    });
  }
  return out;
}

/**
 * Carregador estendido: um prolongamento da base do pente, na direção em que o fim dele desce (o pente curvo da AK
 * desce para a frente), com a base nova um pouco mais larga. Fica preso ao pente: sai e volta com ele na recarga.
 */
function mountMag(g: GunModel, cls: GunClass) {
  const mag = g.parts.mag;
  if (!mag) return;
  // a face de baixo do pente (no curvo da AK ela é inclinada): os triângulos virados para baixo mais baixos; a normal
  // média dá o eixo em que a peça desce e os cantos dela a largura e a profundidade
  const tris = partTris(g, mag);
  const N = new THREE.Vector3();
  const C = new THREE.Vector3();
  const down = tris
    .map((t) => ({ t, n: t.getNormal(new THREE.Vector3()), c: t.getMidpoint(new THREE.Vector3()), a: t.getArea() }))
    .filter((x) => x.a > 1e-8 && x.n.y < -0.35);
  if (!down.length) return;
  const lowest = Math.min(...down.map((x) => x.c.y));
  const face = down.filter((x) => x.c.y < lowest + 0.02);
  const axis = new THREE.Vector3();
  for (const x of face) axis.addScaledVector(x.n, x.a);
  axis.normalize();
  // a face pega também chanfros e degraus: fica só o que está de frente para a média
  const flat = face.filter((x) => x.n.dot(axis) > 0.9);
  const use = flat.length ? flat : face;
  axis.set(0, 0, 0);
  let area = 0;
  for (const x of use) {
    axis.addScaledVector(N.copy(x.n), x.a);
    C.addScaledVector(x.c, x.a);
    area += x.a;
  }
  axis.normalize();
  C.divideScalar(area);
  // a face de baixo do curvo da AK desce bem para a frente (~55°); só um eixo deitado demais é erro do modelo
  if (axis.y > -0.45) axis.set(0, -1, 0);
  // a base no plano perpendicular ao eixo: lado (x da arma) e frente, medidos nos cantos da face
  const side = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, axis.clone().negate());
  // o corte do pente nos últimos 1,5 cm ao longo do eixo (a face de baixo pode ser só um friso, como na AK)
  const all = tris.flatMap((t) => [t.a, t.b, t.c]);
  const maxP = Math.max(...all.map((p) => p.dot(axis)));
  const corners = all.filter((p) => p.dot(axis) > maxP - 0.015);
  const span = (dir: THREE.Vector3) => {
    const v = corners.map((p) => p.dot(dir));
    return [Math.min(...v), Math.max(...v)] as const;
  };
  const [s0, s1] = span(side);
  const [f0, f1] = span(fwd);
  const foot = new THREE.Vector3()
    .addScaledVector(side, (s0 + s1) / 2)
    .addScaledVector(fwd, (f0 + f1) / 2)
    .addScaledVector(axis, maxP);
  const L = MAG_EXT[cls];
  const w = Math.max(0.014, s1 - s0);
  const d = Math.max(0.02, f1 - f0);
  const t = mats();
  const group = new THREE.Group();
  new Kit()
    .box(t.body, w * 0.96, L, d * 0.96, 0, -L / 2 + 0.002, 0)
    .box(t.dark, w + 0.004, 0.008, d + 0.006, 0, -L - 0.002, 0)
    .box(t.metal, w * 0.5, 0.003, d * 0.4, 0, -L * 0.45, d * 0.49)
    .bake(group);
  group.position.copy(foot);
  // x da peça no lado, y contra o eixo (sobe para o pente), z na frente do corte
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, axis.clone().negate(), fwd));
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

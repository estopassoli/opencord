/**
 * Corrida de moto do Espaço 3D (ADR-0055): pista fechada com curvas, motos arcade (acelera, freia, vira), turbo no chão
 * e caixas de item (turbo para usar com a Ação), 3 voltas com pontos de controle (não dá para cortar caminho).
 * Cada um simula a própria moto; a posição vai pela rede como a dos avatares. Largada e chegadas ficam no servidor.
 */
import * as THREE from 'three';
import { power01, type GameEvent } from './events';

/** pontos de controle da pista (sentido da corrida) */
const CONTROL = [
  [0, 52],
  [30, 50],
  [50, 36],
  [56, 8],
  [50, -22],
  [30, -46],
  [0, -52],
  [-30, -48],
  [-50, -30],
  [-56, 0],
  [-50, 30],
  [-30, 48],
] as const;
/** metade do tamanho da arena (130 m) */
export const RACE_HALF = 64;

export const TRACK_W = 11;
const N = 360;

export interface Track {
  pts: { x: number; z: number }[];
  /** direção da pista em cada ponto */
  dirs: { x: number; z: number }[];
  /** turbo no chão e caixas de item (índices na pista) */
  pads: number[];
  boxes: number[];
}

export function buildTrack(): Track {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  const pts: Track['pts'] = [];
  const dirs: Track['dirs'] = [];
  for (let i = 0; i < N; i++) {
    const p = curve.getPointAt(i / N);
    const t = curve.getTangentAt(i / N);
    pts.push({ x: p.x, z: p.z });
    dirs.push({ x: t.x, z: t.z });
  }
  const at = (f: number) => Math.round(f * N);
  return { pts, dirs, pads: [at(0.18), at(0.47), at(0.76)], boxes: [at(0.3), at(0.62), at(0.9)] };
}

export const TRACK = buildTrack();

/** ponto da pista mais perto (procura perto do último, para ser barato) e distância lateral */
export function nearest(track: Track, x: number, z: number, from = -1): { i: number; d: number } {
  let best = { i: 0, d: Infinity };
  const range = from < 0 ? N : 30;
  for (let k = -range; k <= range; k++) {
    const i = ((((from < 0 ? 0 : from) + k) % N) + N) % N;
    const p = track.pts[i]!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best.d) best = { i, d };
  }
  return best;
}

export interface Bike {
  x: number;
  z: number;
  /** direção (radianos, como o ry do avatar) */
  h: number;
  v: number;
  /** progresso: índice na pista, volta, pontos de controle da volta */
  idx: number;
  lap: number;
  checks: number;
  boostUntil: number;
  /** turbo guardado (caixa de item) */
  item: boolean;
  /** guidão (−1 a 1): vira aos poucos, não de uma vez */
  steer: number;
}

const ACC = 11;
const BRAKE = 18;
const MAX_V = 21;
const BOOST_V = 31;
const REVERSE_V = 6;
const OFFROAD_V = 14;

export function startGrid(slot: number): Bike {
  const p = TRACK.pts[N - 4 - Math.floor(slot / 2) * 4]!;
  const d = TRACK.dirs[N - 4]!;
  const side = slot % 2 ? 1 : -1;
  // lado: perpendicular à pista
  const x = p.x + -d.z * side * 2.2;
  const z = p.z + d.x * side * 2.2;
  return { x, z, h: Math.atan2(d.x, d.z), v: 0, idx: N - 4, lap: 0, checks: 0, boostUntil: 0, item: false, steer: 0 };
}

export interface RaceInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export type RaceEvent = { kind: 'lap'; lap: number } | { kind: 'boost' } | { kind: 'item' };

/**
 * Um passo da moto. `go` = a largada já foi dada. Se `fx` vier, acrescenta nela os efeitos (ADR-0056): turbo do chão,
 * caixa de item e volta.
 */
export function stepBike(b: Bike, inp: RaceInput, dt: number, now: number, go: boolean, fx?: GameEvent[]): RaceEvent[] {
  const ev: RaceEvent[] = [];
  const at = () => ({ x: b.x, y: 0.5, z: b.z });
  const boosting = now < b.boostUntil;
  const n = nearest(TRACK, b.x, b.z, b.idx);
  const offroad = n.d > TRACK_W / 2 + 0.5;
  const maxV = boosting ? BOOST_V : offroad ? OFFROAD_V : MAX_V;
  if (go) {
    if (inp.up) b.v += ACC * dt;
    else if (inp.down) b.v -= (b.v > 0 ? BRAKE : ACC * 0.6) * dt;
    else b.v -= Math.sign(b.v) * Math.min(Math.abs(b.v), 4 * dt);
    if (boosting) b.v = Math.max(b.v, BOOST_V * 0.9);
  } else b.v = 0;
  b.v = Math.max(-REVERSE_V, Math.min(maxV, b.v > maxV ? b.v - 20 * dt : b.v));
  // vira mais devagar parado e em alta velocidade fica estável
  // o guidão chega ao fim em ~0,2 s e volta ao centro sozinho: menos tranco ao virar
  const want = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
  b.steer += (want - b.steer) * Math.min(1, dt * 7);
  const grip = Math.min(1, Math.abs(b.v) / 6) * (1 - Math.min(0.3, Math.abs(b.v) / 100));
  b.h += b.steer * 1.9 * grip * dt * Math.sign(b.v || 1);
  b.x += Math.sin(b.h) * b.v * dt;
  b.z += Math.cos(b.h) * b.v * dt;
  // limites da arena
  b.x = Math.max(-RACE_HALF + 1, Math.min(RACE_HALF - 1, b.x));
  b.z = Math.max(-RACE_HALF + 1, Math.min(RACE_HALF - 1, b.z));

  // progresso: pontos de controle a cada terço; volta só conta tendo passado pelos dois
  const prev = b.idx;
  b.idx = nearest(TRACK, b.x, b.z, b.idx).i;
  const third = Math.floor(N / 3);
  if (b.checks === 0 && b.idx >= third && b.idx < third + 20) b.checks = 1;
  if (b.checks === 1 && b.idx >= 2 * third && b.idx < 2 * third + 20) b.checks = 2;
  if (prev > N - 20 && b.idx < 20 && b.checks === 2) {
    b.lap++;
    b.checks = 0;
    ev.push({ kind: 'lap', lap: b.lap });
    fx?.push({ kind: 'lap', lap: b.lap, power: 1, zone: 7, at: at() });
  }
  // turbo no chão e caixa de item
  if (!offroad) {
    for (const pad of TRACK.pads)
      if (Math.abs(b.idx - pad) <= 1 && n.d < TRACK_W / 2 && now > b.boostUntil - 1000) {
        b.boostUntil = now + 1200;
        ev.push({ kind: 'boost' });
        fx?.push({ kind: 'boost', source: 'pad', power: power01(b.v, BOOST_V), zone: 7, at: at() });
      }
    for (const box of TRACK.boxes)
      if (Math.abs(b.idx - box) <= 1 && !b.item) {
        b.item = true;
        ev.push({ kind: 'item' });
        fx?.push({ kind: 'item', power: 0.6, zone: 7, at: at() });
      }
  }
  return ev;
}

/** Ação: usa o turbo guardado */
export function fireBoost(b: Bike, now: number): boolean {
  if (!b.item) return false;
  b.item = false;
  b.boostUntil = now + 2000;
  return true;
}

// ---------- visual ----------
export function buildRaceDecor(): THREE.Group {
  const g = new THREE.Group();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(RACE_HALF * 2, RACE_HALF * 2),
    new THREE.MeshLambertMaterial({ color: 0x3f8a3f }),
  );
  grass.rotation.x = -Math.PI / 2;
  // um pouco acima do chão da arena (no mesmo nível os dois piscam)
  grass.position.y = 0.03;
  g.add(grass);
  // asfalto: faixa ao longo da pista
  const pos: number[] = [];
  const idx: number[] = [];
  const curb: number[] = [];
  const curbIdx: number[] = [];
  const curbCol: number[] = [];
  for (let i = 0; i <= N; i++) {
    const p = TRACK.pts[i % N]!;
    const d = TRACK.dirs[i % N]!;
    const nx = -d.z;
    const nz = d.x;
    const w = TRACK_W / 2;
    pos.push(p.x + nx * w, 0.06, p.z + nz * w, p.x - nx * w, 0.06, p.z - nz * w);
    for (const s of [1, -1]) {
      const base = curb.length / 3;
      curb.push(p.x + nx * s * w, 0.08, p.z + nz * s * w, p.x + nx * s * (w + 0.6), 0.08, p.z + nz * s * (w + 0.6));
      const c = Math.floor(i / 3) % 2 ? [0.9, 0.15, 0.15] : [0.95, 0.95, 0.95];
      curbCol.push(...c, ...c);
      if (i < N) {
        // liga com o próximo par do mesmo lado (4 vértices por i: 2 de cada lado)
        const nb = base + 4;
        curbIdx.push(base, base + 1, nb, base + 1, nb + 1, nb);
      }
    }
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  road.setIndex(idx);
  road.computeVertexNormals();
  const roadMesh = new THREE.Mesh(road, new THREE.MeshLambertMaterial({ color: 0x3a3d44, side: THREE.DoubleSide }));
  g.add(roadMesh);
  const curbs = new THREE.BufferGeometry();
  curbs.setAttribute('position', new THREE.Float32BufferAttribute(curb, 3));
  curbs.setAttribute('color', new THREE.Float32BufferAttribute(curbCol, 3));
  curbs.setIndex(curbIdx);
  curbs.computeVertexNormals();
  g.add(new THREE.Mesh(curbs, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  // linha de chegada quadriculada
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const p0 = TRACK.pts[0]!;
  const d0 = TRACK.dirs[0]!;
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
  finish.rotation.x = -Math.PI / 2;
  finish.rotation.z = Math.atan2(d0.x, d0.z);
  finish.position.set(p0.x, 0.1, p0.z);
  g.add(finish);
  // pórtico da largada
  for (const s of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), new THREE.MeshLambertMaterial({ color: 0xd0d4dc }));
    post.position.set(p0.x - d0.z * s * (TRACK_W / 2 + 0.6), 2, p0.z + d0.x * s * (TRACK_W / 2 + 0.6));
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK_W + 1.5, 0.7, 0.15),
    new THREE.MeshLambertMaterial({ color: 0xe04848 }),
  );
  banner.position.set(p0.x, 4, p0.z);
  // de um poste ao outro: atravessado na pista
  banner.rotation.y = -Math.atan2(d0.x, -d0.z);
  g.add(banner);

  // turbo: setas amarelas no chão
  for (const i of TRACK.pads) {
    const p = TRACK.pts[i]!;
    const d = TRACK.dirs[i]!;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 3), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    arrow.rotation.x = Math.PI / 2;
    arrow.rotation.z = -Math.atan2(d.x, d.z);
    arrow.scale.y = 0.08;
    arrow.position.set(p.x, 0.11, p.z);
    arrow.name = 'pad';
    g.add(arrow);
  }
  // caixas de item: cubos coloridos girando
  for (const i of TRACK.boxes) {
    const p = TRACK.pts[i]!;
    for (const s of [-3, 0, 3]) {
      const d = TRACK.dirs[i]!;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.7, 0.7),
        new THREE.MeshLambertMaterial({ color: 0x8a5ae0, emissive: 0x2a1060, transparent: true, opacity: 0.85 }),
      );
      box.position.set(p.x - d.z * s, 0.9, p.z + d.x * s);
      box.name = 'itembox';
      g.add(box);
    }
  }
  g.traverse((o) => (o.raycast = () => undefined));
  return g;
}

/**
 * Uma roda: pneu, aro de metal, cubo e raios, com o eixo em x (girar `rotation.x` faz a roda rodar).
 */
function wheelMesh(dark: THREE.Material, metal: THREE.Material, accent: THREE.Material): THREE.Group {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.075, 10, 28).rotateY(Math.PI / 2), dark);
  w.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 6, 28).rotateY(Math.PI / 2), accent);
  w.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12).rotateZ(Math.PI / 2), metal);
  w.add(hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.17, 0.03), accent);
    const a = (i / 5) * Math.PI * 2;
    spoke.position.set(0, Math.cos(a) * 0.09, Math.sin(a) * 0.09);
    spoke.rotation.x = -a;
    w.add(spoke);
  }
  w.name = 'wheel';
  return w;
}

/** cilindro de `a` até `b` (garfo, escapamento, balança) */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/**
 * A moto (embaixo do avatar), desenho nosso: carenagem esportiva na cor da pessoa (um pouco mais viva que o boneco),
 * quadro e banco escuros, rodas com aro e raios, garfo e escapamento de metal, farol aceso. Frente em +z.
 */
export function bikeMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // a moto não pode sumir no boneco: a carenagem é mais saturada e um pouco mais escura que a pele
  const paint = new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s + 0.35),
    Math.max(0.28, Math.min(0.48, hsl.l - 0.12)),
  );
  const body = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.85 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.6, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fb4c8,
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0.45,
  });

  const front = wheelMesh(dark, metal, white);
  front.position.set(0, 0.32, 0.66);
  g.add(front);
  const rear = wheelMesh(dark, metal, white);
  rear.position.set(0, 0.32, -0.62);
  g.add(rear);

  // carenagem: perfil lateral (z para a frente, y para cima) extrudado na largura, com borda arredondada
  const prof = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.74, 0.66],
    [-0.42, 0.54],
    [0.02, 0.52],
    [0.2, 0.7],
    [0.46, 0.8],
    [0.66, 0.7],
    [0.7, 0.54],
    [0.5, 0.38],
    [0.12, 0.34],
    [-0.22, 0.38],
    [-0.5, 0.5],
  ];
  prof.moveTo(pts[0]![0], pts[0]![1]);
  for (const [z, y] of pts.slice(1)) prof.lineTo(z, y);
  prof.closePath();
  const W = 0.24;
  const shell = new THREE.ExtrudeGeometry(prof, {
    depth: W,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 3,
  });
  shell.translate(0, 0, -W / 2).rotateY(-Math.PI / 2);
  g.add(new THREE.Mesh(shell, body));

  // faixa branca e o número na lateral
  for (const sx of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), white);
    plate.position.set(sx * (W / 2 + 0.042), 0.47, -0.3);
    plate.rotation.y = sx * (Math.PI / 2);
    g.add(plate);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.035, 0.62), white);
    stripe.position.set(sx * (W / 2 + 0.04), 0.6, 0.32);
    stripe.rotation.x = -0.12;
    g.add(stripe);
  }

  // tanque (arredondado) e banco
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), body);
  tank.scale.set(0.85, 0.55, 1.15);
  tank.position.set(0, 0.74, 0.22);
  g.add(tank);
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 10).rotateX(Math.PI / 2), dark);
  seat.scale.set(1.1, 0.55, 1);
  seat.position.set(0, 0.56, -0.2);
  g.add(seat);

  // quadro: motor, balança traseira e pedaleiras
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), frame);
  engine.position.set(0, 0.36, 0.02);
  g.add(engine);
  for (const sx of [1, -1]) {
    g.add(tube(new THREE.Vector3(sx * 0.07, 0.32, -0.62), new THREE.Vector3(sx * 0.07, 0.42, -0.1), 0.022, frame));
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).rotateZ(Math.PI / 2), metal);
    peg.position.set(sx * 0.17, 0.36, -0.08);
    g.add(peg);
  }

  // garfo da frente (dois tubos inclinados), guidão e manoplas
  for (const sx of [1, -1])
    g.add(tube(new THREE.Vector3(sx * 0.08, 0.32, 0.66), new THREE.Vector3(sx * 0.08, 0.88, 0.42), 0.024, metal));
  g.add(tube(new THREE.Vector3(-0.3, 0.88, 0.42), new THREE.Vector3(0.3, 0.88, 0.42), 0.018, frame));
  for (const sx of [1, -1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.1, 8).rotateZ(Math.PI / 2), dark);
    grip.position.set(sx * 0.33, 0.88, 0.42);
    g.add(grip);
  }

  // farol e para-brisa
  const light = new THREE.Mesh(new THREE.CircleGeometry(0.065, 18), lamp);
  light.position.set(0, 0.74, 0.745);
  g.add(light);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), glass);
  shield.position.set(0, 0.86, 0.58);
  shield.rotation.x = -0.6;
  g.add(shield);

  // escapamento cromado do lado direito
  g.add(tube(new THREE.Vector3(-0.15, 0.3, 0.05), new THREE.Vector3(-0.17, 0.44, -0.62), 0.04, metal));

  g.traverse((o) => {
    o.raycast = () => undefined;
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

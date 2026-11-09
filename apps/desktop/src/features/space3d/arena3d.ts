/** Desenho das arenas de esporte do Espaço 3D (ADR-0055): linhas, cestas, gols e rede. Só visual (a física fica em sports.ts). */
import type { SportZone } from '@opencord/contracts';
import * as THREE from 'three';
import {
  ARENAS,
  BOARD_X,
  COURT_HX,
  COURT_HZ,
  GOAL_H,
  GOAL_HALF_W,
  GOAL_X,
  HOOP_X,
  NET_H,
  RIM_R,
  RIM_Y,
  PP_HX,
  PP_HZ,
  PP_NET,
  PP_Y,
  THREE_PT,
  VB_HX,
  VB_HZ,
  VB_NET,
} from './sports';

const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
/** cor do time que DEFENDE cada lado: azul defende −x, vermelho defende +x */
const defender = (side: 1 | -1) => (side > 0 ? 0xe04848 : 0x3f8fe0);

/** faixa colorida no fundo de cada metade, para saber de quem é cada lado */
function halfTint(g: THREE.Group, hx: number, hz: number) {
  for (const side of [1, -1] as const) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, hz * 2),
      new THREE.MeshBasicMaterial({ color: defender(side), transparent: true, opacity: 0.35, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(side * (hx - 0.6), 0.011, 0);
    g.add(m);
  }
}

/** linha pintada no chão de (x1,z1) a (x2,z2) */
function line(g: THREE.Group, x1: number, z1: number, x2: number, z2: number, w = 0.08) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), white);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(-(z2 - z1), x2 - x1);
  m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
  g.add(m);
}

function rect(g: THREE.Group, x1: number, z1: number, x2: number, z2: number) {
  line(g, x1, z1, x2, z1);
  line(g, x2, z1, x2, z2);
  line(g, x2, z2, x1, z2);
  line(g, x1, z2, x1, z1);
}

/** arco no chão com centro (x,z), raio r, de a0 a a1 (radianos, 0 = +x) */
function arc(g: THREE.Group, x: number, z: number, r: number, a0 = 0, a1 = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.04, 48, 1, a0, a1 - a0), white);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.013, z);
  g.add(m);
}

function cyl(g: THREE.Group, r: number, h: number, color: number, x: number, y: number, z: number, rot?: THREE.Euler) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  if (rot) m.rotation.copy(rot);
  g.add(m);
  return m;
}

function hoop(g: THREE.Group, side: 1 | -1) {
  const bx = side * BOARD_X;
  cyl(g, 0.09, RIM_Y + 1, 0x2b2e36, side * (BOARD_X + 0.9), (RIM_Y + 1) / 2, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x2b2e36 }));
  arm.position.set(side * (BOARD_X + 0.45), RIM_Y + 0.8, 0);
  g.add(arm);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 1.05, 1.8),
    new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 }),
  );
  board.position.set(bx, RIM_Y + 0.45, 0);
  g.add(board);
  const square = new THREE.Mesh(
    new THREE.PlaneGeometry(0.59, 0.45),
    new THREE.MeshBasicMaterial({ color: defender(side) }),
  );
  square.position.set(bx - side * 0.03, RIM_Y + 0.3, 0);
  square.rotation.y = -side * (Math.PI / 2);
  g.add(square);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(RIM_R, 0.02, 6, 24),
    new THREE.MeshLambertMaterial({ color: 0xff6a1a }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(side * HOOP_X, RIM_Y, 0);
  g.add(rim);
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(RIM_R, RIM_R * 0.6, 0.42, 12, 3, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }),
  );
  net.position.set(side * HOOP_X, RIM_Y - 0.21, 0);
  // a comemoração (juice.ts) balança a rede da cesta em que a bola entrou
  net.name = `net:${side}`;
  g.add(net);
}

function goal(g: THREE.Group, side: 1 | -1) {
  const gx = side * GOAL_X;
  // trave da cor do time que defende este gol
  const c = defender(side);
  for (const z of [-GOAL_HALF_W, GOAL_HALF_W]) cyl(g, 0.06, GOAL_H, c, gx, GOAL_H / 2, z);
  cyl(g, 0.06, GOAL_HALF_W * 2, c, gx, GOAL_H, 0, new THREE.Euler(Math.PI / 2, 0, 0));
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, GOAL_H, GOAL_HALF_W * 2, 4, 6, 10),
    new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: 0.6 }),
  );
  net.position.set(gx + side * 0.7, GOAL_H / 2, 0);
  net.name = `net:${side}`;
  g.add(net);
}

export function buildArenaDecor(zone: SportZone): THREE.Group {
  const g = new THREE.Group();
  const lay = ARENAS[zone].layout;
  halfTint(g, lay.width / 2, lay.depth / 2);
  if (zone === 1) {
    const cx = 14;
    const cz = 7.5;
    rect(g, -cx, -cz, cx, cz);
    line(g, 0, -cz, 0, cz);
    arc(g, 0, 0, 1.8);
    for (const side of [1, -1] as const) {
      // garrafão e linha de 3 (arco virado para o meio da quadra)
      rect(g, side * cx, -2.45, side * (cx - 5.8), 2.45);
      arc(g, side * (cx - 5.8), 0, 1.8);
      const start = side > 0 ? Math.PI / 2 + 0.25 : -Math.PI / 2 + 0.25;
      arc(g, side * HOOP_X, 0, THREE_PT, start, start + Math.PI - 0.5);
      hoop(g, side);
    }
  } else if (zone === 2) {
    const cx = GOAL_X;
    const cz = 12;
    rect(g, -cx, -cz, cx, cz);
    line(g, 0, -cz, 0, cz);
    arc(g, 0, 0, 3.2);
    for (const side of [1, -1] as const) {
      rect(g, side * cx, -7, side * (cx - 5.5), 7);
      rect(g, side * cx, -3.6, side * (cx - 2), 3.6);
      goal(g, side);
    }
  } else if (zone === 4) {
    // vôlei de areia: linhas e rede alta
    rect(g, -VB_HX, -VB_HZ, VB_HX, VB_HZ);
    line(g, -3, -VB_HZ, -3, VB_HZ);
    line(g, 3, -VB_HZ, 3, VB_HZ);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(VB_HZ * 2 + 1, 1, 30, 8),
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        wireframe: true,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, VB_NET - 0.5, 0);
    net.name = 'net:0';
    g.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, VB_HZ * 2 + 1), white);
    band.position.set(0, VB_NET, 0);
    g.add(band);
    for (const z of [-(VB_HZ + 0.5), VB_HZ + 0.5]) cyl(g, 0.06, VB_NET + 0.2, 0xd0d4dc, 0, (VB_NET + 0.2) / 2, z);
  } else if (zone === 5) {
    // mesa de ping pong
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(PP_HX * 2, 0.04, PP_HZ * 2),
      new THREE.MeshLambertMaterial({ color: 0x1f5fa8 }),
    );
    top.position.y = PP_Y - 0.02;
    g.add(top);
    const lines = new THREE.Group();
    rect(lines, -PP_HX + 0.02, -PP_HZ + 0.02, PP_HX - 0.02, PP_HZ - 0.02);
    line(lines, -PP_HX, 0, PP_HX, 0, 0.02);
    lines.position.y = PP_Y;
    g.add(lines);
    for (const [x, z] of [
      [-PP_HX + 0.15, -PP_HZ + 0.15],
      [PP_HX - 0.15, -PP_HZ + 0.15],
      [-PP_HX + 0.15, PP_HZ - 0.15],
      [PP_HX - 0.15, PP_HZ - 0.15],
    ] as const)
      cyl(g, 0.04, PP_Y - 0.04, 0x2b2e36, x, (PP_Y - 0.04) / 2, z);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(PP_HZ * 2 + 0.3, PP_NET, 20, 4),
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, PP_Y + PP_NET / 2, 0);
    net.name = 'net:0';
    g.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.015, PP_HZ * 2 + 0.3), white);
    band.position.set(0, PP_Y + PP_NET, 0);
    g.add(band);
  } else if (zone === 3) {
    rect(g, -COURT_HX, -COURT_HZ, COURT_HX, COURT_HZ);
    line(g, -COURT_HX, -COURT_HZ + 1.37, COURT_HX, -COURT_HZ + 1.37);
    line(g, -COURT_HX, COURT_HZ - 1.37, COURT_HX, COURT_HZ - 1.37);
    line(g, -6.4, -COURT_HZ + 1.37, -6.4, COURT_HZ - 1.37);
    line(g, 6.4, -COURT_HZ + 1.37, 6.4, COURT_HZ - 1.37);
    line(g, -6.4, 0, 6.4, 0);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_HZ * 2 + 1, NET_H, 30, 6),
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        wireframe: true,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, NET_H / 2, 0);
    net.name = 'net:0';
    g.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, COURT_HZ * 2 + 1), white);
    band.position.set(0, NET_H, 0);
    g.add(band);
    for (const z of [-(COURT_HZ + 0.5), COURT_HZ + 0.5]) cyl(g, 0.05, NET_H + 0.1, 0x2b2e36, 0, (NET_H + 0.1) / 2, z);
  }
  g.traverse((o) => (o.raycast = () => undefined));
  return g;
}

/** a bola de cada esporte */
export function ballMesh(zone: SportZone): THREE.Mesh {
  const a = ARENAS[zone];
  const color = zone === 1 ? 0xe8742a : zone === 2 || zone === 5 ? 0xf4f4f4 : zone === 4 ? 0xf2d34a : 0xd7f24a;
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(zone === 3 ? 0.09 : zone === 5 ? 0.035 : a.r, 1),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  m.raycast = () => undefined;
  return m;
}

/**
 * Sombra redonda da bola (o mundo não tem sombras em tempo real): fica no chão ou na mesa embaixo da bola e encolhe e
 * clareia com a altura — é o que deixa ler a profundidade. Raio pela bola.
 */
export function ballShadow(zone: SportZone): THREE.Mesh {
  const r = ARENAS[zone].r;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(0.05, r * 1.6), 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  m.raycast = () => undefined;
  return m;
}

/** Anel de queda (tênis, vôlei e ping pong): onde a bola vai quicar. Branco, para não confundir com o do tutorial. */
export function landingRing(zone: SportZone): THREE.Mesh {
  const big = zone === 5 ? 0.09 : 0.42;
  const m = new THREE.Mesh(
    new THREE.RingGeometry(big * 0.72, big, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  m.visible = false;
  m.raycast = () => undefined;
  return m;
}

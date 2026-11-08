/**
 * Esportes do Espaço 3D (ADR-0055): arenas fixas (basquete, futebol, tênis) e a física da bola, sem motor de física.
 * Quem tocou na bola por último simula e transmite; os outros seguem. Ponto é detectado por quem simula e o placar
 * fica no servidor. Lado A (azul) ataca +x; lado B (vermelho) ataca −x.
 */
import type { SpaceLayout, SportZone } from '@opencord/contracts';

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface Arena {
  zone: SportZone;
  layout: SpaceLayout;
  /** raio da bola (m) */
  r: number;
  /** quique no chão (0–1) e atrito ao rolar (por segundo) */
  bounce: number;
  roll: number;
  /** onde a bola volta depois de um ponto */
  ballStart: Vec;
  /** altura dos muros (a bola bate e volta abaixo disso) */
  wallH: number;
  /** jogos de rede: rede em x = 0 (de `y0` até `y0 + h`, para |z| < hz), quadra (fora = erro) e fundo do saque */
  net?: { h: number; hz: number; y0: number };
  court?: { hx: number; hz: number };
  serveX?: number;
  /** ping pong: a mesa (a bola quica nela) */
  table?: { hx: number; hz: number; y: number };
  /** alcance da raquete/mão (do peito do jogador até a bola) */
  reach?: number;
}

const floorLayout = (
  theme: SpaceLayout['theme'],
  width: number,
  depth: number,
  floorColor: string,
  wallColor: string,
  wallH: number,
): SpaceLayout => {
  const hx = width / 2;
  const hz = depth / 2;
  return {
    v: 1,
    theme,
    width,
    depth,
    floorColor,
    wallColor,
    walls: [
      { x1: -hx, z1: -hz, x2: hx, z2: -hz, h: wallH },
      { x1: hx, z1: -hz, x2: hx, z2: hz, h: wallH },
      { x1: hx, z1: hz, x2: -hx, z2: hz, h: wallH },
      { x1: -hx, z1: hz, x2: -hx, z2: -hz, h: wallH },
    ],
    items: [],
    spawn: { x: 0, z: hz - 2 },
  };
};

// ---------- basquete ----------
export const HOOP_X = 12.6;
export const RIM_Y = 3.05;
export const RIM_R = 0.23;
export const BOARD_X = 13.25;
export const THREE_PT = 6.75;

// ---------- futebol ----------
export const GOAL_X = 20;
export const GOAL_HALF_W = 2.6;
export const GOAL_H = 2.2;

// ---------- tênis ----------
export const COURT_HX = 11.9;
export const COURT_HZ = 5.5;
export const NET_H = 0.95;

// ---------- vôlei ----------
export const VB_HX = 9;
export const VB_HZ = 4.5;
export const VB_NET = 2.43;

// ---------- ping pong ----------
export const PP_HX = 1.37;
export const PP_HZ = 0.7625;
export const PP_Y = 0.76;
export const PP_NET = 0.1525;

/** mesa de ping pong como paredes baixas (o jogador não atravessa) */
const tableWalls = [
  { x1: -PP_HX, z1: -PP_HZ, x2: PP_HX, z2: -PP_HZ, h: PP_Y },
  { x1: PP_HX, z1: -PP_HZ, x2: PP_HX, z2: PP_HZ, h: PP_Y },
  { x1: PP_HX, z1: PP_HZ, x2: -PP_HX, z2: PP_HZ, h: PP_Y },
  { x1: -PP_HX, z1: PP_HZ, x2: -PP_HX, z2: -PP_HZ, h: PP_Y },
];

export const ARENAS: Record<SportZone, Arena> = {
  1: {
    zone: 1,
    layout: floorLayout('lounge', 30, 18, '#b9824f', '#3a4250', 4),
    r: 0.12,
    bounce: 0.72,
    roll: 1.2,
    ballStart: { x: 0, y: 0.12, z: 0 },
    wallH: 4,
  },
  2: {
    zone: 2,
    layout: floorLayout('beach', 44, 28, '#3f9a4f', '#e8e1cf', 1),
    r: 0.11,
    bounce: 0.55,
    roll: 0.8,
    ballStart: { x: 0, y: 0.11, z: 0 },
    wallH: 1,
  },
  3: {
    zone: 3,
    layout: floorLayout('rooftop', 34, 18, '#3b6fb0', '#2b3340', 3),
    r: 0.08,
    bounce: 0.75,
    roll: 1.5,
    ballStart: { x: -COURT_HX + 1, y: 1.2, z: 0 },
    wallH: 3,
    net: { h: NET_H, hz: COURT_HZ + 0.5, y0: 0 },
    court: { hx: COURT_HX, hz: COURT_HZ },
    serveX: 11,
    reach: 2,
  },
  4: {
    zone: 4,
    layout: floorLayout('beach', 26, 16, '#e6d3a3', '#f2efe6', 1),
    r: 0.11,
    bounce: 0.45,
    roll: 2,
    ballStart: { x: -VB_HX + 1, y: 1.6, z: 0 },
    wallH: 1,
    net: { h: VB_NET, hz: VB_HZ + 0.5, y0: 0 },
    court: { hx: VB_HX, hz: VB_HZ },
    serveX: 9.5,
    reach: 2.3,
  },
  5: {
    zone: 5,
    layout: {
      ...floorLayout('lounge', 10, 8, '#6b4f3a', '#3a4250', 3),
      walls: [...floorLayout('lounge', 10, 8, '#6b4f3a', '#3a4250', 3).walls, ...tableWalls],
    },
    r: 0.025,
    bounce: 0.88,
    roll: 2,
    ballStart: { x: -PP_HX - 0.4, y: 1.05, z: 0 },
    wallH: 3,
    net: { h: PP_NET, hz: PP_HZ + 0.15, y0: PP_Y },
    court: { hx: PP_HX, hz: PP_HZ },
    table: { hx: PP_HX, hz: PP_HZ, y: PP_Y },
    serveX: 1.9,
    reach: 1.1,
  },
  6: {
    zone: 6,
    layout: floorLayout('lounge', 12, 10, '#5a4636', '#3b2f2a', 3),
    r: 0.03,
    bounce: 0.5,
    roll: 1,
    ballStart: { x: 0, y: 0, z: 0 },
    wallH: 3,
  },
  7: {
    zone: 7,
    layout: floorLayout('rooftop', 60, 60, '#3a3f4a', '#2b3340', 1),
    r: 0.1,
    bounce: 0.5,
    roll: 1,
    ballStart: { x: 0, y: 0, z: 0 },
    wallH: 1,
  },
};

export interface BallState extends Vec {
  vx: number;
  vy: number;
  vz: number;
}

export type BallEvent =
  | { kind: 'score'; side: 'a' | 'b'; points: number }
  | { kind: 'bounce'; x: number; z: number; surface: 'floor' | 'table' }
  | { kind: 'net' };

const G = 9.8;

/** Um passo da física. Devolve eventos (ponto, quique, rede) para quem está simulando. */
export function stepBall(a: Arena, b: BallState, dt: number, shotFrom?: Vec | null): BallEvent[] {
  const ev: BallEvent[] = [];
  const prev = { x: b.x, y: b.y, z: b.z };
  b.vy -= G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  const r = a.r;

  // mesa (ping pong): quica no tampo
  const tb = a.table;
  if (tb && Math.abs(b.x) < tb.hx && Math.abs(b.z) < tb.hz && prev.y >= tb.y + r && b.y < tb.y + r && b.vy < 0) {
    b.y = tb.y + r;
    b.vy = -b.vy * a.bounce;
    ev.push({ kind: 'bounce', x: b.x, z: b.z, surface: 'table' });
  }
  // chão
  if (b.y < r) {
    b.y = r;
    if (b.vy < -1) {
      b.vy = -b.vy * a.bounce;
      ev.push({ kind: 'bounce', x: b.x, z: b.z, surface: 'floor' });
    } else b.vy = 0;
  }
  if (b.y <= r + 0.001) {
    const k = Math.max(0, 1 - a.roll * dt);
    b.vx *= k;
    b.vz *= k;
  }

  // muros da arena (abaixo da altura deles)
  const hx = a.layout.width / 2 - r;
  const hz = a.layout.depth / 2 - r;
  if (b.y < a.wallH) {
    if (b.x > hx || b.x < -hx) {
      b.x = Math.max(-hx, Math.min(hx, b.x));
      b.vx = -b.vx * 0.6;
    }
    if (b.z > hz || b.z < -hz) {
      b.z = Math.max(-hz, Math.min(hz, b.z));
      b.vz = -b.vz * 0.6;
    }
  }

  if (a.zone === 1) {
    for (const side of [1, -1] as const) {
      // tabela
      const bx = side * BOARD_X;
      if (
        Math.abs(b.z) < 0.9 &&
        b.y > RIM_Y - 0.15 &&
        b.y < RIM_Y + 1.05 &&
        Math.sign(b.x - bx) !== Math.sign(prev.x - bx)
      ) {
        b.x = bx - side * r;
        b.vx = -b.vx * 0.6;
      }
      // aro: anel de pontos
      const hxr = side * HOOP_X;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const px = hxr + Math.cos(ang) * RIM_R;
        const pz = Math.sin(ang) * RIM_R;
        const dx = b.x - px;
        const dy = b.y - RIM_Y;
        const dz = b.z - pz;
        const d = Math.hypot(dx, dy, dz);
        if (d < r + 0.02 && d > 1e-6) {
          const nx = dx / d;
          const ny = dy / d;
          const nz = dz / d;
          const vn = b.vx * nx + b.vy * ny + b.vz * nz;
          if (vn < 0) {
            b.vx -= 1.6 * vn * nx;
            b.vy -= 1.6 * vn * ny;
            b.vz -= 1.6 * vn * nz;
          }
          b.x = px + nx * (r + 0.02);
          b.y = RIM_Y + ny * (r + 0.02);
          b.z = pz + nz * (r + 0.02);
        }
      }
      // cesta: passou de cima para baixo pelo aro
      if (prev.y >= RIM_Y && b.y < RIM_Y && b.vy < 0 && Math.hypot(b.x - hxr, b.z) < RIM_R - r * 0.3) {
        const from = shotFrom ?? prev;
        const points = Math.hypot(from.x - hxr, from.z) > THREE_PT ? 3 : 2;
        ev.push({ kind: 'score', side: side > 0 ? 'a' : 'b', points });
      }
    }
  } else if (a.zone === 2) {
    // traves e travessão
    for (const side of [1, -1] as const) {
      const gx = side * GOAL_X;
      for (const pz of [-GOAL_HALF_W, GOAL_HALF_W]) {
        const dx = b.x - gx;
        const dz = b.z - pz;
        const d = Math.hypot(dx, dz);
        if (b.y < GOAL_H && d < r + 0.06 && d > 1e-6) {
          const vn = (b.vx * dx + b.vz * dz) / d;
          if (vn < 0) {
            b.vx -= 1.7 * vn * (dx / d);
            b.vz -= 1.7 * vn * (dz / d);
          }
        }
      }
      // gol: cruzou a linha entre as traves, abaixo do travessão
      if (
        Math.sign(prev.x - gx) !== Math.sign(b.x - gx) &&
        Math.sign(b.x) === side &&
        Math.abs(b.z) < GOAL_HALF_W - r &&
        b.y < GOAL_H - r
      )
        ev.push({ kind: 'score', side: side > 0 ? 'a' : 'b', points: 1 });
    }
  } else if (a.net) {
    // rede no meio (tênis, vôlei, ping pong)
    const n = a.net;
    if (Math.sign(prev.x) !== Math.sign(b.x) && b.y < n.y0 + n.h + r && b.y > n.y0 - r && Math.abs(b.z) < n.hz) {
      b.x = Math.sign(prev.x) * (r + 0.01);
      b.vx = -b.vx * 0.15;
      b.vz *= 0.3;
      ev.push({ kind: 'net' });
    }
  }
  return ev;
}

/** Velocidade para a bola sair de `from` e cair em `to` subindo até `apex` acima do ponto mais alto. */
export function lob(from: Vec, to: Vec, apex: number): { vx: number; vy: number; vz: number } {
  const top = Math.max(from.y, to.y) + apex;
  const up = Math.sqrt(2 * G * Math.max(0.01, top - from.y));
  const down = Math.sqrt(2 * G * Math.max(0.01, top - to.y));
  const t = up / G + down / G;
  return { vx: (to.x - from.x) / t, vy: up, vz: (to.z - from.z) / t };
}

/**
 * Arremesso de basquete: mira a cesta mais perto; a força (0–1) acerta em cheio na faixa boa (0,55–0,8) e erra para
 * curto ou longo fora dela.
 */
export function basketShot(from: Vec, charge: number, facing: number): { vx: number; vy: number; vz: number } {
  const side = Math.sin(facing) >= 0 ? 1 : -1;
  const hoop = { x: side * HOOP_X, y: RIM_Y + 0.05, z: 0 };
  const sweet = charge >= 0.55 && charge <= 0.8;
  const err = sweet ? 0 : charge < 0.55 ? (charge - 0.55) * 2.2 : (charge - 0.8) * 2.4;
  const dx = hoop.x - from.x;
  const dz = hoop.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const target = { x: hoop.x + (dx / d) * err, y: hoop.y, z: hoop.z + (dz / d) * err };
  return lob(from, target, 1.2 + d * 0.06);
}

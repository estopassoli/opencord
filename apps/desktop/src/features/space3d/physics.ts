/**
 * Colisão do Espaço 3D (ADR-0055): o avatar é um círculo no chão; paredes são segmentos com espessura e as peças são
 * retângulos girados. Resolve empurrando para fora (desliza ao longo da parede), sem motor de física.
 */
import type { SpaceLayout } from '@opencord/contracts';
import { ITEM_SPECS } from './models';

export const PLAYER_R = 0.36;
const WALL_T = 0.1;

export interface Obstacles {
  hx: number;
  hz: number;
  walls: { x1: number; z1: number; x2: number; z2: number }[];
  boxes: { x: number; z: number; c: number; s: number; hw: number; hd: number }[];
}

export function obstaclesOf(l: SpaceLayout): Obstacles {
  return {
    hx: l.width / 2,
    hz: l.depth / 2,
    walls: l.walls.map((w) => ({ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 })),
    boxes: l.items
      .filter((it) => ITEM_SPECS[it.kind].solid)
      .map((it) => {
        const sp = ITEM_SPECS[it.kind];
        return { x: it.x, z: it.z, c: Math.cos(it.rot), s: Math.sin(it.rot), hw: sp.w / 2, hd: sp.d / 2 };
      }),
  };
}

/** Move de (x,z) e devolve a posição sem atravessar nada. */
export function resolve(o: Obstacles, x: number, z: number, r = PLAYER_R): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    for (const w of o.walls) {
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (z - w.z1) * dz) / len2));
      const px = w.x1 + dx * t;
      const pz = w.z1 + dz * t;
      const ex = x - px;
      const ez = z - pz;
      const d = Math.hypot(ex, ez);
      const min = r + WALL_T;
      if (d < min) {
        if (d > 1e-6) {
          x = px + (ex / d) * min;
          z = pz + (ez / d) * min;
        } else {
          // em cima da linha: empurra pela normal
          const n = Math.hypot(dx, dz) || 1;
          x = px + (-dz / n) * min;
          z = pz + (dx / n) * min;
        }
      }
    }
    for (const b of o.boxes) {
      // para o espaço da peça (rotação inversa em torno de y)
      const lx = x - b.x;
      const lz = z - b.z;
      const ux = lx * b.c - lz * b.s;
      const uz = lx * b.s + lz * b.c;
      const cx = Math.max(-b.hw, Math.min(b.hw, ux));
      const cz = Math.max(-b.hd, Math.min(b.hd, uz));
      let ex = ux - cx;
      let ez = uz - cz;
      let d = Math.hypot(ex, ez);
      if (d >= r) continue;
      let nx: number;
      let nz: number;
      if (d < 1e-6) {
        // centro dentro da peça: sai pelo lado mais perto
        const px = b.hw - Math.abs(ux);
        const pz = b.hd - Math.abs(uz);
        if (px < pz) {
          ex = Math.sign(ux) || 1;
          ez = 0;
          nx = (Math.sign(ux) || 1) * (b.hw + r);
          nz = uz;
        } else {
          ex = 0;
          ez = Math.sign(uz) || 1;
          nx = ux;
          nz = (Math.sign(uz) || 1) * (b.hd + r);
        }
        d = 0;
      } else {
        nx = cx + (ex / d) * r;
        nz = cz + (ez / d) * r;
      }
      // de volta ao mundo (rotação direta)
      x = b.x + nx * b.c + nz * b.s;
      z = b.z - nx * b.s + nz * b.c;
    }
    x = Math.max(-o.hx + r, Math.min(o.hx - r, x));
    z = Math.max(-o.hz + r, Math.min(o.hz - r, z));
  }
  return { x, z };
}

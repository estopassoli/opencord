/**
 * Mapa do gunfight: um pátio de contêineres à noite, desenho nosso. Quadrado de 48 m com muro alto em volta, filas de
 * contêineres (alguns empilhados), caixotes e muretas na altura do peito (agachado, a cabeça some atrás) e um galpão
 * no meio com duas portas. Tudo são caixas alinhadas aos eixos: as mesmas servem para andar, para o tiro e para a
 * visão dos bots.
 */
import type { Obstacles } from '../physics';
import type { Box } from './weapons';

export const GUN_HALF = 24;
const WALL_H = 5;

export type BoxKind = 'wall' | 'container' | 'crate' | 'low' | 'shed';
export interface MapBox extends Box {
  kind: BoxKind;
  /** cor (contêineres e caixotes variam) */
  color: number;
}

const CONTAINER = { l: 6.1, w: 2.44, h: 2.6 };
const COLORS = [0x8f2f24, 0x2f5f8f, 0x3d7a46, 0xb7832b, 0x6b6f78, 0x7a3f74];

function box(kind: BoxKind, x: number, z: number, sx: number, sz: number, h: number, color: number, y0 = 0): MapBox {
  return {
    kind,
    color,
    min: { x: x - sx / 2, y: y0, z: z - sz / 2 },
    max: { x: x + sx / 2, y: y0 + h, z: z + sz / 2 },
  };
}

function container(x: number, z: number, alongX: boolean, color: number, stack = false): MapBox[] {
  const sx = alongX ? CONTAINER.l : CONTAINER.w;
  const sz = alongX ? CONTAINER.w : CONTAINER.l;
  const out = [box('container', x, z, sx, sz, CONTAINER.h, color)];
  if (stack)
    out.push(box('container', x, z, sx, sz, CONTAINER.h, COLORS[(COLORS.indexOf(color) + 2) % 6]!, CONTAINER.h));
  return out;
}

function buildBoxes(): MapBox[] {
  const H = GUN_HALF;
  const b: MapBox[] = [];
  // muro em volta
  b.push(box('wall', 0, -H - 0.5, H * 2 + 2, 1, WALL_H, 0x4a4d55));
  b.push(box('wall', 0, H + 0.5, H * 2 + 2, 1, WALL_H, 0x4a4d55));
  b.push(box('wall', -H - 0.5, 0, 1, H * 2 + 2, WALL_H, 0x4a4d55));
  b.push(box('wall', H + 0.5, 0, 1, H * 2 + 2, WALL_H, 0x4a4d55));
  // galpão no meio (10 x 8), com portas no norte e no sul e janela larga a leste
  const shed = 0x5b5148;
  b.push(box('shed', -5, 0, 0.4, 8, 3.2, shed));
  b.push(box('shed', 5, -2.6, 0.4, 2.8, 3.2, shed));
  b.push(box('shed', 5, 2.6, 0.4, 2.8, 3.2, shed));
  b.push(box('shed', 5, 0, 0.4, 2.4, 1, shed));
  b.push(box('shed', -3.1, -4, 3.8, 0.4, 3.2, shed));
  b.push(box('shed', 3.1, -4, 3.8, 0.4, 3.2, shed));
  b.push(box('shed', -3.1, 4, 3.8, 0.4, 3.2, shed));
  b.push(box('shed', 3.1, 4, 3.8, 0.4, 3.2, shed));
  b.push(box('crate', -2.5, 1.5, 1.2, 1.2, 1.2, 0x8a6a42));
  // contêineres: duas filas a oeste e a leste, uns cruzados ao norte e ao sul
  b.push(...container(-14, -12, false, COLORS[0]!, true));
  b.push(...container(-14, 2, false, COLORS[1]!));
  b.push(...container(-17, 14, true, COLORS[2]!, true));
  b.push(...container(14, 12, false, COLORS[3]!, true));
  b.push(...container(14, -2, false, COLORS[4]!));
  b.push(...container(17, -14, true, COLORS[5]!, true));
  b.push(...container(-4, -15, true, COLORS[3]!));
  b.push(...container(5, 16, true, COLORS[0]!));
  b.push(...container(-20, -3, false, COLORS[4]!));
  b.push(...container(20, 4, false, COLORS[2]!));
  // caixotes e muretas (cobertura baixa)
  const crate = 0x8a6a42;
  for (const [x, z] of [
    [-8, -9],
    [9, 9],
    [-9, 10],
    [8, -9],
    [0, -10],
    [0, 10],
    [-19, 8],
    [19, -8],
  ] as const)
    b.push(box('crate', x, z, 1.3, 1.3, 1.3, crate));
  for (const [x, z, alongX] of [
    [-10, 0, false],
    [10, 0, false],
    [0, -19, true],
    [0, 19, true],
    [-17, -20, true],
    [17, 20, true],
  ] as const)
    b.push(box('low', x, z, alongX ? 4 : 0.5, alongX ? 0.5 : 4, 0.95, 0x7d7f84));
  return b;
}

export const GUN_BOXES: MapBox[] = buildBoxes();

/** onde se nasce (longe das paredes; o jogo escolhe o mais longe dos inimigos) */
export const GUN_SPAWNS: { x: number; z: number; ry: number }[] = [
  { x: -21, z: -21, ry: Math.PI * 0.25 },
  { x: 21, z: 21, ry: Math.PI * 1.25 },
  { x: -21, z: 21, ry: Math.PI * 0.75 },
  { x: 21, z: -21, ry: -Math.PI * 0.25 },
  { x: 0, z: -22, ry: 0 },
  { x: 0, z: 22, ry: Math.PI },
  { x: -22, z: 0, ry: Math.PI / 2 },
  { x: 22, z: 0, ry: -Math.PI / 2 },
  { x: -8, z: -18, ry: 0 },
  { x: 8, z: 18, ry: Math.PI },
  { x: 0, z: 0, ry: 0 },
  { x: -12, z: 18, ry: Math.PI },
];

/** colisão para andar (só o que está no chão; a parte de cima da pilha é a mesma área) */
export function gunObstacles(): Obstacles {
  return {
    hx: GUN_HALF,
    hz: GUN_HALF,
    walls: [],
    boxes: GUN_BOXES.filter((b) => b.min.y === 0).map((b) => ({
      x: (b.min.x + b.max.x) / 2,
      z: (b.min.z + b.max.z) / 2,
      c: 1,
      s: 0,
      hw: (b.max.x - b.min.x) / 2,
      hd: (b.max.z - b.min.z) / 2,
    })),
  };
}

/** a caixa é sólida no ponto (x, z)? (para a grade de caminhos dos bots) */
export function blockedAt(x: number, z: number, pad = 0.45): boolean {
  if (Math.abs(x) > GUN_HALF - pad || Math.abs(z) > GUN_HALF - pad) return true;
  for (const b of GUN_BOXES) {
    if (b.min.y > 0) continue;
    if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true;
  }
  return false;
}

/** ponto de nascer mais longe de todos os `enemies` (com um sorteio entre os 3 melhores) */
export function pickSpawn(enemies: { x: number; z: number }[], u: number) {
  const scored = GUN_SPAWNS.map((s) => ({
    s,
    d: enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - s.x, e.z - s.z))) : Math.random(),
  })).sort((a, b) => b.d - a.d);
  return scored[Math.min(scored.length - 1, Math.floor(u * 3))]!.s;
}

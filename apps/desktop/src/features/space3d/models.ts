/**
 * Peças do Espaço 3D (ADR-0055), low poly e feitas só com geometria do three.js (sem arquivos de modelo).
 * Origem no chão, no centro da peça; a frente aponta para +z. `w`×`d` é a área ocupada (colisão e seleção).
 */
import type { SpaceItemKind } from '@opencord/contracts';
import * as THREE from 'three';

const mats = new Map<string, THREE.Material>();
export function mat(color: string | number, opts: { emissive?: number; opacity?: number } = {}): THREE.Material {
  const key = `${color}|${opts.emissive ?? ''}|${opts.opacity ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      ...(opts.emissive !== undefined ? { emissive: opts.emissive } : {}),
      ...(opts.opacity !== undefined ? { transparent: true, opacity: opts.opacity } : {}),
    });
    mats.set(key, m);
  }
  return m;
}

/** caixa com a base em y (não o centro) */
function box(g: THREE.Group, w: number, h: number, d: number, color: string | number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  g.add(m);
  return m;
}

function cyl(g: THREE.Group, rt: number, rb: number, h: number, color: string | number, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y + h / 2, z);
  g.add(m);
  return m;
}

function blob(g: THREE.Group, r: number, color: string | number, x: number, y: number, z: number, sy = 1, detail = 0) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color));
  m.position.set(x, y, z);
  m.scale.y = sy;
  g.add(m);
  return m;
}

/** superfície onde o telão/tv mostra a live ou o vídeo (material trocado pela cena) */
function surface(g: THREE.Group, w: number, h: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }));
  m.position.set(x, y, z);
  m.name = 'screen-surface';
  g.add(m);
  return m;
}

export const SCREEN_W = 5;
export const SCREEN_H = SCREEN_W * (9 / 16);
export const SCREEN_Y = 2.05;

const darker = (c: string, k = 0.7) => new THREE.Color(c).multiplyScalar(k).getHex();

interface Spec {
  w: number;
  d: number;
  solid: boolean;
  color: string;
  build(g: THREE.Group, color: string): void;
}

export const ITEM_SPECS: Record<SpaceItemKind, Spec> = {
  screen: {
    w: SCREEN_W + 0.4,
    d: 0.4,
    solid: true,
    color: '#1d2027',
    build(g, c) {
      box(g, SCREEN_W + 0.4, SCREEN_H + 0.4, 0.18, c, 0, SCREEN_Y - SCREEN_H / 2 - 0.2, -0.1);
      surface(g, SCREEN_W, SCREEN_H, 0, SCREEN_Y, 0.001);
      box(g, 0.2, SCREEN_Y - SCREEN_H / 2 - 0.2, 0.2, c, -SCREEN_W / 3, 0, -0.1);
      box(g, 0.2, SCREEN_Y - SCREEN_H / 2 - 0.2, 0.2, c, SCREEN_W / 3, 0, -0.1);
    },
  },
  tv: {
    w: 1.6,
    d: 0.5,
    solid: true,
    color: '#3b2f2a',
    build(g, c) {
      box(g, 1.6, 0.5, 0.45, c);
      box(g, 1.44, 0.86, 0.08, '#15171c', 0, 0.62, -0.05);
      surface(g, 1.32, 0.74, 0, 1.05, 0.0);
    },
  },
  sofa: {
    w: 2.2,
    d: 0.95,
    solid: true,
    color: '#3f6fb5',
    build(g, c) {
      box(g, 2.2, 0.42, 0.95, darker(c, 0.85));
      box(g, 1.9, 0.14, 0.7, c, 0, 0.42, 0.08);
      box(g, 2.2, 0.55, 0.24, c, 0, 0.42, -0.36);
      box(g, 0.18, 0.28, 0.95, darker(c, 0.85), -1.01, 0.42);
      box(g, 0.18, 0.28, 0.95, darker(c, 0.85), 1.01, 0.42);
    },
  },
  armchair: {
    w: 1,
    d: 0.95,
    solid: true,
    color: '#c0504d',
    build(g, c) {
      box(g, 1, 0.42, 0.95, darker(c, 0.85));
      box(g, 0.7, 0.14, 0.7, c, 0, 0.42, 0.08);
      box(g, 1, 0.6, 0.22, c, 0, 0.42, -0.36);
      box(g, 0.15, 0.25, 0.95, darker(c, 0.85), -0.43, 0.42);
      box(g, 0.15, 0.25, 0.95, darker(c, 0.85), 0.43, 0.42);
    },
  },
  beanbag: {
    w: 0.9,
    d: 0.9,
    solid: true,
    color: '#8d5fb8',
    build(g, c) {
      blob(g, 0.48, c, 0, 0.3, 0, 0.62, 1);
      blob(g, 0.3, darker(c, 0.9), 0, 0.55, -0.22, 0.8, 0);
    },
  },
  chair: {
    w: 0.55,
    d: 0.55,
    solid: true,
    color: '#4f9d69',
    build(g, c) {
      for (const [x, z] of [
        [-0.22, -0.22],
        [0.22, -0.22],
        [-0.22, 0.22],
        [0.22, 0.22],
      ] as const)
        box(g, 0.05, 0.45, 0.05, '#2b2b2b', x, 0, z);
      box(g, 0.52, 0.06, 0.52, c, 0, 0.45);
      box(g, 0.52, 0.5, 0.06, c, 0, 0.51, -0.23);
    },
  },
  stool: {
    w: 0.45,
    d: 0.45,
    solid: true,
    color: '#e07a3f',
    build(g, c) {
      cyl(g, 0.04, 0.12, 0.72, '#2b2b2b');
      cyl(g, 0.2, 0.2, 0.08, c, 0, 0.72);
    },
  },
  table: {
    w: 1.6,
    d: 0.9,
    solid: true,
    color: '#a07850',
    build(g, c) {
      box(g, 1.6, 0.07, 0.9, c, 0, 0.72);
      for (const [x, z] of [
        [-0.7, -0.35],
        [0.7, -0.35],
        [-0.7, 0.35],
        [0.7, 0.35],
      ] as const)
        box(g, 0.07, 0.72, 0.07, darker(c), x, 0, z);
    },
  },
  coffee_table: {
    w: 1.2,
    d: 0.6,
    solid: true,
    color: '#7a5c44',
    build(g, c) {
      box(g, 1.2, 0.06, 0.6, c, 0, 0.36);
      box(g, 1.0, 0.06, 0.45, darker(c), 0, 0.1);
      for (const x of [-0.52, 0.52]) box(g, 0.06, 0.36, 0.5, darker(c), x, 0);
    },
  },
  counter: {
    w: 3,
    d: 0.75,
    solid: true,
    color: '#2f9e9e',
    build(g, c) {
      box(g, 3, 1, 0.65, c);
      box(g, 3.1, 0.06, 0.75, '#e8e1cf', 0, 1);
      for (const x of [-1, 0, 1]) cyl(g, 0.05, 0.05, 0.22, '#c94f4f', x * 0.9, 1.06, -0.1, 6);
    },
  },
  bookshelf: {
    w: 1.8,
    d: 0.4,
    solid: true,
    color: '#6b4f3a',
    build(g, c) {
      box(g, 1.8, 2, 0.08, darker(c), 0, 0, -0.16);
      for (const x of [-0.86, 0.86]) box(g, 0.08, 2, 0.4, c, x);
      const colors = ['#c0504d', '#3f6fb5', '#e0b52f', '#4f9d69', '#8d5fb8', '#e8e1cf'];
      for (let s = 0; s < 4; s++) {
        box(g, 1.72, 0.05, 0.4, c, 0, s * 0.5);
        let x = -0.78;
        let i = s * 3;
        while (x < 0.7) {
          const w = 0.07 + ((i * 37) % 5) * 0.015;
          const h = 0.3 + ((i * 53) % 4) * 0.035;
          box(g, w, h, 0.28, colors[i % colors.length]!, x + w / 2, s * 0.5 + 0.05, 0);
          x += w + 0.01;
          i++;
        }
      }
      box(g, 1.8, 0.05, 0.4, c, 0, 1.95);
    },
  },
  plant: {
    w: 0.6,
    d: 0.6,
    solid: true,
    color: '#4f9d69',
    build(g, c) {
      cyl(g, 0.24, 0.18, 0.45, '#b86b45', 0, 0, 0, 7);
      blob(g, 0.36, c, 0, 0.8, 0, 1.1);
      blob(g, 0.24, darker(c, 0.85), 0.16, 1.1, 0.05);
      blob(g, 0.2, darker(c, 1.1), -0.14, 1.05, -0.08);
    },
  },
  tree: {
    w: 1,
    d: 1,
    solid: true,
    color: '#356b3c',
    build(g, c) {
      cyl(g, 0.12, 0.18, 1.2, '#6b4f3a', 0, 0, 0, 6);
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(1 - i * 0.22, 1.1, 7), mat(i % 2 ? darker(c, 1.15) : c));
        m.position.set(0, 1.5 + i * 0.6, 0);
        g.add(m);
      }
    },
  },
  palm: {
    w: 0.8,
    d: 0.8,
    solid: true,
    color: '#4f9d4f',
    build(g, c) {
      let x = 0;
      for (let i = 0; i < 6; i++) {
        const seg = cyl(g, 0.11, 0.14, 0.6, i % 2 ? '#9c7a4f' : '#8b6a42', x, i * 0.58, 0, 6);
        seg.rotation.z = -0.06;
        x += 0.05;
      }
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.8, 4), mat(i % 2 ? c : darker(c, 1.15)));
        const a = (i / 6) * Math.PI * 2;
        leaf.position.set(x + Math.cos(a) * 0.75, 3.35, Math.sin(a) * 0.75);
        leaf.rotation.set(0, -a, Math.PI / 2 + 0.35);
        leaf.scale.z = 0.25;
        g.add(leaf);
      }
      blob(g, 0.14, '#6b4f2a', x + 0.1, 3.3, 0.1);
      blob(g, 0.14, '#6b4f2a', x - 0.1, 3.3, -0.05);
    },
  },
  lamp: {
    w: 0.45,
    d: 0.45,
    solid: true,
    color: '#f2d38a',
    build(g, c) {
      cyl(g, 0.2, 0.22, 0.05, '#2b2b2b');
      cyl(g, 0.025, 0.025, 1.5, '#2b2b2b', 0, 0.05);
      const shade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.3, 0.35, 8, 1, true),
        mat(c, { emissive: 0x7a6230 }),
      );
      shade.position.set(0, 1.62, 0);
      (shade.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
      g.add(shade);
    },
  },
  rug: {
    w: 3,
    d: 2,
    solid: false,
    color: '#c0504d',
    build(g, c) {
      box(g, 3, 0.015, 2, c);
      box(g, 2.6, 0.02, 1.6, darker(c, 1.2));
      box(g, 2.0, 0.025, 1.0, c);
    },
  },
  arcade: {
    w: 0.8,
    d: 0.8,
    solid: true,
    color: '#ff4fa3',
    build(g, c) {
      box(g, 0.8, 1.9, 0.75, '#1b1730', 0, 0, -0.02);
      box(g, 0.82, 0.12, 0.78, c, 0, 1.78);
      box(g, 0.82, 0.08, 0.78, c, 0, 0.9);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), mat(darker(c, 0.6), { emissive: darker(c, 0.6) }));
      scr.position.set(0, 1.35, 0.36);
      scr.rotation.x = -0.15;
      g.add(scr);
      box(g, 0.7, 0.06, 0.3, '#2a2540', 0, 0.98, 0.3);
      cyl(g, 0.03, 0.03, 0.1, '#e05a5a', -0.15, 1.04, 0.32, 6);
      for (const x of [0.05, 0.17]) cyl(g, 0.04, 0.04, 0.03, '#3fd0ff', x, 1.04, 0.32, 8);
    },
  },
  crate: {
    w: 0.9,
    d: 0.9,
    solid: true,
    color: '#b08a55',
    build(g, c) {
      box(g, 0.9, 0.9, 0.9, c);
      for (const y of [0.05, 0.8]) box(g, 0.92, 0.06, 0.92, darker(c), 0, y);
      box(g, 0.92, 0.9, 0.06, darker(c), 0, 0, 0);
    },
  },
  fireplace: {
    w: 1.8,
    d: 0.7,
    solid: true,
    color: '#8a8580',
    build(g, c) {
      box(g, 1.8, 1.2, 0.7, c);
      box(g, 2, 0.12, 0.8, darker(c, 0.8), 0, 1.2);
      box(g, 0.9, 0.7, 0.2, '#1a1412', 0, 0.15, 0.26);
      blob(g, 0.2, 0xff8a2a, -0.1, 0.32, 0.3, 1.4);
      (g.children[g.children.length - 1] as THREE.Mesh).material = mat(0xff8a2a, { emissive: 0xc0501a });
      blob(g, 0.14, 0xffc04a, 0.12, 0.28, 0.32, 1.3);
      (g.children[g.children.length - 1] as THREE.Mesh).material = mat(0xffc04a, { emissive: 0xc08a20 });
      box(g, 1.0, 1.6, 0.5, darker(c, 0.9), 0, 1.32, -0.1);
    },
  },
  speaker: {
    w: 0.6,
    d: 0.5,
    solid: true,
    color: '#22252c',
    build(g, c) {
      box(g, 0.6, 1.2, 0.5, c);
      for (const [y, r] of [
        [0.35, 0.2],
        [0.9, 0.11],
      ] as const) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 12), mat('#3a3f4a'));
        cone.rotation.x = Math.PI / 2;
        cone.position.set(0, y, 0.25);
        g.add(cone);
      }
    },
  },
  column: {
    w: 0.7,
    d: 0.7,
    solid: true,
    color: '#c9d2dc',
    build(g, c) {
      box(g, 0.7, 0.2, 0.7, darker(c, 0.85));
      cyl(g, 0.26, 0.26, 2.8, c, 0, 0.2, 0, 8);
      box(g, 0.7, 0.2, 0.7, darker(c, 0.85), 0, 3);
    },
  },
  bed: {
    w: 1.6,
    d: 2.1,
    solid: true,
    color: '#3f6fb5',
    build(g, c) {
      box(g, 1.6, 0.35, 2.1, '#6b4f3a');
      box(g, 1.5, 0.2, 2.0, '#f2efe6', 0, 0.35);
      box(g, 1.52, 0.08, 1.3, c, 0, 0.5, 0.33);
      box(g, 1.2, 0.14, 0.4, '#ffffff', 0, 0.55, -0.72);
      box(g, 1.6, 0.9, 0.1, '#6b4f3a', 0, 0, -1.03);
    },
  },
};

export function buildItem(kind: SpaceItemKind, color?: string): THREE.Group {
  const spec = ITEM_SPECS[kind];
  const g = new THREE.Group();
  spec.build(g, color ?? spec.color);
  return g;
}

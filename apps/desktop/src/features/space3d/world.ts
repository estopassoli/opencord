/**
 * Monta a cena do ambiente (ADR-0055): piso, paredes, peças e o entorno de cada tema (céu, luz, cidade, mar, estrelas).
 * Tudo low poly, sem sombras em tempo real (só a "sombra" redonda dos avatares) para rodar leve junto com jogos.
 */
import type { SpaceLayout, SpaceTheme } from '@opencord/contracts';
import * as THREE from 'three';
import { addItemLight, buildItem, LIGHT_SPOT, mat } from './models';

const MAX_ITEM_LIGHTS = 6;

interface ThemeLook {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunColor: number;
}

export const THEME_LOOK: Record<SpaceTheme, ThemeLook> = {
  lounge: {
    sky: 0x1f2430,
    fog: 0x1f2430,
    fogNear: 30,
    fogFar: 90,
    hemiSky: 0xfff1dc,
    hemiGround: 0x3a3028,
    hemi: 1.6,
    sun: 1.1,
    sunColor: 0xffe2b8,
  },
  rooftop: {
    sky: 0xf2a774,
    fog: 0xf2b88c,
    fogNear: 25,
    fogFar: 110,
    hemiSky: 0xffd2a8,
    hemiGround: 0x5a4a5a,
    hemi: 1.5,
    sun: 1.4,
    sunColor: 0xffc08a,
  },
  cabin: {
    sky: 0x18202e,
    fog: 0x18202e,
    fogNear: 25,
    fogFar: 80,
    hemiSky: 0xffd9a8,
    hemiGround: 0x2e2218,
    hemi: 1.4,
    sun: 0.9,
    sunColor: 0xffb070,
  },
  station: {
    sky: 0x04060d,
    fog: 0x04060d,
    fogNear: 60,
    fogFar: 200,
    hemiSky: 0xd8ecff,
    hemiGround: 0x20283a,
    hemi: 1.6,
    sun: 1.1,
    sunColor: 0xdaf0ff,
  },
  beach: {
    sky: 0x8fd3f4,
    fog: 0xbfe6f7,
    fogNear: 30,
    fogFar: 140,
    hemiSky: 0xffffff,
    hemiGround: 0xc9b98a,
    hemi: 1.6,
    sun: 1.5,
    sunColor: 0xfff4dc,
  },
  arcade: {
    sky: 0x110e1d,
    fog: 0x110e1d,
    fogNear: 30,
    fogFar: 90,
    hemiSky: 0xd8c8ff,
    hemiGround: 0x2a1f40,
    hemi: 1.5,
    sun: 0.8,
    sunColor: 0xff8fd0,
  },
};

export interface BuiltWorld {
  group: THREE.Group;
  /** paredes (a câmera não atravessa; o editor seleciona) */
  walls: THREE.Mesh[];
  floor: THREE.Mesh;
  items: Map<string, THREE.Group>;
  /** superfícies do telão (primeiro) e das televisões */
  screens: { itemId: string; kind: 'screen' | 'tv'; mesh: THREE.Mesh }[];
  dispose(): void;
}

function floorTexture(color: string, theme: SpaceTheme): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  const base = new THREE.Color(color);
  const line = base.clone().multiplyScalar(theme === 'beach' ? 0.96 : 0.82);
  g.strokeStyle = `#${line.getHexString()}`;
  g.lineWidth = theme === 'beach' ? 1 : 3;
  if (theme === 'cabin' || theme === 'lounge') {
    // tábuas
    for (let y = 0; y <= 128; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(128, y);
      g.stroke();
    }
    for (let y = 0; y < 128; y += 32) {
      const off = (y / 32) % 2 ? 64 : 0;
      g.beginPath();
      g.moveTo(off + 20, y);
      g.lineTo(off + 20, y + 32);
      g.stroke();
    }
  } else {
    g.strokeRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** entorno decorativo fora do piso (não colide; determinístico pelo tamanho) */
function surroundings(g: THREE.Group, l: SpaceLayout) {
  const hx = l.width / 2;
  const hz = l.depth / 2;
  let seed = l.width * 131 + l.depth * 17;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  if (l.theme === 'rooftop') {
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.max(hx, hz) + 12 + rand() * 40;
      const h = 4 + rand() * 30;
      const w = 4 + rand() * 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(rand() > 0.5 ? '#5a5f78' : '#6c6a85'));
      b.position.set(Math.cos(a) * r, h / 2 - 22, Math.sin(a) * r);
      g.add(b);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(l.width + 0.6, 22, l.depth + 0.6), mat('#4a4f60'));
    base.position.y = -11.05;
    g.add(base);
  } else if (l.theme === 'beach') {
    const sand = new THREE.Mesh(new THREE.CircleGeometry(Math.max(hx, hz) + 30, 24), mat('#e6d3a3'));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.06;
    g.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 160), mat('#2f8fcf', { opacity: 0.9 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.12, hz + 28 + 80);
    g.add(sea);
  } else if (l.theme === 'station') {
    const pts: number[] = [];
    for (let i = 0; i < 600; i++) {
      const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(120);
      pts.push(v.x, Math.abs(v.y) * 0.8 + 5, v.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true })));
    const hole = blackHole();
    hole.position.set(-60, 32, -90);
    g.add(hole);
  } else {
    // ambientes fechados: chão escuro em volta
    const out = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      mat(new THREE.Color(THEME_LOOK[l.theme].sky).multiplyScalar(0.8).getHex()),
    );
    out.rotation.x = -Math.PI / 2;
    out.position.y = -0.08;
    g.add(out);
  }
}

export function buildWorld(l: SpaceLayout): BuiltWorld {
  const group = new THREE.Group();
  const look = THEME_LOOK[l.theme];

  group.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi));
  const sun = new THREE.DirectionalLight(look.sunColor, look.sun);
  sun.position.set(8, 18, 10);
  group.add(sun);

  const tex = floorTexture(l.floorColor, l.theme);
  tex.repeat.set(l.width / 2, l.depth / 2);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(l.width, 0.1, l.depth),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  floor.position.y = -0.05;
  floor.name = 'floor';
  group.add(floor);
  surroundings(group, l);

  const walls: THREE.Mesh[] = [];
  const outdoor = l.theme === 'rooftop' || l.theme === 'beach';
  l.walls.forEach((w, i) => {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    const low = w.h <= 1.2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.2, w.h, 0.2),
      mat(low && outdoor ? (l.theme === 'beach' ? '#f2efe6' : '#3a3f4a') : l.wallColor),
    );
    m.position.set((w.x1 + w.x2) / 2, w.h / 2, (w.z1 + w.z2) / 2);
    m.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
    m.userData = { wallIndex: i };
    walls.push(m);
    group.add(m);
    // rodapé
    if (!low) {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(len + 0.24, 0.16, 0.24),
        mat(new THREE.Color(l.wallColor).multiplyScalar(0.7).getHex()),
      );
      base.position.set(m.position.x, 0.08, m.position.z);
      base.rotation.y = m.rotation.y;
      base.raycast = () => undefined;
      group.add(base);
    }
  });

  const items = new Map<string, THREE.Group>();
  const screens: BuiltWorld['screens'] = [];
  let lights = 0;
  for (const it of l.items) {
    const g = buildItem(it.kind, it.color);
    g.position.set(it.x, 0, it.z);
    g.rotation.y = it.rot;
    g.userData = { itemId: it.id };
    group.add(g);
    items.set(it.id, g);
    // luz de verdade só nas primeiras peças que acendem (cada luz pesa em todos os materiais)
    const spot = LIGHT_SPOT[it.kind];
    if (spot && lights < MAX_ITEM_LIGHTS) {
      addItemLight(g, spot.color, spot.y, spot.z ?? 0, spot.intensity);
      lights++;
    }
    if (it.kind === 'screen' || it.kind === 'tv') {
      const s = g.getObjectByName('screen-surface') as THREE.Mesh | undefined;
      if (s) screens.push({ itemId: it.id, kind: it.kind, mesh: s });
    }
  }
  // o telão principal vem primeiro
  screens.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));

  return {
    group,
    walls,
    floor,
    items,
    screens,
    dispose() {
      tex.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
      });
    },
  };
}

/** disco quente em volta do buraco negro: claro perto do horizonte, laranja e transparente para fora, com faixas */
function diskMaterial(inner: number, outer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { inner: { value: inner }, outer: { value: outer } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float inner; uniform float outer; varying vec2 vP;
      void main(){
        float r = (length(vP) - inner) / (outer - inner);
        if (r < 0.0 || r > 1.0) discard;
        float a = atan(vP.y, vP.x);
        float bands = 0.75 + 0.25 * sin(r * 60.0 + a * 3.0);
        vec3 hot = vec3(1.0, 0.97, 0.88);
        vec3 warm = vec3(1.0, 0.62, 0.22);
        vec3 col = mix(hot, warm, smoothstep(0.0, 0.55, r)) * bands;
        float alpha = (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.0, 0.04, r);
        gl_FragColor = vec4(col * 1.35, alpha);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** buraco negro (tema estação espacial): horizonte preto, anel de fótons, disco de acreção e o halo do disco curvado */
function blackHole(): THREE.Group {
  const g = new THREE.Group();
  const R = 9;
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(R, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }),
  );
  horizon.renderOrder = 1;
  g.add(horizon);
  const photon = new THREE.Mesh(
    new THREE.TorusGeometry(R * 1.05, 0.22, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xfff1d6,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  g.add(photon);
  // disco quase de perfil, um pouco inclinado
  const disk = new THREE.Mesh(new THREE.RingGeometry(R * 1.35, R * 3.6, 128, 1), diskMaterial(R * 1.35, R * 3.6));
  disk.rotation.x = Math.PI / 2 - 0.16;
  disk.rotation.z = 0.12;
  g.add(disk);
  // a luz do disco que passa por cima e por baixo do buraco: um anel sempre de frente para a câmera
  const halo = new THREE.Mesh(new THREE.RingGeometry(R * 1.08, R * 1.9, 96, 1), diskMaterial(R * 1.08, R * 1.9));
  halo.onBeforeRender = (_r, _s, camera) => {
    halo.quaternion.copy(camera.quaternion);
    if (halo.parent) halo.quaternion.premultiply(halo.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  };
  g.add(halo);
  // o anel de fótons também de frente para a câmera
  photon.onBeforeRender = (_r, _s, camera) => {
    photon.quaternion.copy(camera.quaternion);
  };
  g.traverse((o) => (o.raycast = () => undefined));
  return g;
}

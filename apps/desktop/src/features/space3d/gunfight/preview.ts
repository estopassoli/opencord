/**
 * Imagens das armas para o menu do equipamento e o armeiro: o modelo de verdade (com os acessórios da montagem)
 * desenhado uma vez num canvas fora da tela, de lado e um pouco de três quartos, com fundo transparente, e guardado
 * como imagem (chave: arma + montagem). Um renderizador só para o menu, criado quando ele abre e liberado quando
 * fecha (`releasePreviews`); as imagens ficam guardadas para a próxima vez (no máximo `MAX_CACHE`).
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';
import { buildKey, type GunBuild } from './attachments';
import { makeBuiltGun } from './attachmodels';
import { disposeGun, loadGuns } from './models';

/** tamanho da imagem (px): larga, para a arma deitada; o menu mostra em até ~480 px de largura (2x) */
export const PREVIEW_W = 960;
export const PREVIEW_H = 400;
const MAX_CACHE = 64;

let renderer: THREE.WebGLRenderer | null = null;
let stage: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
let failed = false;

const keyOf = (id: GunId, build: GunBuild | undefined) => `${id}|${buildKey(build)}`;

/** a imagem já pronta (ou nada: ainda não foi desenhada) */
export function cachedPreview(id: GunId, build: GunBuild | undefined): string | null {
  return cache.get(keyOf(id, build)) ?? null;
}

/**
 * A imagem da arma com a montagem (data URL de PNG transparente). Desenha uma por vez, fora do quadro de quem
 * chamou; sem WebGL (teste, navegador sem placa) devolve "" e o menu mostra só o ícone.
 */
export function gunPreview(id: GunId, build: GunBuild | undefined): Promise<string> {
  const key = keyOf(id, build);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const wait = pending.get(key);
  if (wait) return wait;
  // sem WebGL (teste, navegador sem placa): nem carrega os modelos
  if (!setup()) return Promise.resolve('');
  const job = (queue = queue.then(async () => {
    await loadGuns();
    // um quadro de folga entre uma e outra (o menu não trava abrindo)
    await new Promise((r) => setTimeout(r, 0));
    const url = draw(id, build);
    pending.delete(key);
    if (url) {
      cache.set(key, url);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
    }
    return url;
  })).catch(() => {
    pending.delete(key);
    return '';
  }) as Promise<string>;
  pending.set(key, job);
  return job;
}

function setup(): boolean {
  if (renderer) return true;
  // sem WebGL 2 no ambiente (teste em jsdom): nem tenta criar o contexto
  if (failed || typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(PREVIEW_W, PREVIEW_H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
  } catch {
    failed = true;
    renderer = null;
    return false;
  }
  const scene = new THREE.Scene();
  // luz de estúdio: céu frio por cima, uma principal quente de frente e de cima, e um contorno de trás
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x202228, 1.6));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  key.position.set(2, 3, 1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.6);
  rim.position.set(-2, 1.5, -3);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(3, -1, -1);
  scene.add(fill);
  stage = { scene, camera: new THREE.PerspectiveCamera(18, PREVIEW_W / PREVIEW_H, 0.05, 50) };
  return true;
}

const BOX = new THREE.Box3();
const C = new THREE.Vector3();
const S = new THREE.Vector3();

/** desenha a arma de lado (boca para a direita), um pouco de cima e de três quartos, ocupando a imagem */
function draw(id: GunId, build: GunBuild | undefined): string {
  if (!setup() || !renderer || !stage) return '';
  const g = makeBuiltGun(id, build);
  if (!g) return '';
  try {
    const pivot = new THREE.Group();
    pivot.add(g.root);
    // a boca para a direita da imagem (a câmera fica do lado direito da arma), girada um pouco para mostrar o topo
    pivot.rotation.set(0.12, -0.32, 0, 'YXZ');
    stage.scene.add(pivot);
    pivot.updateMatrixWorld(true);
    BOX.setFromObject(g.root);
    BOX.getCenter(C);
    BOX.getSize(S);
    pivot.position.sub(C);
    const cam = stage.camera;
    const fovV = (cam.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * cam.aspect);
    // a câmera olha ao longo de x: na imagem, o comprimento (z) é a largura e a altura é y; cabe com uma margem
    const dist = Math.max(S.z / 2 / Math.tan(fovH / 2), S.y / 2 / Math.tan(fovV / 2)) * 1.1 + S.x / 2;
    cam.position.set(dist, 0, 0);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    renderer.render(stage.scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    stage.scene.remove(pivot);
    return url;
  } finally {
    disposeGun(g);
  }
}

/** o menu fechou: libera o renderizador (as imagens continuam guardadas) */
export function releasePreviews() {
  if (!renderer) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null;
  stage = null;
}

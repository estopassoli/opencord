/**
 * Cenas do Go Live (ADR-0015): camadas sobrepostas (tela, câmera, imagem, texto) compostas num canvas, e é essa
 * composição que vai para a live. Salvas neste computador (localStorage); imagens reduzidas para caber.
 */
export type LayerKind = 'screen' | 'camera' | 'image' | 'text';

export interface Layer {
  id: string;
  kind: LayerKind;
  name: string;
  /** retângulo em frações do quadro (0–1) */
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  /** imagem: data URL (reduzida) */
  src?: string;
  /** texto */
  text?: string;
  color?: string;
  /** câmera: dispositivo (null = padrão) e cantos arredondados */
  deviceId?: string | null;
  rounded?: boolean;
}

export interface Scene {
  id: string;
  name: string;
  /** de baixo para cima */
  layers: Layer[];
}

const KEY = 'oc-scenes';
const uid = () => crypto.randomUUID();

export const screenLayer = (): Layer => ({
  id: uid(),
  kind: 'screen',
  name: 'Tela',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  visible: true,
});

export const cameraLayer = (): Layer => ({
  id: uid(),
  kind: 'camera',
  name: 'Câmera',
  x: 0.72,
  y: 0.66,
  w: 0.26,
  h: 0.3,
  visible: true,
  deviceId: null,
  rounded: true,
});

export const textLayer = (text = 'Seu texto'): Layer => ({
  id: uid(),
  kind: 'text',
  name: 'Texto',
  x: 0.03,
  y: 0.04,
  w: 0.4,
  h: 0.08,
  visible: true,
  text,
  color: '#ffffff',
});

export const imageLayer = (src: string, aspect: number): Layer => {
  const w = 0.25;
  return {
    id: uid(),
    kind: 'image',
    name: 'Imagem',
    x: 0.03,
    y: 0.7,
    w,
    h: Math.min(0.9, (w / aspect) * (16 / 9)),
    visible: true,
    src,
  };
};

export function defaultScenes(): Scene[] {
  return [
    { id: uid(), name: 'Só a tela', layers: [screenLayer()] },
    { id: uid(), name: 'Tela + câmera', layers: [screenLayer(), cameraLayer()] },
  ];
}

const isScene = (s: unknown): s is Scene =>
  typeof s === 'object' &&
  s !== null &&
  typeof (s as Scene).id === 'string' &&
  typeof (s as Scene).name === 'string' &&
  Array.isArray((s as Scene).layers);

export function loadScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.every(isScene) && list.length) return list;
  } catch {
    /* sem armazenamento ou corrompido: começa das cenas prontas */
  }
  return defaultScenes();
}

/** Salva; devolve false se não coube (imagens grandes demais para o armazenamento local). */
export function saveScenes(scenes: Scene[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(scenes));
    return true;
  } catch {
    return false;
  }
}

/** Reduz a imagem (lado maior até 1280 px, WebP) para guardar a cena sem estourar o armazenamento. */
export async function shrinkImage(file: File): Promise<{ src: string; aspect: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const aspect = bmp.width / bmp.height;
  bmp.close();
  return { src: canvas.toDataURL('image/webp', 0.85), aspect };
}

/** Limita o retângulo ao quadro e a um tamanho mínimo. */
export function clampRect(l: Pick<Layer, 'x' | 'y' | 'w' | 'h'>) {
  const w = Math.min(1, Math.max(0.03, l.w));
  const h = Math.min(1, Math.max(0.03, l.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, l.x)), y: Math.min(1 - h, Math.max(0, l.y)) };
}

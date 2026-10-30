/**
 * Composição das cenas do Go Live (ADR-0015): desenha as camadas (tela, câmera, imagem, texto) num canvas no fps
 * do perfil; a trilha do canvas (captureStream) é o que vai para a live. A mesma função desenha a prévia do editor.
 */
import type { Layer, Scene } from '../lib/scenes';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SceneSources {
  /** vídeo (prévia do editor) ou o último quadro da captura (live, quadro a quadro) */
  screen?: HTMLVideoElement | VideoFrame | null;
  camera?: HTMLVideoElement | VideoFrame | null;
  images: Map<string, HTMLImageElement>;
}

/** Dimensões de um vídeo ou quadro, ou null se ainda não há imagem. */
function dims(v: HTMLVideoElement | VideoFrame | null | undefined): { w: number; h: number } | null {
  if (!v) return null;
  if (v instanceof HTMLVideoElement)
    return v.readyState >= 2 && v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight } : null;
  return v.displayWidth > 0 ? { w: v.displayWidth, h: v.displayHeight } : null;
}

// Insertable Streams (Chromium): ler os quadros da captura sem <video>. Sem tipos no lib.dom: declaração mínima.
interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}
type ProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor;
type GeneratorCtor = new (init: { kind: 'video' }) => TrackGenerator;
const g = globalThis as unknown as {
  MediaStreamTrackProcessor?: ProcessorCtor;
  MediaStreamTrackGenerator?: GeneratorCtor;
};

/** Ajusta a mídia ao retângulo: contain (sem cortar) ou cover (preenche, cortando as sobras). */
function fit(sw: number, sh: number, w: number, h: number, mode: 'contain' | 'cover') {
  const s = mode === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
}

function roundedClip(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
}

function placeholder(ctx: Ctx2D, x: number, y: number, w: number, h: number, label: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 ${Math.max(12, Math.min(28, h * 0.12))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
}

function drawLayer(ctx: Ctx2D, l: Layer, src: SceneSources, W: number, H: number, placeholders: boolean) {
  const x = l.x * W;
  const y = l.y * H;
  const w = l.w * W;
  const h = l.h * H;
  ctx.save();
  if (l.kind === 'screen' || l.kind === 'camera') {
    const v = l.kind === 'screen' ? src.screen : src.camera;
    const d = dims(v);
    if (l.kind === 'camera' && l.rounded) roundedClip(ctx, x, y, w, h, Math.min(w, h) * 0.08);
    if (v && d) {
      const f = fit(d.w, d.h, w, h, l.kind === 'screen' ? 'contain' : 'cover');
      if (l.kind === 'screen') {
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);
      }
      ctx.drawImage(v, x + f.dx, y + f.dy, f.dw, f.dh);
    } else if (placeholders) placeholder(ctx, x, y, w, h, l.kind === 'screen' ? 'Tela' : 'Câmera');
  } else if (l.kind === 'image') {
    const img = src.images.get(l.id);
    if (img?.complete && img.naturalWidth) {
      const f = fit(img.naturalWidth, img.naturalHeight, w, h, 'contain');
      ctx.drawImage(img, x + f.dx, y + f.dy, f.dw, f.dh);
    } else if (placeholders) placeholder(ctx, x, y, w, h, 'Imagem');
  } else if (l.kind === 'text' && l.text) {
    // fonte pela altura da caixa, encolhendo até caber na largura
    let size = h * 0.72;
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    const m = ctx.measureText(l.text).width;
    if (m > w) size *= w / m;
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = size * 0.15;
    ctx.shadowOffsetY = size * 0.04;
    ctx.fillStyle = l.color ?? '#ffffff';
    ctx.fillText(l.text, x, y + h / 2);
  }
  ctx.restore();
}

/** Desenha a cena inteira (de baixo para cima). `placeholders` mostra caixas para fontes sem vídeo (editor). */
export function drawScene(ctx: Ctx2D, scene: Scene, src: SceneSources, W: number, H: number, placeholders = false) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  for (const l of scene.layers) if (l.visible) drawLayer(ctx, l, src, W, H, placeholders);
}

export function videoOf(track: MediaStreamTrack): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = new MediaStream([track]);
  void v.play().catch(() => undefined);
  return v;
}

export function imageOf(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

/** Imagens das camadas, reaproveitando as já carregadas. */
export function syncImages(scene: Scene, images: Map<string, HTMLImageElement>) {
  const keep = new Set<string>();
  for (const l of scene.layers)
    if (l.kind === 'image' && l.src) {
      keep.add(l.id);
      if (images.get(l.id)?.src !== l.src) images.set(l.id, imageOf(l.src));
    }
  for (const id of [...images.keys()]) if (!keep.has(id)) images.delete(id);
}

/**
 * Compositor da live: recebe a trilha da tela capturada, abre a câmera quando a cena tem câmera visível e devolve
 * a trilha composta. Trocar de cena ao vivo não reinicia a transmissão (a trilha publicada é sempre a mesma).
 *
 * A live anda no ritmo da captura: cada quadro capturado dispara uma composição (ver start()). Com <video> fora da página + timer, o Chromium economizava decodificação
 * com a janela coberta (um jogo por cima) e a composição caía para ~7 fps (medido no E2E golive-real).
 */
export class SceneCompositor {
  /** fora da página: não depende do ciclo de desenho da janela (que para com ela coberta por um jogo) */
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly ctx: Ctx2D;
  private readonly sources: SceneSources = { images: new Map() };
  private scene: Scene;
  private timer: ReturnType<typeof setInterval> | null = null;
  private camStream: MediaStream | null = null;
  private camDevice: string | null | undefined;
  private camAbort: (() => void) | null = null;
  private out: MediaStreamTrack | null = null;
  private stopped = false;
  private lastWrite = 0;
  private busy = false;
  /** contadores para diagnóstico (quadros da captura, enviados, descartados e falhas de envio) */
  readonly counters = { screenIn: 0, written: 0, dropped: 0, writeErrors: 0 };

  stats() {
    return { ...this.counters, busy: this.busy, msSinceWrite: Math.round(performance.now() - this.lastWrite) };
  }

  constructor(
    private readonly screen: MediaStreamTrack,
    scene: Scene,
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
  ) {
    const frameDriven = Boolean(g.MediaStreamTrackProcessor && g.MediaStreamTrackGenerator);
    this.canvas = frameDriven ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true }) as Ctx2D | null;
    if (!ctx) throw new Error('canvas indisponível');
    this.ctx = ctx;
    this.scene = scene;
  }

  private draw() {
    drawScene(this.ctx, this.scene, this.sources, this.width, this.height);
  }

  async start(): Promise<MediaStreamTrack> {
    await this.setScene(this.scene);
    if (g.MediaStreamTrackProcessor && g.MediaStreamTrackGenerator) {
      // Caminho principal: quadros da captura entram por MediaStreamTrackProcessor (sem <video>), a cena é desenhada
      // num OffscreenCanvas e cada composição vira um VideoFrame no MediaStreamTrackGenerator. Nada depende de a
      // janela estar visível (medido: com captureStream da página, a live parava com a janela coberta).
      const gen = new g.MediaStreamTrackGenerator({ kind: 'video' });
      const writer = gen.writable.getWriter();
      // relógio único e sempre crescente (µs): misturar o da captura com o da página podia voltar no tempo
      let last = 0;
      const now = () => (last = Math.max(last + 1, Math.round(performance.now() * 1000)));
      const push = () => {
        // envio ainda ocupado: descarta este quadro em vez de acumular atraso
        if (this.busy || this.stopped) {
          this.counters.dropped++;
          return;
        }
        this.busy = true;
        this.draw();
        this.lastWrite = performance.now();
        const frame = new VideoFrame(this.canvas as OffscreenCanvas, { timestamp: now() });
        writer
          .write(frame)
          .then(() => this.counters.written++)
          .catch(() => this.counters.writeErrors++)
          .finally(() => {
            // libera o quadro (memória nativa de ~8 MB em 1080p): sem isso o processo estourava em ~1 min de live
            // (medido no E2E golive-real). close() num quadro já liberado não faz nada.
            frame.close();
            this.busy = false;
          });
      };
      void this.pump(this.screen, (frame) => {
        this.counters.screenIn++;
        this.swap('screen', frame);
        push();
      });
      // tela parada (a captura só manda quadro quando algo muda): ainda assim atualiza câmera/texto
      this.timer = setInterval(() => {
        if (performance.now() - this.lastWrite > 1000 / 15) push();
      }, 1000 / 15);
      this.out = gen;
      return gen;
    }
    // reserva (sem Insertable Streams): <video> + timer + captureStream da página
    const canvas = this.canvas as HTMLCanvasElement;
    this.sources.screen = videoOf(this.screen);
    this.draw();
    this.timer = setInterval(() => this.draw(), 1000 / this.fps);
    const [t] = canvas.captureStream(this.fps).getVideoTracks();
    if (!t) throw new Error('não foi possível compor a cena');
    this.out = t;
    return t;
  }

  /** Lê os quadros de uma trilha até ela acabar (ou o compositor parar). */
  private async pump(track: MediaStreamTrack, onFrame: (f: VideoFrame) => void, abort?: { aborted: boolean }) {
    if (!g.MediaStreamTrackProcessor) return;
    const reader = new g.MediaStreamTrackProcessor({ track }).readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        if (this.stopped || abort?.aborted) {
          value.close();
          break;
        }
        onFrame(value);
      }
    } catch {
      /* trilha encerrada */
    } finally {
      reader.releaseLock();
    }
  }

  /** Guarda o quadro mais recente da fonte, liberando o anterior (quadros ocupam memória de vídeo). */
  private swap(kind: 'screen' | 'camera', frame: VideoFrame) {
    const prev = this.sources[kind];
    if (prev && !(prev instanceof HTMLVideoElement)) prev.close();
    this.sources[kind] = frame;
  }

  /** Troca a cena (ao vivo): liga/desliga a câmera conforme a cena e carrega as imagens. */
  async setScene(scene: Scene) {
    this.scene = scene;
    syncImages(scene, this.sources.images);
    const cam = scene.layers.find((l) => l.kind === 'camera' && l.visible);
    if (!cam) return this.closeCamera();
    const device = cam.deviceId ?? null;
    if (this.camStream && this.camDevice === device) return;
    this.closeCamera();
    try {
      this.camStream = await navigator.mediaDevices.getUserMedia({
        video: { ...(device ? { deviceId: { exact: device } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.camDevice = device;
      const [t] = this.camStream.getVideoTracks();
      if (!t) return;
      if (g.MediaStreamTrackProcessor) {
        const abort = { aborted: false };
        this.camAbort = () => (abort.aborted = true);
        void this.pump(t, (f) => this.swap('camera', f), abort);
      } else this.sources.camera = videoOf(t);
    } catch {
      // sem câmera ou permissão negada: a camada fica vazia, a live segue
      this.sources.camera = null;
    }
  }

  private closeCamera() {
    this.camAbort?.();
    this.camAbort = null;
    for (const t of this.camStream?.getTracks() ?? []) t.stop();
    this.camStream = null;
    this.camDevice = undefined;
    const c = this.sources.camera;
    if (c instanceof HTMLVideoElement) c.srcObject = null;
    else c?.close();
    this.sources.camera = null;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closeCamera();
    this.out?.stop();
    const sc = this.sources.screen;
    if (sc instanceof HTMLVideoElement) sc.srcObject = null;
    else sc?.close();
    this.sources.screen = null;
  }
}

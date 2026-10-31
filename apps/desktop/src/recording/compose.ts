/**
 * Quadro da gravação da chamada (ADR-0023): a cada 1/30 s desenha quem está na chamada (câmera ou iniciais, nome e
 * borda verde de quem fala) e as transmissões de tela num OffscreenCanvas, que vira uma trilha de vídeo. Os quadros
 * das trilhas são lidos com MediaStreamTrackProcessor: funciona com a janela minimizada ou coberta.
 */
import { initials } from '@opencord/ui';
import type { ParticipantView } from '../voice/engine';
import { layoutCall, type Rect } from './layout';

interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}
const g = globalThis as unknown as {
  MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => TrackProcessor;
  MediaStreamTrackGenerator?: new (init: { kind: 'video' }) => TrackGenerator;
};

export const composeAvailable = () => Boolean(g.MediaStreamTrackProcessor && g.MediaStreamTrackGenerator);

export interface CallSource {
  participants(): ParticipantView[];
  videoTrack(identity: string, source: 'camera' | 'screen'): MediaStreamTrack | null;
  /**
   * Anexa o vídeo remoto a um elemento: o LiveKit (adaptiveStream) escolhe a qualidade pelo tamanho do elemento na
   * tela; sem nenhum, manda a camada mais baixa ou pausa. A gravação mantém um elemento invisível do tamanho certo.
   */
  attach?(identity: string, source: 'camera' | 'screen', el: HTMLVideoElement): () => void;
}

/** Elementos invisíveis (dentro da tela, transparentes) que seguram a qualidade alta dos vídeos gravados. */
let keepersBox: HTMLDivElement | null = null;
function keeper(width: number, height: number): HTMLVideoElement {
  if (!keepersBox) {
    keepersBox = document.createElement('div');
    keepersBox.setAttribute('aria-hidden', 'true');
    keepersBox.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;overflow:visible;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(keepersBox);
  }
  const v = document.createElement('video');
  v.muted = true;
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px`;
  keepersBox.append(v);
  return v;
}

const BG = '#111214';
const TILE = '#2b2d31';
const SPEAK = '#3fb27f';
const PALETTE = ['#5865f2', '#3fb27f', '#e8a33d', '#d93b40', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];
const colorOf = (id: string) => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]!;

interface Feed {
  track: MediaStreamTrack;
  frame: VideoFrame | null;
  stopped: boolean;
  release?: () => void;
}

export class CallCompositor {
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private feeds = new Map<string, Feed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
  private busy = false;
  private last = 0;

  constructor(
    private readonly src: CallSource,
    private readonly width = 1920,
    private readonly height = 1080,
    private readonly fps = 30,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas indisponível');
    this.ctx = ctx;
  }

  start(): MediaStreamTrack {
    if (!g.MediaStreamTrackGenerator) throw new Error('composição indisponível');
    const gen = new g.MediaStreamTrackGenerator({ kind: 'video' });
    this.writer = gen.writable.getWriter();
    this.timer = setInterval(() => this.tick(), 1000 / this.fps);
    return gen;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const f of this.feeds.values()) this.drop(f);
    this.feeds.clear();
    void this.writer?.close().catch(() => undefined);
    this.writer = null;
  }

  /** mantém um leitor por trilha de vídeo em uso, guardando só o quadro mais recente */
  private feed(
    key: string,
    track: MediaStreamTrack | null,
    hold?: { identity: string; source: 'camera' | 'screen' },
  ): VideoFrame | null {
    let f = this.feeds.get(key);
    if (f && (!track || f.track !== track || track.readyState === 'ended')) {
      this.drop(f);
      this.feeds.delete(key);
      f = undefined;
    }
    if (!track || track.readyState === 'ended' || !g.MediaStreamTrackProcessor) return null;
    if (!f) {
      const feed: Feed = { track, frame: null, stopped: false };
      if (hold && this.src.attach) {
        const [w, h] = hold.source === 'screen' ? [1920, 1080] : [640, 360];
        const el = keeper(w, h);
        const detach = this.src.attach(hold.identity, hold.source, el);
        feed.release = () => {
          detach();
          el.remove();
        };
      }
      this.feeds.set(key, feed);
      void (async () => {
        const reader = new g.MediaStreamTrackProcessor!({ track }).readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || !value) break;
            if (feed.stopped) {
              value.close();
              break;
            }
            feed.frame?.close();
            feed.frame = value;
          }
        } catch {
          /* trilha encerrada */
        } finally {
          void reader.cancel().catch(() => undefined);
        }
      })();
      f = feed;
    }
    return f.frame;
  }

  private drop(f: Feed) {
    f.release?.();
    f.release = undefined;
    f.stopped = true;
    f.frame?.close();
    f.frame = null;
  }

  private tick() {
    if (this.busy || !this.writer) return;
    const people = this.src.participants();
    const screens = people.filter((p) => p.hasScreen);
    const layout = layoutCall(
      { people: people.map((p) => p.identity), screens: screens.map((p) => p.identity) },
      this.width,
      this.height,
    );
    const used = new Set<string>();
    const c = this.ctx;
    c.fillStyle = BG;
    c.fillRect(0, 0, this.width, this.height);
    for (const s of layout.screens) {
      const key = `${s.id}:screen`;
      used.add(key);
      const frame = this.feed(key, this.src.videoTrack(s.id, 'screen'), { identity: s.id, source: 'screen' });
      this.tile(s.rect, null, frame, 'contain');
    }
    for (const p of layout.people) {
      const view = people.find((x) => x.identity === p.id)!;
      const key = `${p.id}:camera`;
      used.add(key);
      const frame = view.hasCamera
        ? this.feed(
            key,
            this.src.videoTrack(p.id, 'camera'),
            view.isLocal ? undefined : { identity: p.id, source: 'camera' },
          )
        : this.feed(key, null);
      this.tile(p.rect, view, frame, 'cover');
    }
    for (const [key, f] of this.feeds)
      if (!used.has(key)) {
        this.drop(f);
        this.feeds.delete(key);
      }
    this.busy = true;
    const ts = (this.last = Math.max(this.last + 1, Math.round(performance.now() * 1000)));
    const out = new VideoFrame(this.canvas, { timestamp: ts });
    this.writer
      .write(out)
      .catch(() => undefined)
      .finally(() => {
        out.close();
        this.busy = false;
      });
  }

  private tile(r: Rect, who: ParticipantView | null, frame: VideoFrame | null, fit: 'cover' | 'contain') {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.roundRect(r.x, r.y, r.w, r.h, 10);
    c.clip();
    c.fillStyle = who ? TILE : '#000';
    c.fillRect(r.x, r.y, r.w, r.h);
    if (frame) {
      const sw = frame.displayWidth;
      const sh = frame.displayHeight;
      const s = fit === 'contain' ? Math.min(r.w / sw, r.h / sh) : Math.max(r.w / sw, r.h / sh);
      const dw = sw * s;
      const dh = sh * s;
      c.drawImage(frame, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
    } else if (who) {
      const d = Math.min(r.w, r.h) * 0.42;
      c.fillStyle = colorOf(who.identity);
      c.beginPath();
      c.arc(r.x + r.w / 2, r.y + r.h / 2 - d * 0.08, d / 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.font = `700 ${Math.round(d * 0.38)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(initials(who.name), r.x + r.w / 2, r.y + r.h / 2 - d * 0.08);
    }
    if (who) {
      const size = Math.max(12, Math.round(r.h * 0.07));
      c.font = `600 ${size}px system-ui, sans-serif`;
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      const label = who.name;
      const tw = Math.min(c.measureText(label).width, r.w - 24);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.beginPath();
      c.roundRect(r.x + 8, r.y + r.h - size * 2 - 6, tw + 16, size * 2, 6);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(label, r.x + 16, r.y + r.h - size - 6, r.w - 32);
    }
    c.restore();
    if (who?.speaking) {
      c.strokeStyle = SPEAK;
      c.lineWidth = 4;
      c.beginPath();
      c.roundRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 9);
      c.stroke();
    }
  }
}

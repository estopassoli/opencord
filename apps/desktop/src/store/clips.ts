import type { UserSettings } from '@opencord/contracts';
import { create } from 'zustand';
import type { ClipInfo } from '../../electron/shared/ipc';
import { encodeStream, webCodecsAvailable, type EncodeSession } from '../clips/encode';
import { ClipAudio } from '../clips/audio';
import { muxClip } from '../clips/mux';
import { ChunkRing, type StoredChunk } from '../clips/ring';
import { bridge } from '../lib/bridge';
import { playSound } from '../lib/sounds';
import { useData } from './data';
import { useGames } from './games';
import { setSoundTap } from './sounds';
import { useUi } from './ui';

/**
 * Clipes (ADR-0022): com um jogo aberto e a opção ligada, a tela principal e o som do computador são codificados
 * (H.264 na placa) e os últimos segundos ficam na memória. O atalho (Shift+F10) salva um MP4 na pasta de clipes,
 * com miniatura e o jogo ao lado; a biblioteca aparece no painel do usuário e no visualizador de clipes.
 */
/** depois de fechar o jogo, segura a captura um pouco (trocar de partida, reabrir) antes de liberar memória */
const STOP_GRACE_MS = 30_000;

type ClipSettings = Pick<UserSettings['games'], 'clipSeconds' | 'clipFps' | 'clipResolution' | 'clipQuality'>;
const settingsOf = (): ClipSettings => {
  const g = useData.getState().settings?.games;
  return {
    clipSeconds: g?.clipSeconds ?? 60,
    clipFps: g?.clipFps ?? 60,
    clipResolution: g?.clipResolution ?? '1080p',
    clipQuality: g?.clipQuality ?? 75,
  };
};
const MAX_SIZE: Record<ClipSettings['clipResolution'], { width: number; height: number } | null> = {
  source: null,
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
};
/** bitrate: ~0,12 bit por pixel por quadro a 100% (1080p60 ≈ 15 Mb/s), proporcional à qualidade */
export function clipBitrate(width: number, height: number, fps: number, quality: number) {
  return Math.round(Math.max(1_000_000, width * height * fps * 0.12 * (quality / 100)));
}

interface ClipsStore {
  /** guardando os últimos segundos agora */
  active: boolean;
  saving: boolean;
  /** clipes da pasta, mais novos primeiro */
  library: ClipInfo[];
  /** clipe aberto no visualizador */
  viewing: ClipInfo | null;
  loadLibrary(): Promise<void>;
  open(c: ClipInfo | null): void;
  remove(c: ClipInfo): Promise<void>;
}
export const useClips = create<ClipsStore>()((set, get) => ({
  active: false,
  saving: false,
  library: [],
  viewing: null,
  async loadLibrary() {
    if (!bridge) return;
    const library = await bridge.clips.list().catch(() => get().library);
    set({ library });
  },
  open(c) {
    set({ viewing: c });
  },
  async remove(c) {
    await bridge?.clips.remove(c.file);
    set((s) => ({
      library: s.library.filter((x) => x.file !== c.file),
      viewing: s.viewing?.file === c.file ? null : s.viewing,
    }));
  },
}));

let stream: MediaStream | null = null;
let session: EncodeSession | null = null;
let clipAudio: ClipAudio | null = null;
let ring = new ChunkRing(60e6);
let fpsNow = 60;
let running: string | null = null;
let starting: Promise<void> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

async function start() {
  if (stream || starting || !bridge || !webCodecsAvailable()) return;
  starting = (async () => {
    try {
      const cfg = settingsOf();
      if (!(await bridge!.clips.prepareCapture())) return;
      const max = MAX_SIZE[cfg.clipResolution];
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...(max ? { width: { max: max.width }, height: { max: max.height } } : {}),
          frameRate: { ideal: cfg.clipFps, max: cfg.clipFps },
        },
        // sem o som do próprio OpenCord (vozes e efeitos vão em trilhas separadas)
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          restrictOwnAudio: true,
        } as MediaTrackConstraints,
      });
      const [v] = s.getVideoTracks();
      if (v) v.contentHint = 'motion';
      const { width = max?.width ?? 1920, height = max?.height ?? 1080 } = v?.getSettings() ?? {};
      stream = s;
      const voice = await import('./voice');
      clipAudio = new ClipAudio(
        s.getAudioTracks()[0] ?? null,
        () => voice.useVoice.getState().engine()?.callAudioTracks() ?? [],
      );
      setSoundTap((m) => clipAudio?.addEffect(m));
      fpsNow = cfg.clipFps;
      running = JSON.stringify(cfg);
      ring = new ChunkRing(cfg.clipSeconds * 1e6);
      session = encodeStream(
        new MediaStream([...(v ? [v] : []), ...clipAudio.tracks()]),
        { fps: cfg.clipFps, bitrate: clipBitrate(width, height, cfg.clipFps, cfg.clipQuality), keyEverySec: 2 },
        {
          video: (c) => ring.pushVideo(c),
          audio: (c, i) => ring.pushAudio(c, i),
        },
      );
      // a captura caiu (monitor desligado, permissão): fica inativo até o próximo jogo
      v?.addEventListener('ended', () => void stop());
      useClips.setState({ active: true });
    } catch {
      await stop();
    }
  })().finally(() => {
    starting = null;
  });
  await starting;
}

async function stop() {
  const s = session;
  session = null;
  const st = stream;
  stream = null;
  running = null;
  useClips.setState({ active: false });
  await s?.stop().catch(() => undefined);
  st?.getTracks().forEach((t) => t.stop());
  setSoundTap(null);
  clipAudio?.stop();
  clipAudio = null;
  ring.clear();
}

/** Liga ou desliga conforme o jogo detectado e a opção "Clipes"; mudou a captura nas configurações: recomeça. */
export function syncClips() {
  const want = Boolean(useGames.getState().mine) && useData.getState().settings?.games.clips !== false;
  if (want) {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    if (running && running !== JSON.stringify(settingsOf())) void stop().then(start);
    else void start();
  } else if (stream || starting) {
    // opção desligada: para na hora; jogo fechado: espera um pouco
    const off = useData.getState().settings?.games.clips === false;
    if (off) void stop();
    else if (!stopTimer)
      stopTimer = setTimeout(() => {
        stopTimer = null;
        void stop();
      }, STOP_GRACE_MS);
  }
}

/** Miniatura JPEG (320×180) do quadro-chave do meio do clipe. */
async function thumbnail(video: StoredChunk[]): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const keys = video.filter((c) => c.key && c.config);
  const key = keys[Math.floor(keys.length / 2)];
  if (!key || typeof VideoDecoder === 'undefined') return undefined;
  try {
    const frame = await new Promise<VideoFrame>((resolve, reject) => {
      const dec = new VideoDecoder({
        output: (f) => {
          resolve(f);
          void Promise.resolve().then(() => dec.state !== 'closed' && dec.close());
        },
        error: reject,
      });
      dec.configure(key.config as VideoDecoderConfig);
      dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data: key.data }));
      void dec.flush().catch(reject);
    });
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d')!;
    const s = Math.max(320 / frame.displayWidth, 180 / frame.displayHeight);
    const w = frame.displayWidth * s;
    const h = frame.displayHeight * s;
    ctx.drawImage(frame, (320 - w) / 2, (180 - h) / 2, w, h);
    frame.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Atalho de clipe: grava os últimos segundos. */
export async function saveClip() {
  const ui = useUi.getState();
  if (!bridge) return;
  if (!session) {
    ui.toast('info', 'Os clipes funcionam com um jogo aberto (Configurações → Jogos).');
    return;
  }
  if (useClips.getState().saving) return;
  const snap = ring.snapshot();
  if (!snap) return ui.toast('info', 'Ainda não há nada gravado; tente de novo em alguns segundos.');
  useClips.setState({ saving: true });
  try {
    const data = await muxClip(session, fpsNow, snap);
    const g = useGames.getState().mine;
    const durationMs = Math.round((snap.video.at(-1)!.ts + snap.video.at(-1)!.dur - snap.base) / 1000);
    const thumb = await thumbnail(snap.video);
    const file = await bridge.clips.save({
      game: g?.name ?? 'Clipe',
      data,
      durationMs,
      ...(g?.icon ? { icon: g.icon } : {}),
      ...(g?.steamAppId ? { steamAppId: g.steamAppId } : {}),
      ...(thumb ? { thumb } : {}),
    });
    playSound('clip');
    await useClips.getState().loadLibrary();
    ui.toast('success', `Clipe de ${Math.round(durationMs / 1000)} s salvo.`, {
      label: 'Abrir',
      run: () => {
        const c = useClips.getState().library.find((x) => x.file === file);
        if (c) useClips.getState().open(c);
      },
    });
  } catch {
    ui.toast('error', 'Não consegui salvar o clipe.');
  } finally {
    useClips.setState({ saving: false });
  }
}

let wired = false;
/** Acompanha o jogo detectado (chamado ao aplicar as configurações). */
export function wireClips() {
  if (wired) return;
  wired = true;
  void useClips.getState().loadLibrary();
  useGames.subscribe((s, prev) => {
    if (s.mine?.name !== prev.mine?.name) syncClips();
  });
}

/** Diagnóstico somente leitura (suporte/E2E): o que está sendo guardado agora. */
export function clipsDiag() {
  return {
    active: useClips.getState().active,
    width: session?.width ?? 0,
    height: session?.height ?? 0,
    audioCodec: session?.audioCodec ?? null,
    audioTracks: stream?.getAudioTracks().length ?? 0,
    bytes: ring.bytes,
    lastVideoTs: ring.lastVideoTs,
    lastAudioTs: ring.lastAudioTs,
    audioIn: ring.audioIn,
  };
}

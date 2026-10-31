import { create } from 'zustand';
import { encodeStream, webCodecsAvailable, type EncodeSession } from '../clips/encode';
import { muxMp4 } from '../clips/mux';
import { ChunkRing } from '../clips/ring';
import { bridge } from '../lib/bridge';
import { useData } from './data';
import { useGames } from './games';
import { useUi } from './ui';

/**
 * Clipes (ADR-0022): com um jogo aberto e a opção ligada, a tela principal e o som do computador são codificados
 * (H.264 na placa) e os últimos 60 s ficam na memória. O atalho (Shift+F10) salva um MP4 em Vídeos\OpenCord.
 */
const WINDOW_S = 60;
const FPS = 60;
const BITRATE = 12_000_000;
/** depois de fechar o jogo, segura a captura um pouco (trocar de partida, reabrir) antes de liberar memória */
const STOP_GRACE_MS = 30_000;

interface ClipsStore {
  /** guardando os últimos 60 s agora */
  active: boolean;
  saving: boolean;
}
export const useClips = create<ClipsStore>()(() => ({ active: false, saving: false }));

let stream: MediaStream | null = null;
let session: EncodeSession | null = null;
const ring = new ChunkRing(WINDOW_S * 1e6);
let starting: Promise<void> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

async function start() {
  if (stream || starting || !bridge || !webCodecsAvailable()) return;
  starting = (async () => {
    try {
      if (!(await bridge!.clips.prepareCapture())) return;
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: FPS, max: FPS } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
      });
      const [v] = s.getVideoTracks();
      if (v) v.contentHint = 'motion';
      stream = s;
      ring.clear();
      session = encodeStream(
        s,
        { fps: FPS, bitrate: BITRATE, keyEverySec: 2 },
        {
          video: (c) => ring.pushVideo(c),
          audio: (c) => ring.pushAudio(c),
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
  useClips.setState({ active: false });
  await s?.stop().catch(() => undefined);
  st?.getTracks().forEach((t) => t.stop());
  ring.clear();
}

/** Liga ou desliga conforme o jogo detectado e a opção "Clipes". */
export function syncClips() {
  const want = Boolean(useGames.getState().mine) && useData.getState().settings?.games.clips !== false;
  if (want) {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    void start();
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

/** Atalho de clipe: grava os últimos 60 s. */
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
    const data = muxMp4(session, FPS, snap);
    const game = useGames.getState().mine?.name ?? 'Clipe';
    const file = await bridge.clips.save({ game, data });
    const secs = Math.round((snap.video.at(-1)!.ts - snap.base) / 1e6);
    ui.toast('success', `Clipe de ${secs} s salvo em Vídeos\\OpenCord.`, {
      label: 'Mostrar na pasta',
      run: () => void bridge?.clips.reveal(file),
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

import type { UserSettings } from '@opencord/contracts';
import { create } from 'zustand';
import type { ClipInfo } from '../../electron/shared/ipc';
import { reportError } from '../components/ErrorBoundary';
import { encodeStream, webCodecsAvailable, type EncodeSession } from '../clips/encode';
import { ClipAudio } from '../clips/audio';
import { muxClip } from '../clips/mux';
import { ChunkRing, type StoredChunk } from '../clips/ring';
import { bridge } from '../lib/bridge';
import { clipNotice } from '../lib/overlay';
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
/** captura caiu com o jogo aberto: espera a tela assentar antes de religar */
const RESTART_MS = 3_000;

type ClipSettings = Pick<
  UserSettings['games'],
  'clipSeconds' | 'clipFps' | 'clipResolution' | 'clipQuality' | 'clipOutputsOff'
>;
const settingsOf = (): ClipSettings => {
  const g = useData.getState().settings?.games;
  return {
    clipSeconds: g?.clipSeconds ?? 60,
    clipFps: g?.clipFps ?? 60,
    clipResolution: g?.clipResolution ?? '1080p',
    clipQuality: g?.clipQuality ?? 75,
    clipOutputsOff: g?.clipOutputsOff ?? [],
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
/** nomes das trilhas de som do clipe em gravação (a 1ª é a mistura) */
let audioNames: string[] = [];

/** "Fones de ouvido (A50 X Game)" e o rótulo do Chromium ("Padrão - …", "Comunicação - …") viram o mesmo nome */
const deviceName = (label: string) => label.replace(/^(Padrão|Default|Comunicação|Communications)\s+-\s+/i, '').trim();

/**
 * Saídas do Windows nos clipes (ADR-0024): a padrão vem da captura do Chromium (sem o OpenCord); as outras, do
 * oc-audio.exe. Também descobre se o OpenCord toca numa dessas outras (as vozes já estariam no som dela).
 */
async function clipOutputs(off: string[]) {
  const list = (await bridge?.winAudio.list().catch(() => [])) ?? [];
  const def = list.find((d) => d.default);
  const outputs = list.filter((d) => !d.default && !off.includes(d.name)).map(({ id, name }) => ({ id, name }));
  const want = useData.getState().settings?.audio.outputDeviceId ?? '';
  let mine: string | undefined;
  if (!want || want === 'default') mine = def?.id;
  else if (want === 'communications') mine = list.find((d) => d.comm)?.id;
  else {
    const label = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).find(
      (d) => d.kind === 'audiooutput' && d.deviceId === want,
    )?.label;
    mine = label ? list.find((d) => d.name === deviceName(label))?.id : def?.id;
  }
  return {
    systemName: def?.name ?? 'Computador',
    systemOn: !def || !off.includes(def.name),
    outputs,
    opencordInOutputs: outputs.some((o) => o.id === mine),
  };
}
let ring = new ChunkRing(60e6);
let fpsNow = 60;
let running: string | null = null;
let starting: Promise<void> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
/** por que a gravação não começou (vai no aviso do atalho e no crash-log.txt) */
let startError: string | null = null;
/** religadas seguidas da captura (zera quando ela fica de pé por um minuto) */
let restarts = 0;

const reasonOf = (e: unknown) => (e instanceof Error ? e.message || e.name : String(e));
/** registra no crash-log.txt (só o motivo técnico; nada da tela) */
const logClips = (msg: string) => reportError('clips', new Error(msg));

async function start() {
  if (stream || starting || !bridge) return;
  if (!webCodecsAvailable()) {
    startError = 'este computador não tem o codificador de vídeo do navegador (WebCodecs)';
    return;
  }
  starting = (async () => {
    try {
      const cfg = settingsOf();
      if (!(await bridge!.clips.prepareCapture())) {
        startError = 'nenhuma tela encontrada para gravar';
        logClips(`clipes: ${startError}`);
        return;
      }
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
      const eng = () => voice.useVoice.getState().engine();
      const outs = await clipOutputs(cfg.clipOutputsOff);
      const audio = await ClipAudio.create({
        system: outs.systemOn ? (s.getAudioTracks()[0] ?? null) : null,
        systemName: outs.systemName,
        outputs: outs.outputs,
        opencordInOutputs: outs.opencordInOutputs,
        mic: () => eng()?.micAudioTrack() ?? null,
        voices: () => eng()?.remoteAudioTracks() ?? [],
      });
      clipAudio = audio;
      audioNames = audio.names();
      setSoundTap((m, el) => clipAudio?.addEffect(m, el));
      fpsNow = cfg.clipFps;
      running = JSON.stringify(cfg);
      ring = new ChunkRing(cfg.clipSeconds * 1e6);
      session = encodeStream(
        new MediaStream([...(v ? [v] : []), ...audio.tracks()]),
        { fps: cfg.clipFps, bitrate: clipBitrate(width, height, cfg.clipFps, cfg.clipQuality), keyEverySec: 2 },
        {
          video: (c) => ring.pushVideo(c),
          audio: (c, i) => ring.pushAudio(c, i),
          // mudou a resolução ou a placa caiu e voltou: o trecho de antes não cabe no mesmo arquivo
          restart: () => ring.resetVideo(),
          error: (reason) => logClips(`clipes: codificador de vídeo falhou (${reason}); recriando`),
        },
      );
      startError = null;
      // a captura caiu (jogo entrando em tela cheia, troca de resolução, monitor desligado): religa com o jogo aberto
      const startedAt = Date.now();
      v?.addEventListener('ended', () => {
        // caindo logo depois de começar, várias vezes seguidas: desiste até o próximo jogo
        restarts = Date.now() - startedAt > 60_000 ? 0 : restarts + 1;
        if (restarts > 5) {
          startError = 'a captura da tela parou várias vezes seguidas';
          logClips(`clipes: ${startError}; parado até o próximo jogo`);
          void stop();
          return;
        }
        logClips('clipes: a captura da tela parou; religando');
        void stop().then(() => setTimeout(syncClips, RESTART_MS));
      });
      useClips.setState({ active: true });
    } catch (e) {
      startError = reasonOf(e);
      logClips(`clipes: a gravação não começou (${startError})`);
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
  const game = useGames.getState().mine;
  logClips(`clipes: atalho recebido (gravando: ${session ? 'sim' : 'não'}; jogo: ${game?.name ?? 'nenhum'})`);
  if (!session) {
    if (!game) ui.toast('info', 'Os clipes funcionam com um jogo aberto (Configurações → Jogos).');
    else if (starting) {
      clipNotice('A gravação ainda está começando', false);
      ui.toast('info', 'A gravação do clipe está começando; tente de novo em alguns segundos.');
    } else {
      // jogo aberto, mas a gravação caiu ou não começou: avisa o motivo e tenta de novo
      clipNotice('Os clipes não estão gravando', false);
      ui.toast('error', `Os clipes não estão gravando${startError ? ` (${startError})` : ''}. Tentando de novo…`);
      syncClips();
    }
    return;
  }
  if (useClips.getState().saving) return;
  const snap = ring.snapshot();
  if (!snap) {
    clipNotice('Ainda não há nada gravado', false);
    return ui.toast('info', 'Ainda não há nada gravado; tente de novo em alguns segundos.');
  }
  useClips.setState({ saving: true });
  try {
    const data = await muxClip(session, fpsNow, snap, audioNames);
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
    const secs = Math.round(durationMs / 1000);
    clipNotice(`Clipe de ${secs} ${secs === 1 ? 'segundo' : 'segundos'} salvo`, true);
    ui.toast('success', `Clipe de ${secs} s salvo.`, {
      label: 'Abrir',
      run: () => {
        const c = useClips.getState().library.find((x) => x.file === file);
        if (c) useClips.getState().open(c);
      },
    });
  } catch (e) {
    logClips(`clipes: não salvou (${reasonOf(e)})`);
    clipNotice('Não consegui salvar o clipe', false);
    ui.toast('error', `Não consegui salvar o clipe (${reasonOf(e)}).`);
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
    if (s.mine?.name === prev.mine?.name) return;
    restarts = 0;
    syncClips();
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
    audioNames,
    /** bytes de PCM recebidos de cada saída do Windows */
    outputsIn: clipAudio?.received() ?? {},
  };
}

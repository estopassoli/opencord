/**
 * Efeitos sonoros do OpenCord, sintetizados na hora com Web Audio (sem arquivos de áudio: nada de assets de
 * terceiros, nada para baixar). Cada som é uma sequência curta de notas com envelope suave.
 * Respeita Configurações → Notificações (Sons, volume, Não perturbe) e toca no dispositivo de saída escolhido.
 */
import { useData } from '../store/data';

export type SoundName =
  | 'join'
  | 'leave'
  | 'peerJoin'
  | 'peerLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'message'
  | 'streamStart'
  | 'streamStop'
  | 'disconnect'
  | 'reconnect';

interface Note {
  /** Hz */
  f: number;
  /** início (s) */
  t: number;
  /** duração (s) */
  d: number;
  /** ganho relativo 0–1 */
  g?: number;
  type?: OscillatorType;
}

// notas (Hz): escala de Mi maior/Lá maior, timbres suaves — próprios do OpenCord
const E5 = 659.25;
const Gs5 = 830.61;
const A5 = 880;
const B5 = 987.77;
const Cs6 = 1108.73;
const E6 = 1318.51;
const A4 = 440;
const E4 = 329.63;
const B4 = 493.88;

export const SOUNDS: Record<SoundName, Note[]> = {
  join: [
    { f: E5, t: 0, d: 0.16 },
    { f: A5, t: 0.09, d: 0.22 },
  ],
  leave: [
    { f: A5, t: 0, d: 0.16 },
    { f: E5, t: 0.09, d: 0.24 },
  ],
  peerJoin: [
    { f: B5, t: 0, d: 0.12, g: 0.7 },
    { f: E6, t: 0.07, d: 0.18, g: 0.7 },
  ],
  peerLeave: [
    { f: E6, t: 0, d: 0.12, g: 0.7 },
    { f: B5, t: 0.07, d: 0.2, g: 0.7 },
  ],
  mute: [
    { f: Gs5, t: 0, d: 0.09, g: 0.8 },
    { f: E5, t: 0.05, d: 0.12, g: 0.8 },
  ],
  unmute: [
    { f: E5, t: 0, d: 0.09, g: 0.8 },
    { f: Gs5, t: 0.05, d: 0.12, g: 0.8 },
  ],
  deafen: [
    { f: B4, t: 0, d: 0.1, g: 0.8 },
    { f: E4, t: 0.06, d: 0.16, g: 0.8 },
  ],
  undeafen: [
    { f: E4, t: 0, d: 0.1, g: 0.8 },
    { f: B4, t: 0.06, d: 0.16, g: 0.8 },
  ],
  message: [
    { f: Cs6, t: 0, d: 0.1, g: 0.6 },
    { f: E6, t: 0.06, d: 0.22, g: 0.55 },
  ],
  streamStart: [
    { f: A5, t: 0, d: 0.12 },
    { f: Cs6, t: 0.08, d: 0.12 },
    { f: E6, t: 0.16, d: 0.26 },
  ],
  streamStop: [
    { f: E6, t: 0, d: 0.12 },
    { f: Cs6, t: 0.08, d: 0.12 },
    { f: A5, t: 0.16, d: 0.26 },
  ],
  disconnect: [
    { f: A4, t: 0, d: 0.18, g: 0.7, type: 'triangle' },
    { f: E4, t: 0.14, d: 0.3, g: 0.7, type: 'triangle' },
  ],
  reconnect: [
    { f: E5, t: 0, d: 0.1, g: 0.7 },
    { f: E5, t: 0.12, d: 0.1, g: 0.7 },
    { f: A5, t: 0.24, d: 0.2, g: 0.7 },
  ],
};

/** últimos sons disparados (diagnóstico/E2E: confere os gatilhos com o áudio mudo) */
export const soundLog: SoundName[] = [];

let ctx: AudioContext | null = null;
let sink: string | null = null;
const last = new Map<SoundName, number>();

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** Toca no dispositivo de saída escolhido (quando o navegador permite trocar). */
async function applySink(c: AudioContext) {
  const want = useData.getState().settings?.audio.outputDeviceId ?? '';
  const ac = c as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (sink === want || !ac.setSinkId) return;
  sink = want;
  await ac.setSinkId(want).catch(() => undefined);
}

/** Sons ligados, fora do Não perturbe; volume 0–1. */
export function soundVolume(): number {
  const d = useData.getState();
  const n = d.settings?.notifications;
  if (!n || !n.sounds || n.dnd || d.myStatus === 'dnd') return 0;
  return n.soundVolume;
}

export function playSound(name: SoundName, opts: { force?: boolean } = {}) {
  const vol = opts.force ? (useData.getState().settings?.notifications.soundVolume ?? 0.5) : soundVolume();
  if (vol <= 0) return;
  // o mesmo som em rajada (ex.: várias pessoas entrando juntas) toca uma vez
  const now = Date.now();
  if (!opts.force && now - (last.get(name) ?? 0) < 250) return;
  last.set(name, now);
  soundLog.push(name);
  if (soundLog.length > 50) soundLog.shift();
  const c = context();
  if (!c) return;
  void applySink(c);
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const master = c.createGain();
  // curva perceptual: o controle de volume soa linear para o ouvido
  master.gain.value = 0.35 * vol * vol;
  master.connect(c.destination);
  const t0 = c.currentTime + 0.01;
  for (const n of SOUNDS[name]) {
    const start = t0 + n.t;
    const end = start + n.d;
    const peak = n.g ?? 1;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.value = n.f;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

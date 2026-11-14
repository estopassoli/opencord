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
  | 'reconnect'
  | 'clip';

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
const C6 = 1046.5;

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
  // clipe salvo: três notas subindo, rápidas (tipo "obturador")
  clip: [
    { f: A5, t: 0, d: 0.08, g: 0.7 },
    { f: Cs6, t: 0.06, d: 0.08, g: 0.7 },
    { f: E6, t: 0.12, d: 0.18, g: 0.7 },
  ],
};

/** Conjuntos de sons (Configurações → Notificações). "classico" é o SOUNDS acima. */
export const SOUND_PACKS = ['padrao', 'classico', 'suave', 'retro', 'madeira', 'telefone', 'discreto'] as const;
export type SoundPack = (typeof SOUND_PACKS)[number];
export const SOUND_PACK_LABEL: Record<SoundPack, string> = {
  padrao: 'Padrão',
  classico: 'Clássico',
  suave: 'Suave',
  retro: 'Retrô (8 bits)',
  madeira: 'Madeira (marimba)',
  telefone: 'Telefone',
  discreto: 'Discreto',
};

// notas graves/médias usadas pelos conjuntos novos
const C4 = 261.63;
const D4 = 293.66;
const F4 = 349.23;
const G4 = 392;
const C5 = 523.25;
const D5 = 587.33;
const F5 = 698.46;
const G5 = 783.99;
const Cs5 = 554.37;
const A3 = 220;

const sq = (f: number, t: number, d: number, g = 0.45): Note => ({ f, t, d, g, type: 'square' });
const tri = (f: number, t: number, d: number, g = 0.9): Note => ({ f, t, d, g, type: 'triangle' });
const tick = (f: number, t = 0, g = 0.5): Note => ({ f, t, d: 0.045, g });

/** Suave: senos uma oitava abaixo, decaimento longo; quase um sino distante. */
const SUAVE: Record<SoundName, Note[]> = {
  join: [
    { f: E4, t: 0, d: 0.3, g: 0.8 },
    { f: A4, t: 0.14, d: 0.45, g: 0.8 },
  ],
  leave: [
    { f: A4, t: 0, d: 0.3, g: 0.8 },
    { f: E4, t: 0.14, d: 0.5, g: 0.8 },
  ],
  peerJoin: [{ f: B4, t: 0, d: 0.35, g: 0.55 }],
  peerLeave: [{ f: E4, t: 0, d: 0.4, g: 0.55 }],
  mute: [{ f: E4, t: 0, d: 0.2, g: 0.6 }],
  unmute: [{ f: A4, t: 0, d: 0.2, g: 0.6 }],
  deafen: [{ f: A3, t: 0, d: 0.3, g: 0.6 }],
  undeafen: [{ f: E4, t: 0, d: 0.3, g: 0.6 }],
  message: [{ f: Cs5, t: 0, d: 0.4, g: 0.45 }],
  streamStart: [
    { f: A4, t: 0, d: 0.3, g: 0.8 },
    { f: Cs5, t: 0.16, d: 0.5, g: 0.8 },
  ],
  streamStop: [
    { f: Cs5, t: 0, d: 0.3, g: 0.8 },
    { f: A4, t: 0.16, d: 0.5, g: 0.8 },
  ],
  disconnect: [{ f: A3, t: 0, d: 0.6, g: 0.6, type: 'triangle' }],
  reconnect: [
    { f: E4, t: 0, d: 0.2, g: 0.6 },
    { f: A4, t: 0.2, d: 0.4, g: 0.6 },
  ],
  clip: [
    { f: A4, t: 0, d: 0.14, g: 0.6 },
    { f: E5, t: 0.1, d: 0.3, g: 0.6 },
  ],
};

/** Retrô: onda quadrada, arpejos rápidos, cara de videogame antigo. */
const RETRO: Record<SoundName, Note[]> = {
  join: [sq(C5, 0, 0.07), sq(E5, 0.07, 0.07), sq(G5, 0.14, 0.14)],
  leave: [sq(G5, 0, 0.07), sq(E5, 0.07, 0.07), sq(C5, 0.14, 0.16)],
  peerJoin: [sq(G5, 0, 0.06, 0.35), sq(C6, 0.06, 0.1, 0.35)],
  peerLeave: [sq(C6, 0, 0.06, 0.35), sq(G5, 0.06, 0.12, 0.35)],
  mute: [sq(E4, 0, 0.08, 0.4)],
  unmute: [sq(A4, 0, 0.08, 0.4)],
  deafen: [sq(A3, 0, 0.1, 0.4), sq(E4, 0.1, 0.08, 0.3)],
  undeafen: [sq(E4, 0, 0.08, 0.3), sq(A3, 0.08, 0.1, 0.4)],
  message: [sq(B5, 0, 0.05, 0.3), sq(B5, 0.09, 0.08, 0.3)],
  streamStart: [sq(C5, 0, 0.06), sq(G5, 0.06, 0.06), sq(C6, 0.12, 0.16)],
  streamStop: [sq(C6, 0, 0.06), sq(G5, 0.06, 0.06), sq(C5, 0.12, 0.16)],
  disconnect: [sq(E4, 0, 0.12, 0.4), sq(C4, 0.14, 0.22, 0.4)],
  reconnect: [sq(C5, 0, 0.06), sq(C5, 0.1, 0.06), sq(G5, 0.2, 0.14)],
  clip: [sq(G5, 0, 0.05, 0.4), sq(C6, 0.05, 0.05, 0.4), sq(E6, 0.1, 0.12, 0.4)],
};

/** Madeira: triângulo com decaimento curto, notas médias; lembra marimba. */
const MADEIRA: Record<SoundName, Note[]> = {
  join: [tri(D4, 0, 0.12), tri(A4, 0.1, 0.18)],
  leave: [tri(A4, 0, 0.12), tri(D4, 0.1, 0.2)],
  peerJoin: [tri(F5, 0, 0.14, 0.6)],
  peerLeave: [tri(D4, 0, 0.16, 0.6)],
  mute: [tri(G4, 0, 0.08, 0.7), tri(D4, 0.05, 0.1, 0.7)],
  unmute: [tri(D4, 0, 0.08, 0.7), tri(G4, 0.05, 0.1, 0.7)],
  deafen: [tri(A3, 0, 0.14, 0.7)],
  undeafen: [tri(D4, 0, 0.14, 0.7)],
  message: [tri(F5, 0, 0.1, 0.5), tri(A5, 0.07, 0.16, 0.5)],
  streamStart: [tri(D4, 0, 0.1), tri(F4, 0.08, 0.1), tri(A4, 0.16, 0.22)],
  streamStop: [tri(A4, 0, 0.1), tri(F4, 0.08, 0.1), tri(D4, 0.16, 0.22)],
  disconnect: [tri(D4, 0, 0.16, 0.7), tri(A3, 0.14, 0.28, 0.7)],
  reconnect: [tri(D4, 0, 0.08), tri(D4, 0.12, 0.08), tri(A4, 0.24, 0.18)],
  clip: [tri(A4, 0, 0.06, 0.7), tri(D5, 0.06, 0.06, 0.7), tri(F5, 0.12, 0.14, 0.7)],
};

/** Telefone: bipes de dois tons e toques curtos, como um telefone antigo. */
const TELEFONE: Record<SoundName, Note[]> = {
  join: [
    { f: 880, t: 0, d: 0.18, g: 0.6 },
    { f: 1320, t: 0, d: 0.18, g: 0.45 },
  ],
  leave: [
    { f: 620, t: 0, d: 0.12, g: 0.6 },
    { f: 620, t: 0.16, d: 0.12, g: 0.6 },
  ],
  peerJoin: [
    { f: 1000, t: 0, d: 0.08, g: 0.45 },
    { f: 1000, t: 0.1, d: 0.08, g: 0.45 },
  ],
  peerLeave: [{ f: 480, t: 0, d: 0.2, g: 0.45 }],
  mute: [{ f: 480, t: 0, d: 0.12, g: 0.5 }],
  unmute: [{ f: 960, t: 0, d: 0.12, g: 0.5 }],
  deafen: [
    { f: 480, t: 0, d: 0.1, g: 0.5 },
    { f: 360, t: 0.1, d: 0.14, g: 0.5 },
  ],
  undeafen: [
    { f: 360, t: 0, d: 0.1, g: 0.5 },
    { f: 480, t: 0.1, d: 0.14, g: 0.5 },
  ],
  message: [
    { f: 1000, t: 0, d: 0.07, g: 0.4 },
    { f: 1250, t: 0.08, d: 0.1, g: 0.4 },
  ],
  streamStart: [
    { f: 880, t: 0, d: 0.1, g: 0.5 },
    { f: 1320, t: 0.12, d: 0.1, g: 0.5 },
    { f: 1760, t: 0.24, d: 0.16, g: 0.5 },
  ],
  streamStop: [
    { f: 1760, t: 0, d: 0.1, g: 0.5 },
    { f: 1320, t: 0.12, d: 0.1, g: 0.5 },
    { f: 880, t: 0.24, d: 0.16, g: 0.5 },
  ],
  disconnect: [
    { f: 480, t: 0, d: 0.25, g: 0.5 },
    { f: 620, t: 0, d: 0.25, g: 0.35 },
  ],
  reconnect: [
    { f: 880, t: 0, d: 0.08, g: 0.5 },
    { f: 880, t: 0.12, d: 0.08, g: 0.5 },
    { f: 1320, t: 0.24, d: 0.16, g: 0.5 },
  ],
  clip: [
    { f: 1320, t: 0, d: 0.05, g: 0.5 },
    { f: 1760, t: 0.06, d: 0.1, g: 0.5 },
  ],
};

/** Discreto: tiques curtíssimos, baixo volume; só para não passar batido. */
const DISCRETO: Record<SoundName, Note[]> = {
  join: [tick(1200), tick(1600, 0.05)],
  leave: [tick(1600), tick(1200, 0.05)],
  peerJoin: [tick(1400, 0, 0.4)],
  peerLeave: [tick(1000, 0, 0.4)],
  mute: [tick(700, 0, 0.4)],
  unmute: [tick(1100, 0, 0.4)],
  deafen: [tick(600, 0, 0.4), tick(500, 0.06, 0.4)],
  undeafen: [tick(500, 0, 0.4), tick(600, 0.06, 0.4)],
  message: [tick(1500, 0, 0.35)],
  streamStart: [tick(1200), tick(1500, 0.05), tick(1800, 0.1)],
  streamStop: [tick(1800), tick(1500, 0.05), tick(1200, 0.1)],
  disconnect: [tick(700, 0, 0.5), tick(500, 0.08, 0.5)],
  reconnect: [tick(1200, 0, 0.5), tick(1200, 0.1, 0.5), tick(1600, 0.2, 0.5)],
  clip: [tick(1500), tick(2000, 0.05)],
};

/**
 * Padrão: o jeito de "som de chat" que todo mundo reconhece. Notas redondas (seno + um parcial uma oitava acima,
 * mais baixo, para dar corpo), duas notas subindo para entrar e descendo para sair, "tunc" grave e curto no mute,
 * "ding" com cauda na mensagem. Timbre e notas próprios.
 */
const round = (f: number, t: number, d: number, g = 1): Note[] => [
  { f, t, d, g },
  { f: f * 2, t, d: d * 0.6, g: g * 0.18 },
  { f: f * 3, t, d: d * 0.35, g: g * 0.05 },
];
const Fs5 = 739.99;
const D6 = 1174.66;
const G3 = 196;
const PADRAO: Record<SoundName, Note[]> = {
  join: [...round(Fs5, 0, 0.14), ...round(B5, 0.1, 0.26)],
  leave: [...round(B5, 0, 0.14), ...round(Fs5, 0.1, 0.3)],
  peerJoin: [...round(B5, 0, 0.12, 0.6), ...round(D6, 0.08, 0.2, 0.6)],
  peerLeave: [...round(D6, 0, 0.12, 0.6), ...round(B5, 0.08, 0.22, 0.6)],
  mute: [...round(A4, 0, 0.06, 0.9), ...round(E4, 0.04, 0.1, 0.9)],
  unmute: [...round(E4, 0, 0.06, 0.9), ...round(A4, 0.04, 0.12, 0.9)],
  deafen: [...round(G4, 0, 0.08, 0.9), ...round(C4, 0.06, 0.16, 0.9)],
  undeafen: [...round(C4, 0, 0.08, 0.9), ...round(G4, 0.06, 0.16, 0.9)],
  message: [...round(A5, 0, 0.34, 0.7), { f: E6, t: 0.0, d: 0.2, g: 0.12 }],
  streamStart: [...round(A4, 0, 0.1), ...round(E5, 0.09, 0.1), ...round(A5, 0.18, 0.3)],
  streamStop: [...round(A5, 0, 0.1), ...round(E5, 0.09, 0.1), ...round(A4, 0.18, 0.3)],
  disconnect: [...round(E4, 0, 0.14, 0.8), ...round(G3, 0.12, 0.36, 0.8)],
  reconnect: [...round(E5, 0, 0.09, 0.8), ...round(E5, 0.12, 0.09, 0.8), ...round(A5, 0.24, 0.24, 0.8)],
  clip: [...round(A5, 0, 0.07, 0.7), ...round(Cs6, 0.06, 0.07, 0.7), ...round(E6, 0.12, 0.2, 0.7)],
};

export const SOUND_SETS: Record<SoundPack, Record<SoundName, Note[]>> = {
  padrao: PADRAO,
  classico: SOUNDS,
  suave: SUAVE,
  retro: RETRO,
  madeira: MADEIRA,
  telefone: TELEFONE,
  discreto: DISCRETO,
};

/** conjunto escolhido nas configurações */
export function currentPack(): SoundPack {
  const p = useData.getState().settings?.notifications.soundPack;
  return p && p in SOUND_SETS ? (p as SoundPack) : 'padrao';
}

/** últimos sons disparados (diagnóstico/E2E: confere os gatilhos com o áudio mudo) */
export const soundLog: (SoundName | 'nudge')[] = [];

let ctx: AudioContext | null = null;
let sink: string | null = null;
const last = new Map<SoundName, number>();

/**
 * O AudioContext único do app (notificações e efeitos do Espaço 3D, `features/space3d/sfx.ts`); null sem Web Audio
 * (jsdom nos testes).
 */
export function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** Toca no dispositivo de saída escolhido (quando o navegador permite trocar). */
export async function applySink(c: AudioContext) {
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

export function playSound(name: SoundName, opts: { force?: boolean; pack?: SoundPack } = {}) {
  const vol = opts.force ? (useData.getState().settings?.notifications.soundVolume ?? 1) : soundVolume();
  if (vol <= 0) return;
  // o mesmo som em rajada (ex.: várias pessoas entrando juntas) toca uma vez
  const now = Date.now();
  if (!opts.force && now - (last.get(name) ?? 0) < 250) return;
  last.set(name, now);
  soundLog.push(name);
  if (soundLog.length > 50) soundLog.shift();
  playNotes(SOUND_SETS[opts.pack ?? currentPack()][name], vol);
}

/**
 * "Chamar atenção" (ADR-0064): um trinado rápido e insistente seguido de dois toques, igual em todos os conjuntos
 * (precisa ser reconhecível). Próprio do OpenCord, sintetizado como os outros.
 */
export const NUDGE_NOTES: Note[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    f: i % 2 ? 1046.5 : 784,
    t: i * 0.045,
    d: 0.04,
    g: 0.55,
    type: 'triangle' as const,
  })),
  { f: E6, t: 0.5, d: 0.12, g: 0.8 },
  { f: 1760, t: 0.62, d: 0.22, g: 0.7 },
];

/** toca o aviso de "Chamar atenção" no volume dado (0–1), fora da regra de "Efeitos sonoros" */
export function playNudge(vol: number) {
  if (vol <= 0) return;
  soundLog.push('nudge');
  if (soundLog.length > 50) soundLog.shift();
  playNotes(NUDGE_NOTES, vol);
}

function playNotes(notes: readonly Note[], vol: number) {
  const c = context();
  if (!c) return;
  void applySink(c);
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const master = c.createGain();
  // curva perceptual: o controle de volume soa linear para o ouvido
  master.gain.value = 0.35 * vol * vol;
  master.connect(c.destination);
  const t0 = c.currentTime + 0.01;
  for (const n of notes) {
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

/**
 * Motor de efeitos sonoros do Espaço 3D (plano 2026-11-09, P6). Tudo sintetizado na hora com Web Audio (osciladores,
 * ruído filtrado e envelopes): nenhum arquivo de áudio, nada de terceiros. Usa o mesmo AudioContext e o mesmo
 * dispositivo de saída das notificações (`lib/sounds.ts`).
 *
 * Regras (revisão da Iara): volume baixo (mestre 0,25·vol²), distância pela curva da voz com piso 0,15, panorâmica
 * leve (±0,5), abaixa quando alguém fala perto (0,4; placar e apito 0,7), silêncio com Sons desligados, Não perturbe,
 * ensurdecido ou a chave "Efeitos do jogo" desligada. No máximo 12 vozes, o mesmo som no máximo a cada 40 ms, e o
 * `log` registra o que tocaria (testes e diagnóstico, sem tocar nada). Sem AudioContext (jsdom) não faz nada além do
 * log; o contexto só recebe `resume()` depois de um gesto (`unlock`).
 */
import { create } from 'zustand';
import { applySink, context as sharedContext, soundVolume } from '../../lib/sounds';
import type { GameBus, GameEvent } from './events';
import {
  enginePitch,
  sfxFor,
  sfxMix,
  sfxPan,
  SUPERSEDE_MS,
  SUPERSEDES,
  type Listener,
  type SfxCtx,
  type SfxCue,
  type SfxName,
} from './sfxmap';

// ---------- receitas ----------

/** um pedaço de som: tom (oscilador com o tom indo de `f` a `f2`) ou ruído filtrado */
type Part =
  | { k: 'tone'; f: number; f2?: number; t?: number; d: number; g: number; type?: OscillatorType; a?: number }
  | {
      k: 'noise';
      filter: BiquadFilterType;
      f: number;
      f2?: number;
      q?: number;
      t?: number;
      d: number;
      g: number;
      a?: number;
    };

const tone = (f: number, d: number, g: number, o: Partial<Extract<Part, { k: 'tone' }>> = {}): Part => ({
  k: 'tone',
  f,
  d,
  g,
  ...o,
});
const noise = (
  filter: BiquadFilterType,
  f: number,
  d: number,
  g: number,
  o: Partial<Extract<Part, { k: 'noise' }>> = {},
): Part => ({ k: 'noise', filter, f, d, g, ...o });

// notas (Hz), mesma família do conjunto "Padrão" das notificações
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392;
const A4 = 440;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const Cs6 = 1108.73;
const C6 = 1046.5;
const E6 = 1318.51;
const A6 = 1760;

/** nota "redonda": seno com um parcial uma oitava acima, mais baixo */
const note = (f: number, t: number, d: number, g = 0.8): Part[] => [
  tone(f, d, g, { t }),
  tone(f * 2, d * 0.6, g * 0.18, { t }),
];

export const RECIPES: Record<SfxName, Part[]> = {
  // bola de borracha: "tum" grave caindo e um estalo curto
  bounce: [tone(180, 0.07, 1, { f2: 70 }), noise('lowpass', 1200, 0.012, 0.4)],
  // bolinha na mesa: "tic" agudo e seco
  bounceTable: [tone(2300, 0.03, 0.7, { f2: 1800, type: 'triangle' }), noise('bandpass', 3500, 0.01, 0.4, { q: 2 })],
  kick: [noise('lowpass', 400, 0.05, 0.8), tone(95, 0.12, 1, { f2: 45 })],
  // chute forte: mais corpo e um sopro subindo
  kickHard: [
    tone(110, 0.18, 1, { f2: 40 }),
    noise('lowpass', 600, 0.07, 1),
    noise('bandpass', 800, 0.15, 0.35, { f2: 2400, q: 1.5 }),
  ],
  racket: [noise('bandpass', 1200, 0.035, 1, { q: 4 }), tone(620, 0.03, 0.5, { f2: 480 })],
  paddle: [tone(2400, 0.02, 0.8, { f2: 2000, type: 'triangle' }), noise('bandpass', 3000, 0.012, 0.4, { q: 3 })],
  spike: [noise('lowpass', 900, 0.05, 0.9), tone(220, 0.06, 0.6, { f2: 120 })],
  shoot: [noise('bandpass', 600, 0.2, 0.35, { f2: 1600, q: 1.2, a: 0.03 })],
  // errou: só o vento do golpe
  whiff: [noise('bandpass', 500, 0.16, 0.4, { f2: 1800, q: 1.5, a: 0.03 })],
  // aro: três parciais inarmônicos (metálico)
  rim: [tone(520, 0.45, 0.5), tone(1370, 0.3, 0.3), tone(2210, 0.2, 0.2), noise('highpass', 2500, 0.01, 0.3)],
  // tabela: "thunk" de madeira
  board: [noise('lowpass', 250, 0.08, 1), tone(110, 0.1, 0.7, { f2: 90 })],
  // cesta: ruído agudo varrendo, baixinho
  swish: [noise('highpass', 3000, 0.25, 0.35, { f2: 6000, a: 0.05 })],
  // trave: como o aro, mais agudo e curto
  post: [tone(880, 0.3, 0.5), tone(2150, 0.2, 0.3), tone(3400, 0.1, 0.15)],
  wall: [noise('lowpass', 500, 0.06, 0.7), tone(140, 0.07, 0.4, { f2: 80 })],
  netTouch: [noise('lowpass', 700, 0.12, 0.5, { a: 0.02 })],
  cueHit: [
    tone(2900, 0.012, 0.6, { type: 'triangle' }),
    noise('highpass', 3000, 0.004, 0.5),
    tone(300, 0.03, 0.3, { f2: 200 }),
  ],
  ballClack: [tone(2900, 0.02, 0.8, { f2: 2700, type: 'triangle' }), noise('bandpass', 4000, 0.006, 0.5, { q: 2 })],
  cushion: [noise('lowpass', 300, 0.06, 0.7), tone(120, 0.07, 0.5, { f2: 80 })],
  // caçapa: "toc" grave e a bola rolando dentro
  pocket: [tone(160, 0.15, 0.8, { f2: 90 }), noise('lowpass', 400, 0.15, 0.4, { t: 0.05, a: 0.02 })],
  // apito: dois senos quase iguais (o batimento faz o trinado)
  whistle: [tone(2100, 0.32, 0.45, { a: 0.012 }), tone(2140, 0.32, 0.45, { a: 0.012 })],
  scoreUs: [...note(E5, 0, 0.12), ...note(A5, 0.09, 0.22)],
  scoreThem: [...note(A4, 0, 0.12, 0.7), ...note(E4, 0.09, 0.24, 0.7)],
  win: [...note(C5, 0, 0.12), ...note(E5, 0.1, 0.12), ...note(G5, 0.2, 0.12), ...note(C6, 0.3, 0.5)],
  lose: [
    tone(G4, 0.18, 0.7, { type: 'triangle' }),
    tone(E4, 0.18, 0.7, { t: 0.16, type: 'triangle' }),
    tone(C4, 0.45, 0.7, { t: 0.32, type: 'triangle' }),
  ],
  // contagem 3-2-1 e o "JÁ" mais agudo e longo
  count: [tone(880, 0.12, 0.25, { type: 'square' }), tone(880, 0.12, 0.3)],
  go: [tone(A6, 0.35, 0.22, { type: 'square' }), tone(A6, 0.35, 0.4)],
  lap: [...note(A5, 0, 0.08, 0.7), ...note(Cs6, 0.07, 0.08, 0.7), ...note(E6, 0.14, 0.14, 0.7)],
  finalLap: [
    ...note(A5, 0, 0.06),
    ...note(Cs6, 0.05, 0.06),
    ...note(E6, 0.1, 0.06),
    ...note(A5, 0.18, 0.06),
    ...note(Cs6, 0.23, 0.06),
    ...note(E6, 0.28, 0.06),
    ...note(A6, 0.33, 0.2),
  ],
  finish: [
    ...note(C5, 0, 0.1),
    ...note(E5, 0.08, 0.1),
    ...note(G5, 0.16, 0.1),
    ...note(C6, 0.24, 0.12),
    ...note(E6, 0.34, 0.5),
  ],
  boostPad: [noise('highpass', 800, 0.3, 0.4, { f2: 4000, a: 0.02 }), tone(300, 0.25, 0.3, { f2: 900 })],
  boostFire: [noise('bandpass', 400, 0.45, 0.5, { f2: 3000, q: 1, a: 0.03 }), tone(200, 0.4, 0.35, { f2: 700 })],
  itemGet: [tone(987.77, 0.06, 0.6), tone(E6, 0.08, 0.6, { t: 0.05 }), tone(1975.5, 0.14, 0.6, { t: 0.1 })],
  // soco: o vento do golpe; acerto: "pof" grave; defesa: batida abafada
  swing: [noise('bandpass', 700, 0.14, 0.45, { f2: 2000, q: 1.4, a: 0.02 })],
  punch: [tone(120, 0.12, 1, { f2: 50 }), noise('lowpass', 800, 0.025, 0.8)],
  block: [noise('lowpass', 300, 0.07, 0.9), tone(90, 0.08, 0.6, { f2: 60 })],
  ko: [tone(70, 0.4, 1, { f2: 35 }), noise('lowpass', 500, 0.12, 0.8)],
  // gongo: parciais longos
  bell: [tone(220, 1.8, 0.6), tone(333.3, 1.4, 0.4), tone(554, 1, 0.3)],
  chargeTick: [tone(900, 0.025, 0.4, { type: 'triangle' })],
  // "ding" na faixa verde: ensina a soltar ali sem precisar ler
  sweetSpot: [tone(A6, 0.25, 0.6), tone(2637, 0.18, 0.25)],
  uiMove: [tone(1200, 0.025, 0.35)],
  uiOk: [tone(A5, 0.06, 0.5), tone(1320, 0.09, 0.5, { t: 0.05 })],
  uiBack: [tone(1320, 0.06, 0.5), tone(A5, 0.09, 0.5, { t: 0.05 })],
};

/** duração de uma receita (s) */
export function recipeDuration(name: SfxName): number {
  return Math.max(...RECIPES[name].map((p) => (p.t ?? 0) + p.d));
}

// ---------- preferências ("Efeitos do jogo" no menu) ----------

const PREFS_KEY = 'opencord.space3d.sfx';

interface SfxPrefs {
  on: boolean;
  /** 0–1 (multiplica o volume das notificações) */
  vol: number;
  setOn(on: boolean): void;
  setVol(vol: number): void;
}

function loadPrefs(): { on: boolean; vol: number } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { on?: unknown; vol?: unknown };
      return {
        on: typeof p.on === 'boolean' ? p.on : true,
        vol: typeof p.vol === 'number' && Number.isFinite(p.vol) ? Math.max(0, Math.min(1, p.vol)) : 0.7,
      };
    }
  } catch {
    // sem armazenamento (janela privada, bloqueado): fica no padrão
  }
  return { on: true, vol: 0.7 };
}

function savePrefs(p: { on: boolean; vol: number }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

export const useSfxPrefs = create<SfxPrefs>()((set, get) => ({
  ...loadPrefs(),
  setOn(on) {
    set({ on });
    savePrefs({ on, vol: get().vol });
  },
  setVol(vol) {
    const v = Math.max(0, Math.min(1, vol));
    set({ vol: v });
    savePrefs({ on: get().on, vol: v });
  },
}));

let deafened = false;
/** ensurdecido na chamada (o SpaceView acompanha `useVoice.selfDeaf`): silêncio total */
export function setSfxDeafened(on: boolean) {
  deafened = on;
  if (on) sfx.stopEngines();
}

/** volume dos efeitos agora (0 = silêncio): Sons/Não perturbe das notificações × chave e volume do jogo; ensurdecido cala */
export function sfxVolume(): number {
  const p = useSfxPrefs.getState();
  if (!p.on || p.vol <= 0 || deafened) return 0;
  return soundVolume() * p.vol;
}

// ---------- motor ----------

export const SFX_MAX_VOICES = 12;
/** o mesmo som não repete antes disto (ms): uma rajada de choques vira um só */
export const SFX_BURST_MS = 40;
const LOG_MAX = 100;
const MAX_ENGINES = 6;
/** motor sem notícia há mais que isto (ms) para (piloto saiu) */
const ENGINE_STALE_MS = 600;

export interface SfxDeps {
  /** AudioContext (null = sem áudio: só o log) */
  context?: () => AudioContext | null;
  /** volume 0–1; 0 = silêncio total */
  volume?: () => number;
  /** relógio (ms) */
  now?: () => number;
  /** antes de tocar (dispositivo de saída) */
  prepare?: (c: AudioContext) => void;
}

export interface PlayOpts {
  /** onde (m, mundo): distância e panorâmica; sem `at` = som da interface */
  at?: { x: number; y?: number; z: number };
  /** zona do som; diferente da de quem ouve = não toca */
  zone?: number;
  gain?: number;
  pitch?: number;
  info?: boolean;
}

interface Voice {
  name: SfxName;
  gain: number;
  start: number;
  end: number;
  stop?: () => void;
}

interface EngineVoice {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  seen: number;
}

export class Sfx {
  /** o que tocou (ou tocaria sem áudio), mais novo no fim; diagnóstico e testes */
  readonly log: SfxName[] = [];
  /** ganho final do último som (diagnóstico e testes) */
  lastGain = 0;
  private readonly getContext: () => AudioContext | null;
  private readonly volume: () => number;
  private readonly now: () => number;
  private readonly prepare: (c: AudioContext) => void;
  private listener: Listener = { x: 0, z: 0, yaw: 0, zone: 0 };
  private ducked = false;
  private unlocked = false;
  private readonly last = new Map<SfxName, number>();
  private voices: Voice[] = [];
  private readonly engines = new Map<string, EngineVoice>();
  private noiseBuf: AudioBuffer | null = null;
  private out: AudioNode | null = null;
  private outCtx: AudioContext | null = null;

  constructor(deps: SfxDeps = {}) {
    this.getContext = deps.context ?? sharedContext;
    this.volume = deps.volume ?? sfxVolume;
    this.now = deps.now ?? (() => performance.now());
    this.prepare = deps.prepare ?? ((c) => void applySink(c));
  }

  /** quem ouve (meu boneco e a câmera), uma vez por quadro */
  listen(l: Listener) {
    const zoneChanged = l.zone !== this.listener.zone;
    this.listener = { ...l };
    if (zoneChanged) this.stopEngines();
    // motores sem notícia (o piloto saiu) param
    const now = this.now();
    for (const [id, e] of this.engines) if (now - e.seen > ENGINE_STALE_MS) this.stopEngine(id);
  }

  /** alguém falando perto (ou eu): os efeitos abaixam */
  duck(on: boolean) {
    this.ducked = on;
  }

  get isDucked() {
    return this.ducked;
  }

  /** gesto da pessoa (clique, tecla): a partir daqui o contexto pode ser retomado */
  unlock() {
    this.unlocked = true;
    const c = this.getContext();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
  }

  /** vozes tocando agora */
  get active(): number {
    const now = this.now();
    return this.voices.filter((v) => v.end > now).length;
  }

  /** sons de um evento do jogo (filtra pela zona) */
  event(e: GameEvent, ctx: SfxCtx) {
    for (const c of sfxFor(e, ctx)) this.cue(c, { at: e.at, zone: e.zone });
  }

  cue(c: SfxCue, o: PlayOpts = {}): boolean {
    return this.play(c.name, { ...o, gain: c.gain, pitch: c.pitch ?? o.pitch, info: c.info ?? o.info });
  }

  /** som da interface (menu, contagem): sem distância nem zona */
  ui(name: SfxName, o: Omit<PlayOpts, 'at' | 'zone'> = {}): boolean {
    return this.play(name, { info: true, ...o });
  }

  /** toca um som; devolve se entrou (no log) */
  play(name: SfxName, o: PlayOpts = {}): boolean {
    const vol = this.volume();
    if (!(vol > 0)) return false;
    if (o.zone !== undefined && o.zone !== this.listener.zone) return false;
    const now = this.now();
    if (now - (this.last.get(name) ?? -Infinity) < SFX_BURST_MS) return false;
    this.voices = this.voices.filter((v) => v.end > now);
    // um som mais forte que acabou de sair corta este (e este corta os mais fracos)
    for (const v of this.voices)
      if (now - v.start < SUPERSEDE_MS && SUPERSEDES[v.name]?.includes(name) && v.name !== name) return false;
    const weaker = SUPERSEDES[name];
    if (weaker)
      this.voices = this.voices.filter((v) => {
        if (now - v.start < SUPERSEDE_MS && weaker.includes(v.name)) {
          v.stop?.();
          return false;
        }
        return true;
      });
    const d = o.at ? Math.hypot(o.at.x - this.listener.x, o.at.z - this.listener.z) : undefined;
    const gain = sfxMix({ vol, d, ducked: this.ducked, info: o.info, gain: o.gain ?? 1 });
    if (gain <= 1e-4) return false;
    // teto de vozes: sai a mais baixa (ou este, se for o mais baixo)
    if (this.voices.length >= SFX_MAX_VOICES) {
      let low = 0;
      for (let i = 1; i < this.voices.length; i++) if (this.voices[i]!.gain < this.voices[low]!.gain) low = i;
      if (this.voices[low]!.gain >= gain) return false;
      this.voices[low]!.stop?.();
      this.voices.splice(low, 1);
    }
    this.last.set(name, now);
    this.log.push(name);
    if (this.log.length > LOG_MAX) this.log.shift();
    this.lastGain = gain;
    const voice: Voice = { name, gain, start: now, end: now + recipeDuration(name) * 1000 + 30 };
    this.voices.push(voice);
    const c = this.ready();
    if (!c) return true;
    const pan = o.at ? sfxPan(this.listener, o.at) : 0;
    try {
      voice.stop = this.synth(c, name, gain, o.pitch ?? 1, pan);
    } catch (err) {
      console.error('[space3d] som falhou', err);
    }
    return true;
  }

  /** contexto pronto para tocar (null = sem áudio ou ainda sem gesto) */
  private ready(): AudioContext | null {
    const c = this.getContext();
    if (!c) return null;
    if (c.state !== 'running') {
      if (!this.unlocked) return null;
      void c.resume().catch(() => undefined);
    }
    this.prepare(c);
    return c;
  }

  private output(c: AudioContext): AudioNode {
    if (this.out && this.outCtx === c) return this.out;
    // compressor leve no fim: picos de vários sons juntos não estouram
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(c.destination);
    this.out = comp;
    this.outCtx = c;
    this.noiseBuf = null;
    return comp;
  }

  private noise(c: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const ch = buf.getChannelData(0);
    // ruído "rosado" simples (um filtro de um polo sobre o branco): menos chiado
    let last = 0;
    for (let i = 0; i < ch.length; i++) {
      last = 0.6 * last + 0.4 * (Math.random() * 2 - 1);
      ch[i] = last * 1.6;
    }
    this.noiseBuf = buf;
    return buf;
  }

  /** monta os nós de uma receita; devolve como parar antes da hora */
  private synth(c: AudioContext, name: SfxName, gain: number, pitch: number, pan: number): () => void {
    const out = this.output(c);
    const master = c.createGain();
    master.gain.value = gain;
    let tail: AudioNode = master;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      master.connect(p);
      tail = p;
    }
    tail.connect(out);
    const t0 = c.currentTime + 0.005;
    const sources: AudioScheduledSourceNode[] = [];
    for (const part of RECIPES[name]) {
      const start = t0 + (part.t ?? 0);
      const end = start + part.d;
      const env = c.createGain();
      const attack = Math.min(part.a ?? 0.004, part.d / 2);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, part.g), start + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      env.connect(master);
      if (part.k === 'tone') {
        const osc = c.createOscillator();
        osc.type = part.type ?? 'sine';
        osc.frequency.setValueAtTime(part.f * pitch, start);
        if (part.f2) osc.frequency.exponentialRampToValueAtTime(part.f2 * pitch, end);
        osc.connect(env);
        osc.start(start);
        osc.stop(end + 0.02);
        sources.push(osc);
      } else {
        const src = c.createBufferSource();
        src.buffer = this.noise(c);
        const f = c.createBiquadFilter();
        f.type = part.filter;
        f.Q.value = part.q ?? 0.8;
        f.frequency.setValueAtTime(part.f * pitch, start);
        if (part.f2) f.frequency.exponentialRampToValueAtTime(part.f2 * pitch, end);
        src.connect(f).connect(env);
        // começa num ponto qualquer do ruído: dois sons iguais não soam idênticos
        src.start(start, Math.random() * 0.5);
        src.stop(end + 0.02);
        sources.push(src);
      }
    }
    const last = sources.at(-1);
    if (last)
      last.onended = () => {
        try {
          tail.disconnect();
        } catch {
          // já desligado
        }
      };
    return () => {
      for (const s of sources)
        try {
          s.stop();
        } catch {
          // já parou
        }
    };
  }

  // ---------- motor da moto (uma voz por piloto) ----------

  /** motor de `id` na velocidade `v` (m/s) em `at`; null = desliga */
  engine(id: string, v: number | null, at?: { x: number; z: number }, boost = false) {
    const vol = v === null ? 0 : this.volume();
    if (v === null || !(vol > 0)) {
      this.stopEngine(id);
      return;
    }
    let e = this.engines.get(id);
    if (!e) {
      if (this.engines.size >= MAX_ENGINES) return;
      const c = this.ready();
      if (!c) return;
      try {
        e = this.makeEngine(c, at ? sfxPan(this.listener, at) : 0);
      } catch {
        return;
      }
      this.engines.set(id, e);
    }
    const c = e.gain.context;
    const t = c.currentTime;
    e.seen = this.now();
    const f = enginePitch(v);
    const k = Math.min(1, Math.abs(v) / 31);
    e.osc.frequency.setTargetAtTime(f, t, 0.06);
    e.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.06);
    e.filter.frequency.setTargetAtTime(280 + 1400 * k + (boost ? 1200 : 0), t, 0.08);
    const d = at ? Math.hypot(at.x - this.listener.x, at.z - this.listener.z) : undefined;
    // motor é contínuo: mais baixo que os efeitos curtos
    e.gain.gain.setTargetAtTime(sfxMix({ vol, d, ducked: this.ducked, gain: 0.25 + 0.25 * k }), t, 0.08);
    if (e.pan && at) e.pan.pan.setTargetAtTime(sfxPan(this.listener, at), t, 0.08);
  }

  private makeEngine(c: AudioContext, pan: number): EngineVoice {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = c.createOscillator();
    osc2.type = 'square';
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    let p: StereoPannerNode | null = null;
    osc.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(gain);
    if (typeof c.createStereoPanner === 'function') {
      p = c.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p).connect(this.output(c));
    } else gain.connect(this.output(c));
    osc.start();
    osc2.start();
    return { osc, osc2, filter, gain, pan: p, seen: this.now() };
  }

  private stopEngine(id: string) {
    const e = this.engines.get(id);
    if (!e) return;
    this.engines.delete(id);
    const t = e.gain.context.currentTime;
    try {
      e.gain.gain.setTargetAtTime(0.0001, t, 0.05);
      e.osc.stop(t + 0.3);
      e.osc2.stop(t + 0.3);
    } catch {
      // já parou
    }
  }

  /** motores tocando agora */
  get engineCount(): number {
    return this.engines.size;
  }

  stopEngines() {
    for (const id of [...this.engines.keys()]) this.stopEngine(id);
  }

  /** liga o som aos eventos do jogo; devolve a função que desliga */
  attach(bus: GameBus, ctx: () => SfxCtx): () => void {
    return bus.on((e) => this.event(e, ctx()));
  }
}

/** o motor do app (um só, como o AudioContext) */
export const sfx = new Sfx();

/** agenda 3, 2, 1 e o "JÁ" até `goAt` (relógio local); devolve como cancelar */
export function countdownSounds(goAt: number, from = 3): () => void {
  const timers: number[] = [];
  const left = goAt - Date.now();
  for (let n = from; n >= 1; n--) {
    const wait = left - n * 1000;
    if (wait > -250) timers.push(window.setTimeout(() => sfx.ui('count'), Math.max(0, wait)));
  }
  if (left > -250) timers.push(window.setTimeout(() => sfx.ui('go'), Math.max(0, left)));
  return () => timers.forEach((t) => window.clearTimeout(t));
}

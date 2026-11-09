import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultUserSettings, type GunId } from '@opencord/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameBus, type GameEvent, type GameEventKind } from '../src/features/space3d/events';
import {
  RECIPES,
  recipeDuration,
  setSfxDeafened,
  Sfx,
  SFX_MAX_VOICES,
  sfxVolume,
  useSfxPrefs,
} from '../src/features/space3d/sfx';
import { SAMPLE_SETS, sampleSetFor, sampleUrl, zoneSampleFiles } from '../src/features/space3d/sfxbank';
import {
  chargeStep,
  enginePitch,
  NO_SOUND,
  SFX_FLOOR,
  SFX_MAP,
  SFX_PAN_MAX,
  sfxDistanceGain,
  sfxFor,
  sfxLowpassHz,
  sfxMaster,
  sfxMix,
  sfxPan,
  type SfxName,
} from '../src/features/space3d/sfxmap';
import { useData } from '../src/store/data';

const at = { x: 0, y: 1, z: 0 };
const ctx = { me: 'eu', team: 'a' as const };

/** um exemplo de cada tipo de evento (o teste falha se aparecer um tipo novo sem exemplo) */
const SAMPLES: GameEvent[] = [
  { kind: 'kick', by: 'eu', power: 0.5, zone: 2, at },
  { kind: 'hit', by: 'eu', with: 'racket', power: 0.6, zone: 3, at },
  { kind: 'whiff', by: 'eu', power: 0.4, zone: 3, at },
  { kind: 'bounce', surface: 'floor', v: 6, power: 0.4, zone: 1, at },
  { kind: 'surface', surface: 'rim', v: 4, power: 0.5, zone: 1, at },
  { kind: 'score', side: 'a', points: 2, by: 'eu', reason: 'cesta', power: 1, zone: 1, at },
  { kind: 'pocket', ball: 3, power: 0.4, zone: 6, at },
  { kind: 'ballHit', a: 0, b: 3, v: 2, power: 0.5, zone: 6, at },
  { kind: 'cushion', ball: 3, v: 1, power: 0.3, zone: 6, at },
  { kind: 'cue', by: 'eu', power: 0.7, zone: 6, at },
  { kind: 'boost', source: 'pad', power: 0.8, zone: 7, at },
  { kind: 'item', power: 0.6, zone: 7, at },
  { kind: 'lap', lap: 1, power: 1, zone: 7, at },
  { kind: 'finalLap', power: 1, zone: 7, at },
  { kind: 'finish', ms: 60000, power: 1, zone: 7, at },
  { kind: 'punch', by: 'eu', strong: true, landed: false, power: 1, zone: 0, at },
  { kind: 'ko', who: 'eu', power: 1, zone: 0, at },
  { kind: 'countdown', n: 3, power: 0.6, zone: 7, at },
  { kind: 'go', power: 1, zone: 7, at },
  { kind: 'control', by: 'eu', power: 0.3, zone: 2, at },
  { kind: 'gunshot', by: 'eu', w: 'm4', power: 1, zone: 8, at },
  { kind: 'impact', flesh: true, head: false, power: 0.6, zone: 8, at },
  { kind: 'gunfx', what: 'magIn', w: 'm4', power: 0.6, zone: 8, at },
  { kind: 'trick', by: 'eu', trick: 'bicicleta', power: 1, zone: 2, at },
  { kind: 'tackle', by: 'eu', on: 'ana', foul: true, slide: true, power: 1, zone: 2, at },
];

/** motor com relógio na mão, sem áudio (só o log) */
function engine(vol = 1) {
  let t = 1000;
  const s = new Sfx({ context: () => null, volume: () => vol, now: () => t });
  return {
    s,
    tick(ms: number) {
      t += ms;
    },
  };
}

// ---------- AudioContext falso (nada toca: só conta nós e confere o ganho) ----------
class FakeParam {
  value = 0;
  peak = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.peak = Math.max(this.peak, v);
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
}
class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly pan = new FakeParam();
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  readonly playbackRate = new FakeParam();
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  get context() {
    return this.ctx;
  }
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
  start() {
    this.ctx.started++;
  }
  stop() {}
}
class FakeContext {
  nodes: FakeNode[] = [];
  started = 0;
  resumed = 0;
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  constructor(public state: 'running' | 'suspended' = 'running') {}
  createGain() {
    return new FakeNode(this, 'gain');
  }
  createOscillator() {
    return new FakeNode(this, 'osc');
  }
  createBufferSource() {
    return new FakeNode(this, 'noise');
  }
  createBiquadFilter() {
    return new FakeNode(this, 'filter');
  }
  createStereoPanner() {
    return new FakeNode(this, 'pan');
  }
  createDynamicsCompressor() {
    return new FakeNode(this, 'comp');
  }
  createBuffer(_c: number, n: number) {
    const data = new Float32Array(n);
    return { getChannelData: () => data };
  }
  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
}
/** contexto falso que também decodifica (a "gravação" vira um buffer de 0,5 s) */
class FakeDecodingContext extends FakeContext {
  decoded = 0;
  decodeAudioData(data: ArrayBuffer) {
    this.decoded++;
    return Promise.resolve({ duration: 0.5, bytes: data.byteLength });
  }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
function withAudio(
  state: 'running' | 'suspended' = 'running',
  vol = 1,
  c: FakeContext = new FakeContext(state),
  fetchAudio: (url: string) => Promise<ArrayBuffer> = () => Promise.reject(new Error('sem rede no teste')),
) {
  let t = 1000;
  const s = new Sfx({
    context: () => c as unknown as AudioContext,
    volume: () => vol,
    now: () => t,
    prepare: () => undefined,
    fetchAudio,
  });
  return {
    s,
    c,
    tick(ms: number) {
      t += ms;
    },
  };
}

describe('Espaço 3D: som do jogo (sfx, P6)', () => {
  afterEach(() => {
    setSfxDeafened(false);
    useSfxPrefs.setState({ on: true, vol: 0.7 });
  });

  it('todo tipo de GameEvent tem som mapeado ou está marcado como "sem som"', () => {
    const kinds = Object.keys(SFX_MAP).sort();
    expect([...new Set(SAMPLES.map((e) => e.kind))].sort()).toEqual(kinds);
    for (const e of SAMPLES) {
      const m = SFX_MAP[e.kind as GameEventKind];
      if (m === NO_SOUND) continue;
      const cues = sfxFor(e, ctx);
      expect(cues.length, e.kind).toBeGreaterThan(0);
      for (const c of cues) {
        expect(RECIPES[c.name], c.name).toBeDefined();
        expect(c.gain).toBeGreaterThan(0);
        expect(c.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cada receita é curta e tem pedaços audíveis', () => {
    for (const name of Object.keys(RECIPES) as SfxName[]) {
      expect(RECIPES[name].length, name).toBeGreaterThan(0);
      // gongo é o mais longo; nada passa de 2 s
      expect(recipeDuration(name), name).toBeLessThanOrEqual(2);
      for (const p of RECIPES[name]) {
        expect(p.f, name).toBeGreaterThan(20);
        expect(p.f, name).toBeLessThan(8000);
        expect(p.g, name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('placar: ponto do meu time sobe, do outro desce; gol com apito, cesta com swish, caçapa sem apito', () => {
    const goal = (side: 'a' | 'b'): GameEvent => ({
      kind: 'score',
      side,
      points: 1,
      by: null,
      reason: 'gol',
      power: 1,
      zone: 2,
      at,
    });
    expect(sfxFor(goal('a'), ctx).map((c) => c.name)).toEqual(['whistle', 'scoreUs']);
    expect(sfxFor(goal('b'), ctx).map((c) => c.name)).toEqual(['whistle', 'scoreThem']);
    expect(sfxFor(SAMPLES[5]!, ctx).map((c) => c.name)).toEqual(['swish', 'scoreUs']);
    const pool: GameEvent = { kind: 'score', side: 'b', points: 1, by: null, reason: 'caçapa', power: 1, zone: 6, at };
    expect(sfxFor(pool, ctx).map((c) => c.name)).toEqual(['scoreThem']);
    // placar e apito são informação (abaixam menos com voz)
    expect(sfxFor(goal('a'), ctx).every((c) => c.info)).toBe(true);
  });

  it('quique pelo tamanho da bola, chute forte separado, raquete do ping pong e soco defendido', () => {
    const b = (zone: number): GameEvent => ({ kind: 'bounce', surface: 'floor', v: 5, power: 0.5, zone, at });
    const p1 = sfxFor(b(1), ctx)[0]!.pitch!;
    const p5 = sfxFor(b(5), ctx)[0]!.pitch!;
    expect(p5).toBeGreaterThan(p1);
    expect(sfxFor({ kind: 'bounce', surface: 'table', v: 3, power: 0.5, zone: 5, at }, ctx)[0]!.name).toBe(
      'bounceTable',
    );
    expect(sfxFor({ kind: 'kick', by: 'x', power: 1, zone: 2, at }, ctx)[0]!.name).toBe('kickHard');
    expect(sfxFor({ kind: 'hit', by: 'x', with: 'racket', power: 0.5, zone: 5, at }, ctx)[0]!.name).toBe('paddle');
    const blocked: GameEvent = {
      kind: 'punch',
      by: null,
      strong: false,
      landed: true,
      blocked: true,
      power: 0.4,
      zone: 0,
      at,
    };
    expect(sfxFor(blocked, ctx)[0]!.name).toBe('block');
    // quique quase parado não faz barulho
    expect(sfxFor({ kind: 'bounce', surface: 'floor', v: 0.1, power: 0.01, zone: 1, at }, ctx)).toEqual([]);
  });

  it('evento de outra zona não entra no log', () => {
    const { s } = engine();
    s.listen({ x: 0, z: 0, yaw: 0, zone: 2 });
    s.event({ kind: 'kick', by: 'x', power: 0.5, zone: 3, at }, ctx);
    expect(s.log).toEqual([]);
    s.event({ kind: 'kick', by: 'x', power: 0.5, zone: 2, at }, ctx);
    expect(s.log).toEqual(['kick']);
  });

  it('ensurdecido, chave desligada, Sons desligados ou Não perturbe: nada entra', () => {
    const base = defaultUserSettings();
    useData.setState({
      settings: { ...base, notifications: { ...base.notifications, sounds: true, dnd: false, soundVolume: 1 } },
      myStatus: 'online',
    });
    useSfxPrefs.setState({ on: true, vol: 1 });
    expect(sfxVolume()).toBe(1);
    const s = new Sfx({ context: () => null, now: () => 0 });
    s.listen({ x: 0, z: 0, yaw: 0, zone: 2 });
    setSfxDeafened(true);
    expect(sfxVolume()).toBe(0);
    s.event({ kind: 'kick', by: 'x', power: 0.5, zone: 2, at }, ctx);
    s.ui('uiOk');
    expect(s.log).toEqual([]);
    setSfxDeafened(false);
    useSfxPrefs.getState().setOn(false);
    expect(sfxVolume()).toBe(0);
    s.ui('uiOk');
    expect(s.log).toEqual([]);
    useSfxPrefs.getState().setOn(true);
    for (const patch of [{ sounds: false }, { dnd: true }]) {
      useData.setState({ settings: { ...base, notifications: { ...base.notifications, soundVolume: 1, ...patch } } });
      expect(sfxVolume()).toBe(0);
    }
    useData.setState({ settings: base, myStatus: 'dnd' });
    expect(sfxVolume()).toBe(0);
  });

  it('a chave e o volume ficam salvos e um armazenamento quebrado não derruba nada', () => {
    useSfxPrefs.getState().setVol(0.4);
    expect(JSON.parse(localStorage.getItem('opencord.space3d.sfx') ?? '{}')).toMatchObject({ vol: 0.4 });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('cheio');
    };
    try {
      expect(() => useSfxPrefs.getState().setOn(false)).not.toThrow();
      expect(useSfxPrefs.getState().on).toBe(false);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('10 choques em 20 ms viram no máximo 1 entrada', () => {
    const { s, tick } = engine();
    s.listen({ x: 0, z: 0, yaw: 0, zone: 6 });
    for (let i = 0; i < 10; i++) {
      s.event({ kind: 'ballHit', a: 0, b: i + 1, v: 2, power: 0.5, zone: 6, at }, ctx);
      tick(2);
    }
    expect(s.log.filter((n) => n === 'ballClack').length).toBeLessThanOrEqual(1);
    tick(50);
    s.event({ kind: 'ballHit', a: 0, b: 1, v: 2, power: 0.5, zone: 6, at }, ctx);
    expect(s.log.filter((n) => n === 'ballClack').length).toBe(2);
  });

  it('no máximo 12 vozes ao mesmo tempo (sai a mais baixa)', () => {
    const { s, tick } = engine();
    const names = Object.keys(RECIPES) as SfxName[];
    for (const n of names) {
      s.play(n, { gain: 0.5 });
      tick(1);
    }
    expect(s.active).toBeLessThanOrEqual(SFX_MAX_VOICES);
    // um som mais baixo que todos não entra com as 12 ocupadas
    const before = s.log.length;
    tick(5);
    s.play('kick', { gain: 0.01 });
    expect(s.active).toBeLessThanOrEqual(SFX_MAX_VOICES);
    expect(s.log.length).toBe(before);
  });

  it('a última volta corta a volta que saiu junto', () => {
    const { s, tick } = engine();
    s.listen({ x: 0, z: 0, yaw: 0, zone: 7 });
    s.event(SAMPLES[12]!, ctx);
    tick(5);
    s.event(SAMPLES[13]!, ctx);
    tick(5);
    s.event({ kind: 'lap', lap: 2, power: 1, zone: 7, at }, ctx);
    expect(s.log).toEqual(['lap', 'finalLap']);
  });

  it('o ganho final pela distância e pelo ducking nunca passa de 0,25·vol²', () => {
    for (const vol of [0, 0.1, 0.35, 0.7, 1, 1.5]) {
      const top = 0.25 * Math.min(1, vol) ** 2;
      expect(sfxMaster(vol)).toBeCloseTo(top, 10);
      for (const d of [undefined, 0, 2, 5, 10, 22, 80, Infinity])
        for (const ducked of [false, true])
          for (const info of [false, true])
            for (const gain of [0, 0.3, 1, 3]) {
              const g = sfxMix({ vol, d, ducked, info, gain });
              expect(g).toBeGreaterThanOrEqual(0);
              expect(g).toBeLessThanOrEqual(top + 1e-12);
            }
    }
    // ducking: 0,4 nos efeitos e 0,7 no placar/apito
    expect(sfxMix({ vol: 1, ducked: true, gain: 1 })).toBeCloseTo(0.25 * 0.4);
    expect(sfxMix({ vol: 1, ducked: true, info: true, gain: 1 })).toBeCloseTo(0.25 * 0.7);
    // e o motor, com o AudioContext falso, também respeita o teto
    const { s } = withAudio('running', 0.8);
    s.listen({ x: 0, z: 0, yaw: 0, zone: 1 });
    s.duck(true);
    s.play('rim', { at: { x: 1, z: 0 }, zone: 1, gain: 1 });
    expect(s.lastGain).toBeLessThanOrEqual(0.25 * 0.8 * 0.8);
  });

  it('distância: cheio perto, piso de 0,15 longe; panorâmica nunca passa de ±0,5', () => {
    expect(sfxDistanceGain(0)).toBe(1);
    expect(sfxDistanceGain(500)).toBeCloseTo(SFX_FLOOR);
    expect(sfxDistanceGain(Infinity)).toBe(1); // como a voz: sem distância = som da interface
    let prev = 1;
    for (let d = 0; d <= 30; d += 0.5) {
      const g = sfxDistanceGain(d);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      expect(g).toBeGreaterThanOrEqual(SFX_FLOOR - 1e-12);
      prev = g;
    }
    const l = { x: 0, z: 0, yaw: 0, zone: 0 };
    // com yaw 0 a câmera olha para −z: +x é a direita
    expect(sfxPan(l, { x: 10, z: 0 })).toBeCloseTo(SFX_PAN_MAX);
    expect(sfxPan(l, { x: -10, z: 0 })).toBeCloseTo(-SFX_PAN_MAX);
    expect(sfxPan(l, { x: 0, z: -10 })).toBeCloseTo(0);
    for (let a = 0; a < Math.PI * 2; a += 0.3)
      expect(Math.abs(sfxPan({ ...l, yaw: a }, { x: Math.cos(a * 3) * 7, z: Math.sin(a) * 7 }))).toBeLessThanOrEqual(
        SFX_PAN_MAX,
      );
  });

  it('carga: um tique a cada 10%, tom do motor sobe com a velocidade', () => {
    expect(chargeStep(0)).toBe(0);
    expect(chargeStep(0.1)).toBe(1);
    expect(chargeStep(0.55)).toBe(5);
    expect(chargeStep(1)).toBe(10);
    expect(enginePitch(0)).toBeLessThan(enginePitch(10));
    expect(enginePitch(10)).toBeLessThan(enginePitch(31));
    expect(enginePitch(100)).toBe(enginePitch(31));
  });

  it('sem AudioContext (jsdom) só registra; com contexto suspenso, nada toca antes de um gesto', () => {
    const { s } = engine();
    expect(s.ui('uiOk')).toBe(true);
    expect(s.log).toEqual(['uiOk']);
    const a = withAudio('suspended');
    a.s.ui('uiOk');
    expect(a.c.started).toBe(0);
    expect(a.c.resumed).toBe(0);
    a.tick(100);
    a.s.unlock();
    expect(a.c.resumed).toBe(1);
    a.s.ui('uiOk');
    expect(a.c.started).toBeGreaterThan(0);
  });

  it('com o AudioContext falso, cada receita monta sem erro e o pico de cada voz fica no ganho calculado', () => {
    const { s, c, tick } = withAudio('running', 1);
    for (const n of Object.keys(RECIPES) as SfxName[]) {
      expect(() => s.ui(n)).not.toThrow();
      tick(3000);
    }
    expect(c.started).toBeGreaterThan(Object.keys(RECIPES).length);
    // o ganho de cada voz (primeiro gain depois do compressor) nunca passa do mestre
    for (const node of c.nodes) if (node.kind === 'gain') expect(node.gain.value).toBeLessThanOrEqual(1);
  });

  it('motor da moto: uma voz por piloto, para com null e ao sair da zona', () => {
    const { s } = withAudio('running', 1);
    s.listen({ x: 0, z: 0, yaw: 0, zone: 7 });
    s.engine('eu', 10);
    s.engine('ana', 15, { x: 5, z: 0 });
    s.engine('ana', 16, { x: 6, z: 0 });
    expect(s.engineCount).toBe(2);
    s.engine('ana', null);
    expect(s.engineCount).toBe(1);
    s.listen({ x: 0, z: 0, yaw: 0, zone: 0 });
    expect(s.engineCount).toBe(0);
    // silêncio: não liga motor
    const q = withAudio('running', 0);
    q.s.engine('eu', 10);
    expect(q.s.engineCount).toBe(0);
  });

  it('attach liga o barramento e devolve como desligar', () => {
    const bus = new GameBus();
    const { s } = engine();
    s.listen({ x: 0, z: 0, yaw: 0, zone: 2 });
    const off = s.attach(bus, () => ctx);
    bus.emit({ kind: 'kick', by: 'x', power: 0.5, zone: 2, at });
    off();
    bus.emit({ kind: 'whiff', by: 'x', power: 0.5, zone: 2, at });
    expect(s.log).toEqual(['kick']);
  });
  it('banco de gravações: todo arquivo existe, tem crédito e cabe no orçamento; cada arma tem o tiro dela', () => {
    const dir = join(__dirname, '../src/features/space3d/assets/sfx');
    const credits = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
    const used = new Set<string>();
    for (const [key, set] of Object.entries(SAMPLE_SETS)) {
      // a chave é um som que existe (com receita sintetizada de reserva)
      expect(RECIPES[key.split(':')[0] as SfxName], key).toBeDefined();
      expect(set!.files.length, key).toBeGreaterThan(0);
      for (const f of set!.files) {
        expect(sampleUrl(f), f).toBeTruthy();
        used.add(f);
      }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.ogg'));
    // nenhum arquivo sobrando sem uso e todos com autor/licença no CREDITS.md
    expect(files.map((f) => f.replace(/\.ogg$/, '')).sort()).toEqual([...used].sort());
    for (const f of files) expect(credits, f).toContain(`\`${f}\``);
    const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    expect(total).toBeLessThan(3 * 1024 * 1024);
    const guns: GunId[] = ['m4', 'ak47', 'mp7', 'mp5', 'l115', 'm200', 'kar98k', 'm9', 'deagle'];
    for (const w of guns) {
      const cue = sfxFor({ kind: 'gunshot', by: 'eu', w, power: 1, zone: 8, at }, ctx)[0]!;
      expect(sampleSetFor(cue.name, cue.sample)?.exact, w).toBe(true);
    }
    // o gunfight pede as gravações ao entrar na zona; as outras zonas seguem sintetizadas
    expect(zoneSampleFiles(8).length).toBe(used.size);
    expect(zoneSampleFiles(2)).toEqual([]);
  });

  it('gravação de longe fica abafada: passa-baixa cai com a distância e não existe perto', () => {
    expect(sfxLowpassHz(undefined)).toBeNull();
    expect(sfxLowpassHz(3)).toBeNull();
    let prev = Infinity;
    for (let d = 5; d <= 120; d += 5) {
      const f = sfxLowpassHz(d)!;
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(1800);
      prev = f;
    }
    expect(sfxLowpassHz(40)!).toBeLessThan(5000);
  });

  it('gunfight: entra na zona, carrega as gravações e toca o arquivo (não a síntese), com o meu cartucho depois', async () => {
    const c = new FakeDecodingContext();
    const fetchAudio = vi.fn((url: string) => Promise.resolve(new ArrayBuffer(url.length)));
    const { s, tick } = withAudio('running', 1, c, fetchAudio);
    s.listen({ x: 0, z: 0, yaw: 0, zone: 8 });
    expect(fetchAudio).toHaveBeenCalledTimes(zoneSampleFiles(8).length);
    await flush();
    expect(s.loadedSamples).toBe(zoneSampleFiles(8).length);
    const before = c.nodes.length;
    s.event({ kind: 'gunshot', by: 'eu', w: 'kar98k', power: 1, zone: 8, at }, ctx);
    const fresh = c.nodes.slice(before);
    expect(fresh.some((n) => n.kind === 'osc')).toBe(false);
    const src = fresh.filter((n) => n.kind === 'noise');
    expect(src.length).toBe(1);
    expect(src[0]!.buffer).toMatchObject({ duration: 0.5 });
    // a gravação é da própria Kar98k: o tom da família (1,12) não entra, só a variação pequena
    expect(Math.abs(src[0]!.playbackRate.value - 1)).toBeLessThan(0.05);
    // perto: sem passa-baixa
    expect(fresh.some((n) => n.kind === 'filter')).toBe(false);
    tick(100);
    // M4: tiro e o cartucho caindo depois (atrasado)
    const n0 = c.nodes.length;
    s.event({ kind: 'gunshot', by: 'eu', w: 'm4', power: 1, zone: 8, at }, ctx);
    expect(s.log.slice(-2)).toEqual(['shotRifle', 'shellCase']);
    expect(c.nodes.slice(n0).filter((n) => n.kind === 'noise').length).toBe(2);
  });

  it('gunfight: tiro de outra pessoa longe toca a gravação distante com passa-baixa', async () => {
    const c = new FakeDecodingContext();
    const { s } = withAudio('running', 1, c, (url) => Promise.resolve(new ArrayBuffer(url.length)));
    s.listen({ x: 0, z: 0, yaw: 0, zone: 8 });
    await flush();
    const before = c.nodes.length;
    s.event({ kind: 'gunshot', by: 'ana', w: 'ak47', power: 1, zone: 8, at: { x: 45, y: 1, z: 0 } }, ctx);
    expect(s.log.at(-1)).toBe('shotFar');
    const lp = c.nodes.slice(before).find((n) => n.kind === 'filter');
    expect(lp?.type).toBe('lowpass');
    expect(lp!.frequency.value).toBeLessThan(5000);
  });

  it('variações: o mesmo conjunto não repete o arquivo duas vezes seguidas', async () => {
    const c = new FakeDecodingContext();
    // cada arquivo decodifica num buffer diferente (o tamanho da url distingue)
    c.decodeAudioData = (data: ArrayBuffer) => Promise.resolve({ duration: 0.3, bytes: data.byteLength });
    const { s, tick } = withAudio('running', 1, c, (url) => Promise.resolve(new ArrayBuffer(url.length)));
    s.listen({ x: 0, z: 0, yaw: 0, zone: 8 });
    await flush();
    const picks: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      const before = c.nodes.length;
      s.play('step', { gain: 0.5 });
      picks.push(c.nodes.slice(before).find((n) => n.kind === 'noise')?.buffer);
      tick(100);
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('gravação que não carrega (rede, arquivo quebrado) cai na receita sintetizada sem erro', async () => {
    const c = new FakeDecodingContext();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { s } = withAudio('running', 1, c, () => Promise.reject(new Error('offline')));
    s.listen({ x: 0, z: 0, yaw: 0, zone: 8 });
    await flush();
    expect(s.loadedSamples).toBe(0);
    // um aviso só, não um por arquivo
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    const before = c.nodes.length;
    expect(() => s.event({ kind: 'gunshot', by: 'eu', w: 'm9', power: 1, zone: 8, at }, ctx)).not.toThrow();
    expect(c.nodes.slice(before).some((n) => n.kind === 'osc')).toBe(true);
  });
});

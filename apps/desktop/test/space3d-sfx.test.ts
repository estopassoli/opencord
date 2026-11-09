import { defaultUserSettings } from '@opencord/contracts';
import { afterEach, describe, expect, it } from 'vitest';
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
import {
  chargeStep,
  enginePitch,
  NO_SOUND,
  SFX_FLOOR,
  SFX_MAP,
  SFX_PAN_MAX,
  sfxDistanceGain,
  sfxFor,
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
function withAudio(state: 'running' | 'suspended' = 'running', vol = 1) {
  const c = new FakeContext(state);
  let t = 1000;
  const s = new Sfx({
    context: () => c as unknown as AudioContext,
    volume: () => vol,
    now: () => t,
    prepare: () => undefined,
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
    tick(41);
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
});

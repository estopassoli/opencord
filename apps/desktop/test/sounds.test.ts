import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserSettings } from '@opencord/contracts';
import { playSound, soundLog, SOUND_PACKS, SOUND_SAMPLES, SOUND_SETS, SOUNDS, soundVolume } from '../src/lib/sounds';
import { useData } from '../src/store/data';

let oscillators = 0;
let buffers = 0;
const decoded: ArrayBuffer[] = [];
class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect(n: unknown) {
    return n;
  }
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    oscillators++;
    return new FakeNode();
  }
  createBufferSource() {
    buffers++;
    return new FakeNode();
  }
  decodeAudioData(data: ArrayBuffer) {
    decoded.push(data);
    return Promise.resolve({ duration: 1.8 });
  }
  resume() {
    return Promise.resolve();
  }
}

const withSettings = (patch: Partial<ReturnType<typeof defaultUserSettings>['notifications']>) => {
  const s = defaultUserSettings();
  useData.setState({ settings: { ...s, notifications: { ...s.notifications, ...patch } }, myStatus: 'online' });
};

describe('efeitos sonoros', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    oscillators = 0;
    buffers = 0;
    soundLog.length = 0;
  });

  it('cada som tem notas curtas e audíveis', () => {
    for (const [name, notes] of Object.entries(SOUNDS)) {
      expect(notes.length, name).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.f).toBeGreaterThan(200);
        expect(n.f).toBeLessThan(2000);
        expect(n.t + n.d).toBeLessThan(0.7);
      }
    }
  });

  it('toca com Sons ligado, respeitando o volume', () => {
    withSettings({ sounds: true, soundVolume: 0.5 });
    expect(soundVolume()).toBe(0.5);
    playSound('peerJoin');
    expect(soundLog).toEqual(['peerJoin']);
    // conjunto padrão ("padrao"): um oscilador por nota (parciais incluídos)
    expect(oscillators).toBe(SOUND_SETS.padrao.peerJoin.length);
  });

  it('cada conjunto define todos os sons; o clássico é o SOUNDS; o pedido explícito vale sobre o das configurações', () => {
    const names = Object.keys(SOUNDS) as (keyof typeof SOUNDS)[];
    for (const pack of SOUND_PACKS)
      for (const n of names) expect(SOUND_SETS[pack][n].length, `${pack}.${n}`).toBeGreaterThan(0);
    expect(SOUND_SETS.classico).toBe(SOUNDS);
    withSettings({ sounds: true, soundVolume: 1 });
    oscillators = 0;
    playSound('join', { force: true, pack: 'classico' });
    expect(oscillators).toBe(SOUNDS.join.length);
  });

  it('não toca com Sons desligado, em Não perturbe ou volume 0', () => {
    for (const patch of [{ sounds: false }, { dnd: true }, { soundVolume: 0 }]) {
      withSettings({ sounds: true, soundVolume: 0.5, ...patch });
      playSound('message');
    }
    useData.setState({ myStatus: 'dnd' });
    playSound('leave');
    expect(oscillators).toBe(0);
    expect(soundLog).toEqual([]);
  });

  it('rajada do mesmo som toca uma vez', () => {
    withSettings({ sounds: true, soundVolume: 1 });
    playSound('mute');
    playSound('mute');
    expect(soundLog).toEqual(['mute']);
  });

  it('no conjunto padrão, entrar e sair da chamada tocam as gravações (sem as notas)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(SOUND_SAMPLES.padrao?.join?.url).toMatch(/join-call\.ogg/);
    expect(SOUND_SAMPLES.padrao?.leave?.url).toMatch(/leave-call\.ogg/);
    withSettings({ sounds: true, soundVolume: 1, soundPack: 'padrao' });
    // force: o teste anterior tocou "join" há menos de 250 ms (anti-rajada)
    playSound('join', { force: true });
    await vi.waitFor(() => expect(buffers).toBe(1));
    // as duas gravações do conjunto baixam e decodificam uma vez só
    expect(fetchMock).toHaveBeenCalledTimes(2);
    playSound('leave', { force: true });
    await vi.waitFor(() => expect(buffers).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(oscillators).toBe(0);
    expect(soundLog).toEqual(['join', 'leave']);
    vi.unstubAllGlobals();
  });

  it('se a gravação não carrega, entrar toca as notas do conjunto', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem arquivo')));
    vi.stubGlobal('XMLHttpRequest', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sounds = await import('../src/lib/sounds');
    const { useData: data } = await import('../src/store/data');
    const s = defaultUserSettings();
    data.setState({ settings: { ...s, notifications: { ...s.notifications, sounds: true, soundVolume: 1 } } });
    sounds.playSound('join');
    await vi.waitFor(() => expect(oscillators).toBe(sounds.SOUND_SETS.padrao.join.length));
    expect(buffers).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});

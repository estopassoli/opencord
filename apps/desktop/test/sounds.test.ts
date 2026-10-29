import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserSettings } from '@opencord/contracts';
import { playSound, soundLog, SOUNDS, soundVolume } from '../src/lib/sounds';
import { useData } from '../src/store/data';

let oscillators = 0;
class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  connect(n: unknown) {
    return n;
  }
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
    expect(oscillators).toBe(SOUNDS.peerJoin.length);
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
});

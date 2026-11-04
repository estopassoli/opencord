import { describe, expect, it } from 'vitest';
import { afkTarget } from '../src/lib/afkRule';

const base = {
  idleSeconds: 400,
  sinceSpokeMs: 400_000,
  inCall: true,
  channelId: 'sala',
  streaming: false,
  afkChannelId: 'afk',
  afkTimeoutSec: 300,
  afkChannelExists: true,
};

describe('canal de ausentes', () => {
  it('move quem está parado e calado pelo limite', () => {
    expect(afkTarget(base)).toBe('afk');
  });
  it('não move: falou há pouco, ainda dentro do limite, transmitindo, já no canal ou sem canal configurado', () => {
    expect(afkTarget({ ...base, sinceSpokeMs: 10_000 })).toBeNull();
    expect(afkTarget({ ...base, idleSeconds: 200 })).toBeNull();
    expect(afkTarget({ ...base, streaming: true })).toBeNull();
    expect(afkTarget({ ...base, channelId: 'afk' })).toBeNull();
    expect(afkTarget({ ...base, afkChannelId: null })).toBeNull();
    expect(afkTarget({ ...base, afkChannelExists: false })).toBeNull();
    expect(afkTarget({ ...base, inCall: false })).toBeNull();
  });
});

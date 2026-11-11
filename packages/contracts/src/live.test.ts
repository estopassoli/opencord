import { describe, expect, it } from 'vitest';
import { liveIdentity, liveOwner } from './api.js';

describe('live nativa (ADR-0062): identidade <userId>:live', () => {
  it('ida e volta entre o dono e a identidade da live', () => {
    expect(liveIdentity('abc123')).toBe('abc123:live');
    expect(liveOwner(liveIdentity('abc123'))).toBe('abc123');
  });

  it('identidade comum (ou só o sufixo) não é live', () => {
    expect(liveOwner('abc123')).toBeNull();
    expect(liveOwner(':live')).toBeNull();
    expect(liveOwner('abc:lives')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { parseInviteCode } from '../src/lib/invite';

describe('parseInviteCode', () => {
  it('aceita o código puro, com espaços, ou no fim de um link', () => {
    expect(parseInviteCode('hK3mP9xQ2a')).toBe('hK3mP9xQ2a');
    expect(parseInviteCode('  hK3mP9xQ2a \n')).toBe('hK3mP9xQ2a');
    expect(parseInviteCode('https://opencord.pro/invite/hK3mP9xQ2a/')).toBe('hK3mP9xQ2a');
  });
  it('recusa texto que não termina num código', () => {
    expect(parseInviteCode('abc')).toBeNull();
    expect(parseInviteCode('hK3mP9xQ2a!')).toBeNull();
  });
});

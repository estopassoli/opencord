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

import { deviceLabel } from '../src/features/voice/devices';
import { capturePendingInvite, clearPendingInvite, pendingInvite } from '../src/lib/invite';

describe('deviceLabel', () => {
  it('tira o id USB do fim do nome', () => {
    expect(deviceLabel('Microfone do Headset (A50 X Mic) (046d:0b0b)')).toBe('Microfone do Headset (A50 X Mic)');
    expect(deviceLabel('Microfone (NVIDIA Broadcast)')).toBe('Microfone (NVIDIA Broadcast)');
  });
});

describe('link de convite', () => {
  it('guarda o código de /invite/<código> e limpa', () => {
    expect(capturePendingInvite({ pathname: '/invite/hK3mP9xQ2a', search: '' })).toBe('hK3mP9xQ2a');
    expect(pendingInvite()).toBe('hK3mP9xQ2a');
    clearPendingInvite();
    expect(pendingInvite()).toBeNull();
    expect(capturePendingInvite({ pathname: '/', search: '?invite=Zx8Pq2Lm4N' })).toBe('Zx8Pq2Lm4N');
    clearPendingInvite();
    expect(capturePendingInvite({ pathname: '/outra', search: '?invite=curto' })).toBeNull();
  });
});

import { inviteCodesIn } from '../src/features/chat/InviteEmbed';

describe('inviteCodesIn', () => {
  it('acha códigos em links de convite, sem repetir', () => {
    expect(inviteCodesIn('vem: https://app.opencord.pro/invite/nFCcysEmVn e https://x/invite/nFCcysEmVn')).toEqual([
      'nFCcysEmVn',
    ]);
    expect(inviteCodesIn('https://app.opencord.pro/invite/curto')).toEqual([]);
  });
});

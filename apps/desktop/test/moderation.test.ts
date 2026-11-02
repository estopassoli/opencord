import { MAX_TIMEOUT_MS } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import {
  BAN_DELETE_WINDOWS,
  fmtTimeoutUntil,
  isTimedOut,
  TIMEOUT_CHOICES,
  timeoutUntilIso,
} from '../src/lib/moderation';

const now = new Date('2026-11-02T14:00:00').getTime();

describe('moderação: castigo', () => {
  it('durações do submenu cabem no máximo da API', () => {
    expect(TIMEOUT_CHOICES.map((c) => c.label)).toEqual([
      '1 minuto',
      '5 minutos',
      '10 minutos',
      '1 hora',
      '1 dia',
      '1 semana',
    ]);
    for (const c of TIMEOUT_CHOICES) expect(c.ms).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });
  it('timeoutUntilIso soma a duração (e corta no máximo)', () => {
    expect(timeoutUntilIso(60_000, now)).toBe(new Date(now + 60_000).toISOString());
    expect(timeoutUntilIso(MAX_TIMEOUT_MS * 2, now)).toBe(new Date(now + MAX_TIMEOUT_MS).toISOString());
  });
  it('isTimedOut só com data futura válida', () => {
    expect(isTimedOut(null, now)).toBe(false);
    expect(isTimedOut(undefined, now)).toBe(false);
    expect(isTimedOut(new Date(now - 1).toISOString(), now)).toBe(false);
    expect(isTimedOut(new Date(now + 1000).toISOString(), now)).toBe(true);
    expect(isTimedOut('nada', now)).toBe(false);
  });
  it('fmtTimeoutUntil: só a hora no mesmo dia, dia/mês + hora em outro', () => {
    expect(fmtTimeoutUntil(new Date('2026-11-02T14:30:00').toISOString(), now)).toBe('14:30');
    expect(fmtTimeoutUntil(new Date('2026-11-03T09:05:00').toISOString(), now)).toBe('03/11 09:05');
    expect(fmtTimeoutUntil('nada', now)).toBe('nada');
  });
  it('janelas de apagar mensagens ao banir (segundos, até 7 dias)', () => {
    expect(BAN_DELETE_WINDOWS.map((w) => w.seconds)).toEqual([0, 3600, 86_400, 604_800]);
  });
});

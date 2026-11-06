import { defaultUserSettings, type UserSettings } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { effectiveLevel, isMuted, matchKeyword, mutedLabel } from '../src/lib/notifyPrefs';
import { addReminder, dueReminders, tomorrowAt } from '../src/lib/reminders';
import { maskEmail, maskInvite } from '../src/lib/streamer';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const withNotify = (patch: Partial<UserSettings['notifications']>): UserSettings => {
  const s = defaultUserSettings();
  return { ...s, notifications: { ...s.notifications, ...patch } };
};

describe('notificações por servidor e canal', () => {
  it('sem escolha vale o padrão do servidor', () => {
    const s = defaultUserSettings();
    expect(effectiveLevel(s, 'srv', 'ch', 'mentions', NOW)).toBe('mentions');
    expect(effectiveLevel(s, 'srv', 'ch', 'all', NOW)).toBe('all');
  });
  it('o canal vale por cima do servidor', () => {
    const s = withNotify({
      servers: { srv: { level: 'none', mutedUntil: null } },
      channels: { ch: { level: 'all', mutedUntil: null } },
    });
    expect(effectiveLevel(s, 'srv', 'ch', 'mentions', NOW)).toBe('all');
    expect(effectiveLevel(s, 'srv', 'outro', 'mentions', NOW)).toBe('none');
  });
  it('silenciado vence qualquer nível e expira na hora marcada', () => {
    const s = withNotify({
      servers: { srv: { level: 'all', mutedUntil: NOW + 60_000 } },
      channels: { ch: { level: null, mutedUntil: 0 } },
    });
    expect(isMuted(s, 'srv', 'x', NOW)).toBe(true);
    expect(effectiveLevel(s, 'srv', 'x', 'mentions', NOW)).toBe('none');
    expect(isMuted(s, 'srv', 'x', NOW + 120_000)).toBe(false);
    expect(effectiveLevel(s, 'srv', 'x', 'mentions', NOW + 120_000)).toBe('all');
    // 0 = até reativar
    expect(isMuted(s, 'outro', 'ch', NOW + 1e12)).toBe(true);
    expect(mutedLabel({ level: null, mutedUntil: 0 }, NOW)).toBe('Silenciado');
    expect(mutedLabel({ level: null, mutedUntil: null }, NOW)).toBeNull();
  });
});

describe('palavras-chave', () => {
  it('palavra inteira, sem acento nem maiúscula', () => {
    expect(matchKeyword('Bora RAID hoje?', ['raid'])).toBe('raid');
    expect(matchKeyword('reuniao às 20h', ['Reunião'])).toBe('Reunião');
    expect(matchKeyword('sou raider', ['raid'])).toBeNull();
    expect(matchKeyword('maria, vem', ['Maria'])).toBe('Maria');
    expect(matchKeyword('qualquer coisa', [])).toBeNull();
  });
  it('caracteres especiais não quebram a busca', () => {
    expect(matchKeyword('preço (c++) caiu', ['c++'])).toBe('c++');
    expect(matchKeyword('a.b', ['a*'])).toBeNull();
  });
});

describe('lembretes', () => {
  const r = (id: string, at: number) => ({
    id,
    at,
    messageId: '0190f0f0-0000-7000-8000-000000000001',
    channelId: null,
    serverId: null,
    conversationId: null,
    author: '',
    excerpt: '',
  });
  it('ordena, troca o mesmo id e separa os vencidos', () => {
    let list = addReminder([], r('b', NOW + 2000));
    list = addReminder(list, r('a', NOW + 1000));
    list = addReminder(list, r('b', NOW - 1));
    expect(list.map((x) => x.id)).toEqual(['b', 'a']);
    expect(dueReminders(list, NOW).map((x) => x.id)).toEqual(['b']);
  });
  it('amanhã às 9h', () => {
    const d = new Date(tomorrowAt(9, new Date(2026, 10, 6, 23, 30)));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([7, 9, 0]);
  });
});

describe('modo streamer', () => {
  it('mascara e-mail e convite', () => {
    expect(maskEmail('maria@exemplo.com')).toBe('ma•••@e•••.com');
    expect(maskInvite('https://opencord.pro/i/AbC123')).toBe('https://opencord.pro/i/•••••');
    expect(maskInvite('AbC123')).toBe('•••••');
  });
});

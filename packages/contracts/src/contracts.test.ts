import { describe, expect, it } from 'vitest';
import {
  CreateMessageRequest,
  ClientCommands,
  decodeCursor,
  parseYouTubeId,
  parseYouTubePlaylistId,
  defaultUserSettings,
  encodeCursor,
  extractMentions,
  Nickname,
  nickKeyOf,
  RegisterRequest,
  UserSettingsV1,
} from './index.js';

describe('cursor', () => {
  it('round-trip', () => {
    const c = { createdAt: new Date('2026-10-29T10:00:00.123Z'), id: '0192f1d2-7b3c-7def-8123-456789abcdef' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejeita lixo e ids inválidos', () => {
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(btoa('2026-01-01T00:00:00Z|not-a-uuid'))).toBeNull();
    expect(decodeCursor(btoa('xx|0192f1d2-7b3c-7def-8123-456789abcdef'))).toBeNull();
  });
});

describe('schemas', () => {
  it('RegisterRequest: apelido + senha; e-mail opcional; sem convite', () => {
    expect(RegisterRequest.safeParse({ nickname: 'Ana', password: 'x'.repeat(10) }).success).toBe(true);
    expect(RegisterRequest.safeParse({ nickname: 'Ana', password: 'x'.repeat(10), email: 'a@b.co' }).success).toBe(
      true,
    );
    expect(RegisterRequest.safeParse({ nickname: 'Ana', password: 'short' }).success).toBe(false);
    expect(RegisterRequest.safeParse({ nickname: '<x>', password: 'x'.repeat(10) }).success).toBe(false);
  });
  it('mensagem vazia sem anexos é rejeitada', () => {
    const requestId = crypto.randomUUID();
    expect(CreateMessageRequest.safeParse({ requestId, body: '   ' }).success).toBe(false);
    expect(CreateMessageRequest.safeParse({ requestId, body: '', attachmentIds: [crypto.randomUUID()] }).success).toBe(
      true,
    );
    expect(CreateMessageRequest.safeParse({ requestId, body: 'x'.repeat(4001) }).success).toBe(false);
  });
  it('comandos realtime rejeitam campos inválidos', () => {
    expect(ClientCommands['chat:reaction:set'].safeParse({ messageId: 'nope', emoji: '👍', on: true }).success).toBe(
      false,
    );
  });
  it('settings com defaults completos e versão obrigatória', () => {
    const s = defaultUserSettings();
    expect(s.audio.inputMode).toBe('vad');
    expect(s.keybinds.toggleMute).toBe('CommandOrControl+Shift+M');
    expect(UserSettingsV1.safeParse({ version: 2 }).success).toBe(false);
  });
});

describe('apelido', () => {
  it('normaliza para unicidade (caixa, acento, espaços)', () => {
    expect(nickKeyOf('  Joã   o  ')).toBe('joa o');
    expect(nickKeyOf('PROPRIETÁRIO')).toBe(nickKeyOf('proprietario'));
  });
  it('valida tamanho e caracteres', () => {
    expect(Nickname.safeParse('Ana').success).toBe(true);
    expect(Nickname.parse('  Ana   Souza ')).toBe('Ana Souza');
    expect(Nickname.safeParse('a').success).toBe(false);
    expect(Nickname.safeParse('<script>').success).toBe(false);
    expect(Nickname.safeParse('@everyone').success).toBe(false);
    expect(Nickname.safeParse('---').success).toBe(false);
    expect(Nickname.safeParse('x'.repeat(33)).success).toBe(false);
    expect(Nickname.safeParse('ab\u200bc').success).toBe(false);
  });
});

describe('mentions', () => {
  it('extrai ids únicos e @everyone', () => {
    const id = '0192f1d2-7b3c-7def-8123-456789abcdef';
    expect(extractMentions(`oi <@${id}> e <@${id.toUpperCase()}> @everyone`)).toEqual({
      userIds: [id],
      everyone: true,
    });
    expect(extractMentions('email@everyone.com').everyone).toBe(false);
  });
});

describe('links do YouTube (música)', () => {
  it('playlist: list= em links do YouTube e do YouTube Music', () => {
    expect(parseYouTubePlaylistId('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toBe(
      'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    );
    expect(parseYouTubePlaylistId('youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijklmnop&index=3')).toBe(
      'PLabcdefghijklmnop',
    );
    expect(parseYouTubePlaylistId('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijklmnop')).toBe('dQw4w9WgXcQ');
  });
});

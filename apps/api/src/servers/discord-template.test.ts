import { readFileSync } from 'node:fs';
import { Permission } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { DiscordTemplate, mapPermissions, parseTemplateCode, planImport } from './discord-template.js';

const fixture = DiscordTemplate.parse(
  JSON.parse(readFileSync(new URL('../../test/fixtures/discord-template.json', import.meta.url), 'utf8')),
);

describe('importação de modelo do Discord', () => {
  it('aceita link discord.new, discord.com/template ou só o código', () => {
    expect(parseTemplateCode('https://discord.new/abcDEF123')).toBe('abcDEF123');
    expect(parseTemplateCode('discord.new/abcDEF123')).toBe('abcDEF123');
    expect(parseTemplateCode('https://discord.com/template/abcDEF123')).toBe('abcDEF123');
    expect(parseTemplateCode('https://discordapp.com/template/abc-123/')).toBe('abc-123');
    expect(parseTemplateCode('  abcDEF123 ')).toBe('abcDEF123');
    expect(parseTemplateCode('https://evil.example/template/abc')).toBeNull();
    expect(parseTemplateCode('discord.new/../etc/passwd')).toBeNull();
    expect(parseTemplateCode('')).toBeNull();
  });

  it('traduz bits de permissão do Discord (inclusive acima de 2^53)', () => {
    expect(mapPermissions('8')).toBe(Permission.ADMINISTRATOR);
    expect(mapPermissions(String(1 << 10))).toBe(Permission.VIEW_CHANNEL);
    expect(mapPermissions(String(1 << 9))).toBe(Permission.VIDEO | Permission.STREAM);
    expect(mapPermissions(String((1n << 40n) | (1n << 11n)))).toBe(Permission.SEND_MESSAGES);
    expect(mapPermissions('lixo')).toBe(0);
  });

  it('planeja categorias, canais, cargos e permissões', () => {
    const p = planImport(fixture);
    expect(p.name).toBe('Guilda Fictícia');
    expect(p.categories.map((c) => c.name)).toEqual(['Informações', 'Bate-papo']);
    expect(p.roles.map((r) => [r.name, r.color])).toEqual([
      ['Moderação', '#e74c3c'],
      ['Membros antigos', '#3498db'],
    ]);
    expect(p.roles[0]!.permissions).toBe(Permission.ADMINISTRATOR);
    expect(p.everyonePermissions & Permission.VIEW_CHANNEL).toBeTruthy();
    const names = p.channels.map((c) => `${c.kind}:${c.name}:${c.categoryKey ?? '-'}`);
    // texto antes de voz dentro da categoria; anúncios viram texto, palco vira voz; desconhecido fica de fora
    expect(names).toEqual([
      'text:regras:10',
      'text:avisos:10',
      'text:geral:20',
      'text:fora-de-categoria:-',
      'voice:Sala geral:20',
      'voice:Palco:20',
    ]);
    const regras = p.channels.find((c) => c.name === 'regras')!;
    expect(regras.topic).toBe('Leia antes de postar');
    expect(regras.overrides).toEqual([{ roleKey: 'everyone', allow: 0, deny: Permission.SEND_MESSAGES }]);
    expect(p.channels.find((c) => c.name === 'Palco')!.overrides).toEqual([
      { roleKey: '1', allow: Permission.MUTE_MEMBERS, deny: 0 },
    ]);
    // permissão por membro + tipo de canal desconhecido
    expect(p.skipped).toBe(2);
  });
});

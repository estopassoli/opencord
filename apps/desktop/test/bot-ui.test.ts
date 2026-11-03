import type { EmbedField, ServerDetail, TextInput } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import {
  buttonVariant,
  formatEmbedDate,
  groupEmbedFields,
  lengthHint,
  selectChoices,
  selectionSummary,
  toggleSelection,
  validateModalFields,
} from '../src/features/chat/bot-ui';

const field = (name: string, inline: boolean): EmbedField => ({ name, value: name, inline });

describe('groupEmbedFields', () => {
  it('inline seguidos ficam lado a lado (até 3); não-inline ocupa a linha', () => {
    const rows = groupEmbedFields([
      field('a', true),
      field('b', true),
      field('c', true),
      field('d', true),
      field('e', false),
      field('f', true),
    ]);
    expect(rows.map((r) => r.map((f) => f.name))).toEqual([['a', 'b', 'c'], ['d'], ['e'], ['f']]);
  });
  it('inline depois de não-inline começa linha nova', () => {
    const rows = groupEmbedFields([field('x', false), field('y', true), field('z', true)]);
    expect(rows.map((r) => r.map((f) => f.name))).toEqual([['x'], ['y', 'z']]);
  });
  it('sem campos → sem linhas', () => {
    expect(groupEmbedFields([])).toEqual([]);
  });
});

describe('formatEmbedDate', () => {
  const now = new Date(2026, 10, 2, 15, 0); // 02/11/2026 15:00 local
  it('hoje, ontem e data completa em pt-BR', () => {
    expect(formatEmbedDate(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe('hoje às 09:05');
    expect(formatEmbedDate(new Date(2026, 10, 1, 22, 30).toISOString(), now)).toBe('ontem às 22:30');
    expect(formatEmbedDate(new Date(2026, 9, 20, 8, 0).toISOString(), now)).toBe('20/10/2026 08:00');
  });
  it('data inválida vira vazio', () => {
    expect(formatEmbedDate('não é data', now)).toBe('');
  });
});

describe('buttonVariant', () => {
  it('mapeia estilos do bot para o kit (link vira secundário)', () => {
    expect(buttonVariant('primary')).toBe('primary');
    expect(buttonVariant('success')).toBe('success');
    expect(buttonVariant('danger')).toBe('danger');
    expect(buttonVariant('secondary')).toBe('secondary');
    expect(buttonVariant('link')).toBe('secondary');
    expect(buttonVariant(undefined)).toBe('secondary');
  });
});

describe('selectChoices', () => {
  const detail: Pick<ServerDetail, 'members' | 'roles' | 'channels'> = {
    members: [
      {
        user: { id: 'u2', username: 'bia', displayName: 'Bia', avatarKey: null, bot: false },
        roleIds: [],
        joinedAt: '2026-01-01T00:00:00.000Z',
        nickname: null,
        timeoutUntil: null,
      },
      {
        user: { id: 'u1', username: 'ana', displayName: 'Ana', avatarKey: null, bot: false },
        roleIds: [],
        joinedAt: '2026-01-01T00:00:00.000Z',
        nickname: 'Aninha',
        timeoutUntil: null,
      },
      {
        user: { id: 'b1', username: 'robo', displayName: 'Robô', avatarKey: null, bot: true },
        roleIds: [],
        joinedAt: '2026-01-01T00:00:00.000Z',
        nickname: null,
        timeoutUntil: null,
      },
    ],
    roles: [
      { id: 'r1', serverId: 's', name: '@everyone', position: 0, permissions: 0, color: null, isEveryone: true },
      { id: 'r2', serverId: 's', name: 'Mod', position: 2, permissions: 0, color: '#ff0000', isEveryone: false },
      { id: 'r3', serverId: 's', name: 'Membro', position: 1, permissions: 0, color: null, isEveryone: false },
    ],
    channels: [
      {
        id: 'c2',
        serverId: 's',
        categoryId: null,
        kind: 'voice',
        name: 'Voz',
        topic: null,
        position: 0,
        myPermissions: 0,
        overrides: [],
        boardId: null,
        roomHub: false,
        temporary: false,
        ownerId: null,
        userLimit: null,
        locked: false,
        private: false,
      },
      {
        id: 'c1',
        serverId: 's',
        categoryId: null,
        kind: 'text',
        name: 'geral',
        topic: null,
        position: 1,
        myPermissions: 0,
        overrides: [],
        boardId: null,
        roomHub: false,
        temporary: false,
        ownerId: null,
        userLimit: null,
        locked: false,
        private: false,
      },
      {
        id: 'c0',
        serverId: 's',
        categoryId: null,
        kind: 'text',
        name: 'avisos',
        topic: null,
        position: 0,
        myPermissions: 0,
        overrides: [],
        boardId: null,
        roomHub: false,
        temporary: false,
        ownerId: null,
        userLimit: null,
        locked: false,
        private: false,
      },
    ],
  };
  it('string: opções do bot', () => {
    const out = selectChoices(
      { kind: 'string', options: [{ label: 'Um', value: '1', description: 'd', emoji: '1️⃣', default: false }] },
      undefined,
    );
    expect(out).toEqual([{ value: '1', label: 'Um', description: 'd', emoji: '1️⃣' }]);
  });
  it('user: membros em ordem alfabética, apelido do servidor ou do amigo, bots marcados', () => {
    const out = selectChoices({ kind: 'user', options: [] }, detail, (id) => (id === 'u2' ? 'Bibi' : 'alguém'));
    expect(out.map((c) => [c.value, c.label, c.description])).toEqual([
      ['u1', 'Aninha', '@ana'],
      ['u2', 'Bibi', '@bia'],
      ['b1', 'Robô', '@robo · app'],
    ]);
  });
  it('role: do mais alto ao mais baixo, com cor', () => {
    const out = selectChoices({ kind: 'role', options: [] }, detail);
    expect(out.map((c) => c.label)).toEqual(['Mod', 'Membro', '@everyone']);
    expect(out[0]?.color).toBe('#ff0000');
  });
  it('channel: só canais de texto, por posição', () => {
    const out = selectChoices({ kind: 'channel', options: [] }, detail);
    expect(out.map((c) => c.label)).toEqual(['avisos', 'geral']);
    expect(out[0]?.icon).toBe('hashtag');
  });
  it('sem servidor carregado → vazio', () => {
    expect(selectChoices({ kind: 'user', options: [] }, undefined)).toEqual([]);
  });
});

describe('toggleSelection / selectionSummary', () => {
  it('seleção única troca; múltipla marca e desmarca até o máximo', () => {
    expect(toggleSelection([], 'a', 1)).toEqual(['a']);
    expect(toggleSelection(['a'], 'b', 1)).toEqual(['b']);
    expect(toggleSelection(['a'], 'a', 1)).toEqual([]);
    expect(toggleSelection(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a', 2)).toEqual(['b']);
  });
  it('resumo mostra rótulos ou a contagem', () => {
    const choices = [
      { value: 'a', label: 'Ana' },
      { value: 'b', label: 'Bia' },
      { value: 'c', label: 'Caio' },
    ];
    expect(selectionSummary(['a', 'b'], choices)).toBe('Ana, Bia');
    expect(selectionSummary(['a', 'b', 'c'], choices)).toBe('3 selecionados');
    expect(selectionSummary(['zz'], choices)).toBe('zz');
  });
});

describe('validateModalFields', () => {
  const fields: TextInput[] = [
    { type: 'text', customId: 'nome', label: 'Nome', style: 'short', required: true, minLength: 3 },
    { type: 'text', customId: 'obs', label: 'Obs', style: 'paragraph', required: false, maxLength: 5 },
  ];
  it('obrigatório vazio, mínimo e máximo', () => {
    expect(validateModalFields(fields, { nome: '  ', obs: '' })).toEqual({ nome: 'Preencha este campo.' });
    expect(validateModalFields(fields, { nome: 'ab', obs: '' })).toEqual({ nome: 'Mínimo de 3 caracteres.' });
    expect(validateModalFields(fields, { nome: 'abc', obs: '123456' })).toEqual({ obs: 'Máximo de 5 caracteres.' });
    expect(validateModalFields(fields, { nome: 'abc', obs: '' })).toEqual({});
  });
  it('opcional vazio não cobra o mínimo', () => {
    const f: TextInput[] = [{ type: 'text', customId: 'x', label: 'X', style: 'short', required: false, minLength: 4 }];
    expect(validateModalFields(f, { x: '' })).toEqual({});
    expect(validateModalFields(f, { x: 'ab' })).toEqual({ x: 'Mínimo de 4 caracteres.' });
  });
  it('contador e dica de tamanho', () => {
    expect(lengthHint({ maxLength: 10 }, 3)).toBe('3/10');
    expect(lengthHint({ minLength: 2 }, 0)).toBe('mín. 2 caracteres');
    expect(lengthHint({}, 0)).toBeNull();
  });
});

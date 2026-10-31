import { UserSettingsV1, type ServerLayoutItem, type ServerSummary } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyDrop,
  dropPosAt,
  folderLabel,
  moveBy,
  normalizeLayout,
  removeFromFolder,
  resolveLayout,
  ungroup,
  updateFolder,
} from '../src/lib/serverLayout';

const srv = (id: string): ServerSummary => ({
  id,
  name: id.toUpperCase(),
  iconKey: null,
  ownerId: 'o',
  official: false,
});
const servers = ['a', 'b', 'c', 'd', 'e'].map(srv);
const folder = (id: string, serverIds: string[], name = '') => ({ id, name, color: null, serverIds, open: false });
/** forma curta para comparar: 'a' ou 'F:b+c' */
const short = (l: ServerLayoutItem[]) => l.map((i) => (typeof i === 'string' ? i : `${i.id}:${i.serverIds.join('+')}`));

describe('resolveLayout', () => {
  it('sem lista salva mantém a ordem original', () => {
    expect(resolveLayout([], servers).map((e) => (e.kind === 'server' ? e.server.id : ''))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('respeita ordem e pastas, ignora quem saí, repetidos e põe novos no fim', () => {
    const l: ServerLayoutItem[] = ['c', 'zz', folder('F', ['e', 'a', 'gone']), 'c'];
    expect(short(normalizeLayout(l, servers))).toEqual(['c', 'F:e+a', 'b', 'd']);
  });

  it('pasta com um só servidor (os outros saíram) vira servidor solto', () => {
    expect(short(normalizeLayout([folder('F', ['a', 'gone'])], servers))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('applyDrop', () => {
  const base = normalizeLayout([], servers);

  it('reordena antes/depois', () => {
    expect(short(applyDrop(base, { type: 'server', id: 'e' }, { type: 'server', id: 'a', pos: 'before' }))).toEqual([
      'e',
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(short(applyDrop(base, { type: 'server', id: 'a' }, { type: 'server', id: 'c', pos: 'after' }))).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e',
    ]);
  });

  it('soltar no meio de outro servidor cria uma pasta no lugar do alvo', () => {
    const l = applyDrop(base, { type: 'server', id: 'd' }, { type: 'server', id: 'b', pos: 'into' }, 'F');
    expect(short(l)).toEqual(['a', 'F:b+d', 'c', 'e']);
  });

  it('soltar numa pasta põe no fim; perto de um servidor da pasta entra na posição', () => {
    const l = [folder('F', ['a', 'b']), 'c', 'd'];
    expect(short(applyDrop(l, { type: 'server', id: 'd' }, { type: 'folder', id: 'F', pos: 'into' }))).toEqual([
      'F:a+b+d',
      'c',
    ]);
    expect(short(applyDrop(l, { type: 'server', id: 'c' }, { type: 'server', id: 'a', pos: 'after' }))).toEqual([
      'F:a+c+b',
      'd',
    ]);
  });

  it('tirar o penúltimo servidor da pasta desfaz a pasta', () => {
    const l = [folder('F', ['a', 'b']), 'c'];
    expect(short(applyDrop(l, { type: 'server', id: 'a' }, { type: 'server', id: 'c', pos: 'after' }))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('pasta só reordena: não entra em pasta nem num servidor', () => {
    const l = ['a', folder('F', ['b', 'c']), folder('G', ['d', 'e'])];
    expect(short(applyDrop(l, { type: 'folder', id: 'G' }, { type: 'server', id: 'a', pos: 'before' }))).toEqual([
      'G:d+e',
      'a',
      'F:b+c',
    ]);
    expect(short(applyDrop(l, { type: 'folder', id: 'G' }, { type: 'server', id: 'b', pos: 'into' }))).toEqual([
      'a',
      'F:b+c',
      'G:d+e',
    ]);
    expect(short(applyDrop(l, { type: 'folder', id: 'F' }, { type: 'server', id: 'b', pos: 'after' }))).toEqual(
      short(l),
    );
  });

  it('servidor da pasta em cima de outro servidor solto cria nova pasta', () => {
    const l = [folder('F', ['a', 'b', 'c']), 'd'];
    expect(short(applyDrop(l, { type: 'server', id: 'c' }, { type: 'server', id: 'd', pos: 'into' }, 'G'))).toEqual([
      'F:a+b',
      'G:d+c',
    ]);
  });
});

describe('outras operações', () => {
  const l = ['a', folder('F', ['b', 'c', 'd'], 'Jogos'), 'e'];

  it('sobe/desce entre vizinhos (dentro da pasta também)', () => {
    expect(short(moveBy(l, { type: 'server', id: 'a' }, 1))).toEqual(['F:b+c+d', 'a', 'e']);
    expect(short(moveBy(l, { type: 'server', id: 'c' }, -1))).toEqual(['a', 'F:c+b+d', 'e']);
    expect(short(moveBy(l, { type: 'server', id: 'a' }, -1))).toEqual(short(l));
  });

  it('remover da pasta e desagrupar', () => {
    expect(short(removeFromFolder(l, 'c'))).toEqual(['a', 'F:b+d', 'c', 'e']);
    expect(short(ungroup(l, 'F'))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('renomear/abrir e nome automático', () => {
    const u = updateFolder(l, 'F', { name: 'X', open: true })[1];
    expect(u).toMatchObject({ name: 'X', open: true });
    expect(folderLabel(folder('F', []), servers)).toBe('A, B, C, D, ...');
    expect(folderLabel(folder('F', [], ' Jogos '), servers)).toBe('Jogos');
  });

  it('posição pelo cursor', () => {
    expect([10, 50, 90].map((y) => dropPosAt(y, 100, true))).toEqual(['before', 'into', 'after']);
    expect([10, 50, 90].map((y) => dropPosAt(y, 100, false))).toEqual(['before', 'after', 'after']);
  });

  it('configurações antigas (sem serverLayout) ganham lista vazia e a lista salva valida', () => {
    expect(UserSettingsV1.parse({ version: 1 }).serverLayout).toEqual([]);
    expect(UserSettingsV1.parse({ version: 1, serverLayout: l }).serverLayout).toHaveLength(3);
  });
});

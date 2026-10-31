import { describe, expect, it } from 'vitest';
import { newEntries } from '../src/features/shell/updateNotes';

const n = (date: string, time: string, title: string) => ({ date, time, kind: 'novo', title, body: 'b' });

describe('novidades da atualização', () => {
  it('mostra só o que esta versão ainda não tem', () => {
    const known = new Set(['2026-10-31 01:00 Velha']);
    const notes = [
      n('2026-10-31', '03:00', 'Nova'),
      n('2026-10-31', '01:00', 'Velha'),
      n('2026-10-30', '23:00', 'Antiga'),
    ];
    expect(newEntries(notes, '2026-10-31 01:00', known).map((e) => e.title)).toEqual(['Nova']);
  });
});

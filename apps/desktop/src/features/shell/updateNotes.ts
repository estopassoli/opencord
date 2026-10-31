/** Novidades da versão nova que esta versão ainda não tem (parte pura do diálogo de atualização). */
import { CHANGELOG } from '../home/changelog';

export interface Note {
  date: string;
  time?: string;
  kind: string;
  title: string;
  body: string;
}

export const KIND_LABEL: Record<string, string> = { novo: 'Novo', melhoria: 'Melhoria', correção: 'Correção' };
export const keyOf = (e: { date: string; time?: string | undefined }) => `${e.date} ${e.time ?? '00:00'}`;
/** a novidade mais recente que esta versão já tem: só o que vier depois dela é novo */
const MINE = CHANGELOG[0] ? keyOf(CHANGELOG[0]) : '';
const KNOWN = new Set(CHANGELOG.map((e) => `${keyOf(e)} ${e.title}`));

/** Só o que esta versão ainda não tem (mais nova primeiro). */
export function newEntries(notes: Note[], mine = MINE, known = KNOWN): Note[] {
  return notes.filter((n) => keyOf(n) >= mine && !known.has(`${keyOf(n)} ${n.title}`));
}

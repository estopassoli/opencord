/**
 * Menções no compositor: o campo é texto puro, então a pessoa vê e escreve `@usuario`; ao enviar, cada `@nome` de
 * alguém do canal/conversa vira o token `<@id>` que a API entende (contracts/mentions.ts). Na edição o caminho volta
 * (`<@id>` → `@usuario`). Funções puras (testadas sem o app).
 */
import { MENTION_RE, mentionToken } from '@opencord/contracts';

export interface MentionCandidate {
  id: string;
  username: string;
  displayName: string;
  /** apelido no servidor */
  nickname?: string | null | undefined;
}

export type MentionSuggestion =
  | { kind: 'user'; id: string; label: string; detail: string; insert: string }
  | { kind: 'everyone'; label: string; detail: string; insert: string };

/** trecho `@algo` em edição no cursor: [start, end) é o que a sugestão substitui */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/** `@` no começo, depois de espaço ou de abertura (não pega e-mail nem URL) */
const TYPING = /(?:^|[\s([{"'])@([\p{L}\p{N}_.]{0,32})$/u;
const REST = /^[\p{L}\p{N}_.]*/u;
const TYPED = /(^|[\s([{"'])@([\p{L}\p{N}_.]{1,32})/gu;
/** pedaços ímpares do split estão dentro de `código` (mesma regra dos emojis personalizados) */
const CODE_SPLIT = /(`+[^`]*`+)/;
const RESERVED = new Set(['everyone', 'here']);

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const mentionShownName = (c: MentionCandidate) => c.nickname || c.displayName;

/** o `@…` que a pessoa está digitando no cursor, ou null */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = TYPING.exec(before);
  if (!m) return null;
  const query = m[1] ?? '';
  const start = caret - query.length - 1;
  // crase aberta antes do @: está escrevendo código
  if ((before.slice(0, start).match(/`/g)?.length ?? 0) % 2 === 1) return null;
  const rest = REST.exec(text.slice(caret))?.[0] ?? '';
  return { start, end: caret + rest.length, query };
}

/**
 * Pessoas que combinam com o que foi digitado (usuário, apelido ou nome, sem diferenciar acento/maiúscula): primeiro
 * quem começa igual, depois quem tem uma palavra que começa igual, depois quem contém. Sem nada digitado, mantém a
 * ordem recebida (quem falou por último primeiro). `@everyone` entra quando permitido.
 */
export function suggestMentions(
  query: string,
  candidates: readonly MentionCandidate[],
  opts: { everyone?: boolean; limit?: number } = {},
): MentionSuggestion[] {
  const q = fold(query);
  const limit = opts.limit ?? 8;
  const seen = new Set<string>();
  const scored: { c: MentionCandidate; score: number; i: number }[] = [];
  candidates.forEach((c, i) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const names = [c.username, c.nickname ?? '', c.displayName].map(fold).filter(Boolean);
    let score = -1;
    if (!q) score = 0;
    else if (fold(c.username) === q) score = 0;
    else if (names.some((n) => n.startsWith(q))) score = 1;
    else if (names.some((n) => n.split(/[\s._-]+/).some((w) => w.startsWith(q)))) score = 2;
    else if (names.some((n) => n.includes(q))) score = 3;
    if (score >= 0) scored.push({ c, score, i });
  });
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (q ? fold(mentionShownName(a.c)).localeCompare(fold(mentionShownName(b.c))) : 0) ||
      a.i - b.i,
  );
  const everyone = Boolean(opts.everyone) && 'everyone'.startsWith(q);
  const users: MentionSuggestion[] = scored.slice(0, everyone ? limit - 1 : limit).map(({ c }) => ({
    kind: 'user',
    id: c.id,
    label: mentionShownName(c),
    detail: `@${c.username}`,
    insert: `@${c.username} `,
  }));
  if (everyone) users.push({ kind: 'everyone', label: '@everyone', detail: 'todos neste canal', insert: '@everyone ' });
  return users;
}

/**
 * Troca `@nome` pelo token da menção (fora de código): pelo usuário (único) e, se não achar, por apelido ou nome de
 * uma palavra só que só uma pessoa tem. Ponto colado no fim ("fala @ana.") fica fora do nome. `@everyone` fica como
 * está (a API trata) e nomes desconhecidos continuam texto.
 */
export function resolveMentions(text: string, candidates: readonly MentionCandidate[]): string {
  if (!text.includes('@') || !candidates.length) return text;
  const byUser = new Map<string, string>();
  const byName = new Map<string, string | null>(); // null = mais de uma pessoa com esse nome
  for (const c of candidates) {
    byUser.set(c.username.toLowerCase(), c.id);
    for (const raw of [c.nickname, c.displayName]) {
      if (!raw) continue;
      const n = fold(raw);
      if (/\s/.test(n)) continue;
      const cur = byName.get(n);
      byName.set(n, cur === undefined || cur === c.id ? c.id : null);
    }
  }
  const find = (w: string) => {
    if (!w || RESERVED.has(w.toLowerCase())) return null;
    return byUser.get(w.toLowerCase()) ?? byName.get(fold(w)) ?? null;
  };
  return text
    .split(CODE_SPLIT)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(TYPED, (whole, pre: string, word: string) => {
            let w = word;
            let id = find(w);
            while (!id && /[._]$/.test(w)) {
              w = w.slice(0, -1);
              id = find(w);
            }
            return id ? `${pre}${mentionToken(id)}${word.slice(w.length)}` : whole;
          }),
    )
    .join('');
}

/** caminho de volta para editar: `<@id>` de quem é conhecido vira `@usuario` (só onde voltaria a virar menção) */
export function mentionsAsText(text: string, candidates: readonly MentionCandidate[]): string {
  if (!text.includes('<@') || !candidates.length) return text;
  const byId = new Map(candidates.map((c) => [c.id.toLowerCase(), c.username]));
  const re = new RegExp(MENTION_RE.source, 'gi');
  return text
    .split(CODE_SPLIT)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(re, (whole, id: string, at: number) => {
            const u = byId.get(id.toLowerCase());
            const prev = at > 0 ? part[at - 1]! : '';
            const next = part[at + whole.length] ?? '';
            return u && (!prev || /[\s([{"']/.test(prev)) && !/[\p{L}\p{N}]/u.test(next) ? `@${u}` : whole;
          }),
    )
    .join('');
}

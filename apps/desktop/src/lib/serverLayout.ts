import type { ServerFolder, ServerLayoutItem, ServerSummary } from '@opencord/contracts';

/**
 * Barra de servidores organizável: ordem e pastas ficam em `settings.serverLayout` (sincronizado entre aparelhos).
 * Tudo aqui é puro: o rail resolve a lista salva contra os servidores que a pessoa tem e aplica arrastar/soltar.
 */
export type RailEntry =
  { kind: 'server'; server: ServerSummary } | { kind: 'folder'; folder: ServerFolder; servers: ServerSummary[] };

/** O que está sendo arrastado: um servidor (solto ou dentro de pasta) ou uma pasta inteira. */
export type DragSource = { type: 'server' | 'folder'; id: string };
export type DropPos = 'before' | 'after' | 'into';
export type DropTarget = { type: 'server' | 'folder'; id: string; pos: DropPos };

/**
 * Lista salva → o que o rail mostra. Servidores que saí somem, pasta com um só servidor vira servidor solto,
 * servidor repetido vale só na primeira posição, e quem não está na lista (servidor novo) vai para o fim.
 */
export function resolveLayout(layout: readonly ServerLayoutItem[], servers: readonly ServerSummary[]): RailEntry[] {
  const byId = new Map(servers.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const take = (id: string) => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return null;
    seen.add(id);
    return s;
  };
  const out: RailEntry[] = [];
  for (const item of layout) {
    if (typeof item === 'string') {
      const s = take(item);
      if (s) out.push({ kind: 'server', server: s });
      continue;
    }
    const inside = item.serverIds.map(take).filter((s): s is ServerSummary => s !== null);
    if (inside.length >= 2)
      out.push({ kind: 'folder', folder: { ...item, serverIds: inside.map((s) => s.id) }, servers: inside });
    else if (inside[0]) out.push({ kind: 'server', server: inside[0] });
  }
  for (const s of servers) if (!seen.has(s.id)) out.push({ kind: 'server', server: s });
  return out;
}

/** Versão limpa da lista salva (base para as operações): só o que o rail mostra, na mesma ordem. */
export function normalizeLayout(layout: readonly ServerLayoutItem[], servers: readonly ServerSummary[]) {
  return resolveLayout(layout, servers).map((e): ServerLayoutItem => (e.kind === 'server' ? e.server.id : e.folder));
}

const clone = (l: readonly ServerLayoutItem[]): ServerLayoutItem[] =>
  l.map((i) => (typeof i === 'string' ? i : { ...i, serverIds: [...i.serverIds] }));

/** Pasta com 0 servidores some; com 1, vira o servidor solto no mesmo lugar. */
function tidy(l: ServerLayoutItem[]): ServerLayoutItem[] {
  return l.flatMap((i): ServerLayoutItem[] =>
    typeof i === 'string' ? [i] : i.serverIds.length >= 2 ? [i] : i.serverIds,
  );
}

const folderOf = (l: readonly ServerLayoutItem[], serverId: string) =>
  l.find((i): i is ServerFolder => typeof i !== 'string' && i.serverIds.includes(serverId));

export const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Solta `src` em `target`. `into` num servidor solto cria uma pasta com os dois (o alvo primeiro);
 * `into` numa pasta põe o servidor no fim dela; perto de um servidor que está numa pasta, entra na pasta.
 * Pasta não entra em pasta: soltar "dentro" de algo vira "depois" dele (ou da pasta que o contém).
 */
export function applyDrop(
  layout: readonly ServerLayoutItem[],
  src: DragSource,
  target: DropTarget,
  folderId: string = newFolderId(),
): ServerLayoutItem[] {
  if (src.id === target.id) return clone(layout);
  let l = clone(layout);
  // pasta solta sobre um servidor dela mesma: nada muda
  if (src.type === 'folder' && target.type === 'server' && folderOf(l, target.id)?.id === src.id) return l;

  // tira a origem de onde está
  let moving: ServerLayoutItem | null = null;
  if (src.type === 'folder') {
    const i = l.findIndex((x) => typeof x !== 'string' && x.id === src.id);
    if (i < 0) return l;
    moving = l.splice(i, 1)[0] ?? null;
  } else {
    const parent = folderOf(l, src.id);
    if (parent) parent.serverIds = parent.serverIds.filter((id) => id !== src.id);
    else l = l.filter((x) => x !== src.id);
    moving = src.id;
  }
  if (moving === null) return clone(layout);

  const topIndex = (t: DropTarget) =>
    l.findIndex((x) => (t.type === 'server' ? x === t.id : typeof x !== 'string' && x.id === t.id));

  if (typeof moving !== 'string') {
    // pasta: só reordena no nível de cima
    const parent = target.type === 'server' ? folderOf(l, target.id) : undefined;
    const ref: DropTarget = parent ? { type: 'folder', id: parent.id, pos: 'after' } : target;
    const i = topIndex(ref);
    if (i < 0) return clone(layout);
    l.splice(ref.pos === 'before' ? i : i + 1, 0, moving);
    return tidy(l);
  }

  const id = moving;
  if (target.type === 'folder') {
    const i = topIndex(target);
    const f = l[i];
    if (i < 0 || !f || typeof f === 'string') return clone(layout);
    if (target.pos === 'into') f.serverIds.push(id);
    else l.splice(target.pos === 'before' ? i : i + 1, 0, id);
    return tidy(l);
  }

  const parent = folderOf(l, target.id);
  if (parent) {
    const j = parent.serverIds.indexOf(target.id);
    parent.serverIds.splice(target.pos === 'before' ? j : j + 1, 0, id);
    return tidy(l);
  }
  const i = topIndex(target);
  if (i < 0) return clone(layout);
  if (target.pos === 'into') l[i] = { id: folderId, name: '', color: null, serverIds: [target.id, id], open: false };
  else l.splice(target.pos === 'before' ? i : i + 1, 0, id);
  return tidy(l);
}

/** Sobe/desce um servidor ou pasta uma posição entre os vizinhos (dentro da pasta, se estiver numa). */
export function moveBy(layout: readonly ServerLayoutItem[], src: DragSource, delta: -1 | 1): ServerLayoutItem[] {
  const l = clone(layout);
  const parent = src.type === 'server' ? folderOf(l, src.id) : undefined;
  const list: unknown[] = parent ? parent.serverIds : l;
  const i = list.findIndex((x) => (typeof x === 'string' ? x === src.id : (x as ServerFolder).id === src.id));
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return l;
  [list[i], list[j]] = [list[j], list[i]];
  return l;
}

/** Tira o servidor da pasta e o coloca logo depois dela. */
export function removeFromFolder(layout: readonly ServerLayoutItem[], serverId: string): ServerLayoutItem[] {
  const l = clone(layout);
  const parent = folderOf(l, serverId);
  if (!parent) return l;
  parent.serverIds = parent.serverIds.filter((id) => id !== serverId);
  l.splice(l.indexOf(parent) + 1, 0, serverId);
  return tidy(l);
}

/** Desfaz a pasta: os servidores voltam soltos, no lugar dela. */
export function ungroup(layout: readonly ServerLayoutItem[], folderId: string): ServerLayoutItem[] {
  return clone(layout).flatMap((i): ServerLayoutItem[] =>
    typeof i !== 'string' && i.id === folderId ? i.serverIds : [i],
  );
}

export function updateFolder(
  layout: readonly ServerLayoutItem[],
  folderId: string,
  patch: Partial<Pick<ServerFolder, 'name' | 'color' | 'open'>>,
): ServerLayoutItem[] {
  return clone(layout).map((i) => (typeof i !== 'string' && i.id === folderId ? { ...i, ...patch } : i));
}

/** Onde soltar pela altura do cursor no item: borda de cima/baixo reordena, o meio agrupa. */
export function dropPosAt(offsetY: number, height: number, canGroup: boolean): DropPos {
  const r = offsetY / Math.max(1, height);
  if (!canGroup) return r < 0.5 ? 'before' : 'after';
  return r < 0.25 ? 'before' : r > 0.75 ? 'after' : 'into';
}

/** Nome mostrado da pasta: o que a pessoa deu ou os primeiros servidores ("A, B, C, ..."). */
export function folderLabel(folder: ServerFolder, servers: readonly ServerSummary[]): string {
  if (folder.name.trim()) return folder.name.trim();
  const names = servers.slice(0, 4).map((s) => s.name);
  return servers.length > 4 ? `${names.join(', ')}, ...` : names.join(', ');
}

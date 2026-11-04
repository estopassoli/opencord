import type { ClipInfo } from '../../../electron/shared/ipc';

export const NO_GAME = '\u0000sem-jogo';

export interface ClipGroup {
  key: string;
  game: string | null;
  icon: string | null;
  clips: ClipInfo[];
}

/** Clipes por jogo (sem jogo num grupo próprio), na ordem do jogo com o clipe mais recente. */
export function groupClips(library: ClipInfo[]): ClipGroup[] {
  const by = new Map<string, ClipGroup>();
  for (const c of [...library].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = c.game ?? NO_GAME;
    const g = by.get(key) ?? { key, game: c.game, icon: c.icon, clips: [] };
    g.clips.push(c);
    if (!g.icon && c.icon) g.icon = c.icon;
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (b.clips[0]?.createdAt ?? 0) - (a.clips[0]?.createdAt ?? 0));
}

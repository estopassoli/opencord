import { create } from 'zustand';
import { loadScenes, saveScenes, type Scene } from '../lib/scenes';

const ACTIVE_KEY = 'oc-scene-active';
const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

/** Cenas do Go Live (ADR-0015) e a escolhida; null = sem cena (só a tela, como antes). */
interface ScenesStore {
  scenes: Scene[];
  activeId: string | null;
  /** chamado pelo voice store para trocar a cena da live em andamento */
  onLiveChange: ((scene: Scene | null) => void) | null;
  setScenes(list: Scene[]): boolean;
  setActive(id: string | null): void;
  active(): Scene | null;
}

export const useScenes = create<ScenesStore>()((set, get) => ({
  scenes: loadScenes(),
  activeId: readActive(),
  onLiveChange: null,
  setScenes(list) {
    const ok = saveScenes(list);
    set({ scenes: list });
    // a cena ativa foi editada: a live acompanha
    const cur = list.find((s) => s.id === get().activeId) ?? null;
    if (get().activeId && !cur) get().setActive(null);
    else get().onLiveChange?.(cur);
    return ok;
  },
  setActive(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* vale só nesta sessão */
    }
    set({ activeId: id });
    get().onLiveChange?.(get().active());
  },
  active() {
    const { scenes, activeId } = get();
    return scenes.find((s) => s.id === activeId) ?? null;
  },
}));

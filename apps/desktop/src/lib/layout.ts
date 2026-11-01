import { create } from 'zustand';

/** Layout da interface: o clássico ou o Vidro (redesign em teste: vidro líquido, fundo vivo em three.js, parallax). */
export type ShellLayout = 'classico' | 'vidro';

const KEY = 'oc-layout';

function initialLayout(): ShellLayout {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'vidro' || v === 'classico') return v;
  } catch {
    /* armazenamento indisponível: usa o padrão do build */
  }
  return import.meta.env.VITE_OPENCORD_LAYOUT === 'vidro' ? 'vidro' : 'classico';
}

function apply(l: ShellLayout) {
  document.documentElement.dataset.layout = l;
}

export const useLayout = create<{ layout: ShellLayout; setLayout(l: ShellLayout): void }>()((set) => {
  const layout = initialLayout();
  apply(layout);
  return {
    layout,
    setLayout: (l) => {
      apply(l);
      try {
        localStorage.setItem(KEY, l);
      } catch {
        /* vale só nesta sessão */
      }
      set({ layout: l });
    },
  };
});

/**
 * Tema antes das configurações chegarem: o esquema/tom/tema escolhido fica guardado neste computador e é aplicado
 * no <html> já no carregamento, para a janela não piscar no escuro padrão até o login terminar. A fonte da verdade
 * continua sendo as configurações da pessoa no servidor (store/settings.ts).
 */
const KEY = 'oc-appearance';

interface Remembered {
  theme: 'dark' | 'light';
  surface: string;
  palette: string;
}

export function rememberAppearance(a: Remembered) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme: a.theme, surface: a.surface, palette: a.palette }));
  } catch {
    /* sem armazenamento: só nesta sessão */
  }
}

export function applyRememberedAppearance() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<Remembered>;
    const root = document.documentElement;
    if (v.theme === 'dark' || v.theme === 'light') root.dataset.theme = v.theme;
    if (typeof v.surface === 'string' && /^[a-z-]{1,24}$/.test(v.surface)) root.dataset.surface = v.surface;
    if (typeof v.palette === 'string' && /^[a-z-]{1,24}$/.test(v.palette)) root.dataset.palette = v.palette;
  } catch {
    /* valor inválido: fica o padrão */
  }
}

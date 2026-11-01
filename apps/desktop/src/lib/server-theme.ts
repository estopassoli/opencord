/**
 * Tema por servidor: ao abrir um servidor com cor de destaque própria, os tokens da marca trocam para ela (e voltam
 * para a cor da pessoa ao sair); o papel de parede vira a variável `--wallpaper` no <html>, que a conversa usa como
 * fundo. Quem define é quem gerencia o servidor (Configurações → Visão geral).
 */
import { useData } from '../store/data';
import { useSession } from '../store/session';
import { applyAppearanceTokens } from '../store/settings';
import { useUi } from '../store/ui';

export const wallpaperUrl = (key: string | null | undefined) => {
  const base = useSession.getState().serverUrl?.replace(/\/+$/, '');
  return key && base ? `${base}/wallpapers/${encodeURIComponent(key)}` : null;
};

let last = '';
function apply() {
  const { view } = useUi.getState();
  const { details, settings } = useData.getState();
  const server = view.kind === 'server' ? details[view.serverId] : undefined;
  const accent = server?.accent ?? null;
  const wallpaper = wallpaperUrl(server?.wallpaperKey);
  const key = `${accent ?? ''}|${wallpaper ?? ''}`;
  if (key === last) return;
  last = key;
  const root = document.documentElement;
  if (settings) applyAppearanceTokens(settings.appearance, accent);
  if (wallpaper) {
    root.style.setProperty('--wallpaper', `url("${wallpaper}")`);
    root.dataset.wallpaper = 'true';
  } else {
    root.style.removeProperty('--wallpaper');
    delete root.dataset.wallpaper;
  }
}

let started = false;
export function startServerTheme() {
  if (started) return;
  started = true;
  useUi.subscribe(apply);
  useData.subscribe(apply);
  apply();
}

/** As configurações de aparência mudaram: reaplica com a cor do servidor aberto, se houver. */
export function reapplyServerTheme() {
  last = '';
  apply();
}

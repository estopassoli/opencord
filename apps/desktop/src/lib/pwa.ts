/**
 * App instalável no celular (PWA, ADR-0035): registro do service worker (só no navegador, por http/https) e o
 * convite de instalação. No Android/Chrome o navegador dispara `beforeinstallprompt` e o app guarda o evento para
 * abrir o diálogo nativo quando a pessoa tocar em "Instalar"; no iOS não existe esse evento: a instalação é por
 * Compartilhar → "Adicionar à Tela de Início", e o app só orienta.
 */
import { create } from 'zustand';
import { isDesktop } from './bridge';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallKind = 'prompt' | 'ios' | 'none';

interface InstallState {
  /** 'prompt': o navegador oferece instalar; 'ios': orientar; 'none': já instalado, app desktop ou sem suporte */
  kind: InstallKind;
  /** abre o diálogo nativo (Android); resolve true quando a pessoa aceita */
  install(): Promise<boolean>;
}

let deferred: BeforeInstallPromptEvent | null = null;

/** Aberto como app instalado (ícone na tela inicial), não numa aba do navegador. */
export function isStandalone(nav: Navigator = navigator, win: Window = window): boolean {
  return (
    (win.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
    (nav as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad (inclusive iPadOS, que se apresenta como Mac com toque). */
export function isIos(nav: Navigator = navigator): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

export function initialInstallKind(nav: Navigator = navigator, win: Window = window): InstallKind {
  if (isDesktop || isStandalone(nav, win)) return 'none';
  return isIos(nav) ? 'ios' : 'none';
}

export const useInstall = create<InstallState>()((set) => ({
  kind: typeof window === 'undefined' ? 'none' : initialInstallKind(),
  async install() {
    const ev = deferred;
    if (!ev) return false;
    deferred = null;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') set({ kind: 'none' });
    return outcome === 'accepted';
  },
}));

/** Service worker + captura do convite de instalação. Chamar uma vez na inicialização; inofensivo fora do navegador. */
export function setupPwa(onUpdated?: () => void): void {
  if (isDesktop || typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    useInstall.setState({ kind: 'prompt' });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    useInstall.setState({ kind: 'none' });
  });
  if (!/^https?:$/.test(location.protocol) || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // o worker fica ao lado do index.html (build com caminhos relativos); sem cache HTTP do próprio sw.js
  navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href, { updateViaCache: 'none' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          // já havia um worker controlando a página: chegou versão nova (vale no próximo carregamento)
          if (next.state === 'activated' && navigator.serviceWorker.controller) onUpdated?.();
        });
      });
    })
    .catch(() => undefined);
}

/**
 * "Abrir em nova janela": a transmissão vai para uma janela separada do próprio app (window.open de about:blank,
 * liberada no main só com este nome). É a mesma origem: o React desenha nela por portal, com o mesmo estado da
 * chamada, e o vídeo continua vindo da mesma conexão. Os estilos e o tema (atributos/variáveis do <html>) são
 * espelhados. Fechar a janela devolve a transmissão ao palco.
 * (Document Picture-in-Picture seria o ideal, mas o Electron 44 não implementa: requestWindow → "no window".)
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GlobalTips } from '../../components/GlobalTips';
import { useUi } from '../../store/ui';

export const POPOUT_NAME = 'opencord-live';
let popup: Window | null = null;
let rootObserver: MutationObserver | null = null;

function copyStyles(from: Document, to: Document) {
  // base = página do app: url() relativas das folhas (fontes) continuam resolvendo
  const base = to.createElement('base');
  base.href = from.baseURI;
  to.head.append(base);
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      to.head.append(style);
    } catch {
      if (sheet.href) {
        const link = to.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        to.head.append(link);
      }
    }
  }
}

/** Tema, densidade, cor de destaque etc. ficam em atributos e variáveis do <html>: espelha e acompanha mudanças. */
function mirrorRoot(from: HTMLElement, to: HTMLElement) {
  const sync = () => {
    for (const a of Array.from(to.attributes)) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name);
    for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
  };
  sync();
  rootObserver?.disconnect();
  rootObserver = new MutationObserver(sync);
  rootObserver.observe(from, { attributes: true });
}

/** Abre (ou traz para frente) a janela da transmissão de `identity`. */
export function openStreamWindow(identity: string) {
  const w = window.open('', POPOUT_NAME, 'popup,width=1120,height=700');
  if (!w) {
    useUi.getState().toast('error', 'Não foi possível abrir a janela da transmissão.');
    return;
  }
  popup = w;
  const doc = w.document;
  if (!doc.getElementById('oc-popout')) {
    doc.title = 'OpenCord — Transmissão';
    copyStyles(document, doc);
    mirrorRoot(document.documentElement, doc.documentElement);
    const root = doc.createElement('div');
    root.id = 'oc-popout';
    doc.body.className = 'popout-body';
    doc.body.append(root);
    w.addEventListener('pagehide', () => {
      if (popup === w) popup = null;
      rootObserver?.disconnect();
      useUi.getState().setPoppedStream(null);
    });
  }
  w.focus();
  useUi.getState().setPoppedStream(identity);
}

/** Devolve a transmissão ao palco do app. */
export function closeStreamWindow() {
  const w = popup;
  popup = null;
  rootObserver?.disconnect();
  useUi.getState().setPoppedStream(null);
  w?.close();
}

/** Renderiza `children` dentro da janela separada enquanto ela existir. */
export function PopoutPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    setTarget(popup?.document.getElementById('oc-popout') ?? null);
  }, []);
  return target
    ? createPortal(
        <>
          {children}
          <GlobalTips doc={target.ownerDocument} />
        </>,
        target,
      )
    : null;
}

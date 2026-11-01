import { useEffect, useRef } from 'react';
import { REMOTE_PANIC_LABEL, SCANCODES, type MouseButton } from '../../../electron/shared/remote-input';
import { remoteControl } from '../../voice/remote-control';
import { useUi } from '../../store/ui';

const BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right', 'back', 'forward'];
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Camada por cima da live de quem me deixou controlar o PC (ADR-0026): captura mouse, rodinha e teclado e manda pela
 * sala. A posição vai relativa ao quadro do vídeo (0–1), descontando as faixas pretas do `object-fit: contain`; o PC
 * controlado converte para os pixels do monitor transmitido. A tecla viaja pela posição física (`code`): o layout de
 * quem é controlado decide a letra.
 */
export function RemoteOverlay({ name, kb }: { name: string; kb: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef(new Set<string>());
  const queued = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  const pos = (e: { clientX: number; clientY: number }) => {
    const el = ref.current;
    const video = el?.parentElement?.querySelector('video');
    if (!el || !video || !video.videoWidth || !video.videoHeight) return null;
    const r = el.getBoundingClientRect();
    const scale = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    return {
      x: clamp((e.clientX - r.left - (r.width - w) / 2) / w),
      y: clamp((e.clientY - r.top - (r.height - h) / 2) / h),
    };
  };

  const stop = () => {
    remoteControl()?.stopControlling(true);
    useUi.getState().toast('info', 'Você parou de controlar o computador.');
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // a rodinha precisa de preventDefault, e o React registra wheel como passivo
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // um "clique" da rodinha são 120 no Windows; o Chromium manda 100 por clique (ou linhas, no modo 1)
      const unit = e.deltaMode === 1 ? 40 : 1;
      const conv = (d: number) => Math.max(-1200, Math.min(1200, Math.round(d * unit * 1.2)));
      // no Windows, rodinha positiva é para cima/direita; no navegador, deltaY positivo é para baixo
      const dx = conv(e.deltaX);
      const dy = -conv(e.deltaY);
      if (dx || dy) remoteControl()?.sendInput({ t: 'w', dx, dy });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      cancelAnimationFrame(frame.current);
      if (held.current.size) remoteControl()?.sendInput({ t: 'r' });
    };
  }, []);

  const release = () => {
    if (!held.current.size) return;
    held.current.clear();
    remoteControl()?.sendInput({ t: 'r' });
  };

  const key = (e: React.KeyboardEvent, down: boolean) => {
    // o mesmo atalho de emergência de quem é controlado, só que aqui ele fica em mim
    if (down && e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyS') {
      e.preventDefault();
      stop();
      return;
    }
    if (!kb || !Object.hasOwn(SCANCODES, e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (down && e.repeat) return;
    if (down) held.current.add(e.code);
    else held.current.delete(e.code);
    remoteControl()?.sendInput({ t: 'k', c: e.code, d: down });
  };

  return (
    <div
      ref={ref}
      className="remote-overlay"
      tabIndex={0}
      role="application"
      aria-label={`Controlando o computador de ${name}`}
      onPointerMove={(e) => {
        const p = pos(e);
        if (!p) return;
        queued.current = p;
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const q = queued.current;
          if (q) remoteControl()?.sendInput({ t: 'm', ...q });
        });
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pos(e);
        const b = BUTTONS[e.button];
        if (p && b) remoteControl()?.sendInput({ t: 'b', b, d: true, ...p });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const p = pos(e);
        const b = BUTTONS[e.button];
        if (p && b) remoteControl()?.sendInput({ t: 'b', b, d: false, ...p });
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => key(e, true)}
      onKeyUp={(e) => key(e, false)}
      onBlur={release}
    >
      <span className="remote-hint">
        Controlando o computador de {name}
        {kb ? '' : ' (só o mouse)'} · {REMOTE_PANIC_LABEL} para parar
      </span>
    </div>
  );
}

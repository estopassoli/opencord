/**
 * Interface de jogo do Espaço 3D (ADR-0055): comandos do contexto atual com teclas e mouse desenhados, aviso para
 * prender o mouse na visão e a mira no centro. Teclado só tem W A S D, E e F; o resto é no mouse.
 */
import type { SportZone } from '@opencord/contracts';
import { useEffect, useState } from 'react';
import { ACTION_LABELS, ACTIONS, codeLabel, isMouse, normalizeCode, useBindings, type Action } from './bindings';

type Btn = 'left' | 'right' | 'middle' | 'move';

/** mouse desenhado com o botão da ação em destaque */
export function MouseIcon({ btn, hold }: { btn: Btn; hold?: boolean }) {
  const on = (b: Btn) => (btn === b ? 'var(--accent, #5865f2)' : 'rgb(255 255 255 / 0.18)');
  return (
    <span className="space3d-mouse" data-hold={hold ? 'true' : undefined}>
      <svg viewBox="0 0 20 28" width="16" height="22" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="18"
          height="26"
          rx="9"
          fill="none"
          stroke="rgb(255 255 255 / 0.75)"
          strokeWidth="1.6"
        />
        <path d="M2 11 V10 a8 8 0 0 1 7.2 -8 V11 Z" fill={on('left')} />
        <path d="M18 11 V10 a8 8 0 0 0 -7.2 -8 V11 Z" fill={on('right')} />
        <rect
          x="8.6"
          y="4"
          width="2.8"
          height="5"
          rx="1.4"
          fill={btn === 'middle' ? 'var(--accent, #5865f2)' : 'rgb(255 255 255 / 0.75)'}
        />
        {btn === 'move' && <path d="M10 15 l-3 3 h2 v4 h2 v-4 h2 Z" fill="var(--accent, #5865f2)" />}
      </svg>
      {hold && <span className="space3d-hold">segure</span>}
    </span>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="space3d-keys">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

type Row = {
  input: { acts: Action[]; hold?: boolean } | { mouse: Btn } | { text: string };
  label: string;
};
const MOVE: Action[] = ['forward', 'left', 'back', 'right'];

const ROOM: Row[] = [
  { input: { acts: MOVE }, label: 'Andar' },
  { input: { mouse: 'move' }, label: 'Olhar em volta' },
  { input: { acts: ['run'], hold: true }, label: 'Correr' },
  { input: { acts: ['jump'] }, label: 'Pular' },
  { input: { acts: ['wave'] }, label: 'Acenar' },
  { input: { acts: ['interact'] }, label: 'Interagir · desafiar para um x1' },
];

const FIGHT: Row[] = [
  { input: { acts: ['primary'] }, label: 'Soco rápido' },
  { input: { acts: ['primary'], hold: true }, label: 'Soltar: soco forte' },
  { input: { acts: ['secondary'], hold: true }, label: 'Defender' },
  { input: { acts: MOVE }, label: 'Mover no ringue' },
];

const SPORT: Record<SportZone, Row[]> = {
  1: [
    { input: { acts: ['interact'] }, label: 'Pegar ou roubar a bola' },
    { input: { acts: ['primary'], hold: true }, label: 'Arremessar: solte na faixa verde' },
    { input: { acts: ['run'], hold: true }, label: 'Correr' },
  ],
  2: [
    { input: { text: 'Encostar' }, label: 'Chutar (correndo chuta mais forte)' },
    { input: { acts: ['primary'] }, label: 'Chute forte para onde olha' },
    { input: { acts: ['run'], hold: true }, label: 'Correr' },
  ],
  3: [
    { input: { acts: ['primary'] }, label: 'Rebater ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
    { input: { acts: ['run'], hold: true }, label: 'Correr' },
  ],
  4: [
    { input: { acts: ['primary'] }, label: 'Bater na bola ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
    { input: { acts: ['run'], hold: true }, label: 'Correr' },
  ],
  5: [
    { input: { acts: ['primary'] }, label: 'Rebater ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
  ],
  6: [
    { input: { mouse: 'move' }, label: 'Mirar (gira em volta da branca)' },
    { input: { acts: ['primary'], hold: true }, label: 'Força da tacada: solte para tacar' },
  ],
  7: [
    { input: { acts: ['forward', 'back'] }, label: 'Acelerar e frear' },
    { input: { acts: ['left', 'right'] }, label: 'Virar' },
    { input: { acts: ['primary'] }, label: 'Usar o turbo guardado' },
  ],
};

/** o atalho escolhido para uma ação: tecla desenhada ou mouse com o botão em destaque */
export function Binding({ action, hold }: { action: Action; hold?: boolean }) {
  const code = useBindings((b) => b.map[action]);
  if (isMouse(code)) {
    const btn: Btn = code === 'Mouse0' ? 'left' : code === 'Mouse2' ? 'right' : 'middle';
    return code === 'Mouse0' || code === 'Mouse1' || code === 'Mouse2' ? (
      <MouseIcon btn={btn} {...(hold ? { hold: true } : {})} />
    ) : (
      <span className="space3d-tag">{codeLabel(code)}</span>
    );
  }
  return (
    <span className="space3d-mouse">
      <Keys keys={[codeLabel(code)]} />
      {hold && <span className="space3d-hold">segure</span>}
    </span>
  );
}

/** Painel de comandos do contexto (sala, x1 ou esporte), recolhível. */
export function ControlsPanel({ zone, fighting }: { zone: number; fighting: boolean }) {
  const [open, setOpen] = useState(true);
  const rows = fighting ? FIGHT : zone ? SPORT[zone as SportZone] : ROOM;
  const extra: Row[] = zone ? [{ input: { acts: MOVE }, label: 'Andar' }] : [];
  const all = zone === 7 || fighting ? rows : [...rows, ...extra];
  return (
    <div className="space3d-controls" data-open={open ? 'true' : undefined}>
      <button className="space3d-controls-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Comandos
      </button>
      {open && (
        <ul>
          {all.map((r) => {
            const inp = r.input;
            return (
              <li key={r.label}>
                <span className="space3d-input">
                  {'acts' in inp ? (
                    <span className="space3d-keys">
                      {inp.acts.map((a, i) => (
                        <Binding key={a} action={a} {...(inp.hold && i === 0 ? { hold: true } : {})} />
                      ))}
                    </span>
                  ) : 'mouse' in inp ? (
                    <MouseIcon btn={inp.mouse} />
                  ) : (
                    <span className="space3d-tag">{inp.text}</span>
                  )}
                </span>
                <span>{r.label}</span>
              </li>
            );
          })}
          <li className="space3d-controls-esc">
            <span className="space3d-input">
              <Keys keys={['Esc']} />
            </span>
            <span>Pausar · mudar os atalhos</span>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Mouse solto: aviso para clicar e voltar a controlar a visão. Preso: a mira no centro. */
export function LockHint({ locked, fighting }: { locked: boolean; fighting: boolean }) {
  if (locked) return fighting ? null : <div className="space3d-dot" aria-hidden="true" />;
  if (fighting) return null;
  return (
    <div className="space3d-lock" role="status">
      <MouseIcon btn="left" />
      <span>
        <strong>Clique para jogar</strong>
        <span className="small">o mouse controla a visão · Esc solta</span>
      </span>
    </div>
  );
}

/**
 * Menu de pausa (Esc solta o mouse e abre): continuar, mudar os atalhos (tecla ou botão do mouse) e sair do espaço.
 */
export function PauseMenu({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const [view, setView] = useState<'menu' | 'keys'>('menu');
  const [listening, setListening] = useState<Action | null>(null);
  const map = useBindings((b) => b.map);

  // esperando a tecla/botão: a próxima tecla ou clique vira o atalho (Esc cancela)
  useEffect(() => {
    if (!listening) return;
    let armed = false;
    const arm = window.setTimeout(() => (armed = true), 0);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') useBindings.getState().set(listening, normalizeCode(e.code));
      setListening(null);
    };
    const onMouse = (e: MouseEvent) => {
      if (!armed) return;
      e.preventDefault();
      e.stopPropagation();
      useBindings.getState().set(listening, `Mouse${e.button}`);
      setListening(null);
    };
    const noMenu = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', noMenu, true);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      // o menu do botão direito some só depois do clique que acabou de virar atalho
      window.setTimeout(() => window.removeEventListener('contextmenu', noMenu, true), 0);
    };
  }, [listening]);

  return (
    <>
      {/* esperando o atalho: cobre a cena, para o clique virar atalho em vez de prender o mouse */}
      {listening && <div className="space3d-capture" aria-hidden="true" />}
      <div className="space3d-pause" role="dialog" aria-label="Pausa">
        {view === 'menu' ? (
          <>
            <h3>Pausado</h3>
            <button className="space3d-gbtn space3d-gbtn-play space3d-pause-main" onClick={onResume} autoFocus>
              Continuar
            </button>
            <button className="space3d-gbtn space3d-pause-main" onClick={() => setView('keys')}>
              Comandos
            </button>
            <button className="space3d-gbtn space3d-pause-main" onClick={onLeave}>
              Sair do espaço
            </button>
            <p className="small">Clique na cena para voltar. Esc pausa de novo.</p>
          </>
        ) : (
          <>
            <h3>Comandos</h3>
            <p className="small">Clique em Alterar e aperte a tecla ou o botão do mouse que quiser.</p>
            <ul className="space3d-binds">
              {ACTIONS.map((a) => (
                <li key={a}>
                  <span>{ACTION_LABELS[a]}</span>
                  <span className="space3d-bind-cur">
                    {listening === a ? (
                      <span className="space3d-listening">Aperte uma tecla ou botão…</span>
                    ) : (
                      <Binding action={a} />
                    )}
                  </span>
                  <button
                    className="space3d-gbtn space3d-gbtn-sm"
                    aria-label={`Alterar: ${ACTION_LABELS[a]} (agora ${codeLabel(map[a])})`}
                    onClick={() => setListening(listening === a ? null : a)}
                  >
                    {listening === a ? 'Cancelar' : 'Alterar'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="space3d-pause-row">
              <button className="space3d-gbtn" onClick={() => useBindings.getState().reset()}>
                Restaurar padrão
              </button>
              <button className="space3d-gbtn space3d-gbtn-play" onClick={() => setView('menu')}>
                Voltar
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

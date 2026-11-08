/**
 * Interface de jogo do Espaço 3D (ADR-0055): comandos do contexto atual com teclas e mouse desenhados, aviso para
 * prender o mouse na visão e a mira no centro. Teclado só tem W A S D, E e F; o resto é no mouse.
 */
import type { SportZone } from '@opencord/contracts';
import { useState } from 'react';

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

type Row = { input: { keys: string[] } | { mouse: Btn; hold?: boolean } | { text: string }; label: string };

const ROOM: Row[] = [
  { input: { keys: ['W', 'A', 'S', 'D'] }, label: 'Andar' },
  { input: { mouse: 'move' }, label: 'Olhar em volta' },
  { input: { mouse: 'right', hold: true }, label: 'Correr' },
  { input: { mouse: 'middle' }, label: 'Pular' },
  { input: { keys: ['E'] }, label: 'Acenar' },
  { input: { keys: ['F'] }, label: 'Interagir · desafiar para um x1' },
];

const FIGHT: Row[] = [
  { input: { mouse: 'left' }, label: 'Soco rápido' },
  { input: { mouse: 'left', hold: true }, label: 'Soltar: soco forte' },
  { input: { mouse: 'right', hold: true }, label: 'Defender' },
  { input: { keys: ['W', 'A', 'S', 'D'] }, label: 'Mover no ringue' },
];

const SPORT: Record<SportZone, Row[]> = {
  1: [
    { input: { keys: ['F'] }, label: 'Pegar ou roubar a bola' },
    { input: { mouse: 'left', hold: true }, label: 'Arremessar: solte na faixa verde' },
    { input: { mouse: 'right', hold: true }, label: 'Correr' },
  ],
  2: [
    { input: { text: 'Encostar' }, label: 'Chutar (correndo chuta mais forte)' },
    { input: { mouse: 'left' }, label: 'Chute forte para onde olha' },
    { input: { mouse: 'right', hold: true }, label: 'Correr' },
  ],
  3: [
    { input: { mouse: 'left' }, label: 'Rebater ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
    { input: { mouse: 'right', hold: true }, label: 'Correr' },
  ],
  4: [
    { input: { mouse: 'left' }, label: 'Bater na bola ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
    { input: { mouse: 'right', hold: true }, label: 'Correr' },
  ],
  5: [
    { input: { mouse: 'left' }, label: 'Rebater ou sacar' },
    { input: { mouse: 'move' }, label: 'Olhar para um lado puxa a bola' },
  ],
  6: [
    { input: { mouse: 'move' }, label: 'Mirar (gira em volta da branca)' },
    { input: { mouse: 'left', hold: true }, label: 'Força da tacada: solte para tacar' },
  ],
  7: [
    { input: { keys: ['W', 'S'] }, label: 'Acelerar e frear' },
    { input: { keys: ['A', 'D'] }, label: 'Virar' },
    { input: { mouse: 'left' }, label: 'Usar o turbo guardado' },
  ],
};

/** Painel de comandos do contexto (sala, x1 ou esporte), recolhível. */
export function ControlsPanel({ zone, fighting }: { zone: number; fighting: boolean }) {
  const [open, setOpen] = useState(true);
  const rows = fighting ? FIGHT : zone ? SPORT[zone as SportZone] : ROOM;
  const extra: Row[] = zone ? [{ input: { keys: ['W', 'A', 'S', 'D'] }, label: 'Andar' }] : [];
  const all = zone === 7 || fighting ? rows : [...rows, ...extra];
  return (
    <div className="space3d-controls" data-open={open ? 'true' : undefined}>
      <button className="space3d-controls-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Comandos
      </button>
      {open && (
        <ul>
          {all.map((r) => (
            <li key={r.label}>
              <span className="space3d-input">
                {'keys' in r.input ? (
                  <Keys keys={r.input.keys} />
                ) : 'mouse' in r.input ? (
                  <MouseIcon btn={r.input.mouse} {...(r.input.hold ? { hold: true } : {})} />
                ) : (
                  <span className="space3d-tag">{r.input.text}</span>
                )}
              </span>
              <span>{r.label}</span>
            </li>
          ))}
          <li className="space3d-controls-esc">
            <span className="space3d-input">
              <Keys keys={['Esc']} />
            </span>
            <span>Soltar o mouse (para usar os botões)</span>
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

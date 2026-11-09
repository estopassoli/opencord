/**
 * Interface de jogo do Espaço 3D (ADR-0055): comandos do contexto atual com teclas e mouse desenhados, aviso para
 * prender o mouse na visão e a mira no centro. Todo texto de tecla sai de `<Binding action>` (o atalho escolhido).
 */
import type { SportZone } from '@opencord/contracts';
import { Icon, Slider, Switch, type IconName } from '@opencord/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ACTION_LABELS, ACTIONS, codeLabel, isMouse, normalizeCode, useBindings, type Action } from './bindings';
import { sfx, useSfxPrefs } from './sfx';
import type { SfxName } from './sfxmap';

/** som do menu (bem baixo); o clique já é o gesto que libera o áudio */
function uiSound(name: Extract<SfxName, 'uiMove' | 'uiOk' | 'uiBack'>) {
  sfx.unlock();
  sfx.ui(name, { gain: name === 'uiMove' ? 0.4 : 0.55 });
}

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
  { input: { acts: ['turnLeft', 'turnRight'] }, label: 'Girar a câmera' },
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

/**
 * Painel de comandos do contexto (sala, x1 ou esporte). Começa recolhido (o tutorial ensina o essencial) e lembra o
 * último estado; o botão e o atalho "Mostrar os comandos" abrem e fecham.
 */
export function ControlsPanel({
  zone,
  fighting,
  open,
  onToggle,
}: {
  zone: number;
  fighting: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const rows = fighting ? FIGHT : zone ? SPORT[zone as SportZone] : ROOM;
  const extra: Row[] = zone
    ? [
        { input: { acts: MOVE }, label: 'Andar' },
        { input: { acts: ['scoreboard'], hold: true }, label: 'Ver o placar' },
      ]
    : [];
  const all = zone === 7 || fighting ? rows : [...rows, ...extra];
  return (
    <div className="space3d-controls" data-open={open ? 'true' : undefined}>
      <button className="space3d-controls-toggle" aria-expanded={open} onClick={onToggle}>
        <span>Comandos</span>
        <Binding action="help" />
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
            <span>Menu · partida · atalhos</span>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Mouse preso: a mira no centro (no x1 a mira é do DuelHud). */
export function LockHint({ fighting }: { fighting: boolean }) {
  return fighting ? null : <div className="space3d-dot" aria-hidden="true" />;
}

/**
 * Mouse solto com o menu fechado (Esc fechou, ou no x1 e na corrida, onde o menu não abre sozinho): uma faixa leve
 * que não cobre o jogo. O clique na cena prende o mouse de novo; Esc abre o menu.
 */
export function LockStrip() {
  return (
    <div className="space3d-lockstrip" role="status">
      <MouseIcon btn="left" />
      <span>
        <strong>Voltar ao jogo:</strong> clique na tela
      </span>
      <span className="space3d-lockstrip-esc">
        <Keys keys={['Esc']} /> menu
      </span>
    </div>
  );
}

/** os jogos do espaço, como aparecem no menu (0 = a sala) */
const GAMES: { zone: number; icon: IconName; title: string; text: string; hue: string }[] = [
  { zone: 0, icon: 'home', title: 'Sala', text: 'Telão, sofás, música e x1 no soco.', hue: '#8b7cf6' },
  {
    zone: 1,
    icon: 'basketball',
    title: 'Basquete',
    text: 'Pegue a bola e acerte a cesta do outro time.',
    hue: '#f08a3c',
  },
  {
    zone: 2,
    icon: 'football',
    title: 'Futebol',
    text: 'Encoste para chutar; clique para o chute forte.',
    hue: '#3fbf6a',
  },
  { zone: 3, icon: 'tennis', title: 'Tênis', text: 'Raquete na mão: rebata por cima da rede.', hue: '#c8e04a' },
  { zone: 4, icon: 'volleyball', title: 'Vôlei', text: 'Na areia: não deixe a bola cair do seu lado.', hue: '#f2c94c' },
  { zone: 5, icon: 'pingpong', title: 'Ping pong', text: 'Rápido: a bolinha quica na mesa.', hue: '#e05a5a' },
  { zone: 6, icon: 'billiard', title: 'Sinuca', text: 'Mire, dose a força e encaçape.', hue: '#2fb39a' },
  { zone: 7, icon: 'motorbike', title: 'Corrida de moto', text: 'Três voltas na pista, com turbo.', hue: '#3f8fe0' },
];

export type MenuTab = 'games' | 'keys' | 'match';

/**
 * Menu do jogo (Esc solta o mouse e abre): à esquerda Continuar, Jogos, Comandos e Sair; à direita os jogos em
 * cartões (com quantas pessoas estão em cada um) ou os atalhos para mudar.
 */
export function GameMenu({
  tab: initialTab = 'games',
  zone,
  counts,
  place,
  onResume,
  onClose,
  onPick,
  onLeave,
  onHowTo,
  match,
}: {
  tab?: MenuTab;
  /** Como jogar: refaz o tutorial do jogo atual e volta ao jogo */
  onHowTo?: () => void;
  /** aba "Esta partida" (ações da partida da arena ou do x1); null = sem partida aqui */
  match?: ReactNode;
  /** Esc: fecha o menu sem prender o mouse (o navegador não deixa prender sem um clique) */
  onClose: () => void;
  zone: number;
  /** pessoas em cada jogo agora (zona → quantidade, contando comigo) */
  counts: Record<number, number>;
  /** nome do lugar (tema da sala) */
  place: string;
  onResume: () => void;
  onPick: (zone: number) => void;
  onLeave: () => void;
}) {
  const [tab, setTab] = useState<MenuTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const here = GAMES.find((g) => g.zone === zone) ?? GAMES[0]!;
  const nav: { id: 'resume' | MenuTab | 'leave' | 'howto'; icon: IconName; label: string }[] = [
    { id: 'resume', icon: 'play', label: 'Continuar' },
    ...(match ? [{ id: 'match' as const, icon: 'trophy' as const, label: 'Esta partida' }] : []),
    ...(onHowTo ? [{ id: 'howto' as const, icon: 'refresh' as const, label: 'Como jogar' }] : []),
    { id: 'games', icon: 'gamepad', label: 'Jogos' },
    { id: 'keys', icon: 'keyboard', label: 'Comandos' },
    { id: 'leave', icon: 'logout', label: 'Sair do espaço' },
  ];
  const shown: MenuTab = tab === 'match' && !match ? 'games' : tab;

  // Esc fecha; Tab fica preso dentro do menu (é um diálogo modal)
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      uiSound('uiBack');
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !el.hasAttribute('disabled'));
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  // setas para cima/baixo andam pelo menu da esquerda
  const onNavKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    next?.focus();
    uiSound('uiMove');
    e.preventDefault();
  };

  return (
    <div className="gm" role="dialog" aria-modal="true" aria-label="Menu do jogo" onKeyDown={onKey}>
      <aside className="gm-side">
        <div className="gm-brand">
          <span className="gm-paused">
            <Icon name="pause" size={14} /> Menu — a partida continua
          </span>
          <strong>Espaço 3D</strong>
          <span className="gm-where">
            <span className="gm-dot" style={{ background: here.hue }} />
            {here.title} · {place}
          </span>
        </div>
        <nav className="gm-nav" onKeyDown={onNavKey}>
          {nav.map((n) => (
            <button
              key={n.id}
              className="gm-navbtn"
              data-kind={n.id}
              aria-current={shown === n.id ? 'page' : undefined}
              autoFocus={n.id === 'resume'}
              onClick={() => {
                uiSound(n.id === 'leave' ? 'uiBack' : 'uiOk');
                if (n.id === 'resume') onResume();
                else if (n.id === 'leave') onLeave();
                else if (n.id === 'howto') onHowTo?.();
                else setTab(n.id);
              }}
            >
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <p className="gm-foot">
          <Keys keys={['↑', '↓']} /> navegar · <Keys keys={['Enter']} /> escolher · <Keys keys={['Esc']} /> fechar
        </p>
      </aside>
      <section className="gm-main">
        {shown === 'match' ? (
          match
        ) : shown === 'games' ? (
          <>
            <header className="gm-head">
              <h2>Jogos</h2>
              <p>
                Escolha um jogo para ir até ele. Para um x1 no soco, chegue perto de alguém na sala e aperte{' '}
                <Binding action="interact" />.
              </p>
            </header>
            <ul className="gm-grid">
              {GAMES.map((g) => {
                const n = counts[g.zone] ?? 0;
                const cur = g.zone === zone;
                return (
                  <li key={g.zone}>
                    <button
                      className="gm-card"
                      style={{ '--hue': g.hue } as React.CSSProperties}
                      aria-current={cur ? 'true' : undefined}
                      onClick={() => {
                        uiSound('uiOk');
                        if (cur) onResume();
                        else onPick(g.zone);
                      }}
                    >
                      <span className="gm-art" aria-hidden="true">
                        <Icon name={g.icon} size={40} />
                      </span>
                      <span className="gm-card-body">
                        <span className="gm-card-title">{g.title}</span>
                        <span className="gm-card-text">{g.text}</span>
                      </span>
                      <span className="gm-card-foot">
                        <span className="gm-people" data-on={n > 0 ? 'true' : undefined}>
                          <Icon name="users" size={14} /> {n === 0 ? 'Ninguém' : n === 1 ? '1 pessoa' : `${n} pessoas`}
                        </span>
                        <span className="gm-go">{cur ? 'Você está aqui' : g.zone === 0 ? 'Voltar' : 'Jogar'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <KeysPanel />
        )}
      </section>
    </div>
  );
}

/** atalhos: clique em Alterar e aperte a tecla ou o botão do mouse (Esc cancela) */
function KeysPanel() {
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
      {listening && <div className="space3d-capture" aria-hidden="true" />}
      <header className="gm-head">
        <h2>Comandos</h2>
        <p>Clique em Alterar e aperte a tecla ou o botão do mouse que quiser. Fica salvo neste computador.</p>
      </header>
      <ul className="gm-binds">
        {ACTIONS.map((a) => (
          <li key={a} data-listening={listening === a ? 'true' : undefined}>
            <span>{ACTION_LABELS[a]}</span>
            <span className="gm-bind-cur">
              {listening === a ? (
                <span className="gm-listening">Aperte uma tecla ou botão…</span>
              ) : (
                <Binding action={a} />
              )}
            </span>
            <button
              className="gm-btn"
              aria-label={`Alterar: ${ACTION_LABELS[a]} (agora ${codeLabel(map[a])})`}
              onClick={() => {
                uiSound(listening === a ? 'uiBack' : 'uiOk');
                setListening(listening === a ? null : a);
              }}
            >
              {listening === a ? 'Cancelar' : 'Alterar'}
            </button>
          </li>
        ))}
      </ul>
      <div className="gm-row">
        <button className="gm-btn" onClick={() => useBindings.getState().reset()}>
          Restaurar padrão
        </button>
      </div>
      <SoundPanel />
    </>
  );
}

/** "Efeitos do jogo": liga/desliga e volume próprio (salvos neste computador) */
function SoundPanel() {
  const on = useSfxPrefs((p) => p.on);
  const vol = useSfxPrefs((p) => p.vol);
  return (
    <section className="gm-sound" aria-label="Som do jogo">
      <h3>Som</h3>
      <Switch
        checked={on}
        onChange={(v) => {
          useSfxPrefs.getState().setOn(v);
          if (v) uiSound('uiOk');
        }}
        label="Efeitos do jogo"
        description="Bola, apito, motor e menu. Abaixam quando alguém fala. Seguem os Sons das notificações."
      />
      <Slider
        label="Volume dos efeitos"
        value={Math.round(vol * 100)}
        min={0}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        disabled={!on}
        onChange={(v) => useSfxPrefs.getState().setVol(v / 100)}
      />
    </section>
  );
}

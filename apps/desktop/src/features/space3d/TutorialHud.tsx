/**
 * Tutorial jogável e dicas do momento (plano 2026-11-09, P4). Na primeira vez em cada jogo aparece o objetivo em uma
 * frase e os passos, cada um com a tecla escolhida; o passo some quando a pessoa faz a ação (eventos do jogo e da
 * entrada), nunca por tempo. "Pular" fica sempre visível; "Como jogar" no menu refaz. Depois, só uma dica de cada vez.
 * O anúncio para leitor de tela usa a região única do jogo (`useAnnounce`).
 */
import { Icon } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { codeLabel, useBindings, type Action } from './bindings';
import type { GameBus } from './events';
import { Binding, MouseIcon } from './GameHud';
import type { InputBus } from './input';
import { useAnnounce } from './MatchHud';
import {
  advance,
  HintTracker,
  loadLearned,
  saveLearned,
  TUTORIALS,
  tutorialZone,
  type Learned,
  type TutorialHint,
  type TutorialInput,
  type TutorialKey,
  type TutorialStep,
  type TutorialTarget,
} from './tutorial';

/** a dica do momento sai da tela depois disto (é dica, não passo do tutorial) */
export const HINT_MS = 8000;

interface TutorialState {
  learned: Learned;
  /** tutorial em andamento (null = nenhum) */
  active: { key: TutorialKey; step: number } | null;
  /** entra num jogo: começa o tutorial se ainda não foi aprendido (e mantém o passo se já estava nele) */
  enter(key: TutorialKey | null): void;
  /** a pessoa fez um passo (`step` = o próximo); no fim grava como aprendido */
  setStep(step: number): void;
  /** Pular: fecha e conta como aprendido */
  skip(): void;
  /** Como jogar: refaz o tutorial do jogo */
  restart(key: TutorialKey): void;
  /** uma dica apareceu (conta para o limite) */
  hintShown(id: string): void;
  /** painel de comandos aberto ou recolhido (lembrado) */
  togglePanel(): void;
  /** relê o que está salvo (testes) */
  reload(): void;
}

function done(l: Learned, key: TutorialKey): Learned {
  return l.done.includes(key) ? l : { ...l, done: [...l.done, key] };
}

export const useTutorial = create<TutorialState>()((set, get) => ({
  learned: loadLearned(),
  active: null,
  enter(key) {
    const { active, learned } = get();
    if (!key) return set({ active: null });
    if (active?.key === key) return;
    set({ active: learned.done.includes(key) ? null : { key, step: 0 } });
  },
  setStep(step) {
    const a = get().active;
    if (!a || step === a.step) return;
    if (step < TUTORIALS[a.key].steps.length) return set({ active: { ...a, step } });
    const learned = done(get().learned, a.key);
    saveLearned(learned);
    set({ learned, active: null });
  },
  skip() {
    const a = get().active;
    if (!a) return;
    const learned = done(get().learned, a.key);
    saveLearned(learned);
    set({ learned, active: null });
  },
  restart(key) {
    set({ active: { key, step: 0 } });
  },
  hintShown(id) {
    const l = get().learned;
    const learned = { ...l, hints: { ...l.hints, [id]: (l.hints[id] ?? 0) + 1 } };
    saveLearned(learned);
    set({ learned });
  },
  togglePanel() {
    const l = get().learned;
    const learned = { ...l, panel: !l.panel };
    saveLearned(learned);
    set({ learned });
  },
  reload() {
    set({ learned: loadLearned(), active: null });
  },
}));

/** as teclas de um passo ou dica (atalho escolhido, com "segure" e o mouse quando é mirar) */
function StepKeys({
  item,
}: {
  item: Pick<TutorialStep, 'also' | 'hold' | 'mouse'> & { action?: Action; keys?: string };
}) {
  return (
    <span className="space3d-keys space3d-tut-keys">
      {item.mouse && <MouseIcon btn="move" />}
      {item.action ? <Binding action={item.action} {...(item.hold ? { hold: true } : {})} /> : null}
      {item.keys && <kbd>{item.keys}</kbd>}
      {item.also?.map((a) => (
        <Binding key={a} action={a} />
      ))}
    </span>
  );
}

/** texto do passo com a tecla, para o leitor de tela */
function spoken(item: { text: string; action: Action; hold?: boolean }, map: Record<Action, string>) {
  return `${item.text}: ${item.hold ? 'segure ' : ''}${codeLabel(map[item.action])}`;
}

/**
 * Tutorial e dicas do jogo atual. Fica montado (escutando) mesmo com o menu aberto; `hidden` só esconde.
 * `onTarget` diz à cena o que marcar no mundo (anel e seta).
 */
export function TutorialHud({
  game,
  events,
  inputs,
  me,
  team,
  hidden,
  onTarget,
}: {
  game: TutorialKey | null;
  events: GameBus | null;
  inputs: InputBus | null;
  me: string;
  team: 'a' | 'b';
  hidden?: boolean;
  onTarget?: (t: TutorialTarget | null) => void;
}) {
  const active = useTutorial((s) => s.active);
  const map = useBindings((b) => b.map);
  const say = useAnnounce((a) => a.say);
  const [hint, setHint] = useState<TutorialHint | null>(null);

  useEffect(() => useTutorial.getState().enter(game), [game]);

  const tut = active ? TUTORIALS[active.key] : null;
  const step = tut && active ? (tut.steps[active.step] ?? null) : null;

  // dicas só depois do tutorial do jogo (as contagens salvas valem entre visitas)
  const tracker = useMemo(
    () => (game ? new HintTracker(TUTORIALS[game].hints, () => useTutorial.getState().learned.hints) : null),
    [game],
  );
  useEffect(() => setHint(null), [game]);

  const ctx = useRef({ me, team });
  ctx.current = { me, team };

  useEffect(() => {
    if (!game) return;
    const zone = tutorialZone(game);
    const feed = (e: TutorialInput) => {
      if ('zone' in e && e.zone !== zone) return;
      const st = useTutorial.getState();
      const a = st.active;
      if (a && a.key === game) {
        st.setStep(advance(TUTORIALS[game], a.step, e, ctx.current));
        return;
      }
      if (a || !tracker) return;
      const r = tracker.feed(e, ctx.current);
      if (r === 'hide') setHint(null);
      else if (r) {
        st.hintShown(r.id);
        setHint(r);
      }
    };
    const offs = [events?.on(feed), inputs?.on(feed)];
    return () => offs.forEach((off) => off?.());
  }, [game, events, inputs, tracker]);

  // a dica sai sozinha depois de um tempo (o passo do tutorial, não)
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => {
      tracker?.dismiss();
      setHint(null);
    }, HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint, tracker]);

  // o leitor de tela ouve o objetivo e cada passo novo (uma vez)
  const said = useRef('');
  // a tecla trocada no meio do passo não precisa ser anunciada de novo
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    if (!tut || !step || !active) {
      said.current = '';
      return;
    }
    const id = `${active.key}:${active.step}`;
    if (said.current === id) return;
    said.current = id;
    const keys = mapRef.current;
    say(active.step === 0 ? `${tut.objective} ${spoken(step, keys)}` : spoken(step, keys));
  }, [active, tut, step, say]);

  const target = hidden ? null : (step?.alvo ?? null);
  useEffect(() => onTarget?.(target), [target, onTarget]);
  useEffect(() => () => onTarget?.(null), [onTarget]);

  if (hidden || !game) return null;
  if (tut && active && step)
    return (
      <section className="space3d-tut" aria-label={`Como jogar: ${tut.title}`} data-testid="space3d-tutorial">
        <header className="space3d-tut-head">
          <span className="space3d-tut-kicker">Primeira vez · {tut.title}</span>
          <p className="space3d-tut-goal">{tut.objective}</p>
        </header>
        <ol className="space3d-tut-steps">
          {tut.steps.map((s, i) => (
            <li
              key={s.text}
              data-state={i < active.step ? 'done' : i === active.step ? 'now' : 'next'}
              aria-current={i === active.step ? 'step' : undefined}
            >
              <span className="space3d-tut-mark" aria-hidden="true">
                {i < active.step ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="space3d-tut-text">{s.text}</span>
              {i === active.step && <StepKeys item={s} />}
            </li>
          ))}
        </ol>
        <button className="space3d-tut-skip" onClick={() => useTutorial.getState().skip()}>
          Pular tutorial
        </button>
      </section>
    );
  if (hint)
    return (
      <div className="space3d-tip" data-testid="space3d-tip">
        <Icon name="star" size={14} />
        <span>{hint.text}</span>
        <StepKeys item={hint} />
      </div>
    );
  return null;
}

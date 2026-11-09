/**
 * HUD da partida (plano 2026-11-09, P3): placar com o alvo e o selo MATCH POINT, contagem 3-2-1-VAI grande, faixa de
 * ponto com o motivo (evento `score` do ADR-0056), tela de fim com Revanche, aba "Esta partida" do menu e uma região
 * `aria-live` única que só anuncia eventos (ponto, fim, largada) — nunca o cronômetro.
 * Quem manda no placar e na fase é o servidor (`session.scores` / `session.matches`); o evento local só anima.
 * Contra o bot (treino, `bots/store.ts`) o placar, a fase, a corrida e o x1 são os locais, nos mesmos componentes.
 */
import {
  isMatchPoint,
  isMatchZone,
  MATCH_RULES,
  matchPhase,
  matchRuleLabel,
  SPORT_LABELS,
  type MatchPhase,
  type SportZone,
} from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { useSpace } from '../../store/space';
import { useVoice } from '../../store/voice';
import { BOT_LEVEL_LABEL, BOT_LEVELS, type BotLevel } from './bots/level';
import { botMatchPhase, botRuleLabel } from './bots/match';
import { botNameOf, forfeitDuel, useBotPlay } from './bots/store';
import type { GameBus, GameEvent, ScoreReason } from './events';
import { Binding } from './GameHud';
import { countdownSounds, sfx } from './sfx';

type Side = 'a' | 'b';
export const TEAM_NAME: Record<Side, string> = { a: 'Azul', b: 'Vermelho' };

// ---------- região viva única ----------
interface Announce {
  text: string;
  /** muda a cada anúncio (o mesmo texto duas vezes é lido duas vezes) */
  n: number;
  say(text: string): void;
}
export const useAnnounce = create<Announce>()((set, get) => ({
  text: '',
  n: 0,
  say: (text) => set({ text, n: get().n + 1 }),
}));

/** a única região `aria-live` do jogo: ponto, fim, largada e sua vez (o cronômetro fica fora) */
export function LiveRegion() {
  const text = useAnnounce((a) => a.text);
  const n = useAnnounce((a) => a.n);
  return (
    <div className="space3d-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="space3d-live">
      <span key={n}>{text}</span>
    </div>
  );
}

// ---------- faixa de ponto ----------
const REASON_TEXT: Record<ScoreReason, string> = {
  cesta: 'cesta',
  gol: 'gol',
  caçapa: 'caçapa',
  fora: 'bola fora',
  rede: 'bola na rede',
  'dois quiques': 'quicou duas vezes',
  caiu: 'a bola caiu no chão',
  'não passou': 'não passou da rede',
};

/** texto da faixa de ponto (puro): título grande e detalhe com o motivo e quem marcou */
export function scoreBanner(
  e: Pick<Extract<GameEvent, { kind: 'score' }>, 'zone' | 'side' | 'points' | 'reason'>,
  who: string | null,
): { title: string; detail: string } {
  const team = TEAM_NAME[e.side];
  if (e.zone === 1) return { title: `CESTA! +${e.points}`, detail: who ?? `time ${team}` };
  if (e.zone === 2) return { title: `GOL DO ${team.toUpperCase()}!`, detail: who ?? '' };
  if (e.zone === 6) return { title: `CAÇAPA! +${e.points}`, detail: who ? `${who} · ${team}` : `time ${team}` };
  const why = REASON_TEXT[e.reason];
  return { title: `PONTO DO ${team.toUpperCase()}`, detail: who ? `${why} · ${who}` : why };
}

const BANNER_MS = 2200;
const SERVE_MS = 1600;

/** jogos de rede: quem marcou saca (sportplay: `serveSide = call.side`) */
const NET_ZONES = new Set([3, 4, 5]);

/** Faixa central curta a cada ponto ("PONTO DO VERMELHO — bola fora"), seguida de "Saque do X" nos jogos de rede. */
export function PointBanner({ bus, zone }: { bus: GameBus | null; zone: number }) {
  const participants = useVoice((v) => v.participants);
  const nameRef = useRef((id: string | null) =>
    id ? (participants.find((p) => p.identity === id)?.name ?? botNameOf(id)) : null,
  );
  nameRef.current = (id) => (id ? (participants.find((p) => p.identity === id)?.name ?? botNameOf(id)) : null);
  const [shown, setShown] = useState<{ title: string; detail: string; side: Side; serve?: boolean } | null>(null);
  useEffect(() => {
    if (!bus) return;
    const timers: number[] = [];
    const clear = () => timers.splice(0).forEach((t) => window.clearTimeout(t));
    const off = bus.on('score', (e) => {
      if (e.zone !== zone) return;
      clear();
      const b = scoreBanner(e, nameRef.current(e.by));
      setShown({ ...b, side: e.side });
      useAnnounce.getState().say(b.detail ? `${b.title} — ${b.detail}` : b.title);
      timers.push(
        window.setTimeout(() => {
          if (NET_ZONES.has(zone)) {
            setShown({ title: `Saque do ${TEAM_NAME[e.side]}`, detail: '', side: e.side, serve: true });
            timers.push(window.setTimeout(() => setShown(null), SERVE_MS));
          } else setShown(null);
        }, BANNER_MS),
      );
    });
    return () => {
      off();
      clear();
    };
  }, [bus, zone]);
  useEffect(() => setShown(null), [zone]);
  if (!shown) return null;
  return (
    <div
      className="space3d-banner"
      data-team={shown.side}
      data-serve={shown.serve ? 'true' : undefined}
      aria-hidden="true"
    >
      <strong>{shown.title}</strong>
      {shown.detail && <span>{shown.detail}</span>}
    </div>
  );
}

// ---------- contagem ----------
function useTick(on: boolean, ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => tick((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [on, ms]);
}

const GO_MS = 900;

/**
 * Contagem 3-2-1-VAI grande no centro (`goAt` no relógio local). Fora da região viva: anuncia só o VAI. `sound` toca
 * os bipes (a corrida já toca os dela pela cena).
 */
export function BigCountdown({ goAt, sound }: { goAt: number | null; sound?: boolean }) {
  const now = Date.now();
  const live = goAt !== null && now < goAt + GO_MS;
  useTick(live, 100);
  useEffect(() => {
    if (!sound || goAt === null || goAt <= Date.now()) return;
    return countdownSounds(goAt);
  }, [goAt, sound]);
  useEffect(() => {
    if (goAt === null) return;
    const left = goAt - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => useAnnounce.getState().say('Valendo!'), left);
    return () => window.clearTimeout(t);
  }, [goAt]);
  if (!live || goAt === null) return null;
  const n = Math.ceil((goAt - now) / 1000);
  return (
    <div className="space3d-count" aria-hidden="true" data-go={n <= 0 ? 'true' : undefined}>
      <strong key={n}>{n > 0 ? n : 'VAI!'}</strong>
    </div>
  );
}

// ---------- placar ----------
/** fase de agora: a contagem vira jogo no VAI local (o mesmo relógio da contagem grande) */
export function useMatchState(zone: number) {
  const match = useSpace((s) => s.session?.matches?.[String(zone)]);
  const goAt = useSpace((s) => s.matchLocalStart[String(zone)] ?? null);
  const bot = useBotPlay((s) => (s.match?.zone === zone ? s.match : null));
  const counting =
    (match?.phase === 'countdown' && goAt !== null && Date.now() < goAt) ||
    (bot?.phase === 'countdown' && Date.now() < bot.goAt);
  useTick(counting, 250);
  if (bot) {
    // contra o bot: a partida local (o fim vem com o vencedor, como a do servidor)
    const phase = botMatchPhase(bot, Date.now());
    return {
      match: {
        phase: bot.phase,
        startAt: bot.goAt,
        winner: bot.winner ?? undefined,
        endedAt: bot.endedAt ?? undefined,
      },
      phase,
      goAt: bot.phase === 'countdown' ? bot.goAt : null,
    };
  }
  let phase: MatchPhase | null = isMatchZone(zone) && match ? matchPhase(match, Date.now()) : null;
  if (phase === 'playing' && match?.phase === 'countdown' && goAt !== null && Date.now() < goAt) phase = 'countdown';
  return { match, phase, goAt: match?.phase === 'countdown' ? goAt : null };
}

const fmtClock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** "Azul 7 × 5 Vermelho · até 11", selo MATCH POINT e o relógio dos jogos com tempo (fora da região viva) */
/** número do placar que pula quando muda (o primeiro valor não pula; sem animação com "reduzir movimento") */
function ScoreNum({ value }: { value: number }) {
  const [first] = useState(value);
  return (
    <strong key={value} className={value !== first ? 'space3d-score-pop' : undefined}>
      {value}
    </strong>
  );
}

/** placar da zona: o da partida contra o bot, se houver; senão o do servidor */
function useZoneScore(zone: number): { a: number; b: number } {
  const server = useSpace((s) => s.session?.scores?.[String(zone)]);
  const bot = useBotPlay((s) => (s.match?.zone === zone ? s.match.score : null));
  return bot ?? server ?? ZERO;
}
const ZERO = { a: 0, b: 0 };

export function MatchScore({ zone }: { zone: SportZone }) {
  const score = useZoneScore(zone);
  const { phase, goAt } = useMatchState(zone);
  const mz = isMatchZone(zone) ? zone : null;
  const rule = mz ? MATCH_RULES[mz] : null;
  const botGo = useBotPlay((s) => (s.match?.zone === zone ? s.match.goAt : null));
  const serverGo = useSpace((s) => s.matchLocalStart[String(zone)] ?? null);
  const goLocal = botGo ?? serverGo;
  const botRule = botGo !== null ? botRuleLabel(zone) : null;
  const timed = phase === 'playing' && rule?.timeMs != null && goLocal !== null;
  useTick(timed, 1000);
  const elapsed = goLocal !== null ? Math.max(0, Date.now() - goLocal) : 0;
  const mp =
    mz && phase === 'playing'
      ? (['a', 'b'] as const).filter((s) => isMatchPoint(mz, score, s, elapsed))
      : ([] as Side[]);
  return (
    <div className="space3d-game-score" aria-label={`Placar: azul ${score.a}, vermelho ${score.b}`}>
      <span className="space3d-team" data-team="a">
        Azul
      </span>
      <ScoreNum value={score.a} />
      <span className="space3d-game-x">×</span>
      <ScoreNum value={score.b} />
      <span className="space3d-team" data-team="b">
        Vermelho
      </span>
      {mz && <span className="space3d-target">· {matchRuleLabel(mz)}</span>}
      {botRule && <span className="space3d-target">· {botRule}</span>}
      {timed && rule?.timeMs != null && (
        <span className="space3d-clock" aria-hidden="true">
          {elapsed >= rule.timeMs ? 'Gol de ouro' : fmtClock(rule.timeMs - elapsed)}
        </span>
      )}
      {mp.map((s) => (
        <span key={s} className="space3d-mp" data-team={s}>
          MATCH POINT
        </span>
      ))}
      {phase === 'countdown' && goAt !== null && <span className="space3d-target">· começando</span>}
    </div>
  );
}

// ---------- fim de partida ----------
/** janela (relógio do servidor, folga para diferença de relógio) em que o fim ainda toca o som */
const END_SOUND_MS = 15_000;

function useNames() {
  const participants = useVoice((v) => v.participants);
  const bot = useBotPlay((s) => s.bot);
  return useMemo(() => {
    const m = new Map(participants.map((p) => [p.identity, p.name]));
    if (bot) m.set(bot.id, bot.name);
    return (id: string) => m.get(id) ?? 'alguém';
  }, [participants, bot]);
}

/** Tela de fim: vencedor na cor do time, destaque da arena e Revanche (tecla) / Voltar à sala. */
export function MatchEnd({
  zone,
  onRematch,
  onLeave,
}: {
  zone: SportZone;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const { match, phase } = useMatchState(zone);
  const score = useZoneScore(zone);
  const vsBot = useBotPlay((s) => s.match?.zone === zone);
  const server = useSpace((s) => s.session?.board?.[String(zone)]);
  const board = vsBot ? undefined : server;
  const team = useSpace((s) => s.team);
  const nameOf = useNames();
  const winner = phase === 'ended' ? (match?.winner ?? null) : null;
  const top = Object.entries(board ?? {}).sort((a, b) => b[1] - a[1])[0];
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!winner) return;
    const key = `${zone}:${match?.endedAt ?? match?.startAt}`;
    if (said.current === key) return;
    said.current = key;
    // quem chega numa arena com a partida acabada há tempo não ouve vitória/derrota que não viveu
    const fresh = match?.endedAt == null || Date.now() - match.endedAt < END_SOUND_MS;
    if (fresh) sfx.ui(winner === team ? 'win' : 'lose');
    useAnnounce
      .getState()
      .say(
        `Fim de partida: ${TEAM_NAME[winner]} venceu, ${Math.max(score.a, score.b)} a ${Math.min(score.a, score.b)}`,
      );
  }, [winner, zone, match?.endedAt, match?.startAt, score.a, score.b, team]);
  if (!winner) return null;
  return (
    <section className="space3d-end" data-team={winner} aria-label="Fim de partida">
      <span className="space3d-end-kicker">
        {SPORT_LABELS[zone]} · {vsBot ? 'treino contra o bot' : 'fim de partida'}
      </span>
      <strong className="space3d-end-title">{TEAM_NAME[winner]} venceu!</strong>
      <span className="space3d-end-score">
        Azul {score.a} × {score.b} Vermelho
      </span>
      <span className="space3d-end-you">{winner === team ? 'Seu time ganhou' : 'Seu time perdeu'}</span>
      {top && (
        <span className="space3d-end-star">
          <Icon name="star" size={14} /> Destaque: <strong>{nameOf(top[0])}</strong> · {top[1]} pts
        </span>
      )}
      <div className="space3d-end-actions">
        <button className="space3d-gbtn space3d-gbtn-play" onClick={onRematch}>
          <Binding action="rematch" /> Revanche
        </button>
        <button className="space3d-gbtn" onClick={onLeave}>
          <Icon name="home" size={16} /> Voltar à sala
        </button>
      </div>
    </section>
  );
}

// ---------- corrida: pódio e DNF ----------
const fmtRace = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = ((t % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** a corrida que vale para mim: a contra o bot (local) ou a do servidor */
export function useRace() {
  const server = useSpace((s) => s.session?.race ?? null);
  const bot = useBotPlay((s) => s.race);
  return bot ?? server;
}

/** Fim da corrida (para mim ou para todos): pódio dos 3 primeiros, quem não terminou (DNF) e Correr de novo. */
export function RaceEnd({ onAgain }: { onAgain: () => void }) {
  const race = useRace();
  const meId = useData((s) => s.me?.id);
  const nameOf = useNames();
  const mine = race?.results.findIndex((r) => r.userId === meId) ?? -1;
  const dnf = race?.dnf ?? [];
  const over = Boolean(race?.closed);
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!race || mine < 0) return;
    const key = `${race.startAt}:${mine}`;
    if (said.current === key) return;
    said.current = key;
    useAnnounce.getState().say(`Você chegou em ${mine + 1}º`);
  }, [race, mine]);
  if (!race || (mine < 0 && !over)) return null;
  return (
    <section className="space3d-end space3d-end-race" aria-label="Fim da corrida">
      <span className="space3d-end-kicker">Corrida de moto · {over ? 'resultado final' : 'você chegou'}</span>
      <strong className="space3d-end-title">
        {mine >= 0 ? `${mine + 1}º lugar` : dnf.includes(meId ?? '') ? 'Não terminou' : 'Corrida encerrada'}
      </strong>
      <ol className="space3d-podium" aria-label="Pódio">
        {race.results.slice(0, 3).map((r, i) => (
          <li key={r.userId} data-place={i + 1} data-me={r.userId === meId ? 'true' : undefined}>
            <span className="space3d-podium-pos">{i + 1}º</span>
            <span className="truncate">{nameOf(r.userId)}</span>
            <span className="space3d-ptime">{fmtRace(r.ms)}</span>
          </li>
        ))}
      </ol>
      {dnf.length > 0 && (
        <span className="space3d-end-dnf">
          Não terminaram: {dnf.map(nameOf).join(', ')} <span className="space3d-dnf">DNF</span>
        </span>
      )}
      {!over && <span className="space3d-end-you">Esperando os outros chegarem…</span>}
      {over && (
        <div className="space3d-end-actions">
          <button className="space3d-gbtn space3d-gbtn-play" onClick={onAgain}>
            <Binding action="rematch" /> Correr de novo
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- aba "Esta partida" do menu ----------
const OBJECTIVE: Record<SportZone, string> = {
  1: 'Faça a bola passar pela cesta do outro time.',
  2: 'Leve a bola até o gol do outro time.',
  3: 'Rebata por cima da rede para o lado de lá.',
  4: 'Não deixe a bola cair do seu lado da rede.',
  5: 'Rebata para a bolinha quicar do outro lado da mesa.',
  6: 'Encaçape as bolas; quem encaçapa joga de novo.',
  7: 'Três voltas na pista. Quem chegar primeiro vence.',
};

const PHASE_TEXT: Record<MatchPhase, string> = {
  idle: 'Ninguém jogando. Aperte Jogar para começar a contagem.',
  countdown: 'A partida está começando.',
  playing: 'Partida em andamento.',
  ended: 'Partida encerrada.',
};

/**
 * Ações da partida (antes ficavam no HUD, por baixo do menu): Jogar ou Revanche, Trocar de time, Classificação e
 * Zerar (só com a partida parada). Corrida: Jogar / Nova corrida. x1: Desistir.
 */
export function MatchPanel({
  zone,
  onPlay,
  fight,
  others = 0,
  onBot,
}: {
  zone: number;
  onPlay: () => void;
  /** x1 em andamento comigo (na sala) */
  fight?: { duelId: string } | null;
  /** quantas outras pessoas estão nesta zona agora (com gente, não dá para chamar o bot) */
  others?: number;
  /** chama o bot no nível (null = tira o bot) */
  onBot?: (level: BotLevel | null) => void;
}) {
  const team = useSpace((s) => s.team);
  const { phase } = useMatchState(zone);
  const race = useRace();
  const bot = useBotPlay((s) => (s.bot?.zone === zone ? s.bot : null));
  const server = useSpace((s) => s.session?.board?.[String(zone)]);
  const board = bot ? undefined : server;
  const meId = useData((s) => s.me?.id);
  const nameOf = useNames();
  const [showBoard, setShowBoard] = useState(false);

  if (zone === 0) {
    return (
      <>
        <header className="gm-head">
          <h2>Esta partida</h2>
          <p>x1 no soco. Quem zerar a vida do outro primeiro vence.</p>
        </header>
        {fight && (
          <div className="gm-actions">
            <button className="gm-btn gm-btn-danger" onClick={() => forfeitDuel(fight.duelId)}>
              <Icon name="close" size={16} /> Desistir do x1
            </button>
          </div>
        )}
        {onBot && (
          <BotPicker
            title="x1 contra bot"
            bot={bot}
            blocked={fight && !bot ? 'Termine o x1 de agora primeiro.' : null}
            onBot={onBot}
          />
        )}
      </>
    );
  }
  const sz = zone as SportZone;
  const busy = phase === 'countdown' || phase === 'playing';
  const playLabel = zone === 7 ? (race ? 'Nova corrida' : 'Jogar') : phase === 'ended' ? 'Revanche' : 'Jogar';
  const rows = Object.entries(board ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, pts]) => ({ id, pts, name: nameOf(id) }));
  return (
    <>
      <header className="gm-head">
        <h2>Esta partida</h2>
        <p>
          <strong>{SPORT_LABELS[sz]}</strong> · {OBJECTIVE[sz]}
          {isMatchZone(zone) && <> Vence quem fizer {matchRuleLabel(zone)}.</>}
        </p>
        {phase && <p className="gm-phase">{PHASE_TEXT[phase]}</p>}
      </header>
      <div className="gm-actions">
        {busy ? (
          <Tooltip label="A partida já está valendo. Volte ao jogo!">
            <button className="gm-btn gm-btn-play" aria-disabled="true" onClick={(e) => e.preventDefault()}>
              <Icon name="play" size={16} /> Jogando agora
            </button>
          </Tooltip>
        ) : (
          <button className="gm-btn gm-btn-play" onClick={onPlay}>
            <Icon name="play" size={16} /> {playLabel}
            <span className="gm-btn-key">
              <Binding action="rematch" />
            </span>
          </button>
        )}
        {zone !== 7 && !bot && (
          <button
            className="gm-btn"
            data-team={team === 'a' ? 'b' : 'a'}
            onClick={() => useSpace.getState().setTeam(team === 'a' ? 'b' : 'a')}
          >
            <Icon name="users" size={16} /> Trocar de time{' '}
            <span className="muted small">(você está no {TEAM_NAME[team]})</span>
          </button>
        )}
        {zone !== 7 && !bot && (
          <button className="gm-btn" aria-expanded={showBoard} onClick={() => setShowBoard((v) => !v)}>
            <Icon name="trophy" size={16} active={showBoard} /> Classificação
          </button>
        )}
        {zone !== 7 &&
          (busy ? (
            <Tooltip label="Só dá para zerar com a partida parada: espere o fim.">
              <button className="gm-btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>
                <Icon name="refresh" size={16} /> Zerar placar
              </button>
            </Tooltip>
          ) : (
            <button
              className="gm-btn"
              onClick={() => (bot ? useBotPlay.getState().resetScore() : void useSpace.getState().resetScore(zone))}
            >
              <Icon name="refresh" size={16} /> Zerar placar
            </button>
          ))}
      </div>
      {onBot && (
        <BotPicker
          title="Jogar contra bot"
          bot={bot}
          blocked={others > 0 && !bot ? 'Só com a arena vazia: o bot joga só no seu app.' : null}
          onBot={onBot}
        />
      )}
      {showBoard && zone !== 7 && <BoardList rows={rows} meId={meId} />}
      {zone === 7 && race && race.results.length > 0 && (
        <ol className="space3d-board gm-board" aria-label="Chegada">
          {race.results.map((r, i) => (
            <li key={r.userId} data-me={r.userId === meId ? 'true' : undefined}>
              <span className="space3d-board-pos">{i + 1}º</span>
              <span className="truncate">{nameOf(r.userId)}</span>
              <strong>{fmtRace(r.ms)}</strong>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Jogar contra bot: Fácil / Médio / Difícil e Tirar o bot. Treino só no meu app (não conta na classificação); com
 * outras pessoas na arena fica desabilitado com o motivo.
 */
function BotPicker({
  title,
  bot,
  blocked,
  onBot,
}: {
  title: string;
  bot: { level: BotLevel } | null;
  /** por que não dá agora (null = dá) */
  blocked: string | null;
  onBot: (level: BotLevel | null) => void;
}) {
  return (
    <section className="gm-bot" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted small">Treino só no seu app: ninguém mais vê o bot e não conta na classificação.</p>
      <div className="gm-actions" role="group" aria-label="Nível do bot">
        {BOT_LEVELS.map((l) =>
          blocked ? (
            <Tooltip key={l} label={blocked}>
              <button className="gm-btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>
                <Icon name="gamepad" size={16} /> {BOT_LEVEL_LABEL[l]}
              </button>
            </Tooltip>
          ) : (
            <button
              key={l}
              className={bot?.level === l ? 'gm-btn gm-btn-play' : 'gm-btn'}
              aria-pressed={bot?.level === l}
              onClick={() => onBot(l)}
            >
              <Icon name="gamepad" size={16} active={bot?.level === l} /> {BOT_LEVEL_LABEL[l]}
            </button>
          ),
        )}
        {bot && (
          <button className="gm-btn gm-btn-danger" onClick={() => onBot(null)}>
            <Icon name="close" size={16} /> Tirar o bot
          </button>
        )}
      </div>
    </section>
  );
}

function BoardList({ rows, meId }: { rows: { id: string; pts: number; name: string }[]; meId: string | undefined }) {
  return (
    <ol className="space3d-board gm-board" aria-label="Classificação">
      {rows.length === 0 && <li className="space3d-board-empty">Ninguém marcou ainda</li>}
      {rows.map((r, i) => (
        <li key={r.id} data-me={r.id === meId ? 'true' : undefined}>
          <span className="space3d-board-pos">{i + 1}º</span>
          <span className="truncate">{r.name}</span>
          <strong>{r.pts}</strong>
        </li>
      ))}
    </ol>
  );
}

/** Placar segurando Tab (convenção de jogo online): placar, regra e classificação, sem soltar o mouse. */
export function HeldScoreboard({ zone }: { zone: number }) {
  const vsBot = useBotPlay((s) => s.bot?.zone === zone);
  const server = useSpace((s) => s.session?.board?.[String(zone)]);
  const board = vsBot ? undefined : server;
  const race = useRace();
  const meId = useData((s) => s.me?.id);
  const nameOf = useNames();
  let body: ReactNode;
  if (zone === 7) {
    body = (
      <ol className="space3d-board" aria-label="Chegada">
        {(race?.results ?? []).length === 0 && <li className="space3d-board-empty">Ninguém chegou ainda</li>}
        {(race?.results ?? []).map((r, i) => (
          <li key={r.userId} data-me={r.userId === meId ? 'true' : undefined}>
            <span className="space3d-board-pos">{i + 1}º</span>
            <span className="truncate">{nameOf(r.userId)}</span>
            <strong>{fmtRace(r.ms)}</strong>
          </li>
        ))}
      </ol>
    );
  } else {
    const rows = Object.entries(board ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => ({ id, pts, name: nameOf(id) }));
    body = (
      <>
        <MatchScore zone={zone as SportZone} />
        <BoardList rows={rows} meId={meId} />
      </>
    );
  }
  return (
    <section className="space3d-tabboard" aria-label="Placar">
      <span className="space3d-game-title">{SPORT_LABELS[zone as SportZone]} · placar</span>
      {body}
    </section>
  );
}

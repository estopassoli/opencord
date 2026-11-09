/**
 * x1 no soco (ADR-0055): barras de vida, contagem, cronômetro e resultado (todos da chamada veem); convite para mim
 * com Aceitar/Recusar (acima do menu e respondido pelas teclas Interagir/Recusar); para quem luta, os controles e a
 * Revanche. Cronômetro fora da região viva: o resultado vai para o anúncio único (MatchHud). A cena recebe o estado da
 * luta por `useDuelScene`.
 */
import { DUEL_HP, type SpaceDuel } from '@opencord/contracts';
import { Button } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../store/data';
import { useSpace } from '../../store/space';
import { useVoice } from '../../store/voice';
import { normalizeCode, useBindings } from './bindings';
import { Binding } from './GameHud';
import { useAnnounce } from './MatchHud';
import type { SpaceScene } from './scene';
import { countdownSounds, sfx } from './sfx';

const REASON: Record<NonNullable<SpaceDuel['reason']>, string> = {
  ko: 'por nocaute',
  time: 'no tempo',
  forfeit: 'por desistência',
  left: 'porque o outro saiu',
  declined: '',
  expired: '',
};

function useNow(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [on]);
  return Date.now();
}

/** Leva o estado das lutas para a cena: ringues, meu modo luta, golpes que acertaram e nocaute. */
export function useDuelScene(scene: SpaceScene | null) {
  const duels = useSpace((s) => s.duels);
  const meId = useData((s) => s.me?.id);
  const seenHits = useRef(new Set<string>());
  const seenEnd = useRef(new Set<string>());
  useEffect(() => {
    if (!scene) return;
    const list = Object.values(duels);
    scene.setRings(
      list.filter((d) => d.status === 'countdown' || d.status === 'fighting').map((d) => ({ id: d.id, ...d.ring })),
    );
    const mine = list.find(
      (d) => (d.a === meId || d.b === meId) && (d.status === 'countdown' || d.status === 'fighting'),
    );
    scene.setFight(
      mine
        ? {
            duelId: mine.id,
            opponentId: mine.a === meId ? mine.b : mine.a,
            ring: mine.ring,
            phase: mine.status as 'countdown' | 'fighting',
          }
        : null,
    );
    for (const d of list) {
      const h = d.lastHit;
      const key = h ? `${d.id}:${h.at}` : '';
      if (h && !seenHits.current.has(key)) {
        seenHits.current.add(key);
        scene.hit(h.on, h.blocked);
      }
      if (d.status === 'ended' && !seenEnd.current.has(d.id)) {
        seenEnd.current.add(d.id);
        if (d.reason === 'ko' && meId && (d.a === meId || d.b === meId) && d.winner !== meId) scene.knockout();
        // gongo no ringue (quem assiste ouve pela distância); quem lutou ouve vitória ou derrota
        sfx.play('bell', { zone: 0, at: d.ring, gain: 0.8, info: true });
        if (meId && (d.a === meId || d.b === meId) && d.winner) sfx.ui(d.winner === meId ? 'win' : 'lose');
      }
    }
  }, [scene, duels, meId]);
}

/** última luta que terminou comigo dentro (para a Revanche) */
export function lastDuelOf(duels: Record<string, SpaceDuel>, meId: string | undefined): SpaceDuel | undefined {
  return Object.values(duels)
    .filter((d) => d.status === 'ended' && d.reason !== 'declined' && d.reason !== 'expired')
    .filter((d) => d.a === meId || d.b === meId)
    .at(-1);
}

/** a tecla está indo para um campo de texto (chat, busca): não é resposta ao convite */
export function typingIn(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/** Revanche: desafia de novo quem lutou comigo */
export function rematchDuel(meId: string | undefined): boolean {
  const d = lastDuelOf(useSpace.getState().duels, meId);
  if (!d || !meId) return false;
  void useSpace.getState().challenge(d.a === meId ? d.b : d.a);
  return true;
}

export function DuelHud({ aimLocked = false }: { aimLocked?: boolean }) {
  const duels = useSpace((s) => s.duels);
  const offset = useSpace((s) => s.duelOffset);
  const meId = useData((s) => s.me?.id);
  const participants = useVoice((v) => v.participants);
  const nameOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.identity, p.name]));
    return (id: string) => m.get(id) ?? 'alguém';
  }, [participants]);
  const list = Object.values(duels);
  const live = list.find((d) => d.status === 'countdown' || d.status === 'fighting');
  const ended = list.filter((d) => d.status === 'ended' && d.reason !== 'declined' && d.reason !== 'expired').at(-1);
  const invite = list.find((d) => d.status === 'pending' && d.b === meId);
  const waiting = list.find((d) => d.status === 'pending' && d.a === meId);
  const shown = live ?? ended;
  const now = useNow(Boolean(live || invite || waiting)) + offset;

  // contagem do x1 para quem luta: bipe a cada segundo e o "JÁ" mais agudo (relógio do servidor → local)
  const countdownOf = live?.status === 'countdown' && (live.a === meId || live.b === meId) ? live : null;
  const countId = countdownOf?.id ?? null;
  const goAt = countdownOf ? countdownOf.until - offset : null;
  useEffect(() => {
    if (!countId || goAt === null) return;
    return countdownSounds(goAt);
  }, [countId, goAt]);

  // convite e espera respondidos por tecla, mesmo com o menu aberto (o foco pode estar no menu): Interagir aceita,
  // Recusar recusa ou cancela. Na captura, antes da cena, para a mesma tecla não fazer outra coisa.
  const pendingId = invite?.id ?? waiting?.id ?? null;
  const isInvite = Boolean(invite);
  useEffect(() => {
    if (!pendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || document.querySelector('.space3d-capture') || typingIn(e.target)) return;
      const code = normalizeCode(e.code);
      const map = useBindings.getState().map;
      const accept = isInvite && code === map.interact;
      const decline = code === map.decline;
      if (!accept && !decline) return;
      e.preventDefault();
      e.stopPropagation();
      if (isInvite) void useSpace.getState().answerDuel(pendingId, accept);
      else void useSpace.getState().forfeit(pendingId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pendingId, isInvite]);

  // resultado no anúncio único (uma vez por luta)
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!ended || said.current === ended.id || live) return;
    said.current = ended.id;
    useAnnounce
      .getState()
      .say(ended.winner ? `${nameOf(ended.winner)} venceu o x1 ${REASON[ended.reason ?? 'ko']}` : 'x1 empatado');
  }, [ended, live, nameOf]);
  const mineEnded = !live && ended && (ended.a === meId || ended.b === meId) ? ended : null;

  return (
    <>
      {shown && (
        <div className="space3d-duel" role="group" aria-label="x1 no soco">
          <Fighter name={nameOf(shown.a)} hp={shown.hp[shown.a] ?? 0} me={shown.a === meId} />
          <div className="space3d-duel-mid">
            {shown.status === 'countdown' ? (
              <strong className="space3d-duel-count">{Math.max(1, Math.ceil((shown.until - now) / 1000))}</strong>
            ) : shown.status === 'fighting' ? (
              <span className="space3d-duel-time">{Math.max(0, Math.ceil((shown.until - now) / 1000))} s</span>
            ) : (
              <strong className="space3d-duel-result">
                {shown.winner ? `${nameOf(shown.winner)} venceu ${REASON[shown.reason ?? 'ko']}` : 'Empate'}
              </strong>
            )}
            <span className="small">x1 no soco</span>
            {mineEnded && (
              <button className="space3d-gbtn space3d-gbtn-sm" onClick={() => rematchDuel(meId)}>
                <Binding action="rematch" /> Revanche
              </button>
            )}
          </div>
          <Fighter name={nameOf(shown.b)} hp={shown.hp[shown.b] ?? 0} me={shown.b === meId} right />
        </div>
      )}
      {live && (live.a === meId || live.b === meId) && (
        <>
          {/* mira no centro da tela (o cursor fica escondido enquanto a mira está travada) */}
          <div className="space3d-crosshair" aria-hidden="true" data-locked={aimLocked ? 'true' : undefined}>
            <span />
          </div>
        </>
      )}
      {live && (live.a === meId || live.b === meId) && (
        <div className="space3d-duel-help">
          <span className="space3d-duel-keys">
            <Binding action="primary" /> soco · <Binding action="primary" hold /> e solte: soco forte ·{' '}
            <Binding action="secondary" hold /> defender
          </span>
          <Button size="sm" variant="ghost" onClick={() => void useSpace.getState().forfeit(live.id)}>
            Desistir
          </Button>
        </div>
      )}
      {invite && (
        <div className="space3d-invite" role="alertdialog" aria-label="Convite para x1">
          <span>
            <strong>{nameOf(invite.a)}</strong> te desafiou para um x1 no soco
            <span className="muted small"> · {Math.max(0, Math.ceil((invite.until - now) / 1000))} s</span>
          </span>
          <button
            className="space3d-gbtn space3d-gbtn-play"
            onClick={() => void useSpace.getState().answerDuel(invite.id, true)}
          >
            <Binding action="interact" /> Aceitar
          </button>
          <button className="space3d-gbtn" onClick={() => void useSpace.getState().answerDuel(invite.id, false)}>
            <Binding action="decline" /> Recusar
          </button>
        </div>
      )}
      {waiting && !invite && (
        <div className="space3d-invite" role="status">
          <span>
            Esperando <strong>{nameOf(waiting.b)}</strong> aceitar o x1…
          </span>
          <button className="space3d-gbtn" onClick={() => void useSpace.getState().forfeit(waiting.id)}>
            <Binding action="decline" /> Cancelar
          </button>
        </div>
      )}
    </>
  );
}

function Fighter({ name, hp, me, right }: { name: string; hp: number; me: boolean; right?: boolean }) {
  const pct = Math.max(0, Math.min(100, (hp / DUEL_HP) * 100));
  return (
    <div className="space3d-fighter" data-right={right ? 'true' : undefined}>
      <span className="space3d-fighter-name">
        {name}
        {me && <span className="muted small"> (você)</span>}
      </span>
      <div
        className="space3d-hp"
        role="meter"
        aria-label={`Vida de ${name}`}
        aria-valuemin={0}
        aria-valuemax={DUEL_HP}
        aria-valuenow={hp}
      >
        <span style={{ width: `${pct}%` }} data-low={pct <= 30 ? 'true' : undefined} />
      </div>
      <span className="space3d-hp-num">{hp}</span>
    </div>
  );
}

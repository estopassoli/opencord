/**
 * x1 no soco (ADR-0055): barras de vida, contagem, cronômetro e resultado (todos da chamada veem); convite para mim
 * com Aceitar/Recusar; para quem luta, os controles. A cena recebe o estado da luta por `useDuelScene`.
 */
import { DUEL_HP, type SpaceDuel } from '@opencord/contracts';
import { Button } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../store/data';
import { useSpace } from '../../store/space';
import { useVoice } from '../../store/voice';
import type { SpaceScene } from './scene';

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
        scene.hit(h.on);
      }
      if (d.status === 'ended' && !seenEnd.current.has(d.id)) {
        seenEnd.current.add(d.id);
        if (d.reason === 'ko' && meId && (d.a === meId || d.b === meId) && d.winner !== meId) scene.knockout();
      }
    }
  }, [scene, duels, meId]);
}

export function DuelHud() {
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

  return (
    <>
      {shown && (
        <div className="space3d-duel" role="status" aria-live="polite">
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
          </div>
          <Fighter name={nameOf(shown.b)} hp={shown.hp[shown.b] ?? 0} me={shown.b === meId} right />
        </div>
      )}
      {live && (live.a === meId || live.b === meId) && (
        <div className="space3d-duel-help">
          <span>
            <kbd>J</kbd> ou clique: soco · <kbd>K</kbd> ou botão direito: soco forte · segure <kbd>L</kbd>: defender
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
          <Button size="sm" onClick={() => void useSpace.getState().answerDuel(invite.id, true)}>
            Aceitar (F)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void useSpace.getState().answerDuel(invite.id, false)}>
            Recusar
          </Button>
        </div>
      )}
      {waiting && !invite && (
        <div className="space3d-invite" role="status">
          <span>
            Esperando <strong>{nameOf(waiting.b)}</strong> aceitar o x1…
          </span>
          <Button size="sm" variant="ghost" onClick={() => void useSpace.getState().forfeit(waiting.id)}>
            Cancelar
          </Button>
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

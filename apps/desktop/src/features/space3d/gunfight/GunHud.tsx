/**
 * Interface do gunfight: mira (abre com a dispersão; some mirando; ponto na faca), marcador de acerto (branco; vermelho
 * quando mata), luneta das snipers, vida (com a borda vermelha quando está baixa), de onde veio o tiro, munição, lista de
 * abates, placar (Tab), tela de abatido com o renascer e a escolha do equipamento, fim da partida e o painel do menu
 * (equipamento, primeira/terceira pessoa e bots).
 */
import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { BOT_LEVELS, BOT_LEVEL_LABEL, type BotLevel } from '../bots/level';
import { Binding } from '../GameHud';
import { saveLoadout, useGunHud } from './state';
import { CLASS_LABEL, FFA_TARGET, GUNS, SLOT_GUNS, type GunSlot } from './weapons';

/** relógio da tela (a mira e os marcadores somem com o tempo) */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function GunHud() {
  useTick(50);
  const h = useGunHud();
  if (!h.active) return null;
  const now = Date.now();
  const spec = GUNS[h.weapon];
  const knife = spec.cls === 'knife';
  const showLines = !h.dead && !h.scoped && !knife && h.ads < 0.6 && !h.sprint;
  const gap = Math.round(h.spreadPx);
  const hit = now - h.hitAt < 220;
  const lowHp = h.hp < 55;
  const lowAmmo = !knife && h.mag <= Math.ceil(spec.mag * 0.25);
  return (
    <div className="gf-hud" aria-hidden={h.dead ? undefined : 'false'}>
      {lowHp && !h.dead && <div className="gf-vignette" style={{ opacity: Math.min(0.85, (55 - h.hp) / 45) }} />}
      {h.scoped && !h.dead && (
        <div className="gf-scope" aria-hidden>
          <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
            <circle cx="0" cy="0" r="99" fill="none" stroke="#000" strokeWidth="2.5" />
            <line x1="-99" y1="0" x2="-6" y2="0" stroke="#000" strokeWidth="0.8" />
            <line x1="6" y1="0" x2="99" y2="0" stroke="#000" strokeWidth="0.8" />
            <line x1="0" y1="6" x2="0" y2="99" stroke="#000" strokeWidth="0.8" />
            <line x1="0" y1="-99" x2="0" y2="-6" stroke="#000" strokeWidth="0.8" />
            {[-60, -40, -20, 20, 40, 60].map((x) => (
              <line key={x} x1={x} y1="-2.5" x2={x} y2="2.5" stroke="#000" strokeWidth="0.6" />
            ))}
            <circle cx="0" cy="0" r="0.9" fill="#d23" />
          </svg>
        </div>
      )}
      {!h.dead && !h.scoped && (
        <div className="gf-cross" data-ads={h.ads > 0.6 ? 'true' : undefined}>
          {showLines &&
            (['t', 'b', 'l', 'r'] as const).map((s) => (
              <span key={s} className={`gf-line gf-line-${s}`} style={{ ['--gap' as string]: `${gap}px` }} />
            ))}
          <span className="gf-dot" />
          {hit && (
            <span
              className="gf-hit"
              data-kill={h.hitKill ? 'true' : undefined}
              data-head={h.hitHead ? 'true' : undefined}
            >
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}
      {h.hurts
        .filter((d) => now - d.at < 1500)
        .map((d) => (
          <span
            key={d.at}
            className="gf-hurt"
            style={{ transform: `rotate(${(-d.ang * 180) / Math.PI}deg)`, opacity: 1 - (now - d.at) / 1500 }}
          />
        ))}
      <div
        className="gf-health"
        role="meter"
        aria-label="Vida"
        aria-valuenow={h.hp}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="gf-health-bar" style={{ width: `${h.hp}%` }} data-low={lowHp ? 'true' : undefined} />
        <strong>{h.hp}</strong>
      </div>
      <div className="gf-ammo">
        <span className="gf-gun">
          <Icon name={knife ? 'knife' : 'gun'} size={16} /> {spec.name}
        </span>
        {!knife && (
          <span className="gf-count" data-low={lowAmmo ? 'true' : undefined}>
            <strong>{h.mag}</strong> / {h.reserve}
          </span>
        )}
        {h.reloading ? (
          <span className="gf-tip">Recarregando…</span>
        ) : (
          lowAmmo &&
          !knife &&
          h.reserve > 0 && (
            <span className="gf-tip">
              <Binding action="rematch" /> recarregar
            </span>
          )
        )}
      </div>
      <ol className="gf-feed" aria-label="Abates">
        {h.feed
          .filter((f) => now - f.at < 6000)
          .map((f) => (
            <li key={f.id}>
              <span>{f.byName}</span>
              <Icon name={GUNS[f.w].cls === 'knife' ? 'knife' : 'gun'} size={14} />
              {f.head && <Icon name="skull" size={14} />}
              <span>{f.targetName}</span>
            </li>
          ))}
      </ol>
      {h.dead && !h.winner && <DeadPanel />}
      {h.winner && <WinnerPanel />}
    </div>
  );
}

function DeadPanel() {
  const h = useGunHud();
  const left = Math.max(0, Math.ceil((h.respawnAt - Date.now()) / 1000));
  const by = h.scores.find((s) => s.id === h.killedBy)?.name ?? 'alguém';
  return (
    <div className="gf-dead" role="status">
      <Icon name="skull" size={28} />
      <strong>Abatido por {by}</strong>
      <span>Renasce em {left} s</span>
      <LoadoutPicker compact />
    </div>
  );
}

function WinnerPanel() {
  const h = useGunHud();
  return (
    <div className="gf-dead gf-winner" role="status">
      <Icon name="trophy" size={30} />
      <strong>{h.winner === 'Você' ? 'Você venceu!' : `${h.winner} venceu`}</strong>
      <span>Primeiro a {FFA_TARGET} abates.</span>
      <span className="gf-tip">
        <Binding action="rematch" /> ou o menu: jogar de novo
      </span>
    </div>
  );
}

/** placar segurando Tab */
export function GunScoreboard() {
  const rows = useGunHud((s) => s.scores);
  return (
    <div className="gf-board" role="dialog" aria-label="Placar">
      <h3>Todos contra todos · até {FFA_TARGET}</h3>
      <table>
        <thead>
          <tr>
            <th>Jogador</th>
            <th>Abates</th>
            <th>Mortes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-me={r.name === 'Você' ? 'true' : undefined}>
              <td>
                {i + 1}. {r.name}
                {r.bot && <span className="gf-bot-tag">bot</span>}
              </td>
              <td>{r.kills}</td>
              <td>{r.deaths}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SLOT_LABEL: Record<GunSlot, string> = { primary: 'Principal', secondary: 'Pistola', melee: 'Faca' };

/** escolha do equipamento (vale na próxima vez que nascer) */
export function LoadoutPicker({ compact = false }: { compact?: boolean }) {
  const loadout = useGunHud((s) => s.loadout);
  const pick = (slot: GunSlot, id: (typeof SLOT_GUNS)[GunSlot][number]) => {
    const l = { ...loadout, [slot]: id };
    saveLoadout(l);
    useGunHud.getState().set({ loadout: l });
  };
  return (
    <div className="gf-loadout" data-compact={compact ? 'true' : undefined}>
      {(Object.keys(SLOT_GUNS) as GunSlot[]).map((slot) => (
        <fieldset key={slot}>
          <legend>{SLOT_LABEL[slot]}</legend>
          <div className="gf-options">
            {SLOT_GUNS[slot].map((id) => (
              <button
                key={id}
                type="button"
                className="gf-option"
                aria-pressed={loadout[slot] === id}
                onClick={() => pick(slot, id)}
              >
                <span>{GUNS[id].name}</span>
                {!compact && <small>{CLASS_LABEL[GUNS[id].cls]}</small>}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="gf-note">Vale na próxima vez que você nascer.</p>
    </div>
  );
}

/** aba "Esta partida" no gunfight: equipamento, visão e bots de treino */
export function GunMatchPanel({
  others,
  onBots,
  onRestart,
  onView,
}: {
  others: number;
  onBots: (level: BotLevel | null, count: number) => void;
  onRestart: () => void;
  onView: () => void;
}) {
  const bot = useGunHud((s) => s.bot);
  const count = useGunHud((s) => s.botCount);
  const fp = useGunHud((s) => s.firstPerson);
  const blocked = others > 0;
  return (
    <div className="gf-panel">
      <section>
        <h3>Equipamento</h3>
        <LoadoutPicker />
      </section>
      <section>
        <h3>Visão</h3>
        <div className="gf-options">
          <button type="button" className="gf-option" aria-pressed={fp} onClick={() => !fp && onView()}>
            Primeira pessoa
          </button>
          <button type="button" className="gf-option" aria-pressed={!fp} onClick={() => fp && onView()}>
            Terceira pessoa
          </button>
          <span className="gf-note">
            <Binding action="view" /> troca a qualquer hora
          </span>
        </div>
      </section>
      <section>
        <h3>Treino contra bots</h3>
        {blocked ? (
          <p className="gf-note">Só com a arena vazia: os bots jogam só no seu app.</p>
        ) : (
          <>
            <div className="gf-options">
              {BOT_LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className="gf-option"
                  aria-pressed={bot === l}
                  onClick={() => onBots(l, count)}
                >
                  {BOT_LEVEL_LABEL[l]}
                </button>
              ))}
              {bot && (
                <button type="button" className="gf-option" onClick={() => onBots(null, count)}>
                  Tirar os bots
                </button>
              )}
            </div>
            <div className="gf-options" aria-label="Quantos bots">
              {[1, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="gf-option"
                  aria-pressed={count === n}
                  onClick={() => (bot ? onBots(bot, n) : useGunHud.getState().set({ botCount: n }))}
                >
                  {n} {n === 1 ? 'bot' : 'bots'}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      <Button icon="refresh" onClick={onRestart}>
        Recomeçar a partida
      </Button>
    </div>
  );
}

/**
 * Interface do gunfight: mira (abre com a dispersão; some mirando; ponto na faca), marcador de acerto (branco; vermelho
 * quando mata; também por cima da luneta), luneta das snipers (com um escurecer curto na entrada), vida (o número ao
 * lado da barra, com a borda vermelha quando está baixa), de onde veio o tiro, munição, lista de abates, placar (Tab),
 * tela de abatido com o renascer, fim da partida com o placar final e o painel do menu (equipamento, primeira/terceira
 * pessoa e bots). Abates, a própria morte e o vencedor são lidos pela região viva única (`useAnnounce`).
 */
import { Button, Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { BOT_LEVELS, BOT_LEVEL_LABEL, type BotLevel } from '../bots/level';
import { Binding } from '../GameHud';
import { useAnnounce } from '../MatchHud';
import { saveLoadout, useGunHud, type ScoreRow } from './state';
import { CLASS_LABEL, FFA_TARGET, GUNS, SLOT_GUNS, WINNER_MS, type GunSlot } from './weapons';

/** relógio da tela (a mira e os marcadores somem com o tempo) */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/** lê em voz (região viva) os abates que me envolvem, a minha morte e o vencedor — uma vez cada */
function useGunAnnouncements() {
  const feed = useGunHud((s) => s.feed);
  const winner = useGunHud((s) => s.winner);
  const lastFeed = useRef(0);
  useEffect(() => {
    const top = feed[0];
    if (!top || top.id === lastFeed.current) return;
    lastFeed.current = top.id;
    const say = useAnnounce.getState().say;
    if (top.byName === 'Você' && top.targetName !== 'Você') say(`Você abateu ${top.targetName}`);
    else if (top.targetName === 'Você') say(top.byName === 'Você' ? 'Você caiu' : `Abatido por ${top.byName}`);
  }, [feed]);
  useEffect(() => {
    if (winner) useAnnounce.getState().say(winner === 'Você' ? 'Você venceu a partida' : `${winner} venceu a partida`);
  }, [winner]);
}

function HitMarker({ kill, head }: { kill: boolean; head: boolean }) {
  return (
    <span className="gf-hit" data-kill={kill ? 'true' : undefined} data-head={head ? 'true' : undefined}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** retículo da luneta: linhas pretas com um halo claro (lê em fundo escuro e claro) */
function ScopeReticle() {
  const lines: [number, number, number, number][] = [
    [-99, 0, -6, 0],
    [6, 0, 99, 0],
    [0, 6, 0, 99],
    [0, -99, 0, -6],
  ];
  const ticks = [-60, -40, -20, 20, 40, 60];
  return (
    <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
      <circle cx="0" cy="0" r="99" fill="none" stroke="#000" strokeWidth="2.5" />
      {(['halo', 'ink'] as const).map((k) => (
        <g key={k} stroke={k === 'halo' ? 'rgb(255 255 255 / 0.55)' : '#000'}>
          {lines.map(([x1, y1, x2, y2]) => (
            <line key={`${x1}:${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={k === 'halo' ? 1.8 : 0.8} />
          ))}
          {ticks.map((x) => (
            <line key={x} x1={x} y1="-2.5" x2={x} y2="2.5" strokeWidth={k === 'halo' ? 1.5 : 0.6} />
          ))}
        </g>
      ))}
      <circle cx="0" cy="0" r="0.9" fill="#d23" />
    </svg>
  );
}

export function GunHud() {
  useTick(50);
  useGunAnnouncements();
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
    <div className="gf-hud">
      {lowHp && !h.dead && <div className="gf-vignette" style={{ opacity: Math.min(0.85, (55 - h.hp) / 45) }} />}
      {h.scoped && !h.dead && (
        <div className="gf-scope" aria-hidden="true">
          {/* escurecer curto ao encostar o olho na luneta (a arma some no mesmo quadro) */}
          <div key={h.scopeAt} className="gf-scope-fade" />
          <ScopeReticle />
        </div>
      )}
      {!h.dead && (
        <div className="gf-cross" data-ads={h.ads > 0.6 ? 'true' : undefined} aria-hidden="true">
          {!h.scoped &&
            showLines &&
            (['t', 'b', 'l', 'r'] as const).map((s) => (
              <span key={s} className={`gf-line gf-line-${s}`} style={{ ['--gap' as string]: `${gap}px` }} />
            ))}
          {!h.scoped && <span className="gf-dot" />}
          {hit && <HitMarker kill={h.hitKill} head={h.hitHead} />}
        </div>
      )}
      {h.hurts
        .filter((d) => now - d.at < 1500)
        .map((d) => (
          <span
            key={d.at}
            className="gf-hurt"
            aria-hidden="true"
            style={{ transform: `rotate(${(-d.ang * 180) / Math.PI}deg)`, opacity: 1 - (now - d.at) / 1500 }}
          />
        ))}
      <div className="gf-health">
        <Icon name="heart" size={16} />
        <div
          className="gf-health-track"
          role="meter"
          aria-label="Vida"
          aria-valuenow={h.hp}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="gf-health-bar" style={{ width: `${h.hp}%` }} data-low={lowHp ? 'true' : undefined} />
        </div>
        <strong data-low={lowHp ? 'true' : undefined}>{h.hp}</strong>
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
        ) : !knife && h.mag === 0 && h.reserve === 0 ? (
          <span className="gf-tip">
            Sem munição · <kbd>2</kbd> pistola · <kbd>3</kbd> faca
          </span>
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
              {f.by !== f.target && <Icon name={GUNS[f.w].cls === 'knife' ? 'knife' : 'gun'} size={14} />}
              {f.head && <Icon name="skull" size={14} />}
              <span>{f.by === f.target ? 'caiu' : f.targetName}</span>
            </li>
          ))}
      </ol>
      {h.dead && !h.winner && <DeadPanel />}
      {h.winner && <WinnerPanel />}
    </div>
  );
}

/** o equipamento escolhido, em uma linha */
function loadoutText(l: { primary: string; secondary: string; melee: string }) {
  return [l.primary, l.secondary, l.melee].map((id) => GUNS[id as keyof typeof GUNS].name).join(' · ');
}

/** abatido: quem matou e quando renasce (o mouse continua preso: trocar o equipamento é pelo Esc) */
function DeadPanel() {
  const h = useGunHud();
  const left = Math.max(0, Math.ceil((h.respawnAt - Date.now()) / 1000));
  const by = h.scores.find((s) => s.id === h.killedBy)?.name ?? 'alguém';
  return (
    <div className="gf-dead">
      <Icon name="skull" size={28} />
      <strong>{h.killedBy && by === 'Você' ? 'Você caiu' : `Abatido por ${by}`}</strong>
      <span aria-hidden="true">Renasce em {left} s</span>
      <span className="gf-note">
        {loadoutText(h.loadout)} · <kbd>Esc</kbd> troca o equipamento
      </span>
    </div>
  );
}

/** fim da partida: o vencedor, o placar final e como jogar de novo */
function WinnerPanel() {
  const h = useGunHud();
  const left = Math.max(0, Math.ceil((h.winnerAt + WINNER_MS - Date.now()) / 1000));
  return (
    <div className="gf-dead gf-winner">
      <Icon name="trophy" size={30} />
      <strong>{h.winner === 'Você' ? 'Você venceu!' : `${h.winner} venceu`}</strong>
      <span>Primeiro a {FFA_TARGET} abates.</span>
      <ScoreTable rows={h.scores.slice(0, 5)} />
      <span className="gf-tip">
        <Binding action="rematch" /> jogar de novo · recomeça sozinho em <span aria-hidden="true">{left} s</span>
      </span>
    </div>
  );
}

function ScoreTable({ rows }: { rows: ScoreRow[] }) {
  const level = useGunHud((s) => s.bot);
  return (
    <table className="gf-score">
      <thead>
        <tr>
          <th>Jogador</th>
          <th>Abates</th>
          <th>Mortes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} data-me={r.me ? 'true' : undefined}>
            <td>
              {i + 1}. {r.name}
              {r.bot && <span className="gf-bot-tag">bot{level ? ` · ${BOT_LEVEL_LABEL[level]}` : ''}</span>}
            </td>
            <td>{r.kills}</td>
            <td>{r.deaths}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** placar segurando Tab */
export function GunScoreboard() {
  const rows = useGunHud((s) => s.scores);
  return (
    <div className="gf-board" role="dialog" aria-label="Placar">
      <h3>Todos contra todos · até {FFA_TARGET}</h3>
      <ScoreTable rows={rows} />
    </div>
  );
}

const SLOT_LABEL: Record<GunSlot, string> = { primary: 'Principal', secondary: 'Pistola', melee: 'Faca' };

/** escolha do equipamento (vale na próxima vez que nascer) */
export function LoadoutPicker() {
  const loadout = useGunHud((s) => s.loadout);
  const pick = (slot: GunSlot, id: (typeof SLOT_GUNS)[GunSlot][number]) => {
    const l = { ...loadout, [slot]: id };
    saveLoadout(l);
    useGunHud.getState().set({ loadout: l });
  };
  return (
    <div className="gf-loadout">
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
                <small>{CLASS_LABEL[GUNS[id].cls]}</small>
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="gf-note">Vale na próxima vez que você nascer.</p>
    </div>
  );
}

/** aba "Esta partida" no gunfight: objetivo, equipamento, visão e bots de treino */
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
  const canRestart = useGunHud((s) => s.canRestart);
  const blocked = others > 0;
  return (
    <div className="gf-panel">
      <header className="gm-head">
        <h2>Esta partida</h2>
        <p>
          <strong>Gunfight</strong> · todos contra todos. Vence quem fizer {FFA_TARGET} abates primeiro.
        </p>
      </header>
      <section>
        <h3>Equipamento</h3>
        <LoadoutPicker />
      </section>
      <section>
        <h3 id="gf-view">Visão</h3>
        <div className="gf-options" role="group" aria-labelledby="gf-view">
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
        <h3 id="gf-bots">Treino contra bots</h3>
        {blocked && <p className="gf-note">Só com a arena vazia: os bots jogam só no seu app.</p>}
        <div className="gf-options" role="group" aria-labelledby="gf-bots">
          {!blocked &&
            BOT_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className="gf-option"
                aria-pressed={bot === l}
                // o nível que já está valendo não recomeça o treino (o número de bots muda pelos botões abaixo)
                onClick={() => bot !== l && onBots(l, count)}
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
        {!blocked && (
          <div className="gf-options" role="group" aria-label="Quantos bots">
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
        )}
      </section>
      {/* com gente na arena, só quando o jogo deixa (no meio da partida com abates, zeraria o placar de todos) */}
      {canRestart && (
        <Button icon="refresh" onClick={onRestart}>
          {blocked ? 'Recomeçar a partida para todos' : 'Recomeçar a partida'}
        </Button>
      )}
      {/* atribuição exigida pela licença CC-BY 4.0 do pacote de armas (ver assets/guns/CREDITS.md) */}
      <p className="gf-note">
        Modelos de armas: Ultimate Low Poly Guns, de TastyTony e Pichuliru (CC-BY 4.0), adaptados.
      </p>
    </div>
  );
}

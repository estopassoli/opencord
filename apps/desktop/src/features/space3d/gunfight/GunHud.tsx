/**
 * Interface do gunfight: mira (abre com a dispersão; some mirando; ponto na faca), marcador de acerto (branco; vermelho
 * quando mata; também por cima da luneta), luneta das snipers (com um escurecer curto na entrada), vida (o número ao
 * lado da barra, com a borda vermelha quando está baixa), de onde veio o tiro, munição, lista de abates, placar (Tab),
 * vigor da corrida (barra fina só quando não está cheio), tela de abatido com o renascer, fim da partida com o placar
 * final e o painel do menu (equipamento, sensibilidade do mouse, primeira/terceira pessoa e bots). Abates, a própria morte e o vencedor são lidos pela região viva única (`useAnnounce`).
 */
import { Button, Icon, Slider } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { BOT_LEVELS, BOT_LEVEL_LABEL, type BotLevel } from '../bots/level';
import { Binding } from '../GameHud';
import { useAnnounce } from '../MatchHud';
import { ADS_SENS_RANGE, SENS_RANGE, saveAim, type AimSettings } from './aim';
import { MOVE } from './movement';
import { LoadoutCards, LoadoutEditor, type LoadoutView } from './Loadout';
import { releasePreviews } from './preview';
import { useGunHud, type ScoreRow } from './state';
import { GUNS, WINNER_MS, type ScopeStyle } from './weapons';

/** m:ss */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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

/** linhas do retículo (x1, y1, x2, y2), num quadro de −100 a 100 */
type Seg = [number, number, number, number];

/** desenha as linhas duas vezes: um halo claro largo e a tinta preta fina (lê em fundo escuro e claro) */
function Ink({ lines, w = 0.8 }: { lines: Seg[]; w?: number }) {
  return (
    <>
      {(['halo', 'ink'] as const).map((k) => (
        <g key={k} stroke={k === 'halo' ? 'rgb(255 255 255 / 0.55)' : '#000'} strokeLinecap="butt">
          {lines.map(([x1, y1, x2, y2]) => (
            <line
              key={`${x1}:${y1}:${x2}:${y2}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={k === 'halo' ? w + 1 : w}
            />
          ))}
        </g>
      ))}
    </>
  );
}

/**
 * Retículo da luneta de cada estilo: sniper (cruz fina com marcas e o ponto vermelho), variável (cruz grossa nas
 * pontas e fina no meio, com o ponto aceso), prisma 3x da luneta dos fuzis (chevron aceso com as marcas de queda
 * embaixo) e poste da luneta clássica (poste grosso de baixo e as duas barras dos lados).
 */
function ScopeReticle({ style }: { style: ScopeStyle }) {
  const ring = <circle cx="0" cy="0" r="99" fill="none" stroke="#000" strokeWidth="2.5" />;
  if (style === 'post')
    return (
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        {ring}
        <Ink
          lines={[
            [-99, 0, -12, 0],
            [12, 0, 99, 0],
          ]}
          w={3}
        />
        <path
          d="M -2.6 99 L -2.6 4 L 0 0 L 2.6 4 L 2.6 99 Z"
          fill="#000"
          stroke="rgb(255 255 255 / 0.5)"
          strokeWidth="0.8"
        />
      </svg>
    );
  if (style === 'prism')
    return (
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        {ring}
        <Ink
          lines={[
            [0, 14, 0, 70],
            [-6, 26, 6, 26],
            [-4.5, 38, 4.5, 38],
            [-3, 50, 3, 50],
            [-99, 0, -60, 0],
            [60, 0, 99, 0],
          ]}
          w={0.9}
        />
        <path d="M -7 7 L 0 0 L 7 7" fill="none" stroke="rgb(0 0 0 / 0.6)" strokeWidth="3" strokeLinejoin="miter" />
        <path d="M -7 7 L 0 0 L 7 7" fill="none" stroke="#ff3b2f" strokeWidth="1.6" strokeLinejoin="miter" />
        <circle cx="0" cy="0" r="0.9" fill="#ff3b2f" />
      </svg>
    );
  if (style === 'lpvo')
    return (
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        {ring}
        <Ink
          lines={[
            [-99, 0, -30, 0],
            [30, 0, 99, 0],
            [0, 30, 0, 99],
            [0, -99, 0, -30],
          ]}
          w={3}
        />
        <Ink
          lines={[
            [-30, 0, -3, 0],
            [3, 0, 30, 0],
            [0, 3, 0, 30],
            [0, -30, 0, -3],
          ]}
          w={0.7}
        />
        <circle cx="0" cy="0" r="1.3" fill="#ff3b2f" />
      </svg>
    );
  const ticks = [-60, -40, -20, 20, 40, 60];
  return (
    <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
      {ring}
      <Ink
        lines={[
          [-99, 0, -6, 0],
          [6, 0, 99, 0],
          [0, 6, 0, 99],
          [0, -99, 0, -6],
          ...ticks.map((x): Seg => [x, -2.5, x, 2.5]),
        ]}
      />
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
  // na 1ª pessoa, mirando, a mira de ferro faz o papel da cruz; na 3ª não há mira de ferro: a cruz fica (fechada)
  const thirdAds = !h.firstPerson && h.ads >= 0.6;
  const showLines = !h.dead && !h.scoped && !knife && (h.ads < 0.6 || thirdAds) && !h.sprint;
  const gap = Math.round(thirdAds ? Math.min(h.spreadPx, 6) : h.spreadPx);
  const hit = now - h.hitAt < 220;
  const lowHp = h.hp < 55;
  const lowAmmo = !knife && h.mag <= Math.ceil(spec.mag * 0.25);
  return (
    <div className="gf-hud">
      {lowHp && !h.dead && <div className="gf-vignette" style={{ opacity: Math.min(0.85, (55 - h.hp) / 45) }} />}
      {h.scoped && !h.dead && (
        <div
          className="gf-scope"
          aria-hidden="true"
          style={h.scopeKick ? { transform: `translateY(${(-h.scopeKick).toFixed(1)}px)` } : undefined}
        >
          {/* escurecer curto ao encostar o olho na luneta (a arma some no mesmo quadro) */}
          <div key={h.scopeAt} className="gf-scope-fade" />
          <ScopeReticle style={h.scopeStyle} />
        </div>
      )}
      {!h.dead && (
        <div className="gf-cross" data-ads={h.ads > 0.6 && !thirdAds ? 'true' : undefined} aria-hidden="true">
          {!h.scoped &&
            showLines &&
            (['t', 'b', 'l', 'r'] as const).map((s) => (
              <span key={s} className={`gf-line gf-line-${s}`} style={{ ['--gap' as string]: `${gap}px` }} />
            ))}
          {/* mirando em primeira pessoa, só a mira da arma (o ponto some junto com as linhas) */}
          {!h.scoped && (h.ads < 0.6 || thirdAds || knife) && <span className="gf-dot" />}
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
      <TopScore />
      {!h.dead && h.slotsAt > 0 && now - h.slotsAt < 1500 && <SlotList key={h.slotsAt} />}
      {h.shielded && !h.dead && (
        <span className="gf-shield" aria-hidden="true">
          Protegido · atire para sair
        </span>
      )}
      {!h.dead && (
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
      )}
      {!h.dead && h.stamina < 1 && (
        // vigor: discreto, só gastando ou voltando; abaixo do mínimo da tática fica apagado
        <div
          className="gf-stamina"
          role="meter"
          aria-label="Vigor"
          aria-valuenow={Math.round(h.stamina * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            style={{ width: `${Math.round(h.stamina * 100)}%` }}
            data-low={h.stamina < MOVE.tacMin ? 'true' : undefined}
          />
        </div>
      )}
      {!h.dead && (
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
      )}
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

/** no alto ao centro, sem segurar o Tab: o meu placar, o do líder, o alvo e o tempo que falta */
function TopScore() {
  const rows = useGunHud((s) => s.scores);
  const target = useGunHud((s) => s.target);
  const endsAt = useGunHud((s) => s.endsAt);
  const winner = useGunHud((s) => s.winner);
  const me = rows.find((r) => r.me);
  const lead = rows.find((r) => !r.me);
  const left = endsAt - Date.now();
  // o leitor de tela recebe o placar pelo Tab e pelos avisos de abate: isto é só para os olhos
  return (
    <div className="gf-top" aria-hidden="true">
      <span data-me="true">
        Você <b>{me?.kills ?? 0}</b>
      </span>
      {lead && (
        <span>
          {lead.name} <b>{lead.kills}</b>
        </span>
      )}
      <span>até {target}</span>
      {!winner && endsAt > 0 && (
        <span className="gf-clock" data-low={left < 60000 ? 'true' : undefined}>
          {clock(left)}
        </span>
      )}
    </div>
  );
}

/** trocou de arma: o que há em 1, 2 e 3 (a da mão em destaque), por um instante */
function SlotList() {
  const loadout = useGunHud((s) => s.loadout);
  const slot = useGunHud((s) => s.slot);
  return (
    <div className="gf-slots" aria-hidden="true">
      {(['primary', 'secondary', 'melee'] as const).map((sl, i) => (
        <span key={sl} data-on={sl === slot ? 'true' : undefined}>
          <kbd>{i + 1}</kbd>
          {GUNS[loadout[sl]].name}
        </span>
      ))}
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
  const self = !!h.killedBy && by === 'Você';
  // com que arma e se foi na cabeça (ajuda a entender de onde e como veio)
  const how = [h.killedW ? GUNS[h.killedW].name : null, h.killedHead ? 'na cabeça' : null].filter(Boolean);
  return (
    <div className="gf-dead">
      <Icon name="skull" size={28} />
      <strong>{self ? 'Você caiu' : `Abatido por ${by}`}</strong>
      {!self && how.length > 0 && <span>{how.join(' · ')}</span>}
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
  const top = h.scores[0]?.kills ?? 0;
  return (
    <div className="gf-dead gf-winner">
      <Icon name="trophy" size={30} />
      <strong>{h.winner === 'Você' ? 'Você venceu!' : `${h.winner} venceu`}</strong>
      <span>{top >= h.target ? `Primeiro a ${h.target} abates.` : 'Mais abates quando o tempo acabou.'}</span>
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
  const target = useGunHud((s) => s.target);
  const endsAt = useGunHud((s) => s.endsAt);
  return (
    <div className="gf-board" role="dialog" aria-label="Placar">
      <h3>
        Todos contra todos · até {target} · {clock(endsAt - Date.now())}
      </h3>
      <ScoreTable rows={rows} />
    </div>
  );
}

/** pt-BR: vírgula decimal */
const dec = (v: number, n: number) => v.toFixed(n).replace('.', ',');

/** sensibilidade do mouse (graus por contagem, igual em qualquer FPS e janela) e o multiplicador mirando */
function AimSettingsPanel() {
  const aim = useGunHud((s) => s.aim);
  const raw = useGunHud((s) => s.rawMouse);
  const put = (p: Partial<AimSettings>) => {
    const a = { ...aim, ...p };
    saveAim(a);
    useGunHud.getState().set({ aim: a });
  };
  return (
    <div className="gf-aim">
      <Slider
        label="Sensibilidade do mouse"
        hint="Na escala dos jogos de tiro: 1 = 0,022° por contagem do mouse."
        {...SENS_RANGE}
        value={aim.sens}
        format={(v) => dec(v, 1)}
        onChange={(v) => put({ sens: Math.round(v * 10) / 10 })}
      />
      <Slider
        label="Sensibilidade mirando"
        hint="Multiplica a sensibilidade com a mira (além da queda pelo zoom)."
        {...ADS_SENS_RANGE}
        value={aim.adsSens}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => put({ adsSens: Math.round(v * 100) / 100 })}
      />
      <p className="gf-note">
        {raw === true
          ? 'Entrada direta do mouse ativa: sem a aceleração do sistema.'
          : raw === false
            ? 'Este sistema não oferece a entrada direta do mouse: o movimento vem com a aceleração do sistema.'
            : 'A entrada direta do mouse liga quando o mouse fica preso no jogo.'}
      </p>
    </div>
  );
}

/** aba "Esta partida" no gunfight: objetivo, equipamento, mouse, visão e bots de treino */
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
  const target = useGunHud((s) => s.target);
  const [view, setView] = useState<LoadoutView>({ kind: 'home' });
  // as imagens das armas usam um renderizador só do menu: sai junto com ele
  useEffect(() => () => releasePreviews(), []);
  const blocked = others > 0;
  // trocar arma e personalizar ocupam a aba inteira (Esc volta uma tela)
  if (view.kind !== 'home') return <LoadoutEditor view={view} onView={setView} />;
  return (
    <div className="gf-panel">
      <header className="gm-head">
        <h2>Esta partida</h2>
        <p>
          <strong>Gunfight</strong> · todos contra todos. Vence quem chegar a {target} abates primeiro, ou quem tiver
          mais quando os 8 minutos acabarem. Com mais gente, o alvo sobe (até 25).
        </p>
      </header>
      <section aria-labelledby="gf-loadout">
        <h3 id="gf-loadout">Equipamento</h3>
        <LoadoutCards onOpen={setView} />
      </section>
      <div className="gf-settings">
        <section aria-labelledby="gf-mouse">
          <h3 id="gf-mouse">Mouse</h3>
          <AimSettingsPanel />
        </section>
        <div className="gf-settings-col">
          <section aria-labelledby="gf-view">
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
        </div>
      </div>
      {/* com gente na arena, só quando o jogo deixa (no meio da partida com abates, zeraria o placar de todos) */}
      {canRestart && (
        <Button icon="refresh" className="gf-restart" onClick={onRestart}>
          {blocked ? 'Recomeçar a partida para todos' : 'Recomeçar a partida'}
        </Button>
      )}
      {/* atribuição exigida pela licença CC-BY 4.0 dos modelos de armas (ver assets/guns/CREDITS.md) */}
      <p className="gf-note">
        Modelos de armas: Ultimate Low Poly Guns, de TastyTony e Pichuliru, e modelos Low Poly de TastyTony no Sketchfab
        (CC-BY 4.0), adaptados.
      </p>
    </div>
  );
}

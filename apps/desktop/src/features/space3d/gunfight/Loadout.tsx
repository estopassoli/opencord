/**
 * Equipamento e armeiro do gunfight (menu do Esc, aba "Esta partida"). Três telas, sem sair do menu:
 * - cartões das três armas (principal, pistola e faca) com a imagem da arma montada, as barras de atributos e os
 *   acessórios; "Trocar" abre a lista e "Personalizar" abre o armeiro;
 * - lista das armas do espaço (por classe), com a arma em foco em destaque e as barras comparadas com a que está em
 *   uso; escolher equipa e abre o armeiro;
 * - armeiro: os encaixes da arma (mira, boca, sob o cano, carregador) em abas, as opções de cada um com os prós e os
 *   contras, e a imagem e as barras mudando com a opção em foco (antes de escolher).
 * Teclado: setas andam entre os itens, Enter escolhe, Esc volta uma tela (no começo, fecha o menu). As imagens são o
 * modelo 3D de verdade desenhado uma vez (`preview.ts`).
 */
import type { GunId } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { uiSound } from '../GameHud';
import {
  ATTACHMENTS,
  ATT_SLOT_LABEL,
  applyAttachments,
  attachmentEffects,
  attachmentsFor,
  buildFromKey,
  buildKey,
  defaultLabel,
  gunStats,
  slotsFor,
  STAT_HINT,
  STAT_KEYS,
  STAT_LABEL,
  STAT_SHORT,
  type AttId,
  type AttSlot,
  type GunBuild,
  type GunStats,
} from './attachments';
import { cachedPreview, gunPreview } from './preview';
import { saveLoadout, useGunHud } from './state';
import { CLASS_LABEL, GUNS, SLOT_GUNS, type GunClass, type GunSlot, type GunSpec } from './weapons';

export const SLOT_LABEL: Record<GunSlot, string> = { primary: 'Principal', secondary: 'Pistola', melee: 'Faca' };
const SLOTS: GunSlot[] = ['primary', 'secondary', 'melee'];

/** uma linha sobre cada arma (o jeito dela; os números ficam nas barras) */
const BLURB: Record<GunId, string> = {
  m4: 'Fuzil rápido e controlável: sobe pouco e reto, serve em qualquer distância.',
  ak47: 'Bate mais forte que o M4, mas o recuo desenha um S e pede controle.',
  mp7: 'A mais rápida de todas: derrete de perto e perde muito dano de longe.',
  mp5: 'Submetralhadora macia e precisa, um pouco mais lenta que a MP7.',
  l115: 'Sniper ágil: um tiro no peito derruba, e mira mais rápido que a M200.',
  m200: 'A sniper mais pesada: mais zoom, mais dano e pente de 7, mas lenta.',
  kar98k: 'Ferrolho rápido e mira de ferro: só derruba de um tiro na cabeça.',
  m9: 'Pistola leve e rápida, de 15 balas: boa para fechar a luta.',
  deagle: 'Pistola pesada: dois tiros derrubam, mas o cano sobe muito.',
  scarl: 'Fuzil de calibre cheio no meio do caminho: bate mais que o M4 e sobe menos que a AK.',
  mcx: 'Fuzil leve com ponto vermelho e empunhadura de fábrica: dispara rápido e sobe pouco.',
  aks74u: 'Carabina curta e ágil: mira e anda como submetralhadora, mas o dano cai cedo.',
  stg44: 'O avô dos fuzis de assalto: lenta e pesada, cada tiro bate forte e alcança longe.',
  mpx: 'A submetralhadora mais estável: sobe pouco e reto, fácil de manter no alvo.',
  msmc: 'Pente no punho e cadência alta, com ponto vermelho de fábrica: de perto, ninguém atira mais rápido.',
  pdw: 'Cartucho mais forte que o das outras submetralhadoras: segura o dano mais longe.',
  rs9: 'Sniper de precisão alemã: um tiro no peito derruba, equilíbrio entre a L115 e a M200.',
  ballista: 'Sniper pesada de pente de 8: dano e alcance de sobra, mas demora a mirar.',
  sv98: 'Sniper leve e de zoom menor: mira rápido e o ferrolho volta logo, mas de longe não derruba no peito.',
  automag3: 'Pistola de cano longo e cartucho de carabina: alcança mais que as outras pistolas.',
  rhino: 'Revólver de cano baixo: o coice quase não tira a mira do lugar.',
  bfr: 'Revólver gigante de .45-70: o tiro mais forte das pistolas, mas sobe demais e recarrega devagar.',
  karambit: 'Lâmina curva presa na argola: golpe rápido, e o pesado derruba.',
  bayonet: 'Lâmina reta: alcança um pouco mais, golpe um pouco mais lento.',
  balisong: 'Faca borboleta: abre girando na mão; a mais leve e rápida, de alcance curto.',
  kabar: 'Faca de combate clássica: equilibrada em alcance e velocidade.',
  bowie: 'Lâmina longa de ponta recortada: alcança mais, golpe um pouco mais lento.',
  kukri: 'Lâmina pesada e curva: o maior alcance e o golpe leve mais forte, mas a mais lenta.',
};

/** a próxima tela do equipamento */
export type LoadoutView =
  { kind: 'home' } | { kind: 'list'; slot: GunSlot } | { kind: 'smith'; slot: GunSlot; gun: GunId };

/** pt-BR: vírgula decimal */
const dec = (v: number, n = 1) =>
  (Math.round(v * 10 ** n) / 10 ** n)
    .toFixed(n)
    .replace(/\.?0+$/, '')
    .replace('.', ',');

/** salva e publica o equipamento e as montagens */
function commit(p: {
  loadout?: ReturnType<typeof useGunHud.getState>['loadout'];
  builds?: ReturnType<typeof useGunHud.getState>['builds'];
}) {
  const st = useGunHud.getState();
  const loadout = p.loadout ?? st.loadout;
  const builds = p.builds ?? st.builds;
  saveLoadout(loadout, builds);
  st.set({ loadout, builds });
}

/** setas para cima/baixo (ou para os lados) andam entre os itens do grupo; Home e End vão às pontas */
function arrowNav(e: KeyboardEvent<HTMLElement>, sel: string, axis: 'v' | 'h' | 'both' = 'v') {
  const back = axis === 'h' ? ['ArrowLeft'] : axis === 'v' ? ['ArrowUp'] : ['ArrowUp', 'ArrowLeft'];
  const fwd = axis === 'h' ? ['ArrowRight'] : axis === 'v' ? ['ArrowDown'] : ['ArrowDown', 'ArrowRight'];
  const k = e.key;
  if (![...back, ...fwd, 'Home', 'End'].includes(k)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(sel)];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    k === 'Home'
      ? items[0]
      : k === 'End'
        ? items[items.length - 1]
        : items[(i + (fwd.includes(k) ? 1 : items.length - 1) + (i < 0 ? 1 : 0)) % items.length];
  e.preventDefault();
  if (next && next !== document.activeElement) {
    next.focus();
    uiSound('uiMove');
  }
}

/** a imagem da arma montada (desenhada uma vez; enquanto isso, ou sem WebGL, o ícone) */
function GunImage({ id, build, icon = 32 }: { id: GunId; build?: GunBuild; icon?: number }) {
  const key = buildKey(build);
  const [url, setUrl] = useState<{ key: string; url: string } | null>(() => {
    const hit = cachedPreview(id, build);
    return hit === null ? null : { key: `${id}|${key}`, url: hit };
  });
  useEffect(() => {
    let live = true;
    const b = buildFromKey(key);
    const hit = cachedPreview(id, b);
    if (hit !== null) setUrl({ key: `${id}|${key}`, url: hit });
    else void gunPreview(id, b).then((u) => live && setUrl({ key: `${id}|${key}`, url: u }));
    return () => {
      live = false;
    };
  }, [id, key]);
  // a imagem anterior fica até a nova chegar (sem piscar o ícone a cada troca de acessório)
  if (url?.url) return <img className="gf-gunimg" src={url.url} alt="" draggable={false} />;
  return (
    <span className="gf-gunimg gf-gunimg-icon" aria-hidden="true">
      <Icon name={GUNS[id].cls === 'knife' ? 'knife' : 'gun'} size={icon} />
    </span>
  );
}

/** barras de atributos (0–100), com a diferença para `next` (a opção em foco) em verde ou vermelho e com o sinal */
export function StatBars({ base, next, compact }: { base: GunStats; next?: GunStats; compact?: boolean }) {
  return (
    <ul className="gf-stats" data-compact={compact ? 'true' : undefined}>
      {STAT_KEYS.filter((k) => base[k] !== undefined).map((k) => {
        const v = base[k] ?? 0;
        const n = next?.[k] ?? v;
        const d = n - v;
        const lo = Math.min(v, n);
        return (
          <li key={k}>
            <span className="gf-stat-name">{compact ? STAT_SHORT[k] : STAT_LABEL[k]}</span>
            <span
              className="gf-stat-bar"
              role="meter"
              aria-label={STAT_LABEL[k]}
              aria-description={STAT_HINT[k]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={n}
              aria-valuetext={d ? `${n} de 100, ${d > 0 ? 'mais' : 'menos'} ${Math.abs(d)}` : `${n} de 100`}
            >
              <span className="gf-stat-fill" style={{ width: `${lo}%` }} />
              {d !== 0 && (
                <span
                  className="gf-stat-delta"
                  data-dir={d > 0 ? 'up' : 'down'}
                  style={{ left: `${lo}%`, width: `${Math.abs(d)}%` }}
                />
              )}
            </span>
            {!compact && (
              <span className="gf-stat-val" aria-hidden="true">
                {d !== 0 && <em data-dir={d > 0 ? 'up' : 'down'}>{d > 0 ? `+${d}` : `−${-d}`}</em>}
                {n}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** os acessórios montados, em etiquetas (ou "de fábrica") */
function AttChips({ id, build }: { id: GunId; build?: GunBuild }) {
  const slots = slotsFor(id);
  if (!slots.length) return <span className="gf-chip gf-chip-none">Sem acessórios</span>;
  const on = slots.filter((s) => build?.[s]);
  if (!on.length) return <span className="gf-chip gf-chip-none">De fábrica</span>;
  return (
    <>
      {on.map((s) => (
        <span key={s} className="gf-chip">
          <b>{ATT_SLOT_LABEL[s]}</b> {ATTACHMENTS[build![s]!].name}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- cartões

/** os três cartões do equipamento (na aba "Esta partida") */
export function LoadoutCards({ onOpen }: { onOpen: (v: LoadoutView) => void }) {
  const loadout = useGunHud((s) => s.loadout);
  const builds = useGunHud((s) => s.builds);
  return (
    <>
      <div className="gf-cards" onKeyDown={(e) => arrowNav(e, '.gf-card-main', 'h')}>
        {SLOTS.map((slot, i) => {
          const id = loadout[slot];
          const b = builds[id];
          const spec = applyAttachments(GUNS[id], b);
          const canSmith = slotsFor(id).length > 0;
          return (
            <article key={slot} className="gf-card" data-cls={spec.cls}>
              <button
                type="button"
                className="gf-card-main"
                aria-label={`${SLOT_LABEL[slot]}: ${spec.name}, ${CLASS_LABEL[spec.cls]}. Trocar arma`}
                onClick={() => {
                  uiSound('uiOk');
                  onOpen({ kind: 'list', slot });
                }}
              >
                <span className="gf-card-top">
                  <kbd>{i + 1}</kbd>
                  <span className="gf-card-slot">{SLOT_LABEL[slot]}</span>
                  <span className="gf-card-cls">{CLASS_LABEL[spec.cls]}</span>
                </span>
                <span className="gf-card-stage">
                  <GunImage id={id} build={b} />
                </span>
                <span className="gf-card-name">
                  {spec.name}
                  <span className="gf-card-swap">
                    Trocar <Icon name="chevron-right" size={14} />
                  </span>
                </span>
              </button>
              <StatBars base={gunStats(spec)} compact />
              <div className="gf-card-att">
                <AttChips id={id} build={b} />
              </div>
              {canSmith && (
                <button
                  type="button"
                  className="gf-card-smith"
                  aria-label={`Personalizar ${spec.name}`}
                  onClick={() => {
                    uiSound('uiOk');
                    onOpen({ kind: 'smith', slot, gun: id });
                  }}
                >
                  <Icon name="wrench" size={16} /> Personalizar
                </button>
              )}
            </article>
          );
        })}
      </div>
      <p className="gf-note">O equipamento troca assim que você volta ao jogo, com a munição cheia.</p>
    </>
  );
}

// ---------------------------------------------------------------- telas do editor

/** cabeçalho das telas do editor: voltar, o caminho e o título */
function EdHead({
  crumb,
  title,
  onBack,
  backRef,
  children,
}: {
  crumb: string;
  title: string;
  onBack: () => void;
  backRef?: React.Ref<HTMLButtonElement>;
  children?: ReactNode;
}) {
  return (
    <header className="gf-ed-head">
      <button
        ref={backRef}
        type="button"
        className="gf-back"
        aria-label="Voltar"
        onClick={() => {
          uiSound('uiBack');
          onBack();
        }}
      >
        <Icon name="chevron-left" size={20} />
      </button>
      <div className="gf-ed-title">
        <span className="gf-crumb">{crumb}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}

/** a tela do equipamento que não é a de cartões (lista de armas ou armeiro); Esc volta uma tela */
export function LoadoutEditor({
  view,
  onView,
}: {
  view: Exclude<LoadoutView, { kind: 'home' }>;
  onView: (v: LoadoutView) => void;
}) {
  const back = () => onView(view.kind === 'smith' ? { kind: 'list', slot: view.slot } : { kind: 'home' });
  return (
    <div
      className="gf-editor"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        // Esc volta uma tela (o menu só fecha no começo)
        e.preventDefault();
        e.stopPropagation();
        uiSound('uiBack');
        back();
      }}
    >
      {view.kind === 'list' ? (
        <WeaponList slot={view.slot} onBack={back} onSmith={(gun) => onView({ kind: 'smith', slot: view.slot, gun })} />
      ) : (
        <Gunsmith key={view.gun} gun={view.gun} slot={view.slot} onBack={back} />
      )}
    </div>
  );
}

/** grupos da lista por classe, na ordem do menu */
function groups(slot: GunSlot): { cls: GunClass; ids: GunId[] }[] {
  const out: { cls: GunClass; ids: GunId[] }[] = [];
  for (const id of SLOT_GUNS[slot]) {
    const cls = GUNS[id].cls;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.ids.push(id);
    else out.push({ cls, ids: [id] });
  }
  return out;
}

/** as armas de um espaço do equipamento: a em foco em destaque, comparada com a que está em uso */
function WeaponList({ slot, onBack, onSmith }: { slot: GunSlot; onBack: () => void; onSmith: (g: GunId) => void }) {
  const loadout = useGunHud((s) => s.loadout);
  const builds = useGunHud((s) => s.builds);
  const current = loadout[slot];
  const [focus, setFocus] = useState<GunId>(current);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  const pick = (id: GunId, smith: boolean) => {
    uiSound('uiOk');
    if (id !== current) commit({ loadout: { ...loadout, [slot]: id } });
    if (smith && slotsFor(id).length) onSmith(id);
    else onBack();
  };
  const cur = applyAttachments(GUNS[current], builds[current]);
  const foc = applyAttachments(GUNS[focus], builds[focus]);
  return (
    <section className="gf-list-view" aria-label={`Escolher: ${SLOT_LABEL[slot]}`}>
      <EdHead crumb="Equipamento" title={SLOT_LABEL[slot]} onBack={onBack} />
      <div className="gf-list-body">
        <div className="gf-list" role="group" aria-label="Armas" onKeyDown={(e) => arrowNav(e, '.gf-row')}>
          {groups(slot).map((g) => (
            <div key={g.cls} className="gf-list-group">
              {groups(slot).length > 1 && <h3 className="gf-list-cls">{CLASS_LABEL[g.cls]}</h3>}
              {g.ids.map((id) => {
                const sp = applyAttachments(GUNS[id], builds[id]);
                return (
                  <button
                    key={id}
                    ref={id === current ? firstRef : undefined}
                    type="button"
                    className="gf-row"
                    aria-pressed={id === current}
                    data-focus={id === focus ? 'true' : undefined}
                    onFocus={() => setFocus(id)}
                    onMouseEnter={() => setFocus(id)}
                    onClick={() => pick(id, true)}
                  >
                    <span className="gf-row-img">
                      <GunImage id={id} build={builds[id]} icon={20} />
                    </span>
                    <span className="gf-row-text">
                      <span className="gf-row-name">{sp.name}</span>
                      <span className="gf-row-sub">
                        {CLASS_LABEL[sp.cls]}
                        {buildKey(builds[id]) ? ' · com acessórios' : ''}
                      </span>
                    </span>
                    {id === current && (
                      <span className="gf-row-on">
                        <Icon name="check" size={14} /> Em uso
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="gf-detail" aria-live="polite">
          <div className="gf-stage">
            <GunImage id={focus} build={builds[focus]} icon={48} />
          </div>
          <div className="gf-detail-head">
            <h3>{foc.name}</h3>
            <span className="gf-card-cls">{CLASS_LABEL[foc.cls]}</span>
          </div>
          <p className="gf-blurb">{BLURB[focus]}</p>
          <StatBars base={gunStats(cur)} next={gunStats(foc)} />
          {focus !== current && <p className="gf-note">Comparada com a {cur.name}, que está em uso.</p>}
          <div className="gf-actions">
            {slotsFor(focus).length > 0 && (
              <button type="button" className="gf-btn gf-btn-main" onClick={() => pick(focus, true)}>
                <Icon name="wrench" size={16} /> {focus === current ? 'Personalizar' : 'Equipar e personalizar'}
              </button>
            )}
            {focus !== current && (
              <button type="button" className="gf-btn" onClick={() => pick(focus, false)}>
                <Icon name="check" size={16} /> Só equipar
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** a descrição curta do padrão de cada encaixe */
function defaultDesc(spec: GunSpec, slot: AttSlot): string {
  if (slot === 'optic') return spec.scope ? 'A luneta que vem na arma (4x).' : 'A mira da própria arma, sem aumento.';
  if (slot === 'mag') return 'O pente que vem com a arma.';
  if (slot === 'muzzle') return 'O cano como veio da fábrica.';
  return 'O guarda-mão livre: a mão de apoio segura nele.';
}

/** o armeiro: encaixes em abas, as opções com prós e contras, a imagem e as barras com a opção em foco */
function Gunsmith({ gun, slot, onBack }: { gun: GunId; slot: GunSlot; onBack: () => void }) {
  const builds = useGunHud((s) => s.builds);
  const build = builds[gun] ?? {};
  const slots = slotsFor(gun);
  const [tab, setTab] = useState<AttSlot>(slots[0] ?? 'optic');
  /** a opção em foco (prévia): undefined = nenhuma, null = o padrão do encaixe */
  const [hover, setHover] = useState<AttId | null | undefined>(undefined);
  const tabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    tabRef.current?.focus();
  }, []);
  const spec = GUNS[gun];
  const base = applyAttachments(spec, build);
  const preview: GunBuild = hover === undefined ? build : withAtt(build, tab, hover);
  const next = applyAttachments(spec, preview);
  const choose = (att: AttId | null) => {
    uiSound('uiOk');
    const nb = withAtt(build, tab, att);
    const all = { ...builds };
    if (buildKey(nb)) all[gun] = nb;
    else delete all[gun];
    commit({ builds: all });
  };
  const options: (AttId | null)[] = [null, ...attachmentsFor(gun, tab)];
  return (
    <section className="gf-smith" aria-label={`Personalizar ${spec.name}`}>
      <EdHead crumb={`${SLOT_LABEL[slot]} · ${CLASS_LABEL[spec.cls]}`} title={spec.name} onBack={onBack}>
        {buildKey(build) !== '' && (
          <button
            type="button"
            className="gf-btn"
            onClick={() => {
              uiSound('uiBack');
              const all = { ...builds };
              delete all[gun];
              commit({ builds: all });
            }}
          >
            <Icon name="refresh" size={16} /> De fábrica
          </button>
        )}
      </EdHead>
      <div className="gf-smith-body">
        <div className="gf-smith-show">
          <div className="gf-stage gf-stage-big">
            <GunImage id={gun} build={preview} icon={56} />
          </div>
          <StatBars base={gunStats(base)} next={gunStats(next)} />
          <Specs base={base} next={next} />
          <p className="gf-note">Vale assim que você volta ao jogo.</p>
        </div>
        <div className="gf-smith-pick">
          <div
            className="gf-tabs"
            role="tablist"
            aria-label="Encaixes"
            onKeyDown={(e) => arrowNav(e, '[role="tab"]', 'h')}
          >
            {slots.map((s) => {
              const on = build[s];
              return (
                <button
                  key={s}
                  ref={s === tab ? tabRef : undefined}
                  type="button"
                  role="tab"
                  id={`gf-tab-${s}`}
                  aria-selected={s === tab}
                  aria-controls="gf-opts"
                  tabIndex={s === tab ? 0 : -1}
                  className="gf-tab"
                  onClick={() => {
                    if (s !== tab) uiSound('uiMove');
                    setTab(s);
                    setHover(undefined);
                  }}
                  onFocus={() => {
                    setTab(s);
                    setHover(undefined);
                  }}
                >
                  <span className="gf-tab-name">{ATT_SLOT_LABEL[s]}</span>
                  <span className="gf-tab-val">{on ? ATTACHMENTS[on].name : defaultLabel(gun, s)}</span>
                </button>
              );
            })}
          </div>
          <div
            className="gf-opts"
            id="gf-opts"
            role="tabpanel"
            aria-labelledby={`gf-tab-${tab}`}
            onKeyDown={(e) => arrowNav(e, '.gf-opt')}
            onMouseLeave={() => setHover(undefined)}
          >
            {options.map((att) => {
              const on = (build[tab] ?? null) === att;
              const fx = att ? attachmentEffects(att, spec) : [];
              return (
                <button
                  key={att ?? 'none'}
                  type="button"
                  className="gf-opt"
                  aria-pressed={on}
                  onMouseEnter={() => setHover(att)}
                  onFocus={() => setHover(att)}
                  onBlur={() => setHover(undefined)}
                  onClick={() => choose(att)}
                >
                  <span className="gf-opt-head">
                    <span className="gf-opt-name">{att ? ATTACHMENTS[att].name : defaultLabel(gun, tab)}</span>
                    {!att && <span className="gf-opt-tag">Padrão</span>}
                    {on && (
                      <span className="gf-opt-on">
                        <Icon name="check" size={14} /> Equipado
                      </span>
                    )}
                  </span>
                  <span className="gf-opt-desc">{att ? ATTACHMENTS[att].desc : defaultDesc(spec, tab)}</span>
                  {fx.length > 0 && (
                    <span className="gf-effects">
                      {fx.map((f) => (
                        <span
                          key={f.text}
                          className="gf-effect"
                          data-good={f.good === null ? undefined : f.good ? 'true' : 'false'}
                        >
                          <span className="gf-effect-sign" aria-hidden="true">
                            {f.good === null ? '•' : f.good ? '+' : '−'}
                          </span>
                          <span className="oc-visually-hidden">
                            {f.good === null ? '' : f.good ? 'Pró: ' : 'Contra: '}
                          </span>
                          {f.text}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** a montagem com o encaixe trocado (`null` = o padrão) */
function withAtt(b: GunBuild, slot: AttSlot, att: AttId | null): GunBuild {
  const out: Record<string, AttId> = { ...b } as Record<string, AttId>;
  if (att) out[slot] = att;
  else delete out[slot];
  return out as GunBuild;
}

/** números que as barras não mostram: pente, recarga, zoom e o som do tiro */
function Specs({ base, next }: { base: GunSpec; next: GunSpec }) {
  if (base.cls === 'knife') return null;
  const row = (label: string, a: string, b: string) => (
    <div key={label} data-changed={a !== b ? 'true' : undefined}>
      <dt>{label}</dt>
      <dd>
        {a !== b ? (
          <>
            <s aria-hidden="true">{a}</s> <span className="oc-visually-hidden">de {a} para </span>
            {b}
          </>
        ) : (
          a
        )}
      </dd>
    </div>
  );
  const shot = (s: GunSpec) => (s.quiet ? 'Abafado' : 'Normal');
  return (
    <dl className="gf-specs">
      {row('Pente', String(base.mag), String(next.mag))}
      {row('Recarga', `${dec(base.reloadMs / 1000)} s`, `${dec(next.reloadMs / 1000)} s`)}
      {row('Zoom', `${dec(base.zoom, 2)}x`, `${dec(next.zoom, 2)}x`)}
      {row('Tiro', shot(base), shot(next))}
    </dl>
  );
}

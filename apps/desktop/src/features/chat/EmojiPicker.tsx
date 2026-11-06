/**
 * Seletor de emojis: recentes, os emojis personalizados dos servidores da pessoa (ADR-0050; o servidor aberto
 * primeiro) e os do Unicode por categoria, com busca em português (nome e palavras). Escolher devolve o texto para
 * inserir: o próprio emoji, ou `:nome:` para um personalizado (vira o emoji ao enviar). Shift+clique escolhe sem fechar.
 * A lista do Unicode (src/lib/emoji-data.json, gerada por scripts/build-emoji-data.mjs) só carrega ao abrir.
 */
import type { CustomEmoji } from '@opencord/contracts';
import { portalTarget, TextField } from '@opencord/ui';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CustomEmojiImg } from '../../components/CustomEmoji';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';

/** [emoji, nome, palavras, grupo] */
type Row = [string, string, string, number];

/** grupos do emojibase (2 = componentes, fora da lista) */
const GROUPS: { id: number; name: string; icon: string }[] = [
  { id: 0, name: 'Carinhas e emoções', icon: '😀' },
  { id: 1, name: 'Pessoas e corpo', icon: '👋' },
  { id: 3, name: 'Animais e natureza', icon: '🐶' },
  { id: 4, name: 'Comida e bebida', icon: '🍔' },
  { id: 5, name: 'Viagens e lugares', icon: '✈️' },
  { id: 6, name: 'Atividades', icon: '⚽' },
  { id: 7, name: 'Objetos', icon: '💡' },
  { id: 8, name: 'Símbolos', icon: '❤️' },
  { id: 9, name: 'Bandeiras', icon: '🏁' },
];

const RECENT_KEY = 'oc:emoji-recent';
const RECENT_MAX = 27;
const WIDTH = 360;

let dataPromise: Promise<Row[]> | null = null;
const loadData = () => (dataPromise ??= import('../../lib/emoji-data.json').then((m) => m.default as unknown as Row[]));

function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(text: string) {
  try {
    const next = [text, ...readRecent().filter((x) => x !== text)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // sem armazenamento: só não lembra
  }
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** texto para inserir: o emoji do Unicode, ou `:nome:` para o personalizado */
export const customEmojiText = (e: CustomEmoji) => `:${e.name}:`;

export function EmojiPicker({
  serverId,
  anchor,
  onPick,
  onClose,
}: {
  serverId: string | undefined;
  anchor: RefObject<HTMLElement | null>;
  /** keepOpen: Shift+clique */
  onPick: (text: string, keepOpen: boolean) => void;
  onClose: () => void;
}) {
  const servers = useData((s) => s.servers);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState(readRecent);
  const [hover, setHover] = useState<string | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const panel = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void loadData().then((d) => alive && setRows(d));
    return () => {
      alive = false;
    };
  }, []);

  // acima do elemento se couber, senão abaixo; borda direita alinhada com a dele, sempre dentro da janela
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(WIDTH, window.innerWidth - 16);
      const left = Math.round(Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8));
      const above = r.top - 16;
      const below = window.innerHeight - r.bottom - 16;
      const useAbove = above >= 300 || above >= below;
      const maxHeight = Math.min(440, Math.max(220, useAbove ? above : below));
      setStyle(
        useAbove
          ? { position: 'fixed', bottom: Math.round(window.innerHeight - r.top + 6), left, width, maxHeight }
          : { position: 'fixed', top: Math.round(r.bottom + 6), left, width, maxHeight },
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('mousedown', down);
    };
  }, [onClose, anchor]);

  const q = fold(query.trim().replace(/:/g, ''));

  const customGroups = useMemo(
    () =>
      [...servers]
        .sort((a, b) => (a.id === serverId ? -1 : b.id === serverId ? 1 : 0))
        .map((s) => ({ server: s, emojis: (s.emojis ?? []).filter((e) => !q || fold(e.name).includes(q)) }))
        .filter((g) => g.emojis.length > 0),
    [servers, serverId, q],
  );
  const customByText = useMemo(() => {
    const m = new Map<string, CustomEmoji>();
    for (const s of servers)
      for (const e of s.emojis ?? []) if (!m.has(customEmojiText(e))) m.set(customEmojiText(e), e);
    return m;
  }, [servers]);
  const nameOf = useMemo(() => new Map((rows ?? []).map((r) => [r[0], r[1]])), [rows]);

  const unicodeGroups = useMemo(() => {
    if (!rows) return [];
    const hit = q ? rows.filter((r) => fold(r[1]).includes(q) || fold(r[2]).includes(q)) : rows;
    return GROUPS.map((g) => ({ ...g, rows: hit.filter((r) => r[3] === g.id) })).filter((g) => g.rows.length > 0);
  }, [rows, q]);

  // recentes que ainda existem (um personalizado pode ter sido apagado)
  const recentShown = q ? [] : recent.filter((t) => customByText.has(t) || nameOf.has(t));

  const pick = (text: string, keepOpen: boolean) => {
    pushRecent(text);
    setRecent(readRecent());
    onPick(text, keepOpen);
  };

  const jump = (id: string) => {
    const el = scroll.current?.querySelector<HTMLElement>(`[data-emoji-group="${id}"]`);
    if (el && scroll.current) scroll.current.scrollTop = el.offsetTop - scroll.current.offsetTop;
  };

  const item = (text: string, label: string, content: ReactNode) => (
    <button
      key={text}
      type="button"
      className="emoji-panel-item"
      aria-label={label}
      onClick={(e) => pick(text, e.shiftKey)}
      onMouseEnter={() => setHover(label)}
      onFocus={() => setHover(label)}
    >
      {content}
    </button>
  );
  const unicodeItem = (r: Row) => item(r[0], r[1], <span className="emoji-panel-glyph">{r[0]}</span>);
  const customItem = (e: CustomEmoji) => item(customEmojiText(e), customEmojiText(e), <CustomEmojiImg emoji={e} />);

  const nothing = q && rows && customGroups.length === 0 && unicodeGroups.length === 0;

  return createPortal(
    <div ref={panel} className="emoji-panel" style={style} role="dialog" aria-label="Emojis">
      <div className="emoji-panel-head">
        <TextField
          aria-label="Buscar emoji"
          type="search"
          leadingIcon="search"
          placeholder="Buscar emoji"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {!q && (
        <nav className="emoji-panel-tabs" aria-label="Categorias">
          {recentShown.length > 0 && (
            <button type="button" aria-label="Recentes" data-tip="Recentes" onClick={() => jump('recent')}>
              🕘
            </button>
          )}
          {customGroups.map((g) => (
            <button
              key={g.server.id}
              type="button"
              className="emoji-panel-tab-server"
              aria-label={g.server.name}
              data-tip={g.server.name}
              onClick={() => jump(g.server.id)}
            >
              <ServerIcon name={g.server.name} iconKey={g.server.iconKey} />
            </button>
          ))}
          {GROUPS.map((g) => (
            <button key={g.id} type="button" aria-label={g.name} data-tip={g.name} onClick={() => jump(`u${g.id}`)}>
              {g.icon}
            </button>
          ))}
        </nav>
      )}
      <div className="emoji-panel-scroll" ref={scroll}>
        {nothing && <p className="muted small emoji-panel-empty">Nenhum emoji encontrado.</p>}
        {recentShown.length > 0 && (
          <section data-emoji-group="recent" aria-label="Recentes">
            <h4 className="emoji-panel-title">Recentes</h4>
            <div className="emoji-panel-grid">
              {recentShown.map((t) => {
                const c = customByText.get(t);
                return c ? customItem(c) : item(t, nameOf.get(t) ?? t, <span className="emoji-panel-glyph">{t}</span>);
              })}
            </div>
          </section>
        )}
        {customGroups.map((g) => (
          <section key={g.server.id} data-emoji-group={g.server.id} aria-label={g.server.name}>
            <h4 className="emoji-panel-title">
              <span className="emoji-panel-icon" aria-hidden>
                <ServerIcon name={g.server.name} iconKey={g.server.iconKey} />
              </span>
              <span className="truncate">{g.server.name}</span>
            </h4>
            <div className="emoji-panel-grid">{g.emojis.map(customItem)}</div>
          </section>
        ))}
        {!rows && <p className="muted small emoji-panel-empty">Carregando emojis…</p>}
        {unicodeGroups.map((g) => (
          <section key={g.id} data-emoji-group={`u${g.id}`} aria-label={g.name}>
            <h4 className="emoji-panel-title">{g.name}</h4>
            <div className="emoji-panel-grid">{g.rows.map(unicodeItem)}</div>
          </section>
        ))}
      </div>
      <p className="emoji-panel-foot muted small" aria-live="polite">
        {hover ?? 'Shift+clique para escolher vários'}
      </p>
    </div>,
    portalTarget(anchor.current),
  );
}

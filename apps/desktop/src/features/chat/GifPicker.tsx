/**
 * Seletor de GIFs (ADR-0044), aberto pelo botão GIF do composer: busca no KLIPY, favoritos, em alta e categorias.
 * Clicar num GIF envia na hora; a estrela guarda nos favoritos (sincronizados nas configurações).
 */
import type { GifFavorite } from '@opencord/contracts';
import { Icon, portalTarget, TextField } from '@opencord/ui';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  customerId,
  fetchCategories,
  fetchGifs,
  toFavorite,
  type Gif,
  type GifCategory,
  type GifConfig,
} from '../../lib/klipy';
import { useData } from '../../store/data';
import { updateSettings } from '../../store/settings';
import { describeError } from '../../store/session';

const EMPTY: GifFavorite[] = [];

type View = { kind: 'home' } | { kind: 'favorites' } | { kind: 'feed'; q: string; title: string };

/** popover acima do composer, alinhado à direita */
function usePlacement(anchor: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(440, r.width);
      setStyle({
        position: 'fixed',
        bottom: Math.round(window.innerHeight - r.top + 6),
        left: Math.round(r.right - width),
        width,
        height: Math.min(460, Math.max(240, r.top - 24)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);
  return style;
}

export function GifPicker({
  cfg,
  anchor,
  onPick,
  onClose,
  inline,
}: {
  cfg: GifConfig;
  anchor: RefObject<HTMLElement | null>;
  onPick: (gif: Gif, q: string) => void;
  onClose: () => void;
  /** dentro de um diálogo (foto/banner do perfil, ADR-0048): sem portal nem posição flutuante */
  inline?: boolean;
}) {
  const placed = usePlacement(anchor);
  const style: CSSProperties = inline ? { position: 'relative', width: '100%', height: 440 } : placed;
  const panel = useRef<HTMLDivElement>(null);
  const meId = useData((s) => s.me?.id ?? '');
  const favorites = useData((s) => s.settings?.gifFavorites ?? EMPTY);
  const [customer, setCustomer] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ kind: 'home' });
  const [categories, setCategories] = useState<GifCategory[] | null>(null);
  const [trendCover, setTrendCover] = useState<string | null>(null);
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void customerId(meId).then(setCustomer);
    search.current?.focus();
  }, [meId]);

  // fecha com Esc ou clique fora
  useEffect(() => {
    // no diálogo quem fecha é o próprio diálogo
    if (inline) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (view.kind !== 'home' || query) {
        setQuery('');
        setView({ kind: 'home' });
      } else onClose();
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
  }, [view, query, onClose, anchor, inline]);

  // início: categorias e uma capa para "em alta"
  useEffect(() => {
    if (!customer) return;
    const ac = new AbortController();
    fetchCategories(cfg, ac.signal).then(setCategories, () => setCategories([]));
    fetchGifs(cfg, { customer, signal: ac.signal, page: 1 }).then(
      (p) => setTrendCover(p.gifs[0]?.preview ?? null),
      () => undefined,
    );
    return () => ac.abort();
  }, [cfg, customer]);

  // digitar pesquisa (com atraso)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setView((v) => (v.kind === 'feed' && v.q && v.title === v.q ? { kind: 'home' } : v));
      return;
    }
    const t = setTimeout(() => setView({ kind: 'feed', q, title: q }), 300);
    return () => clearTimeout(t);
  }, [query]);

  // carregar a primeira página do feed atual
  useEffect(() => {
    if (view.kind !== 'feed' || !customer) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setGifs([]);
    fetchGifs(cfg, { q: view.q, page: 1, customer, signal: ac.signal })
      .then((p) => {
        setGifs(p.gifs);
        setPage(p.page);
        setHasNext(p.hasNext);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(describeError(e));
      })
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
  }, [cfg, customer, view]);

  const more = () => {
    if (view.kind !== 'feed' || loading || !hasNext) return;
    setLoading(true);
    fetchGifs(cfg, { q: view.q, page: page + 1, customer })
      .then((p) => {
        setGifs((g) => [...g, ...p.gifs.filter((x) => !g.some((y) => y.slug === x.slug))]);
        setPage(p.page);
        setHasNext(p.hasNext);
      })
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setLoading(false));
  };

  const isFav = (slug: string) => favorites.some((f) => f.slug === slug);
  const toggleFav = (g: Gif | GifFavorite) =>
    updateSettings((s) => ({
      ...s,
      gifFavorites: s.gifFavorites.some((f) => f.slug === g.slug)
        ? s.gifFavorites.filter((f) => f.slug !== g.slug)
        : ['title' in g ? toFavorite(g) : g, ...s.gifFavorites].slice(0, 100),
    }));

  const pick = (g: Gif | GifFavorite) => onPick({ title: '', ...g }, view.kind === 'feed' ? view.q : '');

  const list: (Gif | GifFavorite)[] = view.kind === 'favorites' ? favorites : gifs;
  const heading = view.kind === 'favorites' ? 'Favoritos' : view.kind === 'feed' ? view.title : null;

  const picker = (
    <div ref={panel} className="gif-picker" style={style} role="dialog" aria-label="GIFs">
      <div className="gif-picker-head">
        {view.kind !== 'home' && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Voltar"
            onClick={() => {
              setQuery('');
              setView({ kind: 'home' });
            }}
          >
            <Icon name="chevron-right" size={18} className="gif-back" />
          </button>
        )}
        <TextField
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar no KLIPY"
          aria-label="Buscar GIFs no KLIPY"
          leadingIcon="search"
          fieldClassName="gif-search"
        />
      </div>
      {heading && <div className="gif-picker-title truncate">{heading}</div>}
      <div
        className="gif-picker-body"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) more();
        }}
      >
        {view.kind === 'home' ? (
          <div className="gif-tiles">
            <button type="button" className="gif-tile gif-tile-fav" onClick={() => setView({ kind: 'favorites' })}>
              {favorites[0] && <img src={favorites[0].preview} alt="" loading="lazy" />}
              <span>
                <Icon name="star" size={16} /> Favoritos
              </span>
            </button>
            <button
              type="button"
              className="gif-tile"
              onClick={() => setView({ kind: 'feed', q: '', title: 'GIFs em alta' })}
            >
              {trendCover && <img src={trendCover} alt="" loading="lazy" />}
              <span>
                <Icon name="signal" size={16} /> GIFs em alta
              </span>
            </button>
            {(categories ?? []).map((c) => (
              <button
                key={c.query}
                type="button"
                className="gif-tile"
                onClick={() => setView({ kind: 'feed', q: c.query, title: c.name })}
              >
                <img src={c.preview} alt="" loading="lazy" />
                <span>{c.name}</span>
              </button>
            ))}
            {categories === null &&
              Array.from({ length: 6 }, (_, i) => <span key={i} className="gif-tile gif-skeleton" aria-hidden />)}
          </div>
        ) : (
          <>
            {view.kind === 'favorites' && !favorites.length && (
              <p className="muted small gif-empty">Toque na estrela de um GIF para guardar aqui.</p>
            )}
            {error && (
              <p className="muted small gif-empty" role="alert">
                Não deu para carregar os GIFs: {error}
              </p>
            )}
            {view.kind === 'feed' && !loading && !error && !gifs.length && (
              <p className="muted small gif-empty">Nenhum GIF encontrado.</p>
            )}
            <div className="gif-grid">
              {list.map((g) => (
                <div key={g.slug} className="gif-cell" style={{ aspectRatio: `${g.width} / ${g.height}` }}>
                  <button type="button" className="gif-send" aria-label="Enviar GIF" onClick={() => pick(g)}>
                    <img src={g.preview} alt={'title' in g ? g.title : ''} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="gif-fav"
                    aria-pressed={isFav(g.slug)}
                    aria-label={isFav(g.slug) ? 'Tirar dos favoritos' : 'Favoritar'}
                    data-tip={isFav(g.slug) ? 'Tirar dos favoritos' : 'Favoritar'}
                    onClick={() => toggleFav(g)}
                  >
                    <Icon name="star" size={16} active={isFav(g.slug)} />
                  </button>
                </div>
              ))}
              {loading &&
                Array.from({ length: gifs.length ? 2 : 8 }, (_, i) => (
                  <span key={`s${i}`} className="gif-cell gif-skeleton" aria-hidden />
                ))}
            </div>
          </>
        )}
      </div>
      <div className="gif-picker-foot muted small">Powered by KLIPY</div>
    </div>
  );
  return inline ? picker : createPortal(picker, portalTarget(anchor.current));
}

/**
 * Emojis personalizados no compositor (ADR-0050): os do servidor aberto primeiro, depois os dos outros servidores da
 * pessoa (vale para todo mundo, sem plano pago). Escolher um põe `:nome:` no texto, que vira o emoji ao enviar.
 */
import type { CustomEmoji } from '@opencord/contracts';
import { portalTarget, TextField } from '@opencord/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CustomEmojiImg } from '../../components/CustomEmoji';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';

export function EmojiPicker({
  serverId,
  anchor,
  onPick,
  onClose,
}: {
  serverId: string | undefined;
  anchor: RefObject<HTMLElement | null>;
  onPick: (e: CustomEmoji) => void;
  onClose: () => void;
}) {
  const servers = useData((s) => s.servers);
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const panel = useRef<HTMLDivElement>(null);

  // popover acima do composer, alinhado à direita (como o de GIFs)
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(360, r.width);
      setStyle({
        position: 'fixed',
        bottom: Math.round(window.innerHeight - r.top + 6),
        left: Math.round(r.right - width),
        width,
        maxHeight: Math.min(420, Math.max(200, r.top - 24)),
      });
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

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/:/g, '');
    return [...servers]
      .sort((a, b) => (a.id === serverId ? -1 : b.id === serverId ? 1 : 0))
      .map((s) => ({ server: s, emojis: (s.emojis ?? []).filter((e) => !q || e.name.toLowerCase().includes(q)) }))
      .filter((g) => g.emojis.length > 0);
  }, [servers, serverId, query]);

  return createPortal(
    <div ref={panel} className="emoji-panel" style={style} role="dialog" aria-label="Emojis personalizados">
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
      <div className="emoji-panel-scroll">
        {groups.length === 0 && <p className="muted small emoji-panel-empty">Nenhum emoji encontrado.</p>}
        {groups.map((g) => (
          <section key={g.server.id} aria-label={g.server.name}>
            <h4 className="emoji-panel-title">
              <span className="emoji-panel-icon" aria-hidden>
                <ServerIcon name={g.server.name} iconKey={g.server.iconKey} />
              </span>
              <span className="truncate">{g.server.name}</span>
            </h4>
            <div className="emoji-panel-grid">
              {g.emojis.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="emoji-panel-item"
                  aria-label={`:${e.name}:`}
                  onClick={() => onPick(e)}
                >
                  <CustomEmojiImg emoji={e} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>,
    portalTarget(anchor.current),
  );
}

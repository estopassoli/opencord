import { nickKeyOf } from '@opencord/contracts';
import { Icon, TextField, type IconName } from '@opencord/ui';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { CHANNEL_ICON } from '../../lib/channels';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

interface Entry {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  go: () => void;
}

/** Ctrl+K: alterna rapidamente entre canais, DMs e servidores digitando parte do nome. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const details = useData((s) => s.details);
  const servers = useData((s) => s.servers);
  const conversations = useData((s) => s.conversations);
  const meId = useData((s) => s.me?.id);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const srv of servers) {
      const d = details[srv.id];
      for (const c of d?.channels ?? []) {
        out.push({
          id: c.id,
          label: c.name,
          hint: srv.name,
          icon: CHANNEL_ICON[c.kind],
          go: () => {
            useUi.getState().go({ kind: 'server', serverId: srv.id, channelId: c.id });
            if (c.kind === 'voice') void useVoice.getState().join(c.id, srv.id);
          },
        });
      }
      out.push({
        id: srv.id,
        label: srv.name,
        hint: 'Servidor',
        icon: 'server',
        go: () => useUi.getState().go({ kind: 'server', serverId: srv.id, channelId: null }),
      });
    }
    for (const c of conversations) {
      const name =
        c.name ??
        c.members
          .filter((m) => m.id !== meId)
          .map((m) => m.displayName)
          .join(', ');
      out.push({
        id: c.id,
        label: name || 'Conversa',
        hint: 'Mensagem direta',
        icon: 'chat',
        go: () => useUi.getState().go({ kind: 'dm', conversationId: c.id }),
      });
    }
    return out;
  }, [servers, details, conversations, meId]);

  const query = nickKeyOf(q);
  const results = (query ? entries.filter((e) => nickKeyOf(e.label).includes(query)) : entries).slice(0, 12);
  const pick = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    e.go();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[idx]);
    }
  };

  return (
    <Dialog title="Ir para…" onClose={onClose}>
      <TextField
        leadingIcon="search"
        className="switcher-input"
        autoFocus
        value={q}
        placeholder="Para onde você quer ir?"
        aria-label="Buscar canal, conversa ou servidor"
        aria-controls="switcher-results"
        aria-activedescendant={results[idx] ? `sw-${results[idx].id}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={onKey}
      />
      <ul id="switcher-results" role="listbox" className="switcher-list" aria-label="Resultados">
        {results.map((r, i) => (
          <li
            key={r.id}
            id={`sw-${r.id}`}
            role="option"
            aria-selected={i === idx}
            className="switcher-item"
            onMouseEnter={() => setIdx(i)}
            onClick={() => pick(r)}
          >
            <Icon name={r.icon} size={18} active={i === idx} />
            <span className="truncate">{r.label}</span>
            <span className="muted small truncate">{r.hint}</span>
          </li>
        ))}
        {!results.length && <li className="muted switcher-empty">Nada encontrado.</li>}
      </ul>
      <p className="muted small">Use ↑ ↓ para navegar e Enter para abrir.</p>
    </Dialog>
  );
}

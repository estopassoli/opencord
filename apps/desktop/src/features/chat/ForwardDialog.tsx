/**
 * Encaminhar mensagem (ADR-0053): escolhe até 5 destinos (conversas, amigos sem conversa ainda e canais de texto onde a
 * pessoa pode escrever), com um comentário opcional. A API copia o texto e os anexos; aqui só se escolhe para onde.
 */
import {
  FORWARD_MAX_TARGETS,
  hasPermission,
  nickKeyOf,
  Permission,
  type Conversation,
  type ForwardMessageResponse,
  type Message,
} from '@opencord/contracts';
import { Avatar, Button, Icon, TextField } from '@opencord/ui';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { nameFor } from '../../lib/names';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

type Dest =
  | { kind: 'conversation'; id: string; label: string; hint: string; icon: ReactNode }
  | { kind: 'friend'; id: string; userId: string; label: string; hint: string; icon: ReactNode }
  | { kind: 'channel'; id: string; label: string; hint: string; icon: ReactNode };

const convName = (c: Conversation, meId: string | undefined) =>
  c.name ??
  (c.members
    .filter((m) => m.id !== meId)
    .map((m) => nameFor(m.id, m.displayName))
    .join(', ') ||
    'Conversa');

export function ForwardDialog({
  message,
  authorName,
  onClose,
}: {
  message: Message;
  authorName: string;
  onClose: () => void;
}) {
  const meId = useData((s) => s.me?.id);
  const servers = useData((s) => s.servers);
  const details = useData((s) => s.details);
  const conversations = useData((s) => s.conversations);
  const friends = useData((s) => s.friends);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Dest[]>([]);
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const all = useMemo<Dest[]>(() => {
    const out: Dest[] = [];
    // conversas mais recentes primeiro (ids UUIDv7 crescem com o tempo)
    const convs = [...conversations].sort((a, b) => (b.lastMessageId ?? '').localeCompare(a.lastMessageId ?? ''));
    const withDm = new Set<string>();
    for (const c of convs) {
      // conversa com a conta de avisos do OpenCord (ADR-0045) não recebe mensagens
      if (c.members.some((m) => m.system)) continue;
      const others = c.members.filter((m) => m.id !== meId);
      if (c.kind === 'dm' && others[0]) withDm.add(others[0].id);
      const first = others[0];
      out.push({
        kind: 'conversation',
        id: c.id,
        label: convName(c, meId),
        hint: c.kind === 'group' ? 'Grupo' : 'Mensagem direta',
        icon:
          c.kind === 'dm' && first ? (
            <Avatar id={first.id} name={first.displayName} size={28} />
          ) : (
            <span className="forward-icon">
              <Icon name="group" size={16} />
            </span>
          ),
      });
    }
    for (const f of friends) {
      if (f.status !== 'accepted' || f.user.system || withDm.has(f.user.id)) continue;
      out.push({
        kind: 'friend',
        id: `u:${f.user.id}`,
        userId: f.user.id,
        label: nameFor(f.user.id, f.user.displayName),
        hint: 'Amigo',
        icon: <Avatar id={f.user.id} name={f.user.displayName} size={28} />,
      });
    }
    for (const srv of servers) {
      for (const c of details[srv.id]?.channels ?? []) {
        if (c.kind !== 'text' || !hasPermission(c.myPermissions, Permission.SEND_MESSAGES)) continue;
        out.push({
          kind: 'channel',
          id: c.id,
          label: `#${c.name}`,
          hint: srv.name,
          icon: (
            <span className="forward-icon">
              <ServerIcon name={srv.name} iconKey={srv.iconKey} />
            </span>
          ),
        });
      }
    }
    return out;
  }, [conversations, friends, servers, details, meId]);

  const query = nickKeyOf(q.replace(/^#/, ''));
  const results = (
    query
      ? all.filter((d) => nickKeyOf(d.label.replace(/^#/, '')).includes(query) || nickKeyOf(d.hint).includes(query))
      : all
  ).slice(0, 60);
  const isPicked = (d: Dest) => picked.some((p) => p.id === d.id);
  const full = picked.length >= FORWARD_MAX_TARGETS;

  const toggle = (d: Dest | undefined) => {
    if (!d) return;
    if (isPicked(d)) setPicked((p) => p.filter((x) => x.id !== d.id));
    else if (!full) setPicked((p) => [...p, d]);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
    else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter') toggle(results[idx]);
    else return;
    e.preventDefault();
  };

  const send = async () => {
    if (!picked.length || sending) return;
    setSending(true);
    try {
      // amigo sem conversa: abre a DM antes
      const targets = await Promise.all(
        picked.map(async (d) => {
          if (d.kind === 'channel') return { channelId: d.id };
          if (d.kind === 'conversation') return { conversationId: d.id };
          const c = await api().request<Conversation>('POST', '/conversations', { userIds: [d.userId] });
          useData.getState().upsertConversation(c);
          return { conversationId: c.id };
        }),
      );
      const r = await api().request<ForwardMessageResponse>('POST', `/messages/${message.id}/forward`, {
        requestId: crypto.randomUUID(),
        targets,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const ok = picked.filter((_, i) => r.results[i]?.messageId);
      const failed = picked
        .map((d, i) => ({ d, error: r.results[i]?.error }))
        .filter((x): x is { d: Dest; error: string } => Boolean(x.error));
      const ui = useUi.getState();
      if (ok.length)
        ui.toast(
          'success',
          ok.length === 1 ? `Encaminhada para ${ok[0]?.label}` : `Encaminhada para ${ok.length} destinos`,
        );
      for (const f of failed) ui.toast('error', `${f.d.label}: ${f.error}`);
      if (!failed.length) onClose();
      else setPicked(failed.map((f) => f.d));
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setSending(false);
    }
  };

  const preview = message.body.trim() || (message.attachments.length ? '' : 'Mensagem');
  const files = message.attachments.length;

  return (
    <Dialog
      title="Encaminhar mensagem"
      onClose={onClose}
      className="forward-dialog"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void send()} disabled={!picked.length || sending}>
            {sending ? 'Enviando…' : picked.length > 1 ? `Enviar para ${picked.length}` : 'Enviar'}
          </Button>
        </>
      }
    >
      <blockquote className="forward-preview">
        <span className="forward-preview-author">{authorName}</span>
        {preview && <span className="forward-preview-body">{preview}</span>}
        {files > 0 && (
          <span className="forward-preview-files muted small">
            <Icon name="attach" size={14} /> {files === 1 ? message.attachments[0]?.originalName : `${files} anexos`}
          </span>
        )}
      </blockquote>
      <TextField
        leadingIcon="search"
        autoFocus
        value={q}
        placeholder="Buscar conversa, amigo ou canal"
        aria-label="Buscar destino"
        aria-controls="forward-results"
        aria-activedescendant={results[idx] ? `fw-${results[idx].id}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={onKey}
      />
      <ul
        id="forward-results"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Destinos"
        className="forward-list"
      >
        {results.map((d, i) => {
          const on = isPicked(d);
          return (
            <li
              key={d.id}
              id={`fw-${d.id}`}
              role="option"
              aria-selected={on}
              aria-disabled={!on && full}
              data-active={i === idx ? 'true' : undefined}
              className="forward-item"
              onMouseEnter={() => setIdx(i)}
              onClick={() => toggle(d)}
            >
              {d.icon}
              <span className="forward-item-text">
                <span className="truncate">{d.label}</span>
                <span className="muted small truncate">{d.hint}</span>
              </span>
              <span className="forward-check" aria-hidden>
                {on && <Icon name="check" size={14} />}
              </span>
            </li>
          );
        })}
        {!results.length && <li className="muted forward-empty">Nada encontrado.</li>}
      </ul>
      <p className="muted small forward-count" aria-live="polite">
        {full
          ? `Limite de ${FORWARD_MAX_TARGETS} destinos por vez.`
          : picked.length
            ? `${picked.length} de ${FORWARD_MAX_TARGETS} escolhidos`
            : `Escolha até ${FORWARD_MAX_TARGETS} destinos.`}
      </p>
      <TextField
        value={note}
        maxLength={4000}
        placeholder="Adicionar um comentário (opcional)"
        aria-label="Comentário"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void send();
          }
        }}
      />
    </Dialog>
  );
}

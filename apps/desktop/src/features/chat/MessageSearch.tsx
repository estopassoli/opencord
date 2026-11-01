/**
 * Busca de mensagens: botão do cabeçalho (ou Ctrl+F) abre o painel. No canal dá para buscar só nele ou no servidor
 * inteiro (canais que eu vejo); na conversa, só nela. Filtros: pessoa e "com link / arquivo / imagem". O resultado
 * mostra a mensagem inteira; "Ir" leva até ela quando já está carregada na conversa.
 */
import type { Message, SearchMessagesResponse } from '@opencord/contracts';
import { Avatar, Button, Icon, Select, TextField } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { api, describeError } from '../../store/session';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import type { ChatTarget } from './ChatView';
import { jumpTo } from './PinnedMessages';
import { renderRich } from './rich';

type Has = 'link' | 'file' | 'image';
const HAS: { id: Has; label: string }[] = [
  { id: 'link', label: 'Links' },
  { id: 'file', label: 'Arquivos' },
  { id: 'image', label: 'Imagens' },
];
const PAGE = 25;

export function MessageSearch({
  target,
  serverId,
  people,
  nameOf,
}: {
  target: ChatTarget;
  /** servidor do canal (busca no servidor inteiro); ausente na conversa direta */
  serverId?: string;
  /** quem pode aparecer no filtro de pessoa */
  people: { id: string; name: string }[];
  nameOf: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [whole, setWhole] = useState(false);
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [has, setHas] = useState<Has | null>(null);
  const [res, setRes] = useState<SearchMessagesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const serverChannels = useData((s) => (serverId ? s.details[serverId]?.channels : undefined));
  const channels = serverChannels ?? [];

  // Ctrl+F abre a busca desta conversa (o Electron não tem o "localizar" do navegador)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const url = serverId
    ? `/servers/${serverId}/messages/search`
    : `/conversations/${target.conversationId}/messages/search`;
  const run = async (offset: number) => {
    const text = q.trim();
    if (!text) {
      setRes(null);
      setError(null);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ q: text, offset: String(offset), limit: String(PAGE) });
    if (authorId) params.set('authorId', authorId);
    if (has) params.set('has', has);
    if (serverId && !whole && target.channelId) params.set('channelId', target.channelId);
    try {
      const page = await api().request<SearchMessagesResponse>('GET', `${url}?${params}`);
      if (id !== seq.current) return;
      setRes(offset ? { total: page.total, messages: [...(res?.messages ?? []), ...page.messages] } : page);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(describeError(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  // busca sozinha um pouco depois de parar de digitar (e ao trocar um filtro)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(0), 350);
    return () => clearTimeout(t);
  }, [q, whole, authorId, has, open, target.channelId, target.conversationId]);

  const go = (m: Message) => {
    if (jumpTo(m.id)) {
      setOpen(false);
      return;
    }
    if (m.channelId && m.channelId !== target.channelId && serverId) {
      useUi.getState().go({ kind: 'server', serverId, channelId: m.channelId });
      setOpen(false);
      useUi.getState().toast('info', 'Mensagem em outro canal: abri o canal; role para cima se ela for antiga.');
      return;
    }
    useUi.getState().toast('info', 'Mensagem antiga: role a conversa para cima para chegar até ela.');
  };

  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.name;

  return (
    <div className="pins search" ref={box}>
      <button
        className="icon-btn"
        aria-label="Buscar mensagens"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={open}
        data-tip="Buscar mensagens (Ctrl+F)"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="search" />
      </button>
      {open && (
        <div className="pins-panel search-panel" role="dialog" aria-label="Buscar mensagens">
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(0);
            }}
          >
            <TextField
              ref={input}
              type="search"
              leadingIcon="search"
              value={q}
              placeholder={serverId && whole ? 'Buscar no servidor…' : 'Buscar nesta conversa…'}
              aria-label="Texto da busca"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="search-filters">
              {serverId && (
                <button
                  type="button"
                  className="chip"
                  aria-pressed={whole}
                  onClick={() => setWhole((w) => !w)}
                  data-tip={whole ? 'Buscar só neste canal' : 'Buscar em todos os canais que você vê'}
                >
                  <Icon name="hashtag" size={14} /> Servidor inteiro
                </button>
              )}
              {HAS.map((h) => (
                <button
                  type="button"
                  key={h.id}
                  className="chip"
                  aria-pressed={has === h.id}
                  onClick={() => setHas((cur) => (cur === h.id ? null : h.id))}
                >
                  {h.label}
                </button>
              ))}
              <Select<string>
                className="search-person"
                aria-label="Pessoa"
                placeholder="Qualquer pessoa"
                value={authorId}
                onChange={(v) => setAuthorId(v === '' ? null : v)}
                options={[
                  { value: '', label: 'Qualquer pessoa' },
                  ...people.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
          </form>
          <div className="pins-list" aria-live="polite" aria-busy={loading}>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!q.trim() && (
              <div className="pins-empty">
                <Icon name="search" size={32} />
                <p>Digite para buscar.</p>
                <p className="muted small">
                  Várias palavras: todas precisam aparecer. Também procura no nome dos arquivos.
                </p>
              </div>
            )}
            {q.trim() && res?.total === 0 && !loading && (
              <div className="pins-empty">
                <Icon name="search" size={32} />
                <p>Nada encontrado.</p>
              </div>
            )}
            {res && res.total > 0 && (
              <p className="muted small search-count">{res.total === 1 ? '1 resultado' : `${res.total} resultados`}</p>
            )}
            {res?.messages.map((m) => (
              <article key={m.id} className="pin-item">
                <Avatar id={m.author.id} name={m.author.displayName} size={32} />
                <div className="pin-main">
                  <div className="pin-meta">
                    <strong className="truncate">{nameOf(m.author.id)}</strong>
                    {whole && m.channelId && channelName(m.channelId) && (
                      <span className="muted small truncate">#{channelName(m.channelId)}</span>
                    )}
                    <time className="msg-time" dateTime={m.createdAt}>
                      {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </div>
                  {m.body && <div className="pin-body">{renderRich(m.body, nameOf)}</div>}
                  {m.attachments.length > 0 && (
                    <div className="muted small truncate">{m.attachments.map((a) => a.originalName).join(', ')}</div>
                  )}
                </div>
                <div className="pin-actions">
                  <Button variant="secondary" size="sm" onClick={() => go(m)}>
                    Ir
                  </Button>
                </div>
              </article>
            ))}
            {res && res.messages.length < res.total && (
              <Button variant="secondary" size="sm" disabled={loading} onClick={() => void run(res.messages.length)}>
                {loading ? 'Carregando…' : 'Mais resultados'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

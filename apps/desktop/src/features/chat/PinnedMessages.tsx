/**
 * Mensagens fixadas do canal ou da conversa: botão do cabeçalho que abre a lista (mais recente primeiro).
 */
import type { Message } from '@opencord/contracts';
import { Avatar, Button, Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import type { ChatTarget } from './ChatView';
import { renderRich } from './rich';

const path = (t: ChatTarget) => (t.channelId ? `/channels/${t.channelId}` : `/conversations/${t.conversationId}`);

/** Leva até a mensagem se ela já estiver carregada na conversa. */
function jumpTo(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
  el.dataset.flash = 'true';
  setTimeout(() => delete el.dataset.flash, 1600);
  return true;
}

export function PinnedMessages({
  target,
  canUnpin,
  nameOf,
}: {
  target: ChatTarget;
  canUnpin: boolean;
  nameOf: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // carrega ao abrir (sempre atualizado: alguém pode ter fixado algo enquanto estava fechado)
  useEffect(() => {
    if (!open) return;
    setPins(null);
    setError(null);
    void api()
      .request<Message[]>('GET', `${path(target)}/pins`)
      .then(setPins, (e: unknown) => setError(describeError(e)));
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
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

  const unpin = (id: string) =>
    void api()
      .request('DELETE', `/messages/${id}/pin`)
      .then(
        () => setPins((p) => p?.filter((x) => x.id !== id) ?? null),
        (e: unknown) => useUi.getState().toast('error', describeError(e)),
      );

  return (
    <div className="pins" ref={box}>
      <button
        className="icon-btn"
        aria-label="Mensagens fixadas"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={open}
        data-tip="Mensagens fixadas"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="pin" />
      </button>
      {open && (
        <div className="pins-panel" role="dialog" aria-label="Mensagens fixadas">
          <header className="pins-head">
            <Icon name="pin" size={18} />
            <h3>Mensagens fixadas</h3>
          </header>
          <div className="pins-list">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!pins && !error && <p className="muted small pins-empty">Carregando…</p>}
            {pins?.length === 0 && (
              <div className="pins-empty">
                <Icon name="pin" size={32} />
                <p>Nenhuma mensagem fixada aqui ainda.</p>
                <p className="muted small">Clique com o botão direito numa mensagem e escolha "Fixar mensagem".</p>
              </div>
            )}
            {pins?.map((m) => (
              <article key={m.id} className="pin-item">
                <Avatar id={m.author.id} name={m.author.displayName} size={32} />
                <div className="pin-main">
                  <div className="pin-meta">
                    <strong className="truncate">{m.author.displayName}</strong>
                    <time className="msg-time" dateTime={m.createdAt}>
                      {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </div>
                  {m.body && <div className="pin-body">{renderRich(m.body, nameOf)}</div>}
                  {m.attachments.length > 0 && (
                    <div className="muted small">
                      {m.attachments.length === 1 ? '1 anexo' : `${m.attachments.length} anexos`}
                    </div>
                  )}
                </div>
                <div className="pin-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (jumpTo(m.id)) setOpen(false);
                      else useUi.getState().toast('info', 'Role a conversa para cima para ver esta mensagem.');
                    }}
                  >
                    Ir
                  </Button>
                  {canUnpin && (
                    <button
                      className="icon-btn"
                      aria-label="Desafixar mensagem"
                      data-tip="Desafixar"
                      onClick={() => unpin(m.id)}
                    >
                      <Icon name="pin-off" size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

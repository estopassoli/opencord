/**
 * Avisos da conta OpenCord (ADR-0045) no painel do super admin: tudo o que a conta de avisos mandou nas DMs (ex.:
 * ideia recusada no quadro), com quem recebeu e quando. Só leitura.
 */
import type { AdminSystemMessagePage } from '@opencord/contracts';
import { Avatar, Button } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { renderRich } from '../chat/rich';
import { Section } from '../settings/SettingsModal';

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const noNames = () => 'alguém';

export function SystemMessagesTab() {
  const [page, setPage] = useState<AdminSystemMessagePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api()
      .request<AdminSystemMessagePage>('GET', '/admin/system-messages')
      .then(setPage, (e: unknown) => useUi.getState().toast('error', describeError(e)));
  }, []);

  const more = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await api().request<AdminSystemMessagePage>(
        'GET',
        `/admin/system-messages?cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      setPage((p) => (p ? { messages: [...p.messages, ...r.messages], nextCursor: r.nextCursor } : r));
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Section
      title="Avisos enviados"
      description="Mensagens que a conta OpenCord mandou nas DMs (ex.: ideia recusada no quadro). Quem recebe não pode responder."
    >
      {!page ? (
        <p className="muted">Carregando…</p>
      ) : page.messages.length === 0 ? (
        <p className="muted">Nenhum aviso enviado ainda.</p>
      ) : (
        <ul className="admin-notices">
          {page.messages.map((m) => (
            <li key={m.id}>
              <header>
                {m.recipient ? (
                  <>
                    <Avatar id={m.recipient.id} name={m.recipient.displayName} size={24} />
                    <strong className="truncate">{m.recipient.displayName}</strong>
                    <span className="muted small truncate">@{m.recipient.username}</span>
                  </>
                ) : (
                  <strong className="muted">Conta removida</strong>
                )}
                <time className="muted small" dateTime={m.createdAt}>
                  {fmt(m.createdAt)}
                </time>
              </header>
              {m.deleted ? (
                <p className="muted small">Mensagem excluída.</p>
              ) : (
                <div className="admin-notice-body">{renderRich(m.body, noNames)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => void more()}>
          Carregar mais
        </Button>
      )}
    </Section>
  );
}

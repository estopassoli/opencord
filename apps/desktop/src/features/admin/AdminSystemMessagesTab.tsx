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
import { Card, Empty, Loading } from './adminKit';

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
    <div className="adm-stack">
      <Card
        flush
        title="Caixa de saída da conta OpenCord"
        sub={page ? `${page.messages.length} carregado(s)${page.nextCursor ? ' · há mais' : ''}` : undefined}
      >
        {!page ? (
          <div className="adm-pad">
            <Loading rows={4} />
          </div>
        ) : page.messages.length === 0 ? (
          <Empty icon="mail">Nenhum aviso enviado ainda.</Empty>
        ) : (
          <ul className="adm-notices">
            {page.messages.map((m) => (
              <li key={m.id}>
                {m.recipient ? (
                  <Avatar id={m.recipient.id} name={m.recipient.displayName} size={32} />
                ) : (
                  <span className="adm-notice-gone" aria-hidden>
                    ?
                  </span>
                )}
                <div className="adm-notice-main">
                  <header>
                    {m.recipient ? (
                      <>
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {page?.nextCursor && (
        <div className="adm-more-row">
          <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void more()}>
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}

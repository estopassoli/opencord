import { askConfirm } from '../../components/AskDialog';
import type { ServerBan, ServerDetail } from '@opencord/contracts';
import { Avatar, Button } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Configurações do servidor › Banidos (ADR-0034): quem está banido, por quem e por quê; "Desbanir" com confirmação. */
export function BansTab({ detail }: { detail: ServerDetail }) {
  const [bans, setBans] = useState<ServerBan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtime = useSession((s) => s.realtime);

  useEffect(() => {
    let cancelled = false;
    api()
      .request<ServerBan[]>('GET', `/servers/${detail.id}/bans`)
      .then((list) => !cancelled && setBans(list))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  // acompanha banimentos feitos por outros moderadores enquanto a aba está aberta
  useEffect(() => {
    if (!realtime) return;
    const offAdd = realtime.on('server:ban:added', (b) => {
      if (b.serverId !== detail.id) return;
      setBans((cur) => (cur ? [b, ...cur.filter((x) => x.user.id !== b.user.id)] : cur));
    });
    const offRemove = realtime.on('server:ban:removed', (e) => {
      if (e.serverId !== detail.id) return;
      setBans((cur) => (cur ? cur.filter((x) => x.user.id !== e.userId) : cur));
    });
    return () => {
      offAdd();
      offRemove();
    };
  }, [realtime, detail.id]);

  const unban = async (b: ServerBan) => {
    const ok = await askConfirm(`${b.user.displayName} volta a poder entrar no servidor.`, {
      title: 'Desbanir',
      confirmLabel: 'Desbanir',
    });
    if (!ok) return;
    try {
      await api().request('DELETE', `/servers/${detail.id}/bans/${b.user.id}`);
      setBans((cur) => (cur ? cur.filter((x) => x.user.id !== b.user.id) : cur));
      useUi.getState().toast('success', 'Desbanido.');
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!bans) return <p className="muted">Carregando…</p>;
  if (bans.length === 0) return <p className="muted">Ninguém banido.</p>;

  return (
    <ul className="admin-list" aria-label="Banidos">
      {bans.map((b) => (
        <li key={b.user.id} className="admin-row">
          <div className="admin-row-main">
            <Avatar id={b.user.id} name={b.user.displayName} size={32} />
            <div className="admin-row-text">
              <span className="truncate">{b.user.displayName}</span>
              <span className="muted small truncate">@{b.user.username}</span>
            </div>
            <div className="admin-row-text ban-meta">
              <span className="truncate">{b.reason || <span className="muted">Sem motivo</span>}</span>
              <span className="muted small truncate">
                por {b.by?.displayName ?? 'conta removida'} · {fmtDate(b.createdAt)}
              </span>
            </div>
            <div className="admin-row-actions">
              <Button variant="secondary" size="sm" onClick={() => void unban(b)}>
                Desbanir
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

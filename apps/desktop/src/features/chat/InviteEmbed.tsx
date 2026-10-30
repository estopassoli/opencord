import type { InvitePreview, ServerDetail } from '@opencord/contracts';
import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { ServerIcon } from '../../components/ServerIcon';
import { api, describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';

/** Códigos de convite em links `.../invite/<código>` do texto (no máximo 3 por mensagem). */
export function inviteCodesIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/https?:\/\/[^\s]+\/invite\/([A-Za-z0-9]{10})(?![A-Za-z0-9])/g)) out.add(m[1]!);
  return [...out].slice(0, 3);
}

/** Cartão do convite numa mensagem: imagem, nome e membros do servidor, com Entrar (ou Abrir, se já é membro). */
export function InviteEmbed({ code }: { code: string }) {
  const [p, setP] = useState<InvitePreview | null | 'invalid'>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api()
      .request<InvitePreview>('GET', `/invites/${code}`)
      .then(
        (r) => alive && setP(r),
        () => alive && setP('invalid'),
      );
    return () => {
      alive = false;
    };
  }, [code]);
  if (!p) return <div className="invite-embed" aria-busy="true" />;
  if (p === 'invalid')
    return (
      <div className="invite-embed">
        <span className="invite-embed-icon invite-embed-dead" aria-hidden="true">
          <Icon name="close" size={20} />
        </span>
        <span className="invite-embed-names">
          <span className="invite-embed-kicker">Convite</span>
          <strong>Convite inválido</strong>
        </span>
      </div>
    );
  const open = () => useUi.getState().go({ kind: 'server', serverId: p.server.id, channelId: null });
  const join = async () => {
    setBusy(true);
    try {
      await api().request<ServerDetail>('POST', `/invites/${p.code}`);
      await loadServer(p.server.id);
      open();
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="invite-embed">
      <span className="invite-embed-icon" aria-hidden="true">
        <ServerIcon name={p.server.name} iconKey={p.server.iconKey} official={p.server.official} />
      </span>
      <span className="invite-embed-names">
        <span className="invite-embed-kicker">Convite para um servidor</span>
        <strong className="truncate">
          {p.server.name}
          {(p.server.official || p.server.verified) && (
            <Icon name="verified" size={14} active label="Servidor verificado" />
          )}
        </strong>
        <span className="muted small">
          {p.memberCount} {p.memberCount === 1 ? 'membro' : 'membros'}
        </span>
      </span>
      {p.joined ? (
        <Button variant="secondary" size="sm" onClick={open}>
          Abrir
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => void join()}>
          Entrar
        </Button>
      )}
    </div>
  );
}

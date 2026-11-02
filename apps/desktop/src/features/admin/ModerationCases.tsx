import type { ModerationCase, ReviewModerationCaseRequest } from '@opencord/contracts';
import { Avatar, Button, Icon, Select, TextField } from '@opencord/ui';
import { useState } from 'react';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const CATEGORY_LABEL: Record<string, string> = {
  assedio: 'Assédio',
  odio: 'Ódio',
  sexual: 'Conteúdo sexual',
  menores: 'Menores',
  violencia: 'Violência',
  autoagressao: 'Autoagressão',
  ilegal: 'Ilegal',
  golpe: 'Golpe',
  spam: 'Spam',
  doxxing: 'Dados pessoais',
  outro: 'Outro',
};

const STATUS_LABEL: Record<ModerationCase['status'], string> = {
  pending: 'Aguardando revisão',
  approved: 'Aprovado',
  rejected: 'Reprovado',
  blocked: 'Bloqueado pela IA',
};

type Punishment = 'none' | 'timeout10m' | 'timeout1h' | 'timeout1d' | 'timeout7d' | 'kick' | 'ban';
const PUNISHMENTS: { value: Punishment; label: string }[] = [
  { value: 'none', label: 'Sem punição' },
  { value: 'timeout10m', label: 'Castigo de 10 minutos' },
  { value: 'timeout1h', label: 'Castigo de 1 hora' },
  { value: 'timeout1d', label: 'Castigo de 1 dia' },
  { value: 'timeout7d', label: 'Castigo de 7 dias' },
  { value: 'kick', label: 'Expulsar do servidor' },
  { value: 'ban', label: 'Banir do servidor' },
];
const MIN = 60_000;
function punishmentOf(p: Punishment): ReviewModerationCaseRequest['punishment'] {
  switch (p) {
    case 'timeout10m':
      return { kind: 'timeout', durationMs: 10 * MIN };
    case 'timeout1h':
      return { kind: 'timeout', durationMs: 60 * MIN };
    case 'timeout1d':
      return { kind: 'timeout', durationMs: 24 * 60 * MIN };
    case 'timeout7d':
      return { kind: 'timeout', durationMs: 7 * 24 * 60 * MIN };
    case 'kick':
      return { kind: 'kick' };
    case 'ban':
      return { kind: 'ban', deleteMessageSeconds: 0 };
    default:
      return null;
  }
}

/** Um envio retido pela IA (ADR-0036): quem, onde, o que, por quê; aprovar publica, reprovar descarta (e pune). */
export function ModerationCaseCard({
  c,
  showServer,
  onReviewed,
}: {
  c: ModerationCase;
  showServer?: boolean;
  onReviewed: (c: ModerationCase) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [punishment, setPunishment] = useState<Punishment>('none');
  const [busy, setBusy] = useState(false);
  const open = c.status === 'pending' || c.status === 'blocked';

  const review = async (dto: ReviewModerationCaseRequest) => {
    setBusy(true);
    try {
      const r = await api().request<ModerationCase>('POST', `/moderation/cases/${c.id}/review`, dto);
      onReviewed(r);
      useUi.getState().toast('success', dto.decision === 'approve' ? 'Publicado.' : 'Reprovado.');
      setRejecting(false);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const where = [
    showServer ? c.server?.name : null,
    c.channelName ? `#${c.channelName}` : c.conversationId ? 'mensagem direta' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="mod-case" data-status={c.status}>
      <div className="mod-case-head">
        <Avatar id={c.author.id} name={c.author.displayName} size={32} />
        <div className="admin-row-text">
          <span className="truncate">
            <strong>{c.author.displayName}</strong>
            {where ? <span className="muted"> em {where}</span> : null}
          </span>
          <span className="muted small truncate">{fmtDate(c.createdAt)}</span>
        </div>
        <span className="mod-badge" data-kind={c.status}>
          <Icon name={c.status === 'approved' ? 'check' : c.status === 'pending' ? 'clock' : 'block'} size={14} />
          {STATUS_LABEL[c.status]}
        </span>
      </div>
      <p className="mod-case-reason">
        <Icon name="shield" size={14} />
        <span>
          {c.category ? <strong>{CATEGORY_LABEL[c.category] ?? c.category}: </strong> : null}
          {c.reason}
        </span>
      </p>
      {c.autoAction && (
        <p className="mod-case-reason">
          <Icon name="block" size={14} />
          <span>
            Bloqueio automático: conta suspensa
            {c.autoAction === 'suspended+device' ? ' e dispositivo bloqueado' : ''}. Reativar fica no painel admin →
            Usuários.
          </span>
        </p>
      )}
      {c.body && <blockquote className="mod-case-body">{c.body}</blockquote>}
      {c.attachments.length > 0 && (
        <ul className="mod-thumbs" aria-label="Anexos retidos">
          {c.attachments.map((a) => (
            <li key={a.id}>
              {a.mime.startsWith('image/') ? (
                <a href={a.url} target="_blank" rel="noreferrer">
                  <img src={a.url} alt={a.originalName} loading="lazy" />
                </a>
              ) : a.mime.startsWith('video/') ? (
                <video src={a.url} controls preload="metadata" />
              ) : (
                <a href={a.url} target="_blank" rel="noreferrer" className="mod-file">
                  <Icon name="attach" size={16} /> {a.originalName}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {!open && (
        <p className="muted small">
          {c.reviewedBy ? `${STATUS_LABEL[c.status]} por ${c.reviewedBy.displayName}` : STATUS_LABEL[c.status]}
          {c.reviewedAt ? ` · ${fmtDate(c.reviewedAt)}` : ''}
          {c.reviewNote ? ` · ${c.reviewNote}` : ''}
        </p>
      )}
      {open && !rejecting && (
        <div className="form-actions mod-case-actions">
          <Button
            variant="secondary"
            size="sm"
            icon="check"
            disabled={busy}
            onClick={() => void review({ decision: 'approve' })}
          >
            Aprovar e publicar
          </Button>
          <Button variant="danger" size="sm" icon="block" disabled={busy} onClick={() => setRejecting(true)}>
            Reprovar…
          </Button>
        </div>
      )}
      {open && rejecting && (
        <form
          className="form mod-reject"
          onSubmit={(e) => {
            e.preventDefault();
            void review({ decision: 'reject', note: note.trim() || undefined, punishment: punishmentOf(punishment) });
          }}
        >
          <TextField
            label="Motivo (a pessoa vê)"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: ofensa direta a outro membro"
          />
          {c.serverId && (
            <Select<Punishment> label="Punição" value={punishment} onChange={setPunishment} options={PUNISHMENTS} />
          )}
          <div className="form-actions">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" type="submit" disabled={busy}>
              Confirmar reprovação
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function ModerationCasesList({
  cases,
  showServer,
  onReviewed,
  empty,
}: {
  cases: ModerationCase[];
  showServer?: boolean;
  onReviewed: (c: ModerationCase) => void;
  empty: string;
}) {
  if (cases.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="mod-cases" aria-label="Envios retidos pela moderação">
      {cases.map((c) => (
        <ModerationCaseCard key={c.id} c={c} showServer={showServer} onReviewed={onReviewed} />
      ))}
    </ul>
  );
}

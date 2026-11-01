/**
 * Melhores momentos: os vídeos (clipes) compartilhados no servidor, ranqueados por quantas pessoas reagiram no
 * período. Pódio para os três primeiros; "Ir" leva até a mensagem.
 */
import type { Highlight } from '@opencord/contracts';
import { Avatar, Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useAliases } from '../../lib/names';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { jumpTo } from '../chat/PinnedMessages';

const PERIODS = [
  { days: 7, label: 'Esta semana' },
  { days: 30, label: 'Este mês' },
  { days: 90, label: '3 meses' },
] as const;
const MEDALS = ['🥇', '🥈', '🥉'];

export function HighlightsDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [days, setDays] = useState<number>(7);
  const [list, setList] = useState<Highlight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useData((s) => s.details[serverId]);
  const aliases = useAliases();
  const nameOf = (id: string, fallback: string) => {
    const m = detail?.members.find((x) => x.user.id === id);
    return aliases?.[id] ?? m?.nickname ?? m?.user.displayName ?? fallback;
  };

  useEffect(() => {
    setList(null);
    setError(null);
    void api()
      .request<Highlight[]>('GET', `/servers/${serverId}/highlights?days=${days}&limit=30`)
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, [serverId, days]);

  const go = (h: Highlight) => {
    const m = h.message;
    if (jumpTo(m.id)) return onClose();
    if (m.channelId) useUi.getState().go({ kind: 'server', serverId, channelId: m.channelId });
    onClose();
    useUi.getState().toast('info', 'Abri o canal; role para cima se o clipe for antigo.');
  };

  return (
    <Dialog title="Melhores momentos" onClose={onClose} wide>
      <div className="highlights">
        <div className="search-filters">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              className="chip"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
          <span className="muted small">Ranking pelas reações: cada pessoa conta uma vez por clipe.</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!list && !error && <p className="muted small">Carregando…</p>}
        {list?.length === 0 && (
          <div className="pins-empty">
            <Icon name="trophy" size={32} />
            <p>Nenhum clipe neste período.</p>
            <p className="muted small">
              Compartilhe um clipe num canal e reaja nos dos outros: os mais reagidos aparecem aqui.
            </p>
          </div>
        )}
        <ol className="highlight-list">
          {list?.map((h, i) => {
            const video = h.message.attachments.find((a) => a.mime.startsWith('video/'));
            return (
              <li key={h.message.id} className="highlight-card" data-rank={i < 3 ? i + 1 : undefined}>
                <div className="highlight-media">
                  {video && <video src={video.url} controls preload="metadata" className="attachment-video" />}
                  {i < 3 && (
                    <span className="highlight-medal" aria-label={`${i + 1}º lugar`}>
                      {MEDALS[i]}
                    </span>
                  )}
                </div>
                <div className="highlight-meta">
                  <Avatar id={h.message.author.id} name={h.message.author.displayName} size={24} />
                  <strong className="truncate">{nameOf(h.message.author.id, h.message.author.displayName)}</strong>
                  <span className="muted small truncate">#{h.channelName}</span>
                  <span className="highlight-score" data-tip="Pessoas que reagiram">
                    <Icon name="star" size={14} /> {h.score}
                  </span>
                  <span className="muted small">
                    {new Date(h.message.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                  </span>
                  <span className="spacer" />
                  <Button size="sm" variant="secondary" onClick={() => go(h)}>
                    Ir
                  </Button>
                </div>
                {h.message.body && <p className="highlight-body truncate">{h.message.body}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    </Dialog>
  );
}

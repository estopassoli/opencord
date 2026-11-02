/**
 * Respostas efêmeras de bots (ADR-0032): cartões "só você vê" logo acima do composer. "Pensando…" enquanto o bot
 * adiou a resposta; fecham no X ou sozinhos depois de 10 minutos. Não são mensagens do canal. Podem trazer embeds
 * e botões/menus (ADR-0034): o clique manda `component` com `ephemeralOf`, e `update` troca o cartão no lugar.
 */
import { Avatar, Icon } from '@opencord/ui';
import { useBots } from '../../store/bots';
import { useUi } from '../../store/ui';
import { ComponentRows } from './Components';
import { EmbedCards } from './Embeds';
import { renderRich } from './rich';

export function EphemeralReplies({ channelId, nameOf }: { channelId: string; nameOf: (id: string) => string }) {
  const list = useBots((s) => s.ephemeral[channelId]);
  const serverId = useUi((s) => (s.view.kind === 'server' ? s.view.serverId : undefined));
  if (!list?.length) return null;
  return (
    <div className="ephemeral-list" aria-live="polite" aria-label="Respostas só para você">
      {list.map((r) => (
        <article key={r.id} className="ephemeral-card">
          <Avatar id={r.bot.id} name={r.bot.displayName} size={28} />
          <div className="ephemeral-main">
            <header className="ephemeral-head">
              <strong className="truncate">{r.bot.displayName}</strong>
              <span className="bot-badge">APP</span>
              <span className="muted small">/{r.command}</span>
              <span className="ephemeral-only">
                <Icon name="eye" size={12} /> Só você vê
              </span>
            </header>
            <div className="ephemeral-body">
              {r.content === null ? (
                <span className="ephemeral-thinking">
                  <span className="ephemeral-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  Pensando…
                </span>
              ) : (
                r.content && renderRich(r.content, nameOf)
              )}
              {r.embeds.length > 0 && (
                <EmbedCards
                  embeds={r.embeds}
                  nameOf={nameOf}
                  author={{ id: r.bot.id, name: r.bot.displayName, createdAt: new Date(r.at).toISOString() }}
                />
              )}
              {r.components.length > 0 && (
                <ComponentRows rows={r.components} source={{ ephemeralOf: r.id }} serverId={serverId} nameOf={nameOf} />
              )}
            </div>
          </div>
          <button
            className="icon-btn icon-btn-sm"
            aria-label={`Fechar resposta de ${r.bot.displayName}`}
            data-tip="Fechar"
            onClick={() => useBots.getState().dismiss(channelId, r.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}

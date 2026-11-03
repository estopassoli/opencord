import type { Embed } from '@opencord/contracts';
import type { CSSProperties, MouseEvent } from 'react';
import { useUi, type MediaItem } from '../../store/ui';
import { formatEmbedDate, groupEmbedFields } from './bot-ui';
import { ExternalLink, renderRich } from './rich';
import { ChatImage } from './ChatImage';

/**
 * Cartões ricos de bots e webhooks (ADR-0034): barra colorida à esquerda, autor, título com link, descrição em
 * markdown (mesmo renderizador das mensagens), campos em grade, miniatura à direita, imagem grande embaixo e rodapé
 * com data. Imagens abrem no visualizador de mídia da conversa.
 */
interface Props {
  embeds: Embed[];
  nameOf: (id: string) => string;
  /** quem enviou e quando (visualizador de imagem) */
  author?: { id: string; name: string; createdAt: string };
}

/** item do visualizador para uma imagem de embed (sem tamanho em bytes: vem de fora do servidor) */
function mediaItemOf(url: string, title: string | undefined, author: Props['author']): MediaItem {
  return {
    id: url,
    url,
    name: title ?? 'imagem',
    mime: 'image/*',
    sizeBytes: 0,
    width: null,
    height: null,
    authorId: author?.id ?? '',
    authorName: author?.name ?? '',
    createdAt: author?.createdAt ?? new Date().toISOString(),
  };
}

export function EmbedCards({ embeds, nameOf, author }: Props) {
  if (!embeds.length) return null;
  // todas as imagens dos embeds da mensagem: ← → no visualizador passam por elas
  const gallery = embeds.flatMap((e) =>
    [e.thumbnail?.url, e.image?.url].filter((u): u is string => Boolean(u)).map((u) => mediaItemOf(u, e.title, author)),
  );
  const openImage = (e: MouseEvent, url: string) => {
    // clique comum abre o visualizador; ctrl/cmd/shift segue o link
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const index = gallery.findIndex((g) => g.url === url);
    if (index >= 0) useUi.getState().openMedia(gallery, index);
  };
  return (
    <div className="embeds">
      {embeds.map((e, i) => (
        <EmbedCard key={i} embed={e} nameOf={nameOf} openImage={openImage} />
      ))}
    </div>
  );
}

function EmbedCard({
  embed: e,
  nameOf,
  openImage,
}: {
  embed: Embed;
  nameOf: Props['nameOf'];
  openImage: (ev: MouseEvent, url: string) => void;
}) {
  const rows = groupEmbedFields(e.fields ?? []);
  // sem cor o CSS usa a barra neutra
  const style = e.color ? ({ '--embed-color': e.color } as CSSProperties) : undefined;
  return (
    <article className="embed" style={style}>
      <div className="embed-body">
        {e.author && (
          <div className="embed-author">
            {e.author.iconUrl && <img src={e.author.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            {e.author.url ? (
              <ExternalLink href={e.author.url} className="truncate">
                {e.author.name}
              </ExternalLink>
            ) : (
              <span className="truncate">{e.author.name}</span>
            )}
          </div>
        )}
        {e.title && (
          <div className="embed-title">{e.url ? <ExternalLink href={e.url}>{e.title}</ExternalLink> : e.title}</div>
        )}
        {e.description && <div className="embed-desc">{renderRich(e.description, nameOf)}</div>}
        {rows.length > 0 && (
          <div className="embed-fields">
            {rows.map((row, r) => (
              <div key={r} className="embed-row">
                {row.map((f, c) => (
                  <div key={c} className="embed-field">
                    <div className="embed-field-name">{f.name}</div>
                    <div className="embed-field-value">{renderRich(f.value, nameOf)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {e.thumbnail && (
        <a
          className="embed-thumb"
          href={e.thumbnail.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Abrir miniatura"
          onClick={(ev) => openImage(ev, e.thumbnail!.url)}
        >
          <img src={e.thumbnail.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </a>
      )}
      {e.image && (
        <a
          className="embed-image"
          href={e.image.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={e.title ? `Abrir imagem de ${e.title}` : 'Abrir imagem'}
          onClick={(ev) => openImage(ev, e.image!.url)}
        >
          <ChatImage
            src={e.image.url}
            alt={e.title ?? ''}
            maxWidth={480}
            maxHeight={300}
            referrerPolicy="no-referrer"
          />
        </a>
      )}
      {(e.footer || e.timestamp) && (
        <footer className="embed-footer">
          {e.footer?.iconUrl && <img src={e.footer.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          {e.footer && <span className="truncate">{e.footer.text}</span>}
          {e.footer && e.timestamp && <span aria-hidden>·</span>}
          {e.timestamp && (
            <time dateTime={e.timestamp} data-tip={new Date(e.timestamp).toLocaleString('pt-BR')}>
              {formatEmbedDate(e.timestamp)}
            </time>
          )}
        </footer>
      )}
    </article>
  );
}

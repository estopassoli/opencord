/**
 * Catálogo do Spotify na música da chamada: resultados da pesquisa (músicas, álbuns, playlists) com capa e link para
 * abrir no Spotify, e o crédito "Conteúdo do Spotify" exigido pelas diretrizes de marca deles.
 */
import type { MusicTrack, SpotifyKind, SpotifySearchResult } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { bridge } from '../../lib/bridge';
import { fmt, thumb } from './WatchTogether';

export const SPOTIFY_HOME = 'https://open.spotify.com';

export function openSpotify(url: string) {
  if (bridge) void bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/** capa da faixa: a do catálogo quando veio do Spotify; senão a miniatura do vídeo */
export const coverOf = (t: MusicTrack) => t.spotify?.image ?? (t.videoId ? thumb(t.videoId) : null);

/** Crédito do catálogo (diretrizes de marca do Spotify): nome do serviço e link para ele. */
export function SpotifyCredit() {
  return (
    <button type="button" className="spotify-credit small" onClick={() => openSpotify(SPOTIFY_HOME)}>
      <Icon name="music" size={14} />
      Conteúdo do Spotify
    </button>
  );
}

export function SpotifyResults({
  result,
  busy,
  onAdd,
}: {
  result: SpotifySearchResult;
  busy: boolean;
  onAdd: (kind: SpotifyKind, id: string, label: string) => void;
}) {
  const empty = !result.tracks.length && !result.albums.length && !result.playlists.length;
  return (
    <div className="spotify-results" aria-label="Resultados do Spotify">
      {empty && <p className="muted small">Nada encontrado no Spotify.</p>}
      {result.tracks.length > 0 && (
        <section>
          <h4 className="small muted">Músicas</h4>
          <ul>
            {result.tracks.map((t) => (
              <Row
                key={t.id}
                image={t.image}
                title={t.title}
                sub={`${t.artists} · ${fmt(t.durationMs / 1000)}`}
                url={t.url}
                busy={busy}
                onAdd={() => onAdd('track', t.id, t.title)}
              />
            ))}
          </ul>
        </section>
      )}
      {result.albums.length > 0 && (
        <section>
          <h4 className="small muted">Álbuns</h4>
          <ul>
            {result.albums.map((a) => (
              <Row
                key={a.id}
                image={a.image}
                title={a.name}
                sub={`${a.artists} · ${a.total} ${a.total === 1 ? 'música' : 'músicas'}`}
                url={a.url}
                busy={busy}
                onAdd={() => onAdd('album', a.id, a.name)}
              />
            ))}
          </ul>
        </section>
      )}
      {result.playlists.length > 0 && (
        <section>
          <h4 className="small muted">Playlists</h4>
          <ul>
            {result.playlists.map((p) => (
              <Row
                key={p.id}
                image={p.image}
                title={p.name}
                sub={`${p.owner ? `de ${p.owner} · ` : ''}${p.total} ${p.total === 1 ? 'música' : 'músicas'}`}
                url={p.url}
                busy={busy}
                onAdd={() => onAdd('playlist', p.id, p.name)}
              />
            ))}
          </ul>
        </section>
      )}
      <SpotifyCredit />
    </div>
  );
}

function Row({
  image,
  title,
  sub,
  url,
  busy,
  onAdd,
}: {
  image: string | null;
  title: string;
  sub: string;
  url: string;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <li className="spotify-row">
      {image ? <img src={image} alt="" draggable={false} /> : <span className="spotify-cover-empty" aria-hidden />}
      <span className="spotify-row-names">
        <span className="truncate">{title}</span>
        <span className="muted small truncate">{sub}</span>
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Abrir ${title} no Spotify`}
        data-tip="Abrir no Spotify"
        onClick={() => openSpotify(url)}
      >
        <Icon name="link" size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Adicionar ${title} à fila`}
        data-tip="Adicionar à fila"
        disabled={busy}
        onClick={onAdd}
      >
        <Icon name="plus" size={18} />
      </button>
    </li>
  );
}

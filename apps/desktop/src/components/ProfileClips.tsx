/**
 * Clipes em destaque no perfil (ADR-0057): até 6 miniaturas; clicar abre o vídeo no visualizador de mídia.
 */
import type { AccountClip } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useUi, type MediaItem } from '../store/ui';

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ProfileClips({
  clips,
  owner,
  className = 'pc-section',
}: {
  clips: AccountClip[] | undefined;
  owner: { id: string; displayName: string };
  className?: string;
}) {
  if (!clips?.length) return null;
  const items: MediaItem[] = clips.map((c) => ({
    id: c.id,
    url: c.url,
    name: c.game ? `${c.game} · ${c.title}` : c.title,
    mime: 'video/mp4',
    sizeBytes: c.sizeBytes,
    width: c.width,
    height: c.height,
    authorId: owner.id,
    authorName: owner.displayName,
    createdAt: new Date(c.recordedAt).toISOString(),
  }));
  return (
    <section className={className}>
      <h4>Clipes em destaque</h4>
      <ul className="profile-clips">
        {clips.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="profile-clip"
              aria-label={`Ver ${items[i]!.name}`}
              data-tip={items[i]!.name}
              onClick={() => useUi.getState().openMedia(items, i)}
            >
              {c.thumbUrl ? (
                <img src={c.thumbUrl} alt="" draggable={false} loading="lazy" />
              ) : (
                <Icon name="film" size={20} />
              )}
              <span className="profile-clip-play" aria-hidden>
                <Icon name="play" size={16} />
              </span>
              <span className="profile-clip-dur">{dur(c.durationMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Insígnias (ADR-0043): o catálogo vem em InstanceInfo.badges; cada pessoa traz os ids em UserPublic.badges.
 * Ao lado do nome aparecem até 3 ícones (dica com o nome); no perfil, todas com nome e descrição.
 */
import type { Badge } from '@opencord/contracts';
import { Icon, ICON_NAMES, type IconName } from '@opencord/ui';
import { useShallow } from 'zustand/react/shallow';
import { useData } from '../store/data';
import { useSession } from '../store/session';

const EMPTY: Badge[] = [];

/** ícones oferecidos no painel admin (o servidor aceita qualquer nome; desconhecido vira estrela) */
export const BADGE_ICONS: IconName[] = [
  'star',
  'verified',
  'shield',
  'crown',
  'trophy',
  'bug',
  'music',
  'gamepad',
  'film',
  'microphone',
  'emoji',
  'kanban',
  'tag',
  'pin',
  'lock',
  'link',
  'mail',
  'home',
  'server',
  'calendar',
  'clock',
  'signal',
  'spotlight',
  'scissors',
  'camera',
  'image',
  'users',
  'user',
  'bell',
  'moon',
  'sun',
  'activities',
  'soundboard',
  'record',
  'send',
  'eye',
  'wifi',
  'folder',
  'smartphone',
  'keyboard',
];

/** nome salvo no servidor que este app não conhece (ou de uma versão mais nova) vira estrela */
const iconOf = (name: string | null): IconName =>
  name && (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'star';

export function useBadgeCatalog(): Badge[] {
  return useData((s) => s.instance?.badges ?? EMPTY);
}

export function useBadgeImageUrl(key: string | null): string | null {
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  return key && base ? `${base}/badge-images/${encodeURIComponent(key)}` : null;
}

/** Ids atuais da pessoa: o que veio de um perfil vivo (membros, amigos, conversas) ou o recebido. */
export function useLiveBadgeIds(userId: string, fallback: string[] | undefined): string[] {
  return useData(
    useShallow((s) => {
      if (s.me?.id === userId) return s.me.badges ?? [];
      for (const d of Object.values(s.details)) {
        const m = d.members.find((x) => x.user.id === userId);
        if (m) return m.user.badges ?? [];
      }
      const f = s.friends.find((x) => x.user.id === userId);
      if (f) return f.user.badges ?? [];
      return fallback ?? [];
    }),
  );
}

/** as até 3 que a pessoa escolheu destacar (vazio = sem escolha) */
function useFeaturedIds(userId: string, fallback: string[] | undefined): string[] {
  return useData(
    useShallow((s) => {
      if (s.me?.id === userId) return s.me.featuredBadges ?? [];
      for (const d of Object.values(s.details)) {
        const m = d.members.find((x) => x.user.id === userId);
        if (m) return m.user.featuredBadges ?? [];
      }
      const f = s.friends.find((x) => x.user.id === userId);
      if (f) return f.user.featuredBadges ?? [];
      return fallback ?? [];
    }),
  );
}

export function BadgeGlyph({
  badge,
  size = 14,
}: {
  badge: Pick<Badge, 'icon' | 'color' | 'imageKey' | 'name'>;
  size?: number;
}) {
  const url = useBadgeImageUrl(badge.imageKey);
  if (url) return <img className="badge-img" src={url} alt="" width={size} height={size} draggable={false} />;
  return (
    <span className="badge-glyph" style={badge.color ? { color: badge.color } : undefined}>
      <Icon name={iconOf(badge.icon)} size={size} />
    </span>
  );
}

/** Até `max` insígnias como ícones ao lado do nome; o resto vira "+N". */
export function UserBadges({
  userId,
  fallback,
  featuredFallback,
  max = 3,
  size = 14,
}: {
  userId: string;
  fallback?: string[] | undefined;
  featuredFallback?: string[] | undefined;
  max?: number;
  size?: number;
}) {
  const catalog = useBadgeCatalog();
  const ids = useLiveBadgeIds(userId, fallback);
  const featured = useFeaturedIds(userId, featuredFallback);
  const badges = catalog.filter((b) => ids.includes(b.id));
  if (!badges.length) return null;
  // as escolhidas pela pessoa; sem escolha, as primeiras do catálogo
  const picked = featured.length ? badges.filter((b) => featured.includes(b.id)) : badges;
  const shown = picked.slice(0, max);
  const rest = badges.length - shown.length;
  return (
    <span className="user-badges">
      {shown.map((b) => (
        <span key={b.id} className="user-badge" data-tip={b.name} role="img" aria-label={`Insígnia: ${b.name}`}>
          <BadgeGlyph badge={b} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="user-badge-more"
          data-tip={badges
            .filter((b) => !shown.includes(b))
            .map((b) => b.name)
            .join(', ')}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Lista do cartão de perfil: verificado primeiro, depois as insígnias com nome e descrição. */
export function ProfileBadges({
  userId,
  fallback,
  verified,
}: {
  userId: string;
  fallback?: string[] | undefined;
  verified?: boolean | undefined;
}) {
  const catalog = useBadgeCatalog();
  const ids = useLiveBadgeIds(userId, fallback);
  const badges = catalog.filter((b) => ids.includes(b.id));
  if (!badges.length && !verified) return null;
  return (
    <ul className="profile-badges" aria-label="Insígnias">
      {verified && (
        <li data-tip="Perfil verificado pela equipe do OpenCord">
          <span className="badge-glyph is-verified">
            <Icon name="verified" size={16} active />
          </span>
          <span className="truncate">Verificado</span>
        </li>
      )}
      {badges.map((b) => (
        <li key={b.id} {...(b.description ? { 'data-tip': b.description } : {})}>
          <BadgeGlyph badge={b} size={16} />
          <span className="truncate">{b.name}</span>
        </li>
      ))}
    </ul>
  );
}

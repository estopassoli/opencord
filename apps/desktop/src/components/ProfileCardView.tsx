/**
 * Topo do cartão de perfil (ADR-0048): banner, foto, nome, insígnias e bio, tingido pelas duas cores da pessoa.
 * O mesmo desenho serve o cartão de verdade e a prévia ao vivo do editor.
 */
import type { ProfileAppearance, PresenceStatus } from '@opencord/contracts';
import { Avatar } from '@opencord/ui';
import type { CSSProperties, ReactNode } from 'react';
import { renderRich } from '../features/chat/rich';
import { useSession } from '../store/session';
import { UserBadges } from './UserBadges';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};

/** variáveis CSS do cartão: degradê das duas cores e texto claro/escuro conforme o fundo */
export function profileThemeVars(colors: [string, string] | null): CSSProperties | undefined {
  if (!colors) return undefined;
  const [a, b] = colors;
  const dark = (lum(a) + lum(b)) / 2 < 0.35;
  return {
    '--pc-a': a,
    '--pc-b': b,
    '--pc-text': dark ? '#ffffff' : '#111114',
    '--pc-muted': dark ? 'rgb(255 255 255 / 0.72)' : 'rgb(17 17 20 / 0.7)',
  } as CSSProperties;
}

export function useBannerUrl(a: Pick<ProfileAppearance, 'bannerKey' | 'bannerUrl'>): string | null {
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  if (a.bannerUrl) return a.bannerUrl;
  return a.bannerKey && base ? `${base}/banners/${encodeURIComponent(a.bannerKey)}` : null;
}

export function ProfileCardHead({
  user,
  name,
  subtitle,
  appearance,
  bannerSrc,
  status,
  children,
}: {
  user: { id: string; displayName: string; badges?: string[] | undefined };
  name: ReactNode;
  subtitle?: ReactNode;
  appearance: ProfileAppearance;
  /** prévia do editor: imagem local ainda não enviada */
  bannerSrc?: string | null;
  status?: PresenceStatus | undefined;
  children?: ReactNode;
}) {
  const stored = useBannerUrl(appearance);
  const banner = bannerSrc === undefined ? stored : bannerSrc;
  return (
    <div className="pc-head" data-themed={appearance.colors ? 'true' : undefined}>
      <div className="pc-banner" data-empty={banner ? undefined : 'true'}>
        {banner && <img src={banner} alt="" draggable={false} />}
      </div>
      <div className="pc-avatar">
        <Avatar id={user.id} name={user.displayName} size={80} status={status} />
      </div>
      <div className="pc-names">
        <strong className="pc-name">
          {name}
          <UserBadges userId={user.id} fallback={user.badges} />
        </strong>
        {subtitle && <div className="pc-sub">{subtitle}</div>}
      </div>
      {appearance.bio && <div className="pc-bio">{renderRich(appearance.bio, () => 'alguém')}</div>}
      {children}
    </div>
  );
}

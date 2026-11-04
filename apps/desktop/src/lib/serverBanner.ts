/**
 * Faixa do servidor (ADR-0050): cor pronta (degradê desenhado aqui) ou imagem enviada. Usada no perfil do servidor,
 * no topo da lista de canais e no convite.
 */
import type { ServerSummary } from '@opencord/contracts';
import type { CSSProperties } from 'react';
import { useSession } from '../store/session';

export const BANNER_GRADIENTS: Record<string, string> = {
  noite: 'linear-gradient(160deg, #2a1b4a, #120c24)',
  rosa: 'linear-gradient(160deg, #ff5fa8, #c2187a)',
  vermelho: 'linear-gradient(160deg, #ff5b5b, #a61c1c)',
  laranja: 'linear-gradient(160deg, #ffa44d, #d0601a)',
  amarelo: 'linear-gradient(160deg, #ffe066, #d1a514)',
  lilas: 'linear-gradient(160deg, #c08cf2, #6c3aa6)',
  azul: 'linear-gradient(160deg, #4fc3ff, #1565c0)',
  agua: 'linear-gradient(160deg, #6ff0d8, #1c9e8c)',
  verde: 'linear-gradient(160deg, #7cc24a, #2f6b1a)',
  grafite: 'linear-gradient(160deg, #4a4d55, #17181b)',
};
export const BANNER_LABEL: Record<string, string> = {
  noite: 'Noite',
  rosa: 'Rosa',
  vermelho: 'Vermelho',
  laranja: 'Laranja',
  amarelo: 'Amarelo',
  lilas: 'Lilás',
  azul: 'Azul',
  agua: 'Água',
  verde: 'Verde',
  grafite: 'Grafite',
};

export function useServerImageUrl(folder: 'server-banners' | 'invite-backgrounds', key: string | null | undefined) {
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  return key && base ? `${base}/${folder}/${encodeURIComponent(key)}` : null;
}

/** fundo da faixa: imagem (se houver), senão a cor pronta; null = sem faixa */
export function useBannerStyle(
  s: Pick<ServerSummary, 'bannerKey' | 'bannerColor'> | undefined,
  preview?: { color?: string | null; image?: string | null },
): CSSProperties | null {
  const stored = useServerImageUrl('server-banners', s?.bannerKey);
  const image = preview?.image !== undefined ? preview.image : stored;
  const color = preview?.color !== undefined ? preview.color : (s?.bannerColor ?? null);
  if (image) return { backgroundImage: `url("${image}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  if (color && BANNER_GRADIENTS[color]) return { background: BANNER_GRADIENTS[color] };
  return null;
}

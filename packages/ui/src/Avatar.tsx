import type { PresenceStatus } from '@opencord/contracts';
import { createContext, useContext, useState } from 'react';

const PALETTE = ['#4d56fd', '#7a4fd1', '#b4542c', '#2d6cb5', '#8a6d12', '#a3376b', '#3f7d3a', '#5b5f6b'];

/** Cor determinística por id (iniciais sobre fundo sólido; sem imagens de terceiros). */
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] as string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  invisible: 'Invisível',
  offline: 'Offline',
};

export interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  status?: PresenceStatus | undefined;
  speaking?: boolean;
  /** foto explícita; sem ela, usa o resolvedor do app (AvatarSource) e, por fim, as iniciais */
  src?: string | null;
}

/** O app informa a URL da foto de cada pessoa (id → URL ou null); o Avatar não conhece servidor nem dados. */
export const AvatarSource = createContext<(id: string) => string | null>(() => null);

export function Avatar({ id, name, size = 32, status, speaking, src }: AvatarProps) {
  const resolve = useContext(AvatarSource);
  const url = src === undefined ? resolve(id) : src;
  // foto que falhou ao carregar volta às iniciais (sem ícone de imagem quebrada)
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = Boolean(url) && failed !== url;
  return (
    <span className="oc-avatar" data-speaking={speaking ? 'true' : undefined} style={{ width: size, height: size }}>
      <span
        className="oc-avatar-face"
        style={{ background: avatarColor(id), fontSize: Math.round(size * 0.38) }}
        aria-hidden
      >
        {showPhoto ? (
          <img
            className="oc-avatar-img"
            src={url!}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(url!)}
          />
        ) : (
          initials(name)
        )}
      </span>
      {status && (
        <span className="oc-status" data-status={status} data-tip={STATUS_LABEL[status]}>
          <span className="oc-visually-hidden">{STATUS_LABEL[status]}</span>
        </span>
      )}
    </span>
  );
}

export { STATUS_LABEL };

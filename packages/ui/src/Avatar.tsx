import type { PresenceStatus } from '@opencord/contracts';

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
}

export function Avatar({ id, name, size = 32, status, speaking }: AvatarProps) {
  return (
    <span className="oc-avatar" data-speaking={speaking ? 'true' : undefined} style={{ width: size, height: size }}>
      <span
        className="oc-avatar-face"
        style={{ background: avatarColor(id), fontSize: Math.round(size * 0.38) }}
        aria-hidden
      >
        {initials(name)}
      </span>
      {status && (
        <span className="oc-status" data-status={status} title={STATUS_LABEL[status]}>
          <span className="oc-visually-hidden">{STATUS_LABEL[status]}</span>
        </span>
      )}
    </span>
  );
}

export { STATUS_LABEL };

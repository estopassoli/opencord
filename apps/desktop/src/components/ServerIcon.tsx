import { initials } from '@opencord/ui';
import { useState } from 'react';
import { useSession } from '../store/session';

/** URL pública da imagem do servidor (GET /server-icons/:nome) ou null. */
export function useServerIconUrl(iconKey: string | null | undefined): string | null {
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  return iconKey && base ? `${base}/server-icons/${encodeURIComponent(iconKey)}` : null;
}

/** Imagem do servidor; sem imagem (ou se falhar ao carregar), as iniciais do nome. */
export function ServerIcon({
  name,
  iconKey,
  className,
}: {
  name: string;
  iconKey: string | null | undefined;
  className?: string;
}) {
  const url = useServerIconUrl(iconKey);
  const [failed, setFailed] = useState<string | null>(null);
  if (url && failed !== url)
    return (
      <img
        className={className ?? 'server-icon-img'}
        src={url}
        alt=""
        draggable={false}
        onError={() => setFailed(url)}
      />
    );
  return <span aria-hidden>{initials(name)}</span>;
}

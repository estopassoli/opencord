import { AvatarSource } from '@opencord/ui';
import { useMemo, type ReactNode } from 'react';
import { useData } from '../store/data';
import { useSession } from '../store/session';

/**
 * Diz ao <Avatar> qual é a foto de cada pessoa, a partir do que o app já carregou (eu, membros dos servidores,
 * amigos, conversas). Fotos ficam em GET /avatars/:nome no servidor configurado, ou são um GIF do KLIPY.
 */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const serverUrl = useSession((s) => s.serverUrl);
  const me = useData((s) => s.me);
  const details = useData((s) => s.details);
  const friends = useData((s) => s.friends);
  const conversations = useData((s) => s.conversations);
  const resolve = useMemo(() => {
    const base = serverUrl?.replace(/\/+$/, '');
    // foto por GIF do KLIPY (ADR-0048) vem pronta; a enviada é servida em /avatars/:nome
    const urls = new Map<string, string>();
    const add = (u: { id: string; avatarKey: string | null; avatarUrl?: string | undefined }) => {
      const url = u.avatarUrl ?? (u.avatarKey && base ? `${base}/avatars/${encodeURIComponent(u.avatarKey)}` : null);
      if (url) urls.set(u.id, url);
    };
    for (const d of Object.values(details)) for (const m of d.members) add(m.user);
    for (const f of friends) add(f.user);
    for (const c of conversations) for (const u of c.members) add(u);
    if (me) {
      urls.delete(me.id);
      add(me);
    }
    return (id: string) => urls.get(id) ?? null;
  }, [serverUrl, me, details, friends, conversations]);
  return <AvatarSource.Provider value={resolve}>{children}</AvatarSource.Provider>;
}

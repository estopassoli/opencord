import { AvatarSource } from '@opencord/ui';
import { useMemo, type ReactNode } from 'react';
import { useData } from '../store/data';
import { useSession } from '../store/session';

/**
 * Diz ao <Avatar> qual é a foto de cada pessoa, a partir do que o app já carregou (eu, membros dos servidores,
 * amigos, conversas). Fotos ficam em GET /avatars/:nome no servidor configurado.
 */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const serverUrl = useSession((s) => s.serverUrl);
  const me = useData((s) => s.me);
  const details = useData((s) => s.details);
  const friends = useData((s) => s.friends);
  const conversations = useData((s) => s.conversations);
  const resolve = useMemo(() => {
    const keys = new Map<string, string>();
    const add = (id: string, key: string | null | undefined) => key && keys.set(id, key);
    for (const d of Object.values(details)) for (const m of d.members) add(m.user.id, m.user.avatarKey);
    for (const f of friends) add(f.user.id, f.user.avatarKey);
    for (const c of conversations) for (const u of c.members) add(u.id, u.avatarKey);
    if (me) {
      keys.delete(me.id);
      add(me.id, me.avatarKey);
    }
    const base = serverUrl?.replace(/\/+$/, '');
    return (id: string) => {
      const k = keys.get(id);
      return k && base ? `${base}/avatars/${encodeURIComponent(k)}` : null;
    };
  }, [serverUrl, me, details, friends, conversations]);
  return <AvatarSource.Provider value={resolve}>{children}</AvatarSource.Provider>;
}

import type { Member, PresenceStatus } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useData } from '../../store/data';
import { ProfileButton } from './ProfileButton';
import { useAliases } from '../../lib/names';

export function MemberList({ serverId }: { serverId: string }) {
  const detail = useData((s) => s.details[serverId]);
  const presence = useData((s) => s.presence);
  const meId = useData((s) => s.me?.id);
  const myStatus = useData((s) => s.myStatus);
  const aliases = useAliases();
  if (!detail) return null;

  const status = (id: string): PresenceStatus =>
    id === meId ? (myStatus === 'invisible' ? 'offline' : myStatus) : (presence[id] ?? 'offline');
  const hoisted = detail.roles.filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position);
  // servidor oficial: quem criou o OpenCord (o dono do oficial) fica sempre no topo, online ou não
  const creator = detail.official ? detail.members.find((m) => m.user.id === detail.ownerId) : undefined;
  const others = creator ? detail.members.filter((m) => m !== creator) : detail.members;
  const online = others.filter((m) => status(m.user.id) !== 'offline');
  const offline = others.filter((m) => status(m.user.id) === 'offline');
  const groups: { title: string; members: Member[] }[] = creator ? [{ title: 'Criador', members: [creator] }] : [];
  const placed = new Set<string>();
  for (const r of hoisted) {
    const ms = online.filter((m) => m.roleIds.includes(r.id) && !placed.has(m.user.id));
    ms.forEach((m) => placed.add(m.user.id));
    if (ms.length) groups.push({ title: r.name, members: ms });
  }
  const rest = online.filter((m) => !placed.has(m.user.id));
  if (rest.length) groups.push({ title: 'Online', members: rest });
  if (offline.length) groups.push({ title: 'Offline', members: offline });
  const shown = (m: Member) => aliases?.[m.user.id] ?? m.nickname ?? m.user.displayName;
  const sortByName = (a: Member, b: Member) => shown(a).localeCompare(shown(b));
  const roleColor = (m: Member) => hoisted.find((r) => m.roleIds.includes(r.id) && r.color)?.color ?? undefined;

  return (
    <aside className="members" aria-label="Membros">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="members-title">
            {g.title} — {g.members.length}
          </h3>
          <ul>
            {[...g.members].sort(sortByName).map((m) => (
              <li
                key={m.user.id}
                data-offline={status(m.user.id) === 'offline' ? 'true' : undefined}
                data-creator={m === creator ? 'true' : undefined}
              >
                <ProfileButton userId={m.user.id} serverId={serverId} className="member-row">
                  <Avatar id={m.user.id} name={m.user.displayName} size={32} status={status(m.user.id)} />
                  <span className="truncate" style={{ color: roleColor(m) }}>
                    {shown(m)}
                  </span>
                  {m === creator ? (
                    <span className="creator-tag" data-tip="Criador do OpenCord">
                      <Icon name="verified" size={14} active label="Verificado" />
                      criador
                    </span>
                  ) : (
                    detail.ownerId === m.user.id && (
                      <span className="owner-tag" data-tip="Proprietário">
                        dono
                      </span>
                    )
                  )}
                </ProfileButton>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

import type { Member, PresenceStatus, ServerDetail } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useData } from '../../store/data';
import { ProfileButton } from './ProfileButton';
import { useAliases } from '../../lib/names';
import { GameLine } from './Playing';

/** Cor do nick: a do cargo mais alto que tem cor. */
export function roleColorOf(detail: ServerDetail, m: Member | undefined): string | undefined {
  if (!m) return undefined;
  return (
    detail.roles
      .filter((r) => !r.isEveryone && r.color && m.roleIds.includes(r.id))
      .sort((a, b) => b.position - a.position)[0]?.color ?? undefined
  );
}

/** Quem criou o OpenCord (o dono do servidor oficial): selo de verificado em qualquer servidor. */
export function useCreatorId(detail: ServerDetail | undefined): string | null {
  const fromInstance = useData((s) => s.instance?.creatorId ?? null);
  // API antiga sem `creatorId`: no oficial ainda dá para saber pelo dono
  return fromInstance ?? (detail?.official ? detail.ownerId : null);
}

/** Selo "criador" com o ícone de verificado; `iconOnly` (voz) mostra só o ícone. */
export function CreatorTag({ iconOnly }: { iconOnly?: boolean }) {
  if (iconOnly)
    return (
      <span className="creator-badge" data-tip="Criador do OpenCord">
        <Icon name="verified" size={16} active label="Criador do OpenCord (verificado)" />
      </span>
    );
  return (
    <span className="creator-tag" data-tip="Criador do OpenCord">
      <Icon name="verified" size={14} active label="Verificado" />
      criador
    </span>
  );
}

export function MemberList({ serverId }: { serverId: string }) {
  const detail = useData((s) => s.details[serverId]);
  const presence = useData((s) => s.presence);
  const meId = useData((s) => s.me?.id);
  const myStatus = useData((s) => s.myStatus);
  const aliases = useAliases();
  const creatorId = useCreatorId(detail);
  if (!detail) return null;

  const status = (id: string): PresenceStatus =>
    id === meId ? (myStatus === 'invisible' ? 'offline' : myStatus) : (presence[id] ?? 'offline');
  const hoisted = detail.roles.filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position);
  // quem criou o OpenCord tem o selo em qualquer servidor; no oficial fica sempre no topo, online ou não
  const creator = creatorId ? detail.members.find((m) => m.user.id === creatorId) : undefined;
  const pinned = detail.official ? creator : undefined;
  const others = pinned ? detail.members.filter((m) => m !== pinned) : detail.members;
  const online = others.filter((m) => status(m.user.id) !== 'offline');
  const offline = others.filter((m) => status(m.user.id) === 'offline');
  const groups: { title: string; members: Member[] }[] = pinned ? [{ title: 'Criador', members: [pinned] }] : [];
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
  const roleColor = (m: Member) => roleColorOf(detail, m);

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
                  <span className="member-names">
                    <span className="truncate" style={{ color: roleColor(m) }}>
                      {shown(m)}
                    </span>
                    <GameLine userId={m.user.id} className="small" />
                  </span>
                  {m === creator ? (
                    <CreatorTag />
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

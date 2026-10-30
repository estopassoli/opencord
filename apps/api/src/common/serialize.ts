import type { Category, Channel, Member, Role, ServerSummary, UserPublic } from '@opencord/contracts';

type UserRow = { id: string; username: string; displayName: string; avatarKey: string | null };
export const USER_PUBLIC_SELECT = { id: true, username: true, displayName: true, avatarKey: true } as const;

export const userPublic = (u: UserRow): UserPublic => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarKey: u.avatarKey,
});

export const serverSummary = (s: {
  id: string;
  name: string;
  iconKey: string | null;
  ownerId: string;
  official: boolean;
  verified?: boolean;
}): ServerSummary => ({
  id: s.id,
  name: s.name,
  iconKey: s.iconKey,
  ownerId: s.ownerId,
  official: s.official,
  verified: s.verified ?? false,
});

export const role = (r: {
  id: string;
  serverId: string;
  name: string;
  position: number;
  permissions: number;
  color: string | null;
  isEveryone: boolean;
}): Role => ({
  id: r.id,
  serverId: r.serverId,
  name: r.name,
  position: r.position,
  permissions: r.permissions,
  color: r.color,
  isEveryone: r.isEveryone,
});

export const category = (c: { id: string; serverId: string; name: string; position: number }): Category => ({
  id: c.id,
  serverId: c.serverId,
  name: c.name,
  position: c.position,
});

export const channel = (
  c: {
    id: string;
    serverId: string;
    categoryId: string | null;
    kind: 'text' | 'voice' | 'board';
    boardId?: string | null;
    name: string;
    topic: string | null;
    position: number;
    overrides: { subjectType: 'role' | 'member'; subjectId: string; allow: number; deny: number }[];
  },
  myPermissions: number,
): Channel => ({
  id: c.id,
  serverId: c.serverId,
  categoryId: c.categoryId,
  kind: c.kind,
  name: c.name,
  topic: c.topic,
  position: c.position,
  myPermissions,
  boardId: c.boardId ?? null,
  overrides: c.overrides.map((o) => ({
    subjectType: o.subjectType,
    subjectId: o.subjectId,
    allow: o.allow,
    deny: o.deny,
  })),
});

export const member = (m: {
  user: UserRow;
  roles: { roleId: string }[];
  joinedAt: Date;
  nickname: string | null;
}): Member => ({
  user: userPublic(m.user),
  roleIds: m.roles.map((r) => r.roleId),
  joinedAt: m.joinedAt.toISOString(),
  nickname: m.nickname,
});

export const MEMBER_INCLUDE = { user: { select: USER_PUBLIC_SELECT }, roles: { select: { roleId: true } } } as const;

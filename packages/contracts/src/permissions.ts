/**
 * Permissões por servidor/canal como bitset (inteiro de 32 bits, cabe em JSON e em `Int` do Postgres).
 *
 * Regra de resolução (documentada em docs/SECURITY.md):
 * 1. Dono do servidor ou ADMINISTRATOR na base → todas as permissões.
 * 2. Base = OR das permissões do cargo @everyone e dos cargos do membro.
 * 3. Overrides do canal, do menos para o mais específico:
 *    @everyone (deny, depois allow) → cargos do membro agregados (deny, depois allow) → membro (deny, depois allow).
 *    O nível mais específico prevalece; dentro de um nível, o allow agregado vence o deny agregado.
 * 4. Sem VIEW_CHANNEL no canal, todas as permissões do canal são negadas.
 * 5. Sem CONNECT, SPEAK/VIDEO/STREAM são removidas (não faz sentido falar sem entrar).
 */
export const Permission = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  ATTACH_FILES: 1 << 3,
  ADD_REACTIONS: 1 << 4,
  READ_HISTORY: 1 << 5,
  MENTION_EVERYONE: 1 << 6,
  CONNECT: 1 << 7,
  SPEAK: 1 << 8,
  VIDEO: 1 << 9,
  STREAM: 1 << 10,
  MUTE_MEMBERS: 1 << 11,
  MOVE_MEMBERS: 1 << 12,
  KICK_MEMBERS: 1 << 13,
  MANAGE_CHANNELS: 1 << 14,
  MANAGE_ROLES: 1 << 15,
  MANAGE_SERVER: 1 << 16,
  // 1 << 17 reservado (antigo CREATE_INVITE; servidores abertos, ADR-0007)
  VIEW_AUDIT_LOG: 1 << 18,
  ADMINISTRATOR: 1 << 30,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = Object.values(Permission).reduce((acc, bit) => acc | bit, 0);

/** Permissões padrão do cargo @everyone em servidores novos. */
export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.READ_HISTORY |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.STREAM;

export type OverrideSubject = 'role' | 'member';

export interface PermissionOverride {
  subjectType: OverrideSubject;
  subjectId: string;
  allow: number;
  deny: number;
}

export interface PermissionContext {
  userId: string;
  ownerId: string;
  everyoneRoleId: string;
  /** Permissões de cada cargo do servidor (inclui @everyone). */
  rolePermissions: ReadonlyMap<string, number>;
  /** IDs dos cargos do membro (sem @everyone). */
  memberRoleIds: readonly string[];
}

export function hasPermission(perms: number, bit: number): boolean {
  return (perms & bit) === bit;
}

export function computeBasePermissions(ctx: PermissionContext): number {
  if (ctx.userId === ctx.ownerId) return ALL_PERMISSIONS;
  let perms = ctx.rolePermissions.get(ctx.everyoneRoleId) ?? 0;
  for (const roleId of ctx.memberRoleIds) perms |= ctx.rolePermissions.get(roleId) ?? 0;
  if (hasPermission(perms, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return perms;
}

export function computeChannelPermissions(ctx: PermissionContext, overrides: readonly PermissionOverride[]): number {
  const base = computeBasePermissions(ctx);
  if (base === ALL_PERMISSIONS) return ALL_PERMISSIONS;
  let perms = base;

  const everyone = overrides.find((o) => o.subjectType === 'role' && o.subjectId === ctx.everyoneRoleId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;

  let roleAllow = 0;
  let roleDeny = 0;
  const memberRoles = new Set(ctx.memberRoleIds);
  for (const o of overrides) {
    if (o.subjectType === 'role' && memberRoles.has(o.subjectId)) {
      roleAllow |= o.allow;
      roleDeny |= o.deny;
    }
  }
  perms = (perms & ~roleDeny) | roleAllow;

  const member = overrides.find((o) => o.subjectType === 'member' && o.subjectId === ctx.userId);
  if (member) perms = (perms & ~member.deny) | member.allow;

  if (!hasPermission(perms, Permission.VIEW_CHANNEL)) return 0;
  if (!hasPermission(perms, Permission.CONNECT)) {
    perms &= ~(Permission.SPEAK | Permission.VIDEO | Permission.STREAM);
  }
  return perms;
}

export function permissionNames(perms: number): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter((k) => hasPermission(perms, Permission[k]));
}

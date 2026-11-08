/**
 * Permissões como bitset, com os nomes que a comunidade conhece (`PermissionFlagsBits`, `PermissionsBitField`).
 * Os bits espelham `Permission` de `@opencord/contracts` (o SDK só importa tipos do contracts, então os valores são
 * redeclarados aqui; `permissions.test.ts` confere que não divergiram).
 */
export const PermissionFlagsBits = {
  ViewChannel: 1 << 0,
  SendMessages: 1 << 1,
  ManageMessages: 1 << 2,
  AttachFiles: 1 << 3,
  AddReactions: 1 << 4,
  ReadMessageHistory: 1 << 5,
  MentionEveryone: 1 << 6,
  Connect: 1 << 7,
  Speak: 1 << 8,
  Video: 1 << 9,
  Stream: 1 << 10,
  MuteMembers: 1 << 11,
  MoveMembers: 1 << 12,
  KickMembers: 1 << 13,
  ManageChannels: 1 << 14,
  ManageRoles: 1 << 15,
  ManageGuild: 1 << 16,
  ViewAuditLog: 1 << 18,
  BanMembers: 1 << 19,
  ModerateMembers: 1 << 20,
  EditSpace: 1 << 21,
  Administrator: 1 << 30,
} as const;
export type PermissionFlag = keyof typeof PermissionFlagsBits;

/** Os mesmos bits com os nomes do contrato do OpenCord (`VIEW_CHANNEL`, `MANAGE_SERVER`…). */
export const Permission = {
  VIEW_CHANNEL: PermissionFlagsBits.ViewChannel,
  SEND_MESSAGES: PermissionFlagsBits.SendMessages,
  MANAGE_MESSAGES: PermissionFlagsBits.ManageMessages,
  ATTACH_FILES: PermissionFlagsBits.AttachFiles,
  ADD_REACTIONS: PermissionFlagsBits.AddReactions,
  READ_HISTORY: PermissionFlagsBits.ReadMessageHistory,
  MENTION_EVERYONE: PermissionFlagsBits.MentionEveryone,
  CONNECT: PermissionFlagsBits.Connect,
  SPEAK: PermissionFlagsBits.Speak,
  VIDEO: PermissionFlagsBits.Video,
  STREAM: PermissionFlagsBits.Stream,
  MUTE_MEMBERS: PermissionFlagsBits.MuteMembers,
  MOVE_MEMBERS: PermissionFlagsBits.MoveMembers,
  KICK_MEMBERS: PermissionFlagsBits.KickMembers,
  MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
  MANAGE_ROLES: PermissionFlagsBits.ManageRoles,
  MANAGE_SERVER: PermissionFlagsBits.ManageGuild,
  VIEW_AUDIT_LOG: PermissionFlagsBits.ViewAuditLog,
  BAN_MEMBERS: PermissionFlagsBits.BanMembers,
  MODERATE_MEMBERS: PermissionFlagsBits.ModerateMembers,
  EDIT_SPACE: PermissionFlagsBits.EditSpace,
  ADMINISTRATOR: PermissionFlagsBits.Administrator,
} as const;
export type PermissionName = keyof typeof Permission;

const ALL = Object.values(PermissionFlagsBits).reduce((acc, b) => acc | b, 0);

export type PermissionResolvable =
  number | bigint | PermissionFlag | PermissionName | PermissionsBitField | readonly PermissionResolvable[];

function resolveOne(p: Exclude<PermissionResolvable, readonly PermissionResolvable[]>): number {
  if (typeof p === 'number') {
    if (!Number.isInteger(p) || p < 0) throw new RangeError(`permissão inválida: ${p}`);
    return p;
  }
  if (typeof p === 'bigint') return Number(p);
  if (p instanceof PermissionsBitField) return p.bitfield;
  if (p in PermissionFlagsBits) return PermissionFlagsBits[p as PermissionFlag];
  if (p in Permission) return Permission[p as PermissionName];
  throw new RangeError(`permissão desconhecida: "${String(p)}"`);
}

/** Conjunto de permissões: `has`, `add`, `remove`, `toArray`… O valor numérico fica em `bitfield`. */
export class PermissionsBitField {
  static readonly Flags = PermissionFlagsBits;
  static readonly All = ALL;
  /** permissões padrão de `@everyone` em servidores novos */
  static readonly Default =
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.AttachFiles |
    PermissionFlagsBits.AddReactions |
    PermissionFlagsBits.ReadMessageHistory |
    PermissionFlagsBits.Connect |
    PermissionFlagsBits.Speak |
    PermissionFlagsBits.Video |
    PermissionFlagsBits.Stream;

  bitfield: number;

  constructor(bits: PermissionResolvable = 0) {
    this.bitfield = PermissionsBitField.resolve(bits);
  }

  static resolve(bits: PermissionResolvable = 0): number {
    if (Array.isArray(bits))
      return (bits as readonly PermissionResolvable[]).reduce<number>((a, b) => a | PermissionsBitField.resolve(b), 0);
    return resolveOne(bits as Exclude<PermissionResolvable, readonly PermissionResolvable[]>);
  }

  /** tem TODOS os bits? `checkAdmin` (padrão true): ADMINISTRATOR vale por todas */
  has(bits: PermissionResolvable, checkAdmin = true): boolean {
    if (checkAdmin && (this.bitfield & PermissionFlagsBits.Administrator) !== 0) return true;
    const b = PermissionsBitField.resolve(bits);
    return (this.bitfield & b) === b;
  }
  /** tem ALGUM dos bits? */
  any(bits: PermissionResolvable, checkAdmin = true): boolean {
    if (checkAdmin && (this.bitfield & PermissionFlagsBits.Administrator) !== 0) return true;
    return (this.bitfield & PermissionsBitField.resolve(bits)) !== 0;
  }
  /** quais dos bits pedidos faltam (nomes) */
  missing(bits: PermissionResolvable, checkAdmin = true): PermissionFlag[] {
    if (checkAdmin && this.has(PermissionFlagsBits.Administrator, false)) return [];
    return new PermissionsBitField(bits).toArray().filter((name) => !this.has(name, false));
  }
  add(...bits: PermissionResolvable[]): this {
    for (const b of bits) this.bitfield |= PermissionsBitField.resolve(b);
    return this;
  }
  remove(...bits: PermissionResolvable[]): this {
    for (const b of bits) this.bitfield &= ~PermissionsBitField.resolve(b);
    return this;
  }
  equals(other: PermissionResolvable): boolean {
    return this.bitfield === PermissionsBitField.resolve(other);
  }
  freeze(): Readonly<this> {
    return Object.freeze(this);
  }
  /** nomes dos bits presentes (`['ViewChannel', 'SendMessages']`) */
  toArray(): PermissionFlag[] {
    return (Object.keys(PermissionFlagsBits) as PermissionFlag[]).filter(
      (k) => (this.bitfield & PermissionFlagsBits[k]) !== 0,
    );
  }
  /** `{ ViewChannel: true, SendMessages: false, … }` */
  serialize(): Record<PermissionFlag, boolean> {
    const out = {} as Record<PermissionFlag, boolean>;
    for (const k of Object.keys(PermissionFlagsBits) as PermissionFlag[])
      out[k] = (this.bitfield & PermissionFlagsBits[k]) !== 0;
    return out;
  }
  valueOf(): number {
    return this.bitfield;
  }
  toJSON(): number {
    return this.bitfield;
  }
  toString(): string {
    return String(this.bitfield);
  }
  *[Symbol.iterator](): IterableIterator<PermissionFlag> {
    yield* this.toArray();
  }
}

export interface PermissionOverrideLike {
  subjectType: 'role' | 'member';
  subjectId: string;
  allow: number;
  deny: number;
}

export interface PermissionContextLike {
  userId: string;
  ownerId: string;
  everyoneRoleId: string | null;
  rolePermissions: ReadonlyMap<string, number>;
  memberRoleIds: readonly string[];
}

/** Mesma regra da API (docs/SECURITY.md): dono ou ADMINISTRATOR = tudo; senão OR de @everyone e dos cargos. */
export function computeBasePermissions(ctx: PermissionContextLike): number {
  if (ctx.userId === ctx.ownerId) return ALL;
  let perms = ctx.everyoneRoleId ? (ctx.rolePermissions.get(ctx.everyoneRoleId) ?? 0) : 0;
  for (const id of ctx.memberRoleIds) perms |= ctx.rolePermissions.get(id) ?? 0;
  if ((perms & PermissionFlagsBits.Administrator) !== 0) return ALL;
  return perms;
}

/** Overrides do canal: @everyone → cargos agregados → membro; sem VIEW_CHANNEL nada vale; sem CONNECT não fala. */
export function computeChannelPermissions(
  ctx: PermissionContextLike,
  overrides: readonly PermissionOverrideLike[],
): number {
  const base = computeBasePermissions(ctx);
  if (base === ALL) return ALL;
  let perms = base;
  const everyone = overrides.find((o) => o.subjectType === 'role' && o.subjectId === ctx.everyoneRoleId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;
  let allow = 0;
  let deny = 0;
  const mine = new Set(ctx.memberRoleIds);
  for (const o of overrides) {
    if (o.subjectType === 'role' && mine.has(o.subjectId)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms = (perms & ~deny) | allow;
  const member = overrides.find((o) => o.subjectType === 'member' && o.subjectId === ctx.userId);
  if (member) perms = (perms & ~member.deny) | member.allow;
  if ((perms & PermissionFlagsBits.ViewChannel) === 0) return 0;
  if ((perms & PermissionFlagsBits.Connect) === 0)
    perms &= ~(PermissionFlagsBits.Speak | PermissionFlagsBits.Video | PermissionFlagsBits.Stream);
  return perms;
}

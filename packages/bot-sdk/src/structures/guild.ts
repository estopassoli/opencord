import type {
  AuditEntry,
  Category as CategoryDto,
  Channel as ChannelDto,
  ChannelKind,
  Invite as InviteDto,
  InvitePreview,
  Member as MemberDto,
  PlayingGame,
  PresenceStatus,
  Role as RoleDto,
  ServerBan as ServerBanDto,
  ServerDetail,
  ServerEvent as ServerEventDto,
  ServerSummary,
  UserPublic,
  Webhook as WebhookDto,
} from '@opencord/contracts';
import type { Client } from '../client.js';
import { Collection } from '../collection.js';
import { ActivityType, ChannelType, Limits } from '../constants.js';
import { resolveColor, type ColorResolvable } from '../embed.js';
import {
  computeBasePermissions,
  computeChannelPermissions,
  PermissionsBitField,
  type PermissionResolvable,
} from '../permissions.js';
import {
  CategoryChannel,
  channelEditBody,
  searchMessages,
  TextChannel,
  Webhook,
  type ChannelEditOptions,
  type SearchMessagesOptions,
  type SearchResult,
} from './channel.js';
import type { MessagePayload } from './payload.js';
import { stubUser, User } from './user.js';

type UserResolvable = User | GuildMember | string | { id: string };
function idOf(u: UserResolvable): string {
  return typeof u === 'string' ? u : u.id;
}

// ---------- cargos ----------
export interface RoleEditOptions {
  name?: string;
  permissions?: PermissionResolvable;
  color?: ColorResolvable;
  position?: number;
  reason?: string;
}
function roleBody(data: RoleEditOptions) {
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.name = data.name;
  if (data.permissions !== undefined) body.permissions = PermissionsBitField.resolve(data.permissions);
  if (data.color !== undefined) body.color = resolveColor(data.color) ?? null;
  if (data.position !== undefined) body.position = data.position;
  return body;
}

export class Role {
  readonly id: string;
  readonly guildId: string;
  name: string;
  position: number;
  permissions: PermissionsBitField;
  color: string | null;
  readonly isEveryone: boolean;
  constructor(
    readonly guild: Guild,
    data: RoleDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.name = data.name;
    this.position = data.position;
    this.permissions = new PermissionsBitField(data.permissions);
    this.color = data.color;
    this.isEveryone = data.isEveryone;
  }
  get client() {
    return this.guild.client;
  }
  get hexColor() {
    return this.color ?? '#000000';
  }
  get rawPosition() {
    return this.position;
  }
  /** membros com este cargo (cache) */
  get members(): Collection<string, GuildMember> {
    return this.guild.members.cache.filter((m: GuildMember) => this.isEveryone || m.roleIds.includes(this.id));
  }
  /** o bot está acima deste cargo? (dono/ADMINISTRATOR: sempre) */
  get editable() {
    if (this.isEveryone) return !!this.guild.members.me?.permissions.has('ManageRoles');
    const me = this.guild.members.me;
    if (!me) return false;
    if (this.guild.ownerId === me.id || me.permissions.has('Administrator')) return true;
    return me.permissions.has('ManageRoles') && (me.roles.highest?.position ?? 0) > this.position;
  }
  comparePositionTo(role: Role | string) {
    const other = typeof role === 'string' ? this.guild.roles.cache.get(role) : role;
    return this.position - (other?.position ?? 0);
  }
  edit(data: RoleEditOptions): Promise<Role> {
    return this.guild.roles.edit(this, data);
  }
  setName(name: string, reason?: string) {
    return this.edit({ name, reason });
  }
  setPermissions(permissions: PermissionResolvable, reason?: string) {
    return this.edit({ permissions, reason });
  }
  setColor(color: ColorResolvable, reason?: string) {
    return this.edit({ color, reason });
  }
  setPosition(position: number, reason?: string) {
    return this.edit({ position, reason });
  }
  delete(reason?: string) {
    return this.guild.roles.delete(this, reason);
  }
  equals(other: Role | null | undefined) {
    return !!other && other.id === this.id;
  }
  toString() {
    return this.name;
  }
  toJSON(): RoleDto {
    return {
      id: this.id,
      serverId: this.guildId,
      name: this.name,
      position: this.position,
      permissions: this.permissions.bitfield,
      color: this.color,
      isEveryone: this.isEveryone,
    };
  }
}

/** Cargo de que só se conhece o id (opção de comando fora do cache). */
export function stubRole(client: Client, guildId: string, id: string): Role {
  const guild =
    client.guilds.cache.get(guildId) ?? new Guild(client, { id: guildId, name: guildId, ownerId: '', iconKey: null });
  return new Role(guild, {
    id,
    serverId: guildId,
    name: id,
    position: 0,
    permissions: 0,
    color: null,
    isEveryone: false,
  });
}

// ---------- membros ----------
type RoleResolvable = Role | string | { id: string };

/** `member.roles`: cache + `add`/`remove`/`set` (`PUT /servers/:id/members/:userId/roles`). */
export class GuildMemberRoleManager {
  constructor(readonly member: GuildMember) {}
  get guild() {
    return this.member.guild;
  }
  /** cargos do membro (sem @everyone, como a API devolve) */
  get cache(): Collection<string, Role> {
    const out = new Collection<string, Role>();
    for (const id of this.member.roleIds) {
      const r = this.guild.roles.cache.get(id);
      if (r) out.set(id, r);
    }
    return out;
  }
  get highest(): Role | null {
    let best: Role | null = null;
    for (const r of this.cache.values()) if (!best || r.position > best.position) best = r;
    return best;
  }
  has(role: RoleResolvable) {
    return this.member.roleIds.includes(idOf(role));
  }
  private ids(roles: RoleResolvable | readonly RoleResolvable[] | ReadonlyMap<string, Role>): string[] {
    if (roles instanceof Map) return [...roles.keys()];
    return (Array.isArray(roles) ? roles : [roles as RoleResolvable]).map(idOf);
  }
  async set(roles: readonly RoleResolvable[] | ReadonlyMap<string, Role>, _reason?: string): Promise<GuildMember> {
    const roleIds = [...new Set(this.ids(roles))];
    const res = await this.guild.client.rest.put<MemberDto | unknown>(
      `/servers/${this.guild.id}/members/${this.member.id}/roles`,
      { roleIds },
    );
    const dto = res && typeof res === 'object' && 'user' in res ? (res as MemberDto) : null;
    const m = new GuildMember(this.guild, dto ?? { ...this.member.toJSON(), roleIds });
    this.guild.members.cache.set(m.id, m);
    return m;
  }
  add(roles: RoleResolvable | readonly RoleResolvable[], reason?: string) {
    return this.set([...this.member.roleIds, ...this.ids(roles)], reason);
  }
  remove(roles: RoleResolvable | readonly RoleResolvable[], reason?: string) {
    const drop = new Set(this.ids(roles));
    return this.set(
      this.member.roleIds.filter((id) => !drop.has(id)),
      reason,
    );
  }
}

export interface BanOptions {
  reason?: string;
  /** apaga as mensagens da pessoa das últimas N segundos (até 7 dias) */
  deleteMessageSeconds?: number;
  /** o mesmo em dias (nome antigo) */
  deleteMessageDays?: number;
}
function banBody(opts: BanOptions = {}) {
  const seconds =
    opts.deleteMessageSeconds ?? (opts.deleteMessageDays !== undefined ? opts.deleteMessageDays * 86400 : 0);
  if (seconds < 0 || seconds > Limits.banDeleteSeconds)
    throw new Error(`ban: deleteMessageSeconds de 0 a ${Limits.banDeleteSeconds} (7 dias)`);
  return { ...(opts.reason ? { reason: opts.reason } : {}), deleteMessageSeconds: seconds };
}

export class GuildMember {
  readonly user: User;
  readonly nickname: string | null;
  readonly joinedAt: Date;
  readonly roleIds: readonly string[];
  /** castigo (ADR-0034): até quando não pode escrever, reagir nem entrar em voz */
  readonly communicationDisabledUntil: Date | null;
  readonly roles: GuildMemberRoleManager;
  constructor(
    readonly guild: Guild,
    data: MemberDto,
  ) {
    this.user = guild.client.resolveUser(data.user);
    this.nickname = data.nickname;
    this.joinedAt = new Date(data.joinedAt);
    this.roleIds = data.roleIds;
    this.communicationDisabledUntil = data.timeoutUntil ? new Date(data.timeoutUntil) : null;
    this.roles = new GuildMemberRoleManager(this);
  }
  get id() {
    return this.user.id;
  }
  get guildId() {
    return this.guild.id;
  }
  get client() {
    return this.guild.client;
  }
  get displayName() {
    return this.nickname ?? this.user.displayName;
  }
  get joinedTimestamp() {
    return this.joinedAt.getTime();
  }
  get communicationDisabledUntilTimestamp() {
    return this.communicationDisabledUntil?.getTime() ?? null;
  }
  get presence() {
    return this.user.presence;
  }
  /**
   * Permissões efetivas no servidor: dono/ADMINISTRATOR = todas; senão @everyone + cargos. Para o próprio bot usa
   * `guild.myPermissions` (o que a API calculou).
   */
  get permissions(): PermissionsBitField {
    if (this.id === this.client.user?.id && this.guild.myPermissions)
      return new PermissionsBitField(this.guild.myPermissions);
    return new PermissionsBitField(computeBasePermissions(this.guild.permissionContext(this)));
  }
  /** permissões num canal: o bot usa `channel.myPermissions`; os outros são calculados com os overrides do canal */
  permissionsIn(channel: TextChannel | string): PermissionsBitField {
    const ch = typeof channel === 'string' ? this.guild.channels.cache.get(channel) : channel;
    if (!ch) throw new Error('canal fora do cache: não dá para calcular as permissões');
    if (this.id === this.client.user?.id) return new PermissionsBitField(ch.myPermissions);
    return new PermissionsBitField(computeChannelPermissions(this.guild.permissionContext(this), ch.overrides));
  }
  isCommunicationDisabled() {
    return this.communicationDisabledUntil !== null && this.communicationDisabledUntil.getTime() > Date.now();
  }
  /** o bot pode expulsar/banir/castigar? (não é dono, não é o próprio bot, bot tem a permissão) */
  get kickable() {
    return this.actionable('KickMembers');
  }
  get bannable() {
    return this.actionable('BanMembers');
  }
  get moderatable() {
    return this.actionable('ModerateMembers');
  }
  get manageable() {
    return this.actionable('ManageRoles');
  }
  private actionable(bit: 'KickMembers' | 'BanMembers' | 'ModerateMembers' | 'ManageRoles') {
    const me = this.guild.members.me;
    if (!me || me.id === this.id || this.id === this.guild.ownerId || this.user.isInstanceAdmin) return false;
    if (me.id === this.guild.ownerId) return true;
    if (!me.permissions.has(bit)) return false;
    return (
      (me.roles.highest?.position ?? 0) > (this.roles.highest?.position ?? 0) || me.permissions.has('Administrator')
    );
  }
  kick(reason?: string) {
    return this.guild.members.kick(this, reason);
  }
  ban(options?: BanOptions) {
    return this.guild.members.ban(this, options);
  }
  /** castigo por `ms` milissegundos (até 28 dias); `null` tira */
  timeout(ms: number | null, reason?: string) {
    return this.disableCommunicationUntil(ms === null ? null : new Date(Date.now() + ms), reason);
  }
  disableCommunicationUntil(until: Date | number | null, reason?: string) {
    return this.guild.members.edit(this, { communicationDisabledUntil: until, reason });
  }
  /** só o próprio bot muda o apelido (`PATCH /servers/:id/members/me`); para outros não há rota */
  async setNickname(nickname: string | null, _reason?: string): Promise<GuildMember> {
    if (this.id !== this.client.user?.id)
      throw new Error(
        'só dá para mudar o apelido do próprio bot (PATCH /servers/:id/members/me); não há rota para outros membros',
      );
    const dto = await this.client.rest.patch<MemberDto>(`/servers/${this.guild.id}/members/me`, { nickname });
    const m = new GuildMember(this.guild, dto);
    this.guild.members.cache.set(m.id, m);
    return m;
  }
  async fetch(): Promise<GuildMember> {
    return this.guild.members.fetch(this.id);
  }
  send(payload: MessagePayload) {
    return this.user.send(payload);
  }
  createDM() {
    return this.user.createDM();
  }
  equals(other: GuildMember | null | undefined) {
    return !!other && other.id === this.id && other.guildId === this.guildId;
  }
  toString() {
    return this.user.toString();
  }
  toJSON(): MemberDto {
    return {
      user: this.user.toJSON(),
      roleIds: [...this.roleIds],
      joinedAt: this.joinedAt.toISOString(),
      nickname: this.nickname,
      timeoutUntil: this.communicationDisabledUntil?.toISOString() ?? null,
    };
  }
}

export class GuildBan {
  readonly user: User;
  readonly reason: string | null;
  /** quem baniu (null se a conta sumiu ou o evento não trouxe) */
  readonly executor: User | null;
  readonly createdAt: Date | null;
  constructor(
    readonly guild: Guild,
    data: { user: UserPublic; reason: string | null; by: UserPublic | null; createdAt: string | null },
  ) {
    this.user = guild.client.resolveUser(data.user);
    this.reason = data.reason;
    this.executor = data.by ? guild.client.resolveUser(data.by) : null;
    this.createdAt = data.createdAt ? new Date(data.createdAt) : null;
  }
  get client() {
    return this.guild.client;
  }
}

export class Invite {
  readonly code: string;
  readonly url: string | null;
  readonly guildId: string;
  readonly memberCount: number | null;
  /** o bot já é membro? (só na prévia `client.fetchInvite`) */
  readonly joined: boolean | null;
  readonly guildName: string | null;
  constructor(
    readonly client: Client,
    data: InviteDto | InvitePreview,
  ) {
    this.code = data.code;
    if ('serverId' in data) {
      this.url = data.url;
      this.guildId = data.serverId;
      this.memberCount = null;
      this.joined = null;
      this.guildName = null;
    } else {
      this.url = null;
      this.guildId = data.server.id;
      this.memberCount = data.memberCount;
      this.joined = data.joined;
      this.guildName = data.server.name;
    }
  }
  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  toString() {
    return this.url ?? this.code;
  }
}

export interface GuildScheduledEventEditOptions {
  name?: string;
  description?: string;
  scheduledStartTime?: Date | number | string;
  scheduledEndTime?: Date | number | string | null;
  /** canal de voz onde acontece (null = sem canal) */
  channel?: string | { id: string } | null;
  reason?: string;
}
function iso(v: Date | number | string): string {
  return new Date(v).toISOString();
}
function eventBody(data: GuildScheduledEventEditOptions) {
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.title = data.name;
  if (data.description !== undefined) body.description = data.description;
  if (data.scheduledStartTime !== undefined) body.startsAt = iso(data.scheduledStartTime);
  if (data.scheduledEndTime !== undefined)
    body.endsAt = data.scheduledEndTime === null ? null : iso(data.scheduledEndTime);
  if (data.channel !== undefined)
    body.channelId = data.channel === null ? null : typeof data.channel === 'string' ? data.channel : data.channel.id;
  return body;
}

/** Evento do servidor (ADR-0028) com RSVP. */
export class GuildScheduledEvent {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string | null;
  readonly creator: User;
  readonly name: string;
  readonly description: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date | null;
  /** ids de quem confirmou / talvez */
  readonly going: readonly string[];
  readonly maybe: readonly string[];
  /** resposta do bot */
  readonly me: 'going' | 'maybe' | null;
  constructor(
    readonly client: Client,
    data: ServerEventDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.channelId = data.channelId;
    this.creator = client.resolveUser(data.createdBy);
    this.name = data.title;
    this.description = data.description;
    this.scheduledStartAt = new Date(data.startsAt);
    this.scheduledEndAt = data.endsAt ? new Date(data.endsAt) : null;
    this.going = data.going;
    this.maybe = data.maybe;
    this.me = data.me;
  }
  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  get channel(): TextChannel | null {
    return this.channelId ? (this.client.channels.cache.get(this.channelId) ?? null) : null;
  }
  get scheduledStartTimestamp() {
    return this.scheduledStartAt.getTime();
  }
  get scheduledEndTimestamp() {
    return this.scheduledEndAt?.getTime() ?? null;
  }
  get userCount() {
    return this.going.length;
  }
  isActive() {
    const now = Date.now();
    return this.scheduledStartAt.getTime() <= now && (this.scheduledEndAt?.getTime() ?? Infinity) > now;
  }
  isScheduled() {
    return this.scheduledStartAt.getTime() > Date.now();
  }
  isCompleted() {
    return (this.scheduledEndAt?.getTime() ?? Infinity) <= Date.now();
  }
  /** confirma presença: `'going'`, `'maybe'` ou `null` (retira) — `PUT /events/:id/rsvp` */
  async rsvp(status: 'going' | 'maybe' | null): Promise<GuildScheduledEvent> {
    const dto = await this.client.rest.put<ServerEventDto>(`/events/${this.id}/rsvp`, { status });
    return this.cacheIn(dto);
  }
  async edit(data: GuildScheduledEventEditOptions): Promise<GuildScheduledEvent> {
    const dto = await this.client.rest.patch<ServerEventDto>(`/events/${this.id}`, eventBody(data));
    return this.cacheIn(dto);
  }
  setName(name: string) {
    return this.edit({ name });
  }
  setDescription(description: string) {
    return this.edit({ description });
  }
  setScheduledStartTime(at: Date | number | string) {
    return this.edit({ scheduledStartTime: at });
  }
  setScheduledEndTime(at: Date | number | string | null) {
    return this.edit({ scheduledEndTime: at });
  }
  async delete(): Promise<this> {
    await this.client.rest.delete(`/events/${this.id}`);
    this.guild?.scheduledEvents.cache.delete(this.id);
    return this;
  }
  private cacheIn(dto: ServerEventDto) {
    const e = new GuildScheduledEvent(this.client, dto);
    this.guild?.scheduledEvents.cache.set(e.id, e);
    return e;
  }
  toString() {
    return this.name;
  }
}

export class GuildAuditLogsEntry {
  readonly id: string;
  readonly executorId: string;
  readonly action: string;
  readonly targetId: string | null;
  readonly changes: Record<string, unknown>;
  readonly createdAt: Date;
  constructor(
    readonly guild: Guild,
    data: AuditEntry,
  ) {
    this.id = data.id;
    this.executorId = data.actorId;
    this.action = data.action;
    this.targetId = data.targetId;
    this.changes = data.metadata;
    this.createdAt = new Date(data.createdAt);
  }
  get executor(): User | null {
    return this.guild.client.users.cache.get(this.executorId) ?? null;
  }
  get createdTimestamp() {
    return this.createdAt.getTime();
  }
}
export class GuildAuditLogs {
  constructor(readonly entries: Collection<string, GuildAuditLogsEntry>) {}
}

// ---------- presença ----------
export class Activity {
  readonly name: string;
  readonly type = ActivityType.Playing;
  readonly createdAt: Date;
  readonly steamAppId: number | null;
  constructor(data: PlayingGame) {
    this.name = data.name;
    this.createdAt = new Date(data.startedAt);
    this.steamAppId = data.steamAppId ?? null;
  }
  get timestamps() {
    return { start: this.createdAt, end: null };
  }
  get createdTimestamp() {
    return this.createdAt.getTime();
  }
  toString() {
    return this.name;
  }
}

export class Presence {
  status: PresenceStatus;
  activities: Activity[];
  /** status personalizado (texto curto) */
  statusText: string | null;
  constructor(
    readonly client: Client,
    readonly userId: string,
    data: { status?: PresenceStatus; game?: PlayingGame | null; text?: string | null } = {},
  ) {
    this.status = data.status ?? 'offline';
    this.activities = data.game ? [new Activity(data.game)] : [];
    this.statusText = data.text ?? null;
  }
  get user(): User | null {
    return this.client.users.cache.get(this.userId) ?? null;
  }
  _clone(): Presence {
    const p = new Presence(this.client, this.userId);
    p.status = this.status;
    p.activities = [...this.activities];
    p.statusText = this.statusText;
    return p;
  }
}

// ---------- servidor ----------
export interface GuildChannelCreateOptions {
  name: string;
  /** `ChannelType.GuildText` (padrão), `GuildVoice`, `GuildBoard` ou `GuildCategory` */
  type?: ChannelKind | (typeof ChannelType)[keyof typeof ChannelType] | 0 | 2 | 4;
  parent?: string | { id: string } | null;
  topic?: string | null;
  /** canal de voz: criador de salas temporárias */
  roomHub?: boolean;
  reason?: string;
}
function channelKind(t: GuildChannelCreateOptions['type']): ChannelKind | 'category' {
  if (t === undefined || t === 0 || t === ChannelType.GuildText) return 'text';
  if (t === 2 || t === ChannelType.GuildVoice) return 'voice';
  if (t === 4 || t === ChannelType.GuildCategory) return 'category';
  if (t === ChannelType.GuildBoard) return 'board';
  throw new RangeError(`tipo de canal inválido: ${String(t)}`);
}
function parentId(p: string | { id: string } | null): string | null {
  return p === null ? null : typeof p === 'string' ? p : p.id;
}

/** `guild.channels`: cache + `create`/`edit`/`delete`/`fetch`. */
export class GuildChannelManager {
  readonly cache = new Collection<string, TextChannel>();
  constructor(readonly guild: Guild) {}
  get client() {
    return this.guild.client;
  }
  fetch(): Promise<Collection<string, TextChannel>>;
  fetch(id: string): Promise<TextChannel>;
  async fetch(id?: string): Promise<TextChannel | Collection<string, TextChannel>> {
    await this.guild.fetch();
    if (id === undefined) return this.cache;
    const c = this.cache.get(id);
    if (!c) throw new Error(`canal ${id} não encontrado em ${this.guild.name}`);
    return c;
  }
  /** `POST /servers/:id/channels` (ou `/categories` para `ChannelType.GuildCategory`), MANAGE_CHANNELS */
  async create(options: GuildChannelCreateOptions | string): Promise<TextChannel | CategoryChannel> {
    const o = typeof options === 'string' ? { name: options } : options;
    const kind = channelKind(o.type);
    if (kind === 'category') return this.guild.categories.create(o.name);
    const body: Record<string, unknown> = { name: o.name, kind };
    if (o.parent !== undefined) body.categoryId = parentId(o.parent);
    if (o.topic !== undefined) body.topic = o.topic;
    if (o.roomHub !== undefined) body.roomHub = o.roomHub;
    const dto = await this.client.rest.post<ChannelDto>(`/servers/${this.guild.id}/channels`, body);
    return this.client.upsertChannel(dto);
  }
  async edit(channel: TextChannel | string, data: ChannelEditOptions): Promise<TextChannel> {
    const id = typeof channel === 'string' ? channel : channel.id;
    const dto = await this.client.rest.patch<ChannelDto>(`/channels/${id}`, channelEditBody(data));
    return this.client.upsertChannel(dto);
  }
  async delete(channel: TextChannel | string, _reason?: string): Promise<void> {
    const id = typeof channel === 'string' ? channel : channel.id;
    await this.client.rest.delete(`/channels/${id}`);
  }
  resolve(id: string) {
    return this.cache.get(id) ?? null;
  }
}

export class GuildCategoryManager {
  readonly cache = new Collection<string, CategoryChannel>();
  constructor(readonly guild: Guild) {}
  /** `POST /servers/:id/categories` (MANAGE_CHANNELS) */
  async create(options: { name: string } | string): Promise<CategoryChannel> {
    const name = typeof options === 'string' ? options : options.name;
    const dto = await this.guild.client.rest.post<CategoryDto>(`/servers/${this.guild.id}/categories`, { name });
    return this.guild.client.upsertCategory(dto);
  }
  resolve(id: string) {
    return this.cache.get(id) ?? null;
  }
}

export interface GuildMemberEditOptions {
  /** castigo até a data (`null` tira); até 28 dias */
  communicationDisabledUntil?: Date | number | null;
  reason?: string;
}

/** `guild.members`: cache, `fetch`, `me`, moderação (`kick`, `ban`, `unban`, `edit`). */
export class GuildMemberManager {
  readonly cache = new Collection<string, GuildMember>();
  constructor(readonly guild: Guild) {}
  get client() {
    return this.guild.client;
  }
  /** o próprio bot como membro */
  get me(): GuildMember | null {
    return this.cache.get(this.client.user?.id ?? '') ?? null;
  }
  fetch(): Promise<Collection<string, GuildMember>>;
  fetch(user: UserResolvable | { user: UserResolvable }): Promise<GuildMember>;
  async fetch(arg?: UserResolvable | { user: UserResolvable }): Promise<GuildMember | Collection<string, GuildMember>> {
    await this.guild.fetch();
    if (arg === undefined) return this.cache;
    const id =
      typeof arg === 'object' && arg !== null && 'user' in arg && !(arg instanceof User)
        ? idOf((arg as { user: UserResolvable }).user)
        : idOf(arg as UserResolvable);
    const m = this.cache.get(id);
    if (!m) throw new Error(`membro ${id} não encontrado em ${this.guild.name}`);
    return m;
  }
  resolve(user: UserResolvable) {
    return this.cache.get(idOf(user)) ?? null;
  }
  /** `DELETE /servers/:id/members/:userId` (KICK_MEMBERS) */
  async kick(user: UserResolvable, reason?: string): Promise<GuildMember | User | string> {
    const id = idOf(user);
    const before = this.cache.get(id) ?? this.client.users.cache.get(id) ?? id;
    await this.client.rest.delete(`/servers/${this.guild.id}/members/${id}`, reason ? { reason } : {});
    return before;
  }
  /** `PUT /servers/:id/bans/:userId` (BAN_MEMBERS): expulsa e bane */
  async ban(user: UserResolvable, options?: BanOptions): Promise<GuildMember | User | string> {
    const id = idOf(user);
    const before = this.cache.get(id) ?? this.client.users.cache.get(id) ?? id;
    await this.client.rest.put(`/servers/${this.guild.id}/bans/${id}`, banBody(options));
    return before;
  }
  unban(user: UserResolvable, reason?: string) {
    return this.guild.bans.remove(user, reason);
  }
  /** castigo (`PATCH /servers/:id/members/:userId`, MODERATE_MEMBERS) */
  async edit(user: UserResolvable, data: GuildMemberEditOptions): Promise<GuildMember> {
    const id = idOf(user);
    const body: Record<string, unknown> = {};
    let timeoutUntil: string | null | undefined;
    if (data.communicationDisabledUntil !== undefined) {
      const until = data.communicationDisabledUntil;
      if (until !== null && new Date(until).getTime() - Date.now() > Limits.timeoutMs)
        throw new Error('castigo de no máximo 28 dias');
      timeoutUntil = until === null ? null : new Date(until).toISOString();
      body.timeoutUntil = timeoutUntil;
    }
    if (data.reason) body.reason = data.reason;
    const res = await this.client.rest.patch<MemberDto | unknown>(`/servers/${this.guild.id}/members/${id}`, body);
    const dto = res && typeof res === 'object' && 'user' in res ? (res as MemberDto) : null;
    const current = this.cache.get(id);
    const fallback: MemberDto = current?.toJSON() ?? {
      user: (this.client.users.cache.get(id) ?? stubUser(this.client, id)).toJSON(),
      roleIds: [],
      joinedAt: new Date().toISOString(),
      nickname: null,
      timeoutUntil: null,
    };
    if (timeoutUntil !== undefined) fallback.timeoutUntil = timeoutUntil;
    const m = new GuildMember(this.guild, dto ?? fallback);
    this.cache.set(m.id, m);
    return m;
  }
}

/** `guild.roles`: cache, `everyone`, `highest`, `create`/`edit`/`delete`. */
export class RoleManager {
  readonly cache = new Collection<string, Role>();
  constructor(readonly guild: Guild) {}
  get client() {
    return this.guild.client;
  }
  get everyone(): Role | null {
    return this.cache.find((r) => r.isEveryone) ?? null;
  }
  get highest(): Role | null {
    let best: Role | null = null;
    for (const r of this.cache.values()) if (!best || r.position > best.position) best = r;
    return best;
  }
  fetch(): Promise<Collection<string, Role>>;
  fetch(id: string): Promise<Role>;
  async fetch(id?: string): Promise<Role | Collection<string, Role>> {
    await this.guild.fetch();
    if (id === undefined) return this.cache;
    const r = this.cache.get(id);
    if (!r) throw new Error(`cargo ${id} não encontrado em ${this.guild.name}`);
    return r;
  }
  resolve(role: RoleResolvable) {
    return this.cache.get(idOf(role)) ?? null;
  }
  /** `POST /servers/:id/roles` (MANAGE_ROLES) */
  async create(data: RoleEditOptions = {}): Promise<Role> {
    const body = roleBody(data);
    if (!body.name) throw new Error('cargo: informe name');
    if (body.permissions === undefined) body.permissions = 0;
    const dto = await this.client.rest.post<RoleDto>(`/servers/${this.guild.id}/roles`, body);
    const r = new Role(this.guild, dto);
    this.cache.set(r.id, r);
    return r;
  }
  async edit(role: RoleResolvable, data: RoleEditOptions): Promise<Role> {
    const dto = await this.client.rest.patch<RoleDto>(`/roles/${idOf(role)}`, roleBody(data));
    const r = new Role(this.guild, dto);
    this.cache.set(r.id, r);
    return r;
  }
  async delete(role: RoleResolvable, _reason?: string): Promise<void> {
    const id = idOf(role);
    await this.client.rest.delete(`/roles/${id}`);
    this.cache.delete(id);
  }
}

/** `guild.bans`: `fetch` (`GET /servers/:id/bans`), `create` (ban), `remove` (unban). */
export class GuildBanManager {
  readonly cache = new Collection<string, GuildBan>();
  constructor(readonly guild: Guild) {}
  get client() {
    return this.guild.client;
  }
  fetch(): Promise<Collection<string, GuildBan>>;
  fetch(user: UserResolvable): Promise<GuildBan>;
  async fetch(user?: UserResolvable): Promise<GuildBan | Collection<string, GuildBan>> {
    const list = await this.client.rest.get<ServerBanDto[]>(`/servers/${this.guild.id}/bans`);
    this.cache.clear();
    for (const b of list) this.cache.set(b.user.id, new GuildBan(this.guild, b));
    if (user === undefined) return this.cache;
    const b = this.cache.get(idOf(user));
    if (!b) throw new Error(`${idOf(user)} não está banido de ${this.guild.name}`);
    return b;
  }
  create(user: UserResolvable, options?: BanOptions) {
    return this.guild.members.ban(user, options);
  }
  /** `DELETE /servers/:id/bans/:userId` */
  async remove(user: UserResolvable, _reason?: string): Promise<User | null> {
    const id = idOf(user);
    await this.client.rest.delete(`/servers/${this.guild.id}/bans/${id}`);
    const ban = this.cache.get(id);
    this.cache.delete(id);
    return ban?.user ?? this.client.users.cache.get(id) ?? null;
  }
}

export class GuildInviteManager {
  constructor(readonly guild: Guild) {}
  /** `POST /servers/:id/invites` (qualquer membro): o mesmo código a cada pedido do bot */
  async create(): Promise<Invite> {
    const dto = await this.guild.client.rest.post<InviteDto>(`/servers/${this.guild.id}/invites`);
    return new Invite(this.guild.client, dto);
  }
}

export type GuildScheduledEventCreateOptions = GuildScheduledEventEditOptions & {
  name: string;
  scheduledStartTime: Date | number | string;
};

/** `guild.scheduledEvents`: `fetch`/`create`/`edit`/`delete` (+ `event.rsvp`). */
export class GuildScheduledEventManager {
  readonly cache = new Collection<string, GuildScheduledEvent>();
  constructor(readonly guild: Guild) {}
  get client() {
    return this.guild.client;
  }
  fetch(): Promise<Collection<string, GuildScheduledEvent>>;
  fetch(id: string): Promise<GuildScheduledEvent>;
  async fetch(id?: string): Promise<GuildScheduledEvent | Collection<string, GuildScheduledEvent>> {
    const list = await this.client.rest.get<ServerEventDto[]>(`/servers/${this.guild.id}/events`);
    this.cache.clear();
    for (const e of list) this.cache.set(e.id, new GuildScheduledEvent(this.client, e));
    if (id === undefined) return this.cache;
    const e = this.cache.get(id);
    if (!e) throw new Error(`evento ${id} não encontrado em ${this.guild.name}`);
    return e;
  }
  /** `POST /servers/:id/events` (MANAGE_SERVER) */
  async create(data: GuildScheduledEventCreateOptions): Promise<GuildScheduledEvent> {
    const dto = await this.client.rest.post<ServerEventDto>(`/servers/${this.guild.id}/events`, {
      description: '',
      channelId: null,
      endsAt: null,
      ...eventBody(data),
    });
    const e = new GuildScheduledEvent(this.client, dto);
    this.cache.set(e.id, e);
    return e;
  }
  async edit(event: GuildScheduledEvent | string, data: GuildScheduledEventEditOptions): Promise<GuildScheduledEvent> {
    const id = typeof event === 'string' ? event : event.id;
    const dto = await this.client.rest.patch<ServerEventDto>(`/events/${id}`, eventBody(data));
    const e = new GuildScheduledEvent(this.client, dto);
    this.cache.set(e.id, e);
    return e;
  }
  async delete(event: GuildScheduledEvent | string): Promise<void> {
    const id = typeof event === 'string' ? event : event.id;
    await this.client.rest.delete(`/events/${id}`);
    this.cache.delete(id);
  }
}

/** `guild.presences`: presença dos membros (atualizada pelos eventos; `fetch()` carrega `GET /servers/:id/presence`). */
export class PresenceManager {
  readonly cache = new Collection<string, Presence>();
  constructor(readonly guild: Guild) {}
  async fetch(): Promise<Collection<string, Presence>> {
    const client = this.guild.client;
    const map = await client.rest.get<Record<string, PresenceStatus>>(`/servers/${this.guild.id}/presence`);
    for (const [userId, status] of Object.entries(map)) {
      const p = client.presences.cache.ensure(userId, () => new Presence(client, userId));
      p.status = status;
      this.cache.set(userId, p);
    }
    return this.cache;
  }
}

export class Guild {
  readonly id: string;
  name: string;
  ownerId: string;
  iconKey: string | null;
  official = false;
  verified = false;
  accent: string | null = null;
  wallpaperKey: string | null = null;
  /** permissões do bot no servidor (bits) */
  myPermissions = 0;
  readonly available = true;
  readonly channels: GuildChannelManager;
  readonly categories: GuildCategoryManager;
  readonly members: GuildMemberManager;
  readonly roles: RoleManager;
  readonly bans: GuildBanManager;
  readonly invites: GuildInviteManager;
  readonly scheduledEvents: GuildScheduledEventManager;
  readonly presences: PresenceManager;
  readonly messages: {
    /** busca em todos os canais de texto do servidor que o bot vê (`GET /servers/:id/messages/search`) */
    search: (opts: SearchMessagesOptions | string) => Promise<SearchResult>;
  };

  constructor(
    readonly client: Client,
    data: { id: string; name: string; ownerId: string; iconKey: string | null } & Partial<ServerSummary>,
  ) {
    this.id = data.id;
    this.name = data.name;
    this.ownerId = data.ownerId;
    this.iconKey = data.iconKey;
    this.applySummary(data);
    this.channels = new GuildChannelManager(this);
    this.categories = new GuildCategoryManager(this);
    this.members = new GuildMemberManager(this);
    this.roles = new RoleManager(this);
    this.bans = new GuildBanManager(this);
    this.invites = new GuildInviteManager(this);
    this.scheduledEvents = new GuildScheduledEventManager(this);
    this.presences = new PresenceManager(this);
    this.messages = {
      search: (opts) =>
        searchMessages(
          this.client,
          `/servers/${this.id}/messages/search`,
          typeof opts === 'string' ? { q: opts } : opts,
        ),
    };
  }

  applySummary(data: Partial<ServerSummary> & { name?: string; ownerId?: string; iconKey?: string | null }) {
    if (data.name !== undefined) this.name = data.name;
    if (data.ownerId !== undefined) this.ownerId = data.ownerId;
    if (data.iconKey !== undefined) this.iconKey = data.iconKey;
    if (data.official !== undefined) this.official = data.official;
    if (data.verified !== undefined) this.verified = data.verified;
    if (data.accent !== undefined) this.accent = data.accent;
    if (data.wallpaperKey !== undefined) this.wallpaperKey = data.wallpaperKey;
    return this;
  }

  /** aplica o detalhe (`GET /servers/:id`) nos caches */
  apply(detail: ServerDetail) {
    this.applySummary(detail);
    this.myPermissions = detail.myPermissions;
    this.roles.cache.clear();
    for (const r of detail.roles) this.roles.cache.set(r.id, new Role(this, r));
    this.categories.cache.clear();
    for (const c of detail.categories ?? []) this.categories.cache.set(c.id, new CategoryChannel(this.client, c));
    for (const id of [...this.channels.cache.keys()])
      if (!detail.channels.some((c) => c.id === id)) this.client.channels.cache.delete(id);
    this.channels.cache.clear();
    for (const c of detail.channels) this.client.upsertChannel(c);
    this.members.cache.clear();
    for (const m of detail.members) this.members.cache.set(m.user.id, new GuildMember(this, m));
    for (const m of this.members.cache.values()) {
      const p = this.client.presences.cache.get(m.id);
      if (p) this.presences.cache.set(m.id, p);
    }
    return this;
  }
  _clone(): Guild {
    const g = new Guild(this.client, { id: this.id, name: this.name, ownerId: this.ownerId, iconKey: this.iconKey });
    g.applySummary(this);
    g.myPermissions = this.myPermissions;
    return g;
  }

  /** contexto para calcular permissões de um membro com a mesma regra da API */
  permissionContext(member: GuildMember) {
    return {
      userId: member.id,
      ownerId: this.ownerId,
      everyoneRoleId: this.roles.everyone?.id ?? null,
      rolePermissions: new Map([...this.roles.cache.values()].map((r) => [r.id, r.permissions.bitfield])),
      memberRoleIds: member.roleIds,
    };
  }

  /** recarrega canais, cargos, categorias e membros */
  async fetch(): Promise<this> {
    this.apply(await this.client.rest.get<ServerDetail>(`/servers/${this.id}`));
    return this;
  }
  get memberCount() {
    return this.members.cache.size;
  }
  get owner(): GuildMember | null {
    return this.members.cache.get(this.ownerId) ?? null;
  }
  async fetchOwner(): Promise<GuildMember> {
    return this.members.cache.get(this.ownerId) ?? this.members.fetch(this.ownerId);
  }
  /** ícone (`GET /server-icons/:nome`); null sem ícone */
  iconURL(): string | null {
    return this.iconKey ? `${this.client.rest.baseUrl}/server-icons/${this.iconKey}` : null;
  }
  /** `PATCH /servers/:id` (MANAGE_SERVER): `name`, `accent` (#rrggbb ou null) */
  async edit(data: { name?: string; accent?: ColorResolvable; reason?: string }): Promise<this> {
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.accent !== undefined) body.accent = resolveColor(data.accent) ?? null;
    const res = await this.client.rest.patch<Partial<ServerSummary>>(`/servers/${this.id}`, body);
    if (res && typeof res === 'object') this.applySummary(res);
    return this;
  }
  setName(name: string, reason?: string) {
    return this.edit({ name, reason });
  }
  /** o bot sai do servidor (`POST /servers/:id/leave`) */
  async leave(): Promise<this> {
    await this.client.rest.post(`/servers/${this.id}/leave`);
    return this;
  }
  /** exclui o servidor (só o dono) */
  async delete(): Promise<this> {
    await this.client.rest.delete(`/servers/${this.id}`);
    return this;
  }
  /** `GET /servers/:id/audit-log?limit=` (VIEW_AUDIT_LOG) */
  async fetchAuditLogs(options: { limit?: number } = {}): Promise<GuildAuditLogs> {
    const q = options.limit ? `?limit=${options.limit}` : '';
    const list = await this.client.rest.get<AuditEntry[]>(`/servers/${this.id}/audit-log${q}`);
    return new GuildAuditLogs(new Collection(list.map((e) => [e.id, new GuildAuditLogsEntry(this, e)])));
  }
  /** `GET /servers/:id/webhooks` (MANAGE_SERVER) */
  async fetchWebhooks(): Promise<Collection<string, Webhook>> {
    const list = await this.client.rest.get<WebhookDto[]>(`/servers/${this.id}/webhooks`);
    return new Collection(list.map((w) => [w.id, new Webhook(this.client, w)]));
  }
  toString() {
    return this.name;
  }
  toJSON(): ServerSummary {
    return {
      id: this.id,
      name: this.name,
      iconKey: this.iconKey,
      ownerId: this.ownerId,
      official: this.official,
      verified: this.verified,
      accent: this.accent,
      wallpaperKey: this.wallpaperKey,
    };
  }
}

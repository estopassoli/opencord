import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  Permission,
  hasPermission,
  INVITE_CODE,
  rooms,
  type Category,
  type Channel,
  type PermissionOverrideDto,
  type Role,
  type ServerDetail,
  type ServerDirectoryEntry,
  type AdminServerEntry,
  type Invite,
  type InvitePreview,
  type ServerSummary,
} from '@opencord/contracts';
import { randomInt } from 'node:crypto';
import { createServerShell, createServerWithDefaults } from '@opencord/db';
import type { ImportPlan } from './discord-template.js';
import { PrismaService } from '../common/prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../common/domain-events.js';
import { forbidden, notFound } from '../common/errors.js';
import { category, channel, member, MEMBER_INCLUDE, role, serverSummary } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService, type ServerAccess } from './permissions.service.js';

const MAX_SERVERS_PER_OWNER = 20;
const MAX_CHANNELS = 200;
const MAX_ROLES = 100;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** 10 caracteres de um alfabeto sem ambíguos (~57 bits): inviável de adivinhar com o rate limit. */
const inviteCode = () => Array.from({ length: 10 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------- Servidores ----------
  async listMine(userId: string): Promise<ServerSummary[]> {
    const rows = await this.prisma.serverMember.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => serverSummary(r.server));
  }

  async create(userId: string, name: string): Promise<ServerDetail> {
    const owned = await this.prisma.server.count({ where: { ownerId: userId } });
    if (owned >= MAX_SERVERS_PER_OWNER) throw new BadRequestException('limite de servidores atingido');
    const server = await this.prisma.$transaction((tx) => createServerWithDefaults(tx, userId, name));
    await this.audit.log(userId, server.id, 'server.create', server.id, { name });
    return this.announceNew(server, userId);
  }

  /** Servidor novo: avisa cada membro conectado (no oficial, todos; no privado, só o dono) para carregá-lo. */
  private async announceNew(
    server: { id: string; name: string; ownerId: string; iconKey: string | null; official: boolean },
    userId: string,
  ) {
    const members = await this.prisma.serverMember.findMany({
      where: { serverId: server.id },
      select: { userId: true },
    });
    for (const m of members) {
      await this.realtime.syncUserRooms(m.userId);
      if (m.userId !== userId) this.realtime.toUser(m.userId, 'server:added', serverSummary(server));
    }
    return this.detail(server.id, userId);
  }

  /** Cria um servidor a partir de um plano de importação (estrutura de um modelo do Discord). */
  async createFromPlan(userId: string, plan: ImportPlan, source: string): Promise<ServerDetail> {
    const owned = await this.prisma.server.count({ where: { ownerId: userId } });
    if (owned >= MAX_SERVERS_PER_OWNER) throw new BadRequestException('limite de servidores atingido');
    const server = await this.prisma.$transaction(
      async (tx) => {
        const { server, everyone } = await createServerShell(tx, userId, plan.name, plan.everyonePermissions);
        const roleIds = new Map<string, string>([['everyone', everyone.id]]);
        // na ordem do modelo (da base para o topo): posição 1 = logo acima de @everyone
        for (const [i, r] of plan.roles.entries()) {
          const row = await tx.role.create({
            data: { serverId: server.id, name: r.name, color: r.color, permissions: r.permissions, position: i + 1 },
          });
          roleIds.set(r.key, row.id);
        }
        const catIds = new Map<string, string>();
        for (const [i, c] of plan.categories.entries()) {
          const row = await tx.category.create({ data: { serverId: server.id, name: c.name, position: i } });
          catIds.set(c.key, row.id);
        }
        for (const [i, c] of plan.channels.entries()) {
          await tx.channel.create({
            data: {
              serverId: server.id,
              categoryId: c.categoryKey ? (catIds.get(c.categoryKey) ?? null) : null,
              kind: c.kind,
              name: c.name,
              topic: c.topic,
              position: i,
              overrides: {
                create: c.overrides
                  .filter((o) => roleIds.has(o.roleKey))
                  .map((o) => ({
                    subjectType: 'role' as const,
                    subjectId: roleIds.get(o.roleKey)!,
                    allow: o.allow,
                    deny: o.deny,
                  })),
              },
            },
          });
        }
        return server;
      },
      { timeout: 30_000 },
    );
    await this.audit.log(userId, server.id, 'server.import', server.id, {
      source,
      roles: plan.roles.length,
      categories: plan.categories.length,
      channels: plan.channels.length,
      skipped: plan.skipped,
    });
    return this.announceNew(server, userId);
  }

  async detail(serverId: string, userId: string): Promise<ServerDetail> {
    const access = await this.perms.server(serverId, userId);
    const s = await this.prisma.server.findUniqueOrThrow({
      where: { id: serverId },
      include: {
        roles: { orderBy: { position: 'asc' } },
        categories: { orderBy: { position: 'asc' } },
        channels: { include: { overrides: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        members: { include: MEMBER_INCLUDE, orderBy: { joinedAt: 'asc' } },
      },
    });
    const chPerms = await this.perms.channelsFor(access, s.channels);
    const canManage =
      hasPermission(access.base, Permission.MANAGE_CHANNELS) || hasPermission(access.base, Permission.MANAGE_ROLES);
    return {
      ...serverSummary(s),
      roles: s.roles.map(role),
      categories: s.categories.map(category),
      channels: s.channels
        .filter((c) => (chPerms.get(c.id) ?? 0) !== 0)
        // overrides só são expostos a quem pode gerenciá-los
        .map((c) => channel(canManage ? c : { ...c, overrides: [] }, chPerms.get(c.id) ?? 0)),
      members: s.members.map(member),
      myPermissions: access.base,
    };
  }

  async update(serverId: string, userId: string, dto: { name?: string | undefined }): Promise<ServerSummary> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    const s = await this.prisma.server.update({
      where: { id: serverId },
      data: { ...(dto.name ? { name: dto.name } : {}) },
    });
    await this.audit.log(userId, serverId, 'server.update', serverId, dto);
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(s));
    return serverSummary(s);
  }

  async remove(serverId: string, userId: string) {
    const access = await this.perms.server(serverId, userId);
    if (access.ownerId !== userId) throw forbidden('somente o proprietário pode excluir o servidor');
    const members = await this.prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } });
    this.events.emit({ type: 'member.removed', serverId, userId: '*', reason: 'deleted' });
    this.realtime.emit(rooms.server(serverId), 'server:deleted', { serverId });
    await this.prisma.server.delete({ where: { id: serverId } });
    for (const m of members) await this.realtime.syncUserRooms(m.userId);
  }

  async leave(serverId: string, userId: string) {
    const access = await this.perms.server(serverId, userId);
    if (access.ownerId === userId)
      throw new BadRequestException('o proprietário não pode sair; transfira ou exclua o servidor');
    await this.prisma.serverMember.delete({ where: { serverId_userId: { serverId, userId } } });
    await this.audit.log(userId, serverId, 'member.leave', userId, {});
    this.events.emit({ type: 'member.removed', serverId, userId, reason: 'left' });
    await this.realtime.memberRemoved(serverId, userId, 'left');
  }

  /** Diretório: só os servidores oficiais (abertos a todos), com contagem de membros e se o usuário já participa. */
  async directory(userId: string): Promise<ServerDirectoryEntry[]> {
    const rows = await this.prisma.server.findMany({
      where: { official: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        iconKey: true,
        _count: { select: { members: true } },
        members: { where: { userId }, select: { userId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iconKey: r.iconKey,
      memberCount: r._count.members,
      joined: r.members.length > 0,
    }));
  }

  /** Entrar no servidor oficial pelo diretório, sem convite. Privados exigem convite (404, sem revelar que existem). */
  async join(serverId: string, userId: string): Promise<ServerDetail> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { official: true } });
    if (!server?.official) throw notFound('servidor');
    return this.addMember(serverId, userId, { via: 'directory' });
  }

  /** Idempotente: só audita e avisa quando a pessoa ainda não era membro. */
  private async addMember(serverId: string, userId: string, meta: Record<string, string>): Promise<ServerDetail> {
    const created = await this.prisma.serverMember.createMany({ data: [{ serverId, userId }], skipDuplicates: true });
    if (created.count) {
      await this.audit.log(userId, serverId, 'member.join', userId, meta);
      await this.realtime.memberJoined(serverId, userId);
    }
    return this.detail(serverId, userId);
  }

  // ---------- Super admin da instância (ADR-0013) ----------
  private async requireInstanceAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isInstanceAdmin: true } });
    if (!u?.isInstanceAdmin) throw notFound('recurso');
  }

  /** Todos os servidores da instância, com dono, membros e se o admin já participa. */
  async adminServers(userId: string): Promise<AdminServerEntry[]> {
    await this.requireInstanceAdmin(userId);
    const rows = await this.prisma.server.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        iconKey: true,
        official: true,
        verified: true,
        owner: { select: { id: true, displayName: true } },
        _count: { select: { members: true } },
        members: { where: { userId }, select: { userId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iconKey: r.iconKey,
      official: r.official,
      verified: r.verified,
      owner: r.owner,
      memberCount: r._count.members,
      joined: r.members.length > 0,
    }));
  }

  /** O admin entra em qualquer servidor; fica registrado na auditoria e todos veem a entrada. */
  async adminJoin(serverId: string, userId: string): Promise<ServerDetail> {
    await this.requireInstanceAdmin(userId);
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { id: true } });
    if (!server) throw notFound('servidor');
    return this.addMember(serverId, userId, { via: 'instance-admin' });
  }

  /** Selo de verificado (só o selo; privacidade e entrada não mudam). Avisa os membros na hora. */
  async adminSetVerified(serverId: string, userId: string, verified: boolean): Promise<ServerSummary> {
    await this.requireInstanceAdmin(userId);
    const exists = await this.prisma.server.findUnique({ where: { id: serverId }, select: { id: true } });
    if (!exists) throw notFound('servidor');
    const server = await this.prisma.server.update({ where: { id: serverId }, data: { verified } });
    await this.audit.log(userId, serverId, 'server.verified', serverId, { verified });
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
    return serverSummary(server);
  }

  // ---------- Convites ----------
  /** Convite do membro para o servidor: reaproveita o que ele já criou (um link por pessoa e servidor). */
  async createInvite(serverId: string, userId: string): Promise<Invite> {
    await this.perms.server(serverId, userId); // 404 para quem não é membro
    const existing = await this.prisma.invite.findFirst({ where: { serverId, creatorId: userId } });
    if (existing) return this.inviteDto(existing.code, serverId);
    const invite = await this.prisma.invite.create({ data: { code: inviteCode(), serverId, creatorId: userId } });
    await this.audit.log(userId, serverId, 'invite.create', invite.code, {});
    return this.inviteDto(invite.code, serverId);
  }

  private inviteDto(code: string, serverId: string): Invite {
    const base = this.cfg.PUBLIC_APP_URL?.replace(/\/+$/, '');
    return { code, serverId, url: base ? `${base}/invite/${code}` : null };
  }

  async previewInvite(code: string, userId: string): Promise<InvitePreview> {
    const inv = await this.findInvite(code);
    const [memberCount, me] = await Promise.all([
      this.prisma.serverMember.count({ where: { serverId: inv.serverId } }),
      this.prisma.serverMember.findUnique({ where: { serverId_userId: { serverId: inv.serverId, userId } } }),
    ]);
    const s = inv.server;
    return {
      code: inv.code,
      server: { id: s.id, name: s.name, iconKey: s.iconKey, official: s.official, verified: s.verified },
      memberCount,
      joined: Boolean(me),
    };
  }

  /**
   * Página pública do link de convite: meta tags Open Graph (nome, imagem e membros do servidor) para o cartão que
   * Discord, WhatsApp etc. mostram ao colar o link; quem abre no navegador segue para o app com o convite.
   */
  async inviteEmbed(code: string): Promise<string> {
    const app = this.cfg.PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
    const target = `${app}/?invite=${encodeURIComponent(code)}`;
    const esc = (t: string) =>
      t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    let title = 'Convite para o OpenCord';
    let description = 'Este convite não existe mais.';
    let image = app ? `${app}/opencord-logo.png` : '';
    try {
      const inv = await this.findInvite(code);
      const members = await this.prisma.serverMember.count({ where: { serverId: inv.serverId } });
      title = `Convite para ${inv.server.name}`;
      description = `${members} ${members === 1 ? 'membro' : 'membros'} · Entre pelo navegador ou pelo app, só com um apelido.`;
      if (inv.server.iconKey)
        image = `${this.cfg.PUBLIC_API_URL.replace(/\/+$/, '')}/server-icons/${encodeURIComponent(inv.server.iconKey)}`;
    } catch {
      /* convite inválido: cartão genérico */
    }
    const meta = (p: string, v: string) => (v ? `<meta property="${p}" content="${esc(v)}">` : '');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(title)}</title>
${meta('og:site_name', 'OpenCord')}${meta('og:type', 'website')}${meta('og:title', title)}
${meta('og:description', description)}${meta('og:image', image)}${meta('og:url', target)}
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#4d56fd">
<meta name="description" content="${esc(description)}">
</head><body style="background:#1e1f22;color:#dbdee1;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p><a style="color:#8b93ff" href="${esc(target)}">Abrir o convite no OpenCord</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body></html>`;
  }

  async acceptInvite(code: string, userId: string): Promise<ServerDetail> {
    const inv = await this.findInvite(code);
    const already = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: inv.serverId, userId } },
    });
    if (!already) await this.prisma.invite.update({ where: { code: inv.code }, data: { uses: { increment: 1 } } });
    return this.addMember(inv.serverId, userId, { via: 'invite', code: inv.code });
  }

  private async findInvite(code: string) {
    if (!INVITE_CODE.test(code)) throw notFound('convite');
    const inv = await this.prisma.invite.findUnique({ where: { code }, include: { server: true } });
    if (!inv) throw notFound('convite');
    return inv;
  }

  async listMemberIds(serverId: string): Promise<string[]> {
    return (await this.prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } })).map(
      (m) => m.userId,
    );
  }

  /** Chamado após um usuário existente entrar via convite. */
  async afterJoin(serverId: string, userId: string) {
    await this.realtime.memberJoined(serverId, userId);
  }

  // ---------- Membros ----------
  private async targetTop(serverId: string, targetUserId: string, ownerId: string): Promise<number> {
    if (targetUserId === ownerId) return Number.POSITIVE_INFINITY;
    const m = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetUserId } },
      select: { roles: { select: { role: { select: { position: true } } } } },
    });
    if (!m) throw notFound('membro');
    return Math.max(0, ...m.roles.map((r) => r.role.position));
  }

  async kick(serverId: string, actorId: string, targetId: string, reason?: string) {
    if (actorId === targetId) throw new BadRequestException('use "sair do servidor"');
    const actor = await this.perms.requireServer(serverId, actorId, Permission.KICK_MEMBERS);
    this.perms.assertAbove(actor, await this.targetTop(serverId, targetId, actor.ownerId));
    await this.prisma.serverMember.delete({ where: { serverId_userId: { serverId, userId: targetId } } });
    await this.audit.log(actorId, serverId, 'member.kick', targetId, { reason: reason ?? null });
    // Revogação ativa: voz (SFU) é encerrada pelo VoiceService ao receber o evento.
    this.events.emit({ type: 'member.removed', serverId, userId: targetId, reason: 'kicked' });
    await this.realtime.memberRemoved(serverId, targetId, 'kicked');
  }

  async setMemberRoles(serverId: string, actorId: string, targetId: string, roleIds: string[]) {
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MANAGE_ROLES);
    const roles = await this.prisma.role.findMany({ where: { serverId } });
    const byId = new Map(roles.map((r) => [r.id, r]));
    const unique = [...new Set(roleIds)];
    for (const id of unique) {
      const r = byId.get(id);
      if (!r || r.isEveryone) throw new BadRequestException('cargo inválido');
    }
    const current = await this.prisma.memberRole.findMany({ where: { serverId, userId: targetId } });
    if (!(await this.prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId: targetId } } })))
      throw notFound('membro');
    const currentIds = new Set(current.map((c) => c.roleId));
    const changed = [
      ...unique.filter((id) => !currentIds.has(id)),
      ...[...currentIds].filter((id) => !unique.includes(id)),
    ];
    // Só pode adicionar/remover cargos abaixo do seu; e não pode alterar alguém acima ou igual (exceto a si mesmo, para cargos abaixo).
    for (const id of changed) this.perms.assertAbove(actor, byId.get(id)?.position ?? Number.POSITIVE_INFINITY);
    if (targetId !== actorId) this.perms.assertAbove(actor, await this.targetTop(serverId, targetId, actor.ownerId));
    await this.prisma.$transaction([
      this.prisma.memberRole.deleteMany({ where: { serverId, userId: targetId } }),
      this.prisma.memberRole.createMany({ data: unique.map((roleId) => ({ serverId, userId: targetId, roleId })) }),
    ]);
    await this.audit.log(actorId, serverId, 'member.roles', targetId, { roleIds: unique });
    const m = await this.prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: targetId } },
      include: MEMBER_INCLUDE,
    });
    this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: member(m) });
    await this.permissionsChanged(serverId);
    return member(m);
  }

  async setNickname(serverId: string, userId: string, nickname: string | null) {
    await this.perms.server(serverId, userId);
    const m = await this.prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId } },
      data: { nickname: nickname?.trim() || null },
      include: MEMBER_INCLUDE,
    });
    this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: member(m) });
    return member(m);
  }

  private async permissionsChanged(serverId: string) {
    this.events.emit({ type: 'permissions.changed', serverId });
    await this.realtime.syncServer(serverId);
  }

  // ---------- Cargos ----------
  async createRole(
    serverId: string,
    actorId: string,
    dto: { name: string; permissions: number; color?: string | null | undefined },
  ): Promise<Role> {
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MANAGE_ROLES);
    this.perms.assertGrantable(actor, dto.permissions);
    if ((dto.permissions & ~ALL_PERMISSIONS) !== 0) throw new BadRequestException('bits de permissão desconhecidos');
    const count = await this.prisma.role.count({ where: { serverId } });
    if (count >= MAX_ROLES) throw new BadRequestException('limite de cargos');
    const top = await this.prisma.role.aggregate({ where: { serverId }, _max: { position: true } });
    // Novo cargo entra logo abaixo do cargo mais alto do ator (owner: no topo).
    const position = Number.isFinite(actor.topPosition) ? Math.max(1, actor.topPosition) : (top._max.position ?? 0) + 1;
    if (Number.isFinite(actor.topPosition)) {
      await this.prisma.role.updateMany({
        where: { serverId, position: { gte: position }, isEveryone: false },
        data: { position: { increment: 1 } },
      });
    }
    const r = await this.prisma.role.create({
      data: { serverId, name: dto.name, permissions: dto.permissions, color: dto.color ?? null, position },
    });
    await this.audit.log(actorId, serverId, 'role.create', r.id, { name: r.name, permissions: r.permissions });
    this.realtime.emit(rooms.server(serverId), 'role:upserted', role(r));
    return role(r);
  }

  async updateRole(
    roleId: string,
    actorId: string,
    dto: {
      name?: string | undefined;
      permissions?: number | undefined;
      color?: string | null | undefined;
      position?: number | undefined;
    },
  ): Promise<Role> {
    const r = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!r) throw notFound('cargo');
    const actor = await this.perms.requireServer(r.serverId, actorId, Permission.MANAGE_ROLES).catch((e: unknown) => {
      throw e;
    });
    if (!r.isEveryone) this.perms.assertAbove(actor, r.position);
    if (dto.permissions !== undefined) {
      if ((dto.permissions & ~ALL_PERMISSIONS) !== 0) throw new BadRequestException('bits de permissão desconhecidos');
      // Mudar bits exige possuí-los (adicionar ou remover).
      this.perms.assertGrantable(actor, dto.permissions ^ r.permissions);
    }
    if (r.isEveryone && (dto.name || dto.position !== undefined))
      throw new BadRequestException('@everyone não pode ser renomeado ou movido');
    if (dto.position !== undefined) this.perms.assertAbove(actor, dto.position);
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.permissions !== undefined ? { permissions: dto.permissions } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
    await this.audit.log(actorId, r.serverId, 'role.update', roleId, {
      before: { permissions: r.permissions, name: r.name },
      after: dto,
    });
    this.realtime.emit(rooms.server(r.serverId), 'role:upserted', role(updated));
    await this.permissionsChanged(r.serverId);
    return role(updated);
  }

  async deleteRole(roleId: string, actorId: string) {
    const r = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!r) throw notFound('cargo');
    if (r.isEveryone) throw new BadRequestException('@everyone não pode ser excluído');
    const actor = await this.perms.requireServer(r.serverId, actorId, Permission.MANAGE_ROLES);
    this.perms.assertAbove(actor, r.position);
    await this.prisma.$transaction([
      this.prisma.channelPermissionOverride.deleteMany({ where: { subjectType: 'role', subjectId: roleId } }),
      this.prisma.role.delete({ where: { id: roleId } }),
    ]);
    await this.audit.log(actorId, r.serverId, 'role.delete', roleId, { name: r.name });
    this.realtime.emit(rooms.server(r.serverId), 'role:deleted', { serverId: r.serverId, roleId });
    await this.permissionsChanged(r.serverId);
  }

  // ---------- Categorias ----------
  async createCategory(serverId: string, actorId: string, name: string): Promise<Category> {
    await this.perms.requireServer(serverId, actorId, Permission.MANAGE_CHANNELS);
    const max = await this.prisma.category.aggregate({ where: { serverId }, _max: { position: true } });
    const c = await this.prisma.category.create({ data: { serverId, name, position: (max._max.position ?? -1) + 1 } });
    await this.audit.log(actorId, serverId, 'category.create', c.id, { name });
    this.realtime.emit(rooms.server(serverId), 'category:upserted', category(c));
    return category(c);
  }

  async updateCategory(
    categoryId: string,
    actorId: string,
    dto: { name?: string | undefined; position?: number | undefined },
  ): Promise<Category> {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw notFound('categoria');
    await this.perms.requireServer(c.serverId, actorId, Permission.MANAGE_CHANNELS);
    const u = await this.prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
    this.realtime.emit(rooms.server(c.serverId), 'category:upserted', category(u));
    return category(u);
  }

  async deleteCategory(categoryId: string, actorId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw notFound('categoria');
    await this.perms.requireServer(c.serverId, actorId, Permission.MANAGE_CHANNELS);
    await this.prisma.category.delete({ where: { id: categoryId } });
    await this.audit.log(actorId, c.serverId, 'category.delete', categoryId, { name: c.name });
    this.realtime.emit(rooms.server(c.serverId), 'category:deleted', { serverId: c.serverId, categoryId });
  }

  // ---------- Canais ----------
  private async emitChannel(serverId: string, channelId: string, ev: 'channel:created' | 'channel:updated') {
    // Payload inclui myPermissions, que varia por usuário: enviar individualmente a cada membro conectado que vê o canal.
    const members = await this.prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } });
    const c = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { overrides: true } });
    for (const m of members) {
      const access = await this.perms.server(serverId, m.userId).catch(() => null);
      if (!access) continue;
      const p = (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0;
      if (p === 0) {
        if (ev === 'channel:updated') this.realtime.toUser(m.userId, 'channel:deleted', { serverId, channelId });
        continue;
      }
      const canManage =
        hasPermission(access.base, Permission.MANAGE_CHANNELS) || hasPermission(access.base, Permission.MANAGE_ROLES);
      this.realtime.toUser(m.userId, ev, channel(canManage ? c : { ...c, overrides: [] }, p));
    }
  }

  private async validateOverrides(access: ServerAccess, overrides: PermissionOverrideDto[]) {
    const roles = await this.prisma.role.findMany({ where: { serverId: access.serverId }, select: { id: true } });
    const roleIds = new Set(roles.map((r) => r.id));
    const memberIds = new Set(
      (
        await this.prisma.serverMember.findMany({
          where: {
            serverId: access.serverId,
            userId: { in: overrides.filter((o) => o.subjectType === 'member').map((o) => o.subjectId) },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const seen = new Set<string>();
    for (const o of overrides) {
      const key = `${o.subjectType}:${o.subjectId}`;
      if (seen.has(key)) throw new BadRequestException('override duplicado');
      seen.add(key);
      if (o.subjectType === 'role' ? !roleIds.has(o.subjectId) : !memberIds.has(o.subjectId))
        throw new BadRequestException('alvo de override inválido');
      if ((o.allow & o.deny) !== 0) throw new BadRequestException('allow e deny sobrepostos');
      this.perms.assertGrantable(access, o.allow | o.deny);
    }
  }

  async createChannel(
    serverId: string,
    actorId: string,
    dto: {
      name: string;
      kind: 'text' | 'voice';
      categoryId?: string | null | undefined;
      topic?: string | null | undefined;
    },
  ): Promise<Channel> {
    await this.perms.requireServer(serverId, actorId, Permission.MANAGE_CHANNELS);
    if ((await this.prisma.channel.count({ where: { serverId } })) >= MAX_CHANNELS)
      throw new BadRequestException('limite de canais');
    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({ where: { id: dto.categoryId, serverId } });
      if (!cat) throw new BadRequestException('categoria inválida');
    }
    const max = await this.prisma.channel.aggregate({
      where: { serverId, categoryId: dto.categoryId ?? null },
      _max: { position: true },
    });
    const c = await this.prisma.channel.create({
      data: {
        serverId,
        name: dto.name,
        kind: dto.kind,
        categoryId: dto.categoryId ?? null,
        topic: dto.topic ?? null,
        position: (max._max.position ?? -1) + 1,
      },
      include: { overrides: true },
    });
    await this.audit.log(actorId, serverId, 'channel.create', c.id, { name: c.name, kind: c.kind });
    await this.realtime.syncServer(serverId);
    await this.emitChannel(serverId, c.id, 'channel:created');
    const access = await this.perms.server(serverId, actorId);
    return channel(c, (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0);
  }

  async updateChannel(
    channelId: string,
    actorId: string,
    dto: {
      name?: string | undefined;
      topic?: string | null | undefined;
      categoryId?: string | null | undefined;
      position?: number | undefined;
      overrides?: PermissionOverrideDto[] | undefined;
    },
  ): Promise<Channel> {
    const existing = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!existing) throw notFound('canal');
    const access = await this.perms
      .requireServer(existing.serverId, actorId, Permission.MANAGE_CHANNELS)
      .catch((e: unknown) => {
        throw e instanceof Error && e.message.includes('não encontrado') ? notFound('canal') : e;
      });
    if (dto.overrides) {
      if (!hasPermission(access.base, Permission.MANAGE_ROLES))
        throw forbidden('MANAGE_ROLES necessário para alterar overrides');
      await this.validateOverrides(access, dto.overrides);
    }
    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({ where: { id: dto.categoryId, serverId: existing.serverId } });
      if (!cat) throw new BadRequestException('categoria inválida');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
        },
      });
      if (dto.overrides) {
        await tx.channelPermissionOverride.deleteMany({ where: { channelId } });
        if (dto.overrides.length)
          await tx.channelPermissionOverride.createMany({ data: dto.overrides.map((o) => ({ ...o, channelId })) });
      }
    });
    await this.audit.log(
      actorId,
      existing.serverId,
      dto.overrides ? 'channel.overrides' : 'channel.update',
      channelId,
      { ...dto },
    );
    if (dto.overrides) await this.permissionsChanged(existing.serverId);
    await this.emitChannel(existing.serverId, channelId, 'channel:updated');
    const c = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { overrides: true } });
    return channel(c, (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0);
  }

  async deleteChannel(channelId: string, actorId: string) {
    const c = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!c) throw notFound('canal');
    await this.perms.requireServer(c.serverId, actorId, Permission.MANAGE_CHANNELS);
    this.events.emit({ type: 'channel.deleted', serverId: c.serverId, channelId });
    this.realtime.emit(rooms.server(c.serverId), 'channel:deleted', { serverId: c.serverId, channelId });
    await this.prisma.channel.delete({ where: { id: channelId } });
    await this.audit.log(actorId, c.serverId, 'channel.delete', channelId, { name: c.name });
  }
}

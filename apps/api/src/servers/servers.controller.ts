import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '@opencord/contracts';
import { serverSummary } from '../common/serialize.js';
import { AvatarService } from '../users/avatar.service.js';
import {
  CreateCategoryRequest,
  CreateChannelRequest,
  CreateRoleRequest,
  CreateServerRequest,
  DiscordImportRequest,
  SetMemberRolesRequest,
  UpdateCategoryRequest,
  UpdateChannelRequest,
  UpdateRoleRequest,
  UpdateServerRequest,
} from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PresenceService } from '../realtime/presence.service.js';
import { PermissionsService } from './permissions.service.js';
import { ServersService } from './servers.service.js';
import { DiscordImportService } from './discord-import.service.js';

const anyUuid = new ParseUUIDPipe();
const uuid = anyUuid;
const Nickname = z.object({ nickname: z.string().trim().max(64).nullable() });
const KickBody = z.object({ reason: z.string().max(512).optional() }).default({});

const VerifiedBody = z.object({ verified: z.boolean() });

@Controller()
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly audit: AuditService,
    private readonly presence: PresenceService,
    private readonly perms: PermissionsService,
    private readonly discord: DiscordImportService,
    private readonly avatars: AvatarService,
  ) {}

  @Get('servers')
  list(@CurrentUser() u: AuthUser) {
    return this.servers.listMine(u.userId);
  }

  @Post('servers')
  create(@CurrentUser() u: AuthUser, @Body(zodPipe(CreateServerRequest)) dto: z.infer<typeof CreateServerRequest>) {
    return this.servers.create(u.userId, dto.name);
  }

  /** Prévia da importação de um modelo de servidor do Discord (não cria nada). */
  @Post('servers/import/discord/preview')
  @HttpCode(200)
  previewDiscord(@Body(zodPipe(DiscordImportRequest)) dto: z.infer<typeof DiscordImportRequest>) {
    return this.discord.preview(dto.link);
  }

  /** Cria um servidor com a estrutura (categorias, canais, cargos, permissões) de um modelo do Discord. */
  @Post('servers/import/discord')
  importDiscord(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(DiscordImportRequest)) dto: z.infer<typeof DiscordImportRequest>,
  ) {
    return this.discord.import(u.userId, dto.link);
  }

  /** Imagem do servidor (multipart "file"; mesmas regras da foto de perfil). Exige gerenciar o servidor. */
  @Post('servers/:id/icon')
  async setIcon(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string, @Req() req: FastifyRequest) {
    await this.perms.requireServer(id, u.userId, Permission.MANAGE_SERVER);
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    return serverSummary(await this.avatars.setServerIcon(id, file.file));
  }

  @Delete('servers/:id/icon')
  async clearIcon(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.perms.requireServer(id, u.userId, Permission.MANAGE_SERVER);
    return serverSummary(await this.avatars.clearServerIcon(id));
  }

  /** Diretório: servidores oficiais (abertos a todos, sem convite). */
  @Get('servers/directory')
  directory(@CurrentUser() u: AuthUser) {
    return this.servers.directory(u.userId);
  }

  /** Entrar no servidor oficial (ex.: depois de ter saído). */
  @Post('servers/:id/join')
  join(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    return this.servers.join(id, u.userId);
  }

  /** Super admin (ADR-0013): todos os servidores da instância; 404 para quem não é admin. */
  @Get('admin/servers')
  adminServers(@CurrentUser() u: AuthUser) {
    return this.servers.adminServers(u.userId);
  }

  @Post('admin/servers/:id/join')
  adminJoin(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    return this.servers.adminJoin(id, u.userId);
  }

  @Put('admin/servers/:id/verified')
  adminSetVerified(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(VerifiedBody)) body: z.infer<typeof VerifiedBody>,
  ) {
    return this.servers.adminSetVerified(id, u.userId, body.verified);
  }

  /** Convite para o servidor (qualquer membro); devolve o mesmo código a cada pedido da mesma pessoa. */
  @Post('servers/:id/invites')
  createInvite(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    return this.servers.createInvite(id, u.userId);
  }

  /** Página do link de convite com meta tags (cartão no Discord/WhatsApp); redireciona quem abre para o app. */
  @Public()
  @Get('invites/:code/embed')
  async inviteEmbed(@Param('code') code: string, @Res() reply: FastifyReply) {
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
      .header('X-Content-Type-Options', 'nosniff')
      .send(await this.servers.inviteEmbed(code));
  }

  /** Prévia do convite (nome, imagem e membros do servidor) antes de entrar. */
  @Get('invites/:code')
  previewInvite(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.servers.previewInvite(code, u.userId);
  }

  @Post('invites/:code')
  acceptInvite(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.servers.acceptInvite(code, u.userId);
  }

  @Get('servers/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    return this.servers.detail(id, u.userId);
  }

  @Patch('servers/:id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(UpdateServerRequest)) dto: z.infer<typeof UpdateServerRequest>,
  ) {
    return this.servers.update(id, u.userId, dto);
  }

  @Delete('servers/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.servers.remove(id, u.userId);
  }

  @Post('servers/:id/leave')
  @HttpCode(204)
  async leave(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.servers.leave(id, u.userId);
  }

  @Get('servers/:id/presence')
  async serverPresence(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.perms.server(id, u.userId);
    return this.presence.visibleMany(await this.servers.listMemberIds(id));
  }

  /** Jogo de cada membro que está jogando agora (ADR-0021). */
  @Get('servers/:id/games')
  async serverGames(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.perms.server(id, u.userId);
    return this.presence.visibleGames(await this.servers.listMemberIds(id));
  }

  @Get('servers/:id/audit-log')
  auditLog(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string, @Query('limit') limit?: string) {
    return this.audit.list(id, u.userId, limit ? Number(limit) || 100 : 100);
  }

  // ----- membros -----
  @Delete('servers/:id/members/:userId')
  @HttpCode(204)
  async kick(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Param('userId', anyUuid) userId: string,
    @Body(zodPipe(KickBody)) body: z.infer<typeof KickBody>,
  ) {
    await this.servers.kick(id, u.userId, userId, body?.reason);
  }

  @Put('servers/:id/members/:userId/roles')
  setRoles(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Param('userId', anyUuid) userId: string,
    @Body(zodPipe(SetMemberRolesRequest)) dto: z.infer<typeof SetMemberRolesRequest>,
  ) {
    return this.servers.setMemberRoles(id, u.userId, userId, dto.roleIds);
  }

  @Patch('servers/:id/members/me')
  nickname(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(Nickname)) dto: z.infer<typeof Nickname>,
  ) {
    return this.servers.setNickname(id, u.userId, dto.nickname);
  }

  // ----- cargos -----
  @Post('servers/:id/roles')
  createRole(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(CreateRoleRequest)) dto: z.infer<typeof CreateRoleRequest>,
  ) {
    return this.servers.createRole(id, u.userId, dto);
  }

  @Patch('roles/:id')
  updateRole(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(UpdateRoleRequest)) dto: z.infer<typeof UpdateRoleRequest>,
  ) {
    return this.servers.updateRole(id, u.userId, dto);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    await this.servers.deleteRole(id, u.userId);
  }

  // ----- categorias -----
  @Post('servers/:id/categories')
  createCategory(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(CreateCategoryRequest)) dto: z.infer<typeof CreateCategoryRequest>,
  ) {
    return this.servers.createCategory(id, u.userId, dto.name);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(UpdateCategoryRequest)) dto: z.infer<typeof UpdateCategoryRequest>,
  ) {
    return this.servers.updateCategory(id, u.userId, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.servers.deleteCategory(id, u.userId);
  }

  // ----- canais -----
  @Post('servers/:id/channels')
  createChannel(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(CreateChannelRequest)) dto: z.infer<typeof CreateChannelRequest>,
  ) {
    return this.servers.createChannel(id, u.userId, dto);
  }

  @Patch('channels/:id')
  updateChannel(
    @CurrentUser() u: AuthUser,
    @Param('id', anyUuid) id: string,
    @Body(zodPipe(UpdateChannelRequest)) dto: z.infer<typeof UpdateChannelRequest>,
  ) {
    return this.servers.updateChannel(id, u.userId, dto);
  }

  @Delete('channels/:id')
  @HttpCode(204)
  async deleteChannel(@CurrentUser() u: AuthUser, @Param('id', anyUuid) id: string) {
    await this.servers.deleteChannel(id, u.userId);
  }
}

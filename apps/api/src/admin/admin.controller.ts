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
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  AdminAuditQuery,
  AdminSystemMessagesQuery,
  AdminUsersQuery,
  CreateBadgeRequest,
  SetUserBadgesRequest,
  UpdateBadgeRequest,
  SetInstanceAdminRequest,
  SetUserVerifiedRequest,
  SuspendUserRequest,
  UpdateInstanceConfigRequest,
} from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { AdminService } from './admin.service.js';

const uuid = new ParseUUIDPipe();

/** Painel do super admin (ADR-0020). Todas as rotas dão 404 para quem não é super admin. */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats(@CurrentUser() u: AuthUser) {
    return this.admin.stats(u.userId);
  }

  @Get('system-messages')
  systemMessages(
    @CurrentUser() u: AuthUser,
    @Query(zodPipe(AdminSystemMessagesQuery)) q: z.infer<typeof AdminSystemMessagesQuery>,
  ) {
    return this.admin.systemMessages(u.userId, q.cursor);
  }

  @Get('users')
  users(@CurrentUser() u: AuthUser, @Query(zodPipe(AdminUsersQuery)) q: z.infer<typeof AdminUsersQuery>) {
    return this.admin.users(u.userId, q);
  }

  @Post('users/:id/suspend')
  suspend(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(SuspendUserRequest.default({}))) body: z.infer<typeof SuspendUserRequest>,
  ) {
    return this.admin.suspend(u.userId, id, body.reason);
  }

  @Post('users/:id/unsuspend')
  unsuspend(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.admin.unsuspend(u.userId, id);
  }

  @Post('users/:id/logout')
  logout(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.admin.logoutEverywhere(u.userId, id);
  }

  @Put('users/:id/verified')
  setVerified(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(SetUserVerifiedRequest)) body: z.infer<typeof SetUserVerifiedRequest>,
  ) {
    return this.admin.setVerified(u.userId, id, body.verified);
  }

  @Put('users/:id/badges')
  setBadges(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(SetUserBadgesRequest)) body: z.infer<typeof SetUserBadgesRequest>,
  ) {
    return this.admin.setUserBadges(u.userId, id, body.badgeIds);
  }

  // insígnias (ADR-0043): o catálogo em si chega a todos em InstanceInfo.badges
  @Post('badges')
  createBadge(@CurrentUser() u: AuthUser, @Body(zodPipe(CreateBadgeRequest)) body: z.infer<typeof CreateBadgeRequest>) {
    return this.admin.createBadge(u.userId, body);
  }

  @Patch('badges/:id')
  updateBadge(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(UpdateBadgeRequest)) body: z.infer<typeof UpdateBadgeRequest>,
  ) {
    return this.admin.updateBadge(u.userId, id, body);
  }

  @Delete('badges/:id')
  @HttpCode(204)
  async deleteBadge(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    await this.admin.deleteBadge(u.userId, id);
  }

  /** Imagem da insígnia (multipart, campo "file"): PNG/JPEG/WebP/GIF até 1 MB; vale no lugar do ícone. */
  @Post('badges/:id/image')
  async setBadgeImage(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    return this.admin.setBadgeImage(u.userId, id, file.file);
  }

  @Delete('badges/:id/image')
  clearBadgeImage(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.admin.setBadgeImage(u.userId, id, null);
  }

  @Put('users/:id/admin')
  setAdmin(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(SetInstanceAdminRequest)) body: z.infer<typeof SetInstanceAdminRequest>,
  ) {
    return this.admin.setAdmin(u.userId, id, body.admin);
  }

  @Get('device-bans')
  deviceBans(@CurrentUser() u: AuthUser) {
    return this.admin.listDeviceBans(u.userId);
  }

  @Delete('device-bans/:id')
  @HttpCode(204)
  async removeDeviceBan(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    await this.admin.removeDeviceBan(u.userId, id);
  }

  @Get('instance')
  instance(@CurrentUser() u: AuthUser) {
    return this.admin.instanceConfig(u.userId);
  }

  @Patch('instance')
  updateInstance(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UpdateInstanceConfigRequest)) body: z.infer<typeof UpdateInstanceConfigRequest>,
  ) {
    return this.admin.updateInstance(u.userId, body);
  }

  @Get('audit')
  audit(@CurrentUser() u: AuthUser, @Query(zodPipe(AdminAuditQuery)) q: z.infer<typeof AdminAuditQuery>) {
    return this.admin.auditLog(u.userId, q);
  }
}

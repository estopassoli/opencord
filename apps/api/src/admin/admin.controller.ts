import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AdminAuditQuery,
  AdminUsersQuery,
  SetInstanceAdminRequest,
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

  @Put('users/:id/admin')
  setAdmin(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zodPipe(SetInstanceAdminRequest)) body: z.infer<typeof SetInstanceAdminRequest>,
  ) {
    return this.admin.setAdmin(u.userId, id, body.admin);
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

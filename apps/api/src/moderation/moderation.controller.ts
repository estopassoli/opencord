import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import { BanRequest, UpdateMemberRequest } from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { ModerationService } from './moderation.service.js';

const uuid = new ParseUUIDPipe();
/** corpo opcional: `PUT …/bans/:userId` sem corpo bane sem motivo e sem apagar mensagens */
const BanBody = BanRequest.prefault({});

/** Moderação (ADR-0034): banimentos e castigo. */
@Controller()
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('servers/:id/bans')
  bans(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.moderation.bans(id, u.userId);
  }

  @Put('servers/:id/bans/:userId')
  ban(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body(zodPipe(BanBody)) dto: z.infer<typeof BanBody>,
  ) {
    return this.moderation.ban(id, u.userId, userId, dto);
  }

  @Delete('servers/:id/bans/:userId')
  @HttpCode(204)
  async unban(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('userId', uuid) userId: string) {
    await this.moderation.unban(id, u.userId, userId);
  }

  /** castigo: `timeoutUntil` ISO (até 28 dias) aplica; null tira */
  @Patch('servers/:id/members/:userId')
  timeout(
    @CurrentUser() u: AuthUser,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body(zodPipe(UpdateMemberRequest)) dto: z.infer<typeof UpdateMemberRequest>,
  ) {
    return this.moderation.setTimeout(id, u.userId, userId, dto);
  }
}

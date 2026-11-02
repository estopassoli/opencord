import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ModerationCasesQuery, ReviewModerationCaseRequest } from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { ModerationCasesService } from './moderation-cases.service.js';

const id = new ParseUUIDPipe({ version: '7' });

/** Moderação por IA (ADR-0036): fila por servidor, fila da instância e decisão. */
@Controller()
export class ModerationCasesController {
  constructor(private readonly cases: ModerationCasesService) {}

  @Get('servers/:id/moderation/cases')
  list(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Query(zodPipe(ModerationCasesQuery)) q: z.infer<typeof ModerationCasesQuery>,
  ) {
    return this.cases.list(serverId, u.userId, q);
  }

  @Get('admin/moderation/cases')
  listAll(@CurrentUser() u: AuthUser, @Query(zodPipe(ModerationCasesQuery)) q: z.infer<typeof ModerationCasesQuery>) {
    return this.cases.listAll(u.userId, q);
  }

  @Post('moderation/cases/:id/review')
  review(
    @CurrentUser() u: AuthUser,
    @Param('id', id) caseId: string,
    @Body(zodPipe(ReviewModerationCaseRequest)) dto: ReviewModerationCaseRequest,
  ) {
    return this.cases.review(caseId, u.userId, dto);
  }
}

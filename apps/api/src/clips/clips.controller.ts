import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateAccountClipRequest, UpdateAccountClipRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { ClipsService } from './clips.service.js';

/** Clipes na conta (ADR-0057) */
@Controller('me/clips')
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.clips.list(u.userId);
  }

  @Post()
  create(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(CreateAccountClipRequest)) body: z.infer<typeof CreateAccountClipRequest>,
  ) {
    return this.clips.create(u.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(zodPipe(UpdateAccountClipRequest)) body: z.infer<typeof UpdateAccountClipRequest>,
  ) {
    return this.clips.update(u.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.clips.remove(u.userId, id);
  }
}

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { SaveSpaceRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { SpaceService } from './space.service.js';

const id = new ParseUUIDPipe();

/** Ambiente do Espaço 3D do servidor (ADR-0055). */
@Controller()
export class SpaceController {
  constructor(private readonly space: SpaceService) {}

  @Get('servers/:id/space')
  get(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.space.get(serverId, u.userId);
  }

  @Put('servers/:id/space')
  save(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Body(zodPipe(SaveSpaceRequest)) dto: z.infer<typeof SaveSpaceRequest>,
  ) {
    return this.space.save(serverId, u.userId, dto.layout, dto.baseRevision);
  }

  /** volta ao ambiente gerado automaticamente */
  @Delete('servers/:id/space')
  reset(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.space.reset(serverId, u.userId);
  }
}

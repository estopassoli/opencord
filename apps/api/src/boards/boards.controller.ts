import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateBoardCardRequest, UpdateBoardCardRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { BoardsService } from './boards.service.js';

const id = new ParseUUIDPipe();

/** Quadros kanban (ADR-0017). */
@Controller()
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get('channels/:id/cards')
  list(@CurrentUser() u: AuthUser, @Param('id', id) boardId: string) {
    return this.boards.list(boardId, u.userId);
  }

  @Post('channels/:id/cards')
  create(
    @CurrentUser() u: AuthUser,
    @Param('id', id) boardId: string,
    @Body(zodPipe(CreateBoardCardRequest)) dto: z.infer<typeof CreateBoardCardRequest>,
  ) {
    return this.boards.create(boardId, u.userId, dto);
  }

  @Patch('cards/:id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cardId: string,
    @Body(zodPipe(UpdateBoardCardRequest)) dto: z.infer<typeof UpdateBoardCardRequest>,
  ) {
    return this.boards.update(cardId, u.userId, dto);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) cardId: string) {
    await this.boards.remove(cardId, u.userId);
  }
}

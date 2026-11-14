import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CreateConversationRequest, FriendRequestCreate } from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { PresenceService } from '../realtime/presence.service.js';
import { NudgeService } from './nudge.service.js';
import { SocialService } from './social.service.js';

const id = new ParseUUIDPipe();

@Controller()
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly presence: PresenceService,
    private readonly nudges: NudgeService,
  ) {}

  /** "Chamar atenção" (ADR-0064): treme o app da pessoa e toca um aviso */
  @Post('users/:userId/nudge')
  @HttpCode(204)
  async nudge(@CurrentUser() u: AuthUser, @Param('userId', id) userId: string): Promise<void> {
    await this.nudges.nudge(u.userId, userId);
  }

  @Get('users/:userId/profile')
  profile(@CurrentUser() u: AuthUser, @Param('userId', id) other: string) {
    return this.social.profile(u.userId, other);
  }

  @Get('friends')
  async friends(@CurrentUser() u: AuthUser) {
    const list = await this.social.listFriends(u.userId);
    const accepted = list.filter((f) => f.status === 'accepted').map((f) => f.user.id);
    const [statuses, games, texts] = await Promise.all([
      this.presence.visibleMany(accepted),
      this.presence.visibleGames(accepted),
      this.presence.visibleTexts(accepted),
    ]);
    return list.map((f) => ({
      ...f,
      presence: statuses[f.user.id] ?? 'offline',
      game: games[f.user.id] ?? null,
      statusText: texts[f.user.id] ?? null,
    }));
  }

  @Post('friends/requests')
  request(@CurrentUser() u: AuthUser, @Body(zodPipe(FriendRequestCreate)) dto: z.infer<typeof FriendRequestCreate>) {
    return this.social.request(u.userId, dto.username);
  }

  @Post('friends/:userId/accept')
  accept(@CurrentUser() u: AuthUser, @Param('userId', id) other: string) {
    return this.social.accept(u.userId, other);
  }

  @Delete('friends/:userId')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('userId', id) other: string) {
    await this.social.remove(u.userId, other);
  }

  @Get('blocks')
  blocks(@CurrentUser() u: AuthUser) {
    return this.social.listBlocked(u.userId);
  }

  @Put('blocks/:userId')
  @HttpCode(204)
  async block(@CurrentUser() u: AuthUser, @Param('userId', id) other: string) {
    await this.social.block(u.userId, other);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(@CurrentUser() u: AuthUser, @Param('userId', id) other: string) {
    await this.social.unblock(u.userId, other);
  }

  @Get('conversations')
  conversations(@CurrentUser() u: AuthUser) {
    return this.social.listConversations(u.userId);
  }

  @Post('conversations')
  open(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(CreateConversationRequest)) dto: z.infer<typeof CreateConversationRequest>,
  ) {
    return this.social.openConversation(u.userId, dto.userIds, dto.name);
  }

  @Post('conversations/:id/leave')
  @HttpCode(204)
  async leave(@CurrentUser() u: AuthUser, @Param('id', id) cid: string) {
    await this.social.leaveConversation(u.userId, cid);
  }
}

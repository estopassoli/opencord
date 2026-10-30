import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AckReadRequest,
  CreateMessageRequest,
  CreatePollRequest,
  EditMessageRequest,
  Emoji,
  ListMessagesQuery,
  SetReactionRolesRequest,
  VotePollRequest,
} from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { MessagesService, type Target } from './messages.service.js';

const id = new ParseUUIDPipe();
type ListQ = z.infer<typeof ListMessagesQuery>;
type CreateM = z.infer<typeof CreateMessageRequest>;
type CreatePoll = z.infer<typeof CreatePollRequest>;
type VotePoll = z.infer<typeof VotePollRequest>;

/** a pergunta vira o texto da mensagem (prévia, notificações e busca); o prazo conta a partir de agora */
const pollMessage = (dto: CreatePoll) => ({
  requestId: dto.requestId,
  body: dto.question,
  poll: {
    question: dto.question,
    options: dto.options,
    multiple: dto.multiple,
    endsAt: dto.durationHours ? new Date(Date.now() + dto.durationHours * 3_600_000) : null,
  },
});

@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  private routes(kind: 'channels' | 'conversations', targetId: string): Target {
    return kind === 'channels' ? { channelId: targetId } : { conversationId: targetId };
  }

  @Get('channels/:id/messages')
  listChannel(@CurrentUser() u: AuthUser, @Param('id', id) cid: string, @Query(zodPipe(ListMessagesQuery)) q: ListQ) {
    return this.messages.list(u.userId, this.routes('channels', cid), q);
  }

  @Post('channels/:id/messages')
  async createChannel(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(CreateMessageRequest)) dto: CreateM,
  ) {
    return (await this.messages.create(u.userId, this.routes('channels', cid), dto)).message;
  }

  /** enquete (ADR-0018): uma mensagem com a pergunta e a enquete presa a ela */
  @Post('channels/:id/polls')
  async pollChannel(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(CreatePollRequest)) dto: CreatePoll,
  ) {
    return (await this.messages.create(u.userId, { channelId: cid }, pollMessage(dto))).message;
  }

  @Post('conversations/:id/polls')
  async pollConv(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(CreatePollRequest)) dto: CreatePoll,
  ) {
    return (await this.messages.create(u.userId, { conversationId: cid }, pollMessage(dto))).message;
  }

  /** cargos por reação (ADR-0019): substitui o conjunto emoji → cargo da mensagem */
  @Put('messages/:id/reaction-roles')
  reactionRoles(
    @CurrentUser() u: AuthUser,
    @Param('id', id) mid: string,
    @Body(zodPipe(SetReactionRolesRequest)) dto: z.infer<typeof SetReactionRolesRequest>,
  ) {
    return this.messages.setReactionRoles(u.userId, mid, dto.pairs);
  }

  @Put('polls/:id/vote')
  vote(@CurrentUser() u: AuthUser, @Param('id', id) pid: string, @Body(zodPipe(VotePollRequest)) dto: VotePoll) {
    return this.messages.vote(u.userId, pid, dto.optionIds);
  }

  @Post('polls/:id/close')
  @HttpCode(200)
  closePoll(@CurrentUser() u: AuthUser, @Param('id', id) pid: string) {
    return this.messages.closePoll(u.userId, pid);
  }

  @Put('channels/:id/read')
  @HttpCode(204)
  async readChannel(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(AckReadRequest)) dto: z.infer<typeof AckReadRequest>,
  ) {
    await this.messages.markRead(u.userId, { channelId: cid }, dto.messageId);
  }

  @Get('channels/:id/pins')
  pinsChannel(@CurrentUser() u: AuthUser, @Param('id', id) cid: string) {
    return this.messages.pins(u.userId, { channelId: cid });
  }

  @Get('conversations/:id/pins')
  pinsConv(@CurrentUser() u: AuthUser, @Param('id', id) cid: string) {
    return this.messages.pins(u.userId, { conversationId: cid });
  }

  @Put('messages/:id/pin')
  pinMessage(@CurrentUser() u: AuthUser, @Param('id', id) mid: string) {
    return this.messages.pin(u.userId, mid, true);
  }

  @Delete('messages/:id/pin')
  unpinMessage(@CurrentUser() u: AuthUser, @Param('id', id) mid: string) {
    return this.messages.pin(u.userId, mid, false);
  }

  @Get('conversations/:id/messages')
  listConv(@CurrentUser() u: AuthUser, @Param('id', id) cid: string, @Query(zodPipe(ListMessagesQuery)) q: ListQ) {
    return this.messages.list(u.userId, this.routes('conversations', cid), q);
  }

  @Post('conversations/:id/messages')
  async createConv(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(CreateMessageRequest)) dto: CreateM,
  ) {
    return (await this.messages.create(u.userId, this.routes('conversations', cid), dto)).message;
  }

  @Put('conversations/:id/read')
  @HttpCode(204)
  async readConv(
    @CurrentUser() u: AuthUser,
    @Param('id', id) cid: string,
    @Body(zodPipe(AckReadRequest)) dto: z.infer<typeof AckReadRequest>,
  ) {
    await this.messages.markRead(u.userId, { conversationId: cid }, dto.messageId);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() u: AuthUser,
    @Param('id', id) mid: string,
    @Body(zodPipe(EditMessageRequest)) dto: z.infer<typeof EditMessageRequest>,
  ) {
    return this.messages.edit(u.userId, mid, dto.body);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) mid: string) {
    await this.messages.remove(u.userId, mid);
  }

  @Put('messages/:id/reactions/:emoji')
  @HttpCode(204)
  async react(@CurrentUser() u: AuthUser, @Param('id', id) mid: string, @Param('emoji', zodPipe(Emoji)) emoji: string) {
    await this.messages.react(u.userId, mid, emoji, true);
  }

  @Delete('messages/:id/reactions/:emoji')
  @HttpCode(204)
  async unreact(
    @CurrentUser() u: AuthUser,
    @Param('id', id) mid: string,
    @Param('emoji', zodPipe(Emoji)) emoji: string,
  ) {
    await this.messages.react(u.userId, mid, emoji, false);
  }

  @Get('me/unreads')
  unreads(@CurrentUser() u: AuthUser) {
    return this.messages.unreads(u.userId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AckReadRequest,
  CreateMessageRequest,
  EditMessageRequest,
  Emoji,
  ListMessagesQuery,
} from '@opencord/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { MessagesService, type Target } from './messages.service.js';

const id = new ParseUUIDPipe();
type ListQ = z.infer<typeof ListMessagesQuery>;
type CreateM = z.infer<typeof CreateMessageRequest>;

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

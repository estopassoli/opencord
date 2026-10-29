import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { UpdateVoiceStateRequest } from '@opencord/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { VoiceService } from './voice.service.js';

const id = new ParseUUIDPipe();
const MuteBody = z.object({ muted: z.boolean() });

@Controller()
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('voice/channels/:id/join')
  join(@CurrentUser() u: AuthUser, @Param('id', id) channelId: string) {
    return this.voice.join(u.userId, channelId);
  }

  @Post('voice/leave')
  @HttpCode(204)
  async leave(@CurrentUser() u: AuthUser) {
    await this.voice.leave(u.userId);
  }

  @Patch('voice/state')
  state(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UpdateVoiceStateRequest)) dto: z.infer<typeof UpdateVoiceStateRequest>,
  ) {
    // video/streaming são derivados dos webhooks da SFU; o cliente só controla mute/deafen.
    return this.voice.updateSelf(u.userId, { selfMute: dto.selfMute, selfDeaf: dto.selfDeaf });
  }

  @Get('servers/:id/voice-states')
  list(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.voice.listServer(u.userId, serverId);
  }

  @Put('voice/members/:userId/server-mute')
  @HttpCode(204)
  async mute(
    @CurrentUser() u: AuthUser,
    @Param('userId', id) target: string,
    @Body(zodPipe(MuteBody)) dto: z.infer<typeof MuteBody>,
  ) {
    await this.voice.serverMute(u.userId, target, dto.muted);
  }

  @Delete('voice/members/:userId')
  @HttpCode(204)
  async disconnect(@CurrentUser() u: AuthUser, @Param('userId', id) target: string) {
    await this.voice.disconnectMember(u.userId, target);
  }

  /** Webhook LiveKit: corpo bruto + header Authorization assinado (validado pelo WebhookReceiver). */
  @Public()
  @Post('livekit/webhook')
  @HttpCode(200)
  async webhook(@Req() req: FastifyRequest, @Headers('authorization') auth: string | undefined) {
    const body =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : JSON.stringify(req.body ?? {});
    await this.voice.handleWebhook(body, auth);
    return { ok: true };
  }
}

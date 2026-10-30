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
  Query,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { UpdateVoiceStateRequest } from '@opencord/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { VoiceService } from './voice.service.js';
import { ActivitiesService } from './activities.service.js';

const id = new ParseUUIDPipe();
const MuteBody = z.object({ muted: z.boolean() });

@Controller()
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly activities: ActivitiesService,
  ) {}

  /** Pesquisa de vídeos para o "Assistir juntos" (precisa de YOUTUBE_API_KEY no servidor). */
  @Get('activities/youtube/search')
  searchYouTube(@Query('q', zodPipe(z.string().trim().min(1).max(100))) q: string) {
    return this.activities.search(q);
  }

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

  /** Prévia da própria live (multipart, campo "file", JPEG até 256 KB), para quem está fora da chamada (ADR-0012). */
  @Post('voice/stream-preview')
  @HttpCode(204)
  async setStreamPreview(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    await this.voice.setStreamPreview(u.userId, file.file);
  }

  @Get('voice/members/:userId/stream-preview')
  async streamPreview(@CurrentUser() u: AuthUser, @Param('userId', id) userId: string, @Res() reply: FastifyReply) {
    const buf = await this.voice.streamPreview(u.userId, userId);
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(buf);
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

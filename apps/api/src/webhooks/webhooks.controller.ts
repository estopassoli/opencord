import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CreateWebhookRequest, WebhookPostRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { WebhooksService } from './webhooks.service.js';

const id = new ParseUUIDPipe();
/** quem tem o link pode postar: limite por IP mais apertado que o global */
const POST_RATE = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Webhooks de entrada (ADR-0030). */
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('servers/:id/webhooks')
  list(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.webhooks.list(u.userId, serverId);
  }

  @Post('servers/:id/webhooks')
  create(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Body(zodPipe(CreateWebhookRequest)) dto: z.infer<typeof CreateWebhookRequest>,
  ) {
    return this.webhooks.create(u.userId, serverId, dto);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) webhookId: string) {
    await this.webhooks.remove(u.userId, webhookId);
  }

  /** O link secreto: `{"content":"..."}` (Discord) ou `{"text":"..."}` (Slack). */
  @Public()
  @Post('webhooks/:id/:token')
  @RouteConfig(POST_RATE)
  @HttpCode(204)
  async post(
    @Param('id', id) webhookId: string,
    @Param('token') token: string,
    @Body(zodPipe(WebhookPostRequest)) body: z.infer<typeof WebhookPostRequest>,
  ) {
    await this.webhooks.post(webhookId, token, body);
  }
}

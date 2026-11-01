import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CreateSlackLinkRequest } from '@opencord/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { SlackService } from './slack.service.js';

const id = new ParseUUIDPipe();
/** endpoint público de eventos: limite por IP mais apertado que o global */
const EVENTS_RATE = { rateLimit: { max: 120, timeWindow: '1 minute' } };

/** Ponte com o Slack (ADR-0033). */
@Controller()
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Get('integrations/slack/status')
  status() {
    return this.slack.status();
  }

  @Get('integrations/slack/channels')
  channels() {
    return this.slack.channels();
  }

  @Get('servers/:id/slack-links')
  list(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.slack.list(u.userId, serverId);
  }

  @Post('servers/:id/slack-links')
  create(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Body(zodPipe(CreateSlackLinkRequest)) dto: z.infer<typeof CreateSlackLinkRequest>,
  ) {
    return this.slack.create(u.userId, serverId, dto);
  }

  @Delete('slack-links/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) linkId: string) {
    await this.slack.remove(u.userId, linkId);
  }

  /** Events API do Slack: assinatura sobre o corpo bruto; responde na hora e processa depois. */
  @Public()
  @Post('integrations/slack/events')
  @RouteConfig(EVENTS_RATE)
  @HttpCode(200)
  events(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    if (!this.slack.configured()) throw new UnauthorizedException('Slack não configurado');
    const h = req.headers;
    const ok = this.slack.verify(
      {
        signature: typeof h['x-slack-signature'] === 'string' ? h['x-slack-signature'] : undefined,
        timestamp: typeof h['x-slack-request-timestamp'] === 'string' ? h['x-slack-request-timestamp'] : undefined,
      },
      req.rawBody ?? '',
    );
    if (!ok) throw new UnauthorizedException('assinatura inválida');
    return this.slack.handleEvent(body ?? {});
  }
}

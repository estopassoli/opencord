import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CreateEventRequest, RsvpRequest, UpdateEventRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { EventsService } from './events.service.js';

const id = new ParseUUIDPipe();

/** Eventos do servidor (ADR-0028). */
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('servers/:id/events')
  list(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.events.list(u.userId, serverId);
  }

  @Post('servers/:id/events')
  create(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Body(zodPipe(CreateEventRequest)) dto: z.infer<typeof CreateEventRequest>,
  ) {
    return this.events.create(u.userId, serverId, dto);
  }

  @Patch('events/:id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', id) eventId: string,
    @Body(zodPipe(UpdateEventRequest)) dto: z.infer<typeof UpdateEventRequest>,
  ) {
    return this.events.update(u.userId, eventId, dto);
  }

  @Delete('events/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) eventId: string) {
    await this.events.remove(u.userId, eventId);
  }

  @Put('events/:id/rsvp')
  rsvp(@CurrentUser() u: AuthUser, @Param('id', id) eventId: string, @Body(zodPipe(RsvpRequest)) dto: RsvpRequest) {
    return this.events.rsvp(u.userId, eventId, dto.status);
  }
}

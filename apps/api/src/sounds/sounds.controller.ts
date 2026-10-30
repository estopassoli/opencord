import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { SoundsService } from './sounds.service.js';

const id = new ParseUUIDPipe();

@Controller()
export class SoundsController {
  constructor(private readonly sounds: SoundsService) {}

  @Get('servers/:id/sounds')
  list(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.sounds.list(serverId, u.userId);
  }

  /** multipart: campos name, emoji?, volume, durationMs ANTES do arquivo "file" (MP3/OGG/WAV até 1 MB). */
  @Post('servers/:id/sounds')
  async upload(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(file.fields))
      if (v && !Array.isArray(v) && 'value' in v && v.type === 'field') fields[k] = v.value;
    return this.sounds.upload(serverId, u.userId, file.file, fields);
  }

  @Delete('servers/:id/sounds/:soundId')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string, @Param('soundId', id) soundId: string) {
    await this.sounds.remove(serverId, soundId, u.userId);
  }

  @Get('sounds/:soundId/file')
  async file(@CurrentUser() u: AuthUser, @Param('soundId', id) soundId: string, @Res() reply: FastifyReply) {
    const f = await this.sounds.open(soundId, u.userId);
    return reply
      .header('Content-Type', f.mime)
      .header('Content-Length', String(f.size))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=86400, immutable')
      .send(f.stream);
  }
}

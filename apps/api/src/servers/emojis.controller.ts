import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { RenameEmojiRequest } from '@opencord/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { StorageService } from '../attachments/storage.service.js';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { AvatarService } from '../users/avatar.service.js';
import { EmojisService } from './emojis.service.js';

const uuidParam = new ParseUUIDPipe();

/** Emojis personalizados do servidor (ADR-0050). */
@Controller()
export class EmojisController {
  constructor(
    private readonly emojis: EmojisService,
    private readonly images: AvatarService,
    private readonly storage: StorageService,
  ) {}

  @Get('servers/:id/emojis')
  list(@CurrentUser() u: AuthUser, @Param('id', uuidParam) id: string) {
    return this.emojis.list(id, u.userId);
  }

  /** multipart com o campo "file"; o nome vai em `?name=` */
  @Post('servers/:id/emojis')
  async create(
    @CurrentUser() u: AuthUser,
    @Param('id', uuidParam) id: string,
    @Query('name') name: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    return this.emojis.create(id, u.userId, (name ?? '').trim(), file.file);
  }

  @Patch('emojis/:id')
  rename(
    @CurrentUser() u: AuthUser,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(RenameEmojiRequest)) dto: z.infer<typeof RenameEmojiRequest>,
  ) {
    return this.emojis.rename(id, u.userId, dto.name);
  }

  @Delete('emojis/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', uuidParam) id: string) {
    await this.emojis.remove(id, u.userId);
  }

  /** imagem pública, como as fotos de perfil: o emoji aparece em qualquer lugar onde o texto dele for parar */
  @Public()
  @Get('emojis/:id')
  async image(@Param('id', uuidParam) id: string, @Res() reply: FastifyReply) {
    const name = await this.emojis.fileOf(id);
    const f = name ? this.images.open(name, 'emojis') : null;
    if (!f) throw new NotFoundException();
    const size = await this.storage.size(f.key).catch(() => null);
    if (size === null) throw new NotFoundException();
    return reply
      .header('Content-Type', f.mime)
      .header('Content-Length', String(size))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'public, max-age=86400')
      .send(await this.storage.read(f.key));
  }
}

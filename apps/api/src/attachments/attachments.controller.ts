import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { AttachmentsService } from './attachments.service.js';
import { LargeUploadService } from './large-upload.service.js';

const uuid = new ParseUUIDPipe();

@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly large: LargeUploadService,
  ) {}

  /** Vídeo grande (clipe compartilhado, até 1 GB): começa o envio em partes. */
  @Post('large')
  startLarge(@CurrentUser() u: AuthUser, @Body() body: { name?: unknown; size?: unknown }) {
    const name = typeof body?.name === 'string' ? body.name.slice(0, 200) : 'video.mp4';
    return this.large.start(u.userId, name, Number(body?.size));
  }

  /** multipart: campo "n" (número da parte) ANTES do arquivo "file" (até 8 MB). */
  @Post('large/:id/parts')
  async largePart(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    const f = file.fields['n'];
    const n = Number(f && !Array.isArray(f) && 'value' in f ? f.value : NaN);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('número da parte inválido');
    return this.large.part(u.userId, id, n, await file.toBuffer());
  }

  @Post('large/:id/complete')
  async completeLarge(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return { attachment: await this.large.complete(u.userId, id) };
  }

  @Post('large/:id/abort')
  @HttpCode(204)
  async abortLarge(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    await this.large.abort(u.userId, id);
  }

  @Post()
  async upload(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    return { attachment: await this.attachments.upload(u.userId, file.file, file.filename, file.mimetype) };
  }

  /** A assinatura HMAC é a autorização: URLs só são emitidas a quem pode ver a mensagem. */
  @Public()
  @Get(':id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!this.attachments.verify(id, exp, sig)) throw new NotFoundException('anexo não encontrado');
    const f = await this.attachments.openForDownload(id);
    if (!f) throw new NotFoundException('anexo não encontrado');
    const disposition = `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.row.originalName)}`;
    return reply
      .header('Content-Type', f.inline ? f.row.mime : 'application/octet-stream')
      .header('Content-Length', String(f.row.sizeBytes))
      .header('Content-Disposition', disposition)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=3600')
      .send(f.stream);
  }
}

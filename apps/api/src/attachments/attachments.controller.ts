import {
  BadRequestException,
  Controller,
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

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

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

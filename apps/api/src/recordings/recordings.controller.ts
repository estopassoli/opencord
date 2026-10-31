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
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { CompleteRecordingRequest } from '@opencord/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { RecordingsService } from './recordings.service.js';

const id = new ParseUUIDPipe();

/** Gravação de chamada (ADR-0023). */
@Controller()
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get('voice/channels/:id/recordings')
  list(@CurrentUser() u: AuthUser, @Param('id', id) channelId: string) {
    return this.recordings.list(u.userId, channelId);
  }

  @Post('voice/channels/:id/recordings')
  start(@CurrentUser() u: AuthUser, @Param('id', id) channelId: string) {
    return this.recordings.start(u.userId, channelId);
  }

  /** multipart: campo "n" (número da parte) ANTES do arquivo "file" (até 8 MB). */
  @Post('recordings/:id/parts')
  async part(@CurrentUser() u: AuthUser, @Param('id', id) recId: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    const nField = file.fields['n'];
    const n = Number(nField && !Array.isArray(nField) && 'value' in nField ? nField.value : NaN);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('número da parte inválido');
    const data = await file.toBuffer();
    return this.recordings.part(u.userId, recId, n, data);
  }

  @Post('recordings/:id/alive')
  @HttpCode(204)
  async alive(@CurrentUser() u: AuthUser, @Param('id', id) recId: string) {
    await this.recordings.alive(u.userId, recId);
  }

  @Post('recordings/:id/complete')
  complete(@CurrentUser() u: AuthUser, @Param('id', id) recId: string, @Body() body: unknown) {
    const parsed = CompleteRecordingRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException('duração inválida');
    return this.recordings.complete(u.userId, recId, parsed.data.durationMs);
  }

  @Post('recordings/:id/abort')
  @HttpCode(204)
  async abort(@CurrentUser() u: AuthUser, @Param('id', id) recId: string) {
    await this.recordings.abort(u.userId, recId);
  }

  @Post('recordings/:id/link')
  link(@CurrentUser() u: AuthUser, @Param('id', id) recId: string) {
    return this.recordings.link(u.userId, recId);
  }

  @Delete('recordings/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) recId: string) {
    await this.recordings.remove(u.userId, recId);
  }

  /** A assinatura HMAC é a autorização: o link só é emitido a quem pode ver o canal. */
  @Public()
  @Get('recordings/:id/download')
  async download(
    @Param('id', id) recId: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!this.recordings.verify(recId, exp, sig)) throw new NotFoundException('gravação não encontrada');
    const f = await this.recordings.openForDownload(recId);
    if (!f) throw new NotFoundException('gravação não encontrada');
    return reply
      .header('Content-Type', 'video/mp4')
      .header('Content-Length', String(f.size))
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(f.stream);
  }
}

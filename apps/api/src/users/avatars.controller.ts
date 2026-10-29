import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { StorageService } from '../attachments/storage.service.js';
import { Public } from '../common/auth.js';
import { AvatarService } from './avatar.service.js';

/** Fotos de perfil e imagens de servidor são públicas como num chat qualquer; o nome é aleatório e muda a cada troca (cache eterno). */
@Controller()
export class AvatarsController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('avatars/:name')
  get(@Param('name') name: string, @Res() reply: FastifyReply) {
    return this.serve(this.avatars.open(name), reply);
  }

  @Public()
  @Get('server-icons/:name')
  getServerIcon(@Param('name') name: string, @Res() reply: FastifyReply) {
    return this.serve(this.avatars.open(name, 'server-icons'), reply);
  }

  private async serve(f: { mime: string; key: string } | null, reply: FastifyReply) {
    if (!f) throw new NotFoundException();
    const size = await this.storage.size(f.key).catch(() => null);
    if (size === null) throw new NotFoundException();
    return reply
      .header('Content-Type', f.mime)
      .header('Content-Length', String(size))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(await this.storage.read(f.key));
  }
}

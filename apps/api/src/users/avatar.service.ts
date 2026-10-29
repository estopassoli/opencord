import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { rooms } from '@opencord/contracts';
import { imageSize } from '../attachments/attachments.service.js';
import { StorageService } from '../attachments/storage.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** O app já recorta e reduz para 256×256; o limite é folgado para quem envia direto pela API. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 1024;
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** nome guardado em users.avatarKey e servido em GET /avatars/:name (aleatório: muda a cada troca → cache eterno) */
export const AVATAR_NAME = /^[0-9a-f-]{36}-(png|jpeg|webp|gif)$/;

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  async set(userId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of file) {
      size += c.length;
      if (size > AVATAR_MAX_BYTES) throw new PayloadTooLargeException('a foto passa de 1 MB');
      chunks.push(c);
    }
    if (file.truncated) throw new PayloadTooLargeException('a foto passa de 1 MB');
    if (!size) throw new BadRequestException('arquivo vazio');
    const buf = Buffer.concat(chunks);
    // tipo real pelos bytes; o declarado pelo cliente não vale
    const { fileTypeFromBuffer } = await import('file-type');
    const mime = (await fileTypeFromBuffer(buf))?.mime;
    const ext = mime ? TYPES[mime] : undefined;
    if (!mime || !ext) throw new BadRequestException('use uma imagem PNG, JPEG, WebP ou GIF');
    const dims = imageSize(buf, mime);
    if (!dims || dims.width < 16 || dims.height < 16 || dims.width > MAX_SIDE || dims.height > MAX_SIDE)
      throw new BadRequestException(`a foto precisa ter entre 16 e ${MAX_SIDE} pixels de lado`);
    const name = `${randomUUID()}-${ext}`;
    await this.storage.write(`avatars/${name}`, Readable.from(buf));
    return this.apply(userId, name);
  }

  async clear(userId: string) {
    return this.apply(userId, null);
  }

  private async apply(userId: string, name: string | null) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarKey: true } });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarKey: name } });
    if (before.avatarKey && AVATAR_NAME.test(before.avatarKey))
      await this.storage.remove(`avatars/${before.avatarKey}`).catch(() => undefined);
    await this.announce(userId);
    return user;
  }

  /** Perfil público mudou: avisa a própria pessoa (outras sessões) e quem compartilha servidor com ela. */
  async announce(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const servers = await this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } });
    this.realtime.emit(
      [rooms.user(userId), ...servers.map((s) => rooms.server(s.serverId))],
      'user:updated',
      userPublic(user),
    );
  }

  /** Para GET /avatars/:name. */
  open(name: string) {
    const m = AVATAR_NAME.exec(name);
    if (!m) return null;
    const mime = Object.entries(TYPES).find(([, e]) => e === m[1])![0];
    return { mime, key: `avatars/${name}` };
  }
}

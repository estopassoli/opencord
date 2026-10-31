import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { UPLOAD_ALLOWED_MIME, type Attachment } from '@opencord/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { InstanceService } from '../admin/instance.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { StorageService } from './storage.service.js';

const SIGNED_URL_BUCKET_S = 3600;
const ORPHAN_TTL_MS = 24 * 3600 * 1000;
const MAX_UNCLAIMED_PER_USER = 50;
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|ogg))$/;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // remove caracteres de controle, aspas e reservados do Windows
  /* eslint-disable no-control-regex -- remover caracteres de controle é o objetivo */
  const clean = base
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  /* eslint-enable no-control-regex */
  return clean || 'arquivo';
}

function isProbablyText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

/** Dimensões de PNG/GIF/JPEG/WebP lidas do cabeçalho (sem decodificar a imagem). */
export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && buf.length > 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length > 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp' && buf.length > 30) {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1] ?? 0;
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

type AttachmentRow = {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Attachments');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly instance: InstanceService,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV !== 'test') this.timer = setInterval(() => void this.cleanupOrphans(), 3600_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.cfg.ATTACHMENT_URL_SECRET).update(`${id}.${exp}`).digest('base64url');
  }

  signedUrl(id: string, now = Date.now()): string {
    // expiração arredondada para o próximo intervalo: URLs estáveis por ~1h (cache do cliente)
    const exp = (Math.floor(now / 1000 / SIGNED_URL_BUCKET_S) + 2) * SIGNED_URL_BUCKET_S;
    return `${this.cfg.PUBLIC_API_URL}/attachments/${id}/download?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  verify(id: string, exp: string | undefined, sig: string | undefined): boolean {
    const e = Number(exp);
    if (!sig || !Number.isInteger(e) || e * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(id, e));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  serialize(a: AttachmentRow): Attachment {
    return {
      id: a.id,
      originalName: a.originalName,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      url: this.signedUrl(a.id),
      width: a.width,
      height: a.height,
    };
  }

  async upload(
    userId: string,
    file: AsyncIterable<Buffer> & { truncated?: boolean },
    filename: string,
    declaredMime: string,
  ): Promise<Attachment> {
    // o super admin pode baixar o limite do ambiente (ADR-0020)
    const max = await this.instance.uploadMaxBytes();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file) {
      size += chunk.length;
      if (size > max) throw new PayloadTooLargeException(`arquivo excede ${Math.floor(max / 1024 / 1024)} MB`);
      chunks.push(chunk);
    }
    if (file.truncated) throw new PayloadTooLargeException('arquivo excede o limite');
    if (size === 0) throw new BadRequestException('arquivo vazio');
    // anexos ainda não usados em mensagem ficam 24 h ocupando espaço: limita quantos cada pessoa acumula
    // (conferido depois de ler o corpo: recusar no meio do envio deixa o upload pendurado)
    const pending = await this.prisma.attachment.count({
      where: { uploaderId: userId, messageId: null, createdAt: { gte: new Date(Date.now() - ORPHAN_TTL_MS) } },
    });
    if (pending >= MAX_UNCLAIMED_PER_USER)
      throw new BadRequestException('muitos anexos enviados e ainda não usados; envie as mensagens ou espere');
    const buf = Buffer.concat(chunks);

    // MIME real pelos magic bytes; o MIME declarado pelo cliente não é confiável.
    const { fileTypeFromBuffer } = await import('file-type');
    const sniffed = await fileTypeFromBuffer(buf);
    let mime = sniffed?.mime as string | undefined;
    if (!mime && declaredMime === 'text/plain' && isProbablyText(buf)) mime = 'text/plain';
    if (!mime || !(UPLOAD_ALLOWED_MIME as readonly string[]).includes(mime)) {
      throw new BadRequestException(`tipo de arquivo não permitido (${mime ?? 'desconhecido'})`);
    }
    const dims = mime.startsWith('image/') ? imageSize(buf, mime) : null;
    const id = randomUUID();
    const d = new Date();
    const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    await this.storage.write(key, buf, mime);
    try {
      const row = await this.prisma.attachment.create({
        data: {
          uploaderId: userId,
          storageKey: key,
          mime,
          sizeBytes: size,
          originalName: sanitizeFilename(filename),
          sha256: createHash('sha256').update(buf).digest('hex'),
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        },
      });
      return this.serialize(row);
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }

  async openForDownload(id: string) {
    const a = await this.prisma.attachment.findUnique({
      where: { id },
      include: { message: { select: { deletedAt: true } } },
    });
    // anexos de mensagens excluídas deixam de ser servidos
    if (!a || a.message?.deletedAt) return null;
    return { row: a, stream: await this.storage.read(a.storageKey), inline: INLINE_MIME.test(a.mime) };
  }

  /** Vincula anexos à mensagem: só do próprio autor, ainda não vinculados e recentes. */
  async claimForMessage(tx: Pick<PrismaService, 'attachment'>, userId: string, ids: string[], messageId: string) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const r = await tx.attachment.updateMany({
      where: {
        id: { in: unique },
        uploaderId: userId,
        messageId: null,
        createdAt: { gt: new Date(Date.now() - ORPHAN_TTL_MS) },
      },
      data: { messageId },
    });
    if (r.count !== unique.length) throw new BadRequestException('anexo inválido ou já utilizado');
  }

  async cleanupOrphans(): Promise<number> {
    const old = await this.prisma.attachment.findMany({
      where: { messageId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) } },
      take: 500,
    });
    for (const a of old) {
      await this.storage.remove(a.storageKey).catch((e: unknown) => this.log.warn(String(e)));
      await this.prisma.attachment.delete({ where: { id: a.id } }).catch(() => undefined);
    }
    return old.length;
  }
}

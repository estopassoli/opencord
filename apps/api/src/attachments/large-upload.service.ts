import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { LARGE_UPLOAD_MAX_BYTES, RECORDING_PART_BYTES, type Attachment } from '@opencord/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { AttachmentsService, sanitizeFilename } from './attachments.service.js';
import { StorageService } from './storage.service.js';

/** envio pela metade some depois disto (partes já gravadas são descartadas) */
const PENDING_TTL_S = 6 * 3600;
/** o estado vive além do prazo da varredura, para ela sempre achar as partes a descartar */
const STATE_GRACE_S = 3600;
const key = (id: string) => `attup:${id}`;
const PENDING_SET = 'attup:pending';
/** só vídeo (clipes compartilhados); confirmado pelos bytes da primeira parte */
const VIDEO = new Set(['video/mp4', 'video/webm']);

interface Pending {
  userId: string;
  storageKey: string;
  uploadId: string | null;
  name: string;
  size: number;
  mime: string | null;
  parts: { n: number; etag: string }[];
  /** bytes já recebidos */
  bytes: number;
  /** hash de cada parte (o sha256 do anexo é o hash dessa lista) */
  hashes: string[];
}

/**
 * Anexos grandes (clipes compartilhados, até 1 GB): enviados em partes de 8 MB, em ordem, e gravados no armazenamento
 * em partes (S3 multipart ou arquivo local). No fim viram um anexo comum, que a mensagem reivindica como sempre.
 * O estado do envio fica no Redis (sem tabela nova).
 */
@Injectable()
export class LargeUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('LargeUpload');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(String(e))), 10 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get r() {
    return this.redis.client;
  }

  private async load(userId: string, id: string): Promise<Pending> {
    const raw = await this.r.get(key(id));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    if (!p || p.userId !== userId) throw notFound('envio');
    return p;
  }

  /** Grava o estado e empurra o prazo da varredura; o estado expira só depois desse prazo. */
  private async save(id: string, p: Pending) {
    await this.r
      .multi()
      .set(key(id), JSON.stringify(p), 'EX', PENDING_TTL_S + STATE_GRACE_S)
      .zadd(PENDING_SET, Date.now() + PENDING_TTL_S * 1000, id)
      .exec();
  }

  async start(userId: string, name: string, size: number): Promise<{ id: string; partBytes: number }> {
    if (!Number.isInteger(size) || size <= 0) throw new BadRequestException('tamanho inválido');
    if (size > LARGE_UPLOAD_MAX_BYTES) throw new PayloadTooLargeException('o vídeo passa de 1 GB');
    const id = randomUUID();
    const d = new Date();
    const storageKey = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    const uploadId = await this.storage.partsBegin(storageKey, 'application/octet-stream');
    await this.save(id, {
      userId,
      storageKey,
      uploadId,
      name: sanitizeFilename(name),
      size,
      mime: null,
      parts: [],
      bytes: 0,
      hashes: [],
    });
    return { id, partBytes: RECORDING_PART_BYTES };
  }

  async part(userId: string, id: string, n: number, data: Buffer) {
    const p = await this.load(userId, id);
    if (n !== p.parts.length + 1) throw new BadRequestException(`parte fora de ordem (esperada ${p.parts.length + 1})`);
    if (!data.length || data.length > RECORDING_PART_BYTES) throw new BadRequestException('parte com tamanho inválido');
    const sent = p.bytes + data.length;
    if (sent > p.size) throw new BadRequestException('mais dados do que o tamanho informado');
    if (n === 1) {
      const { fileTypeFromBuffer } = await import('file-type');
      const mime = (await fileTypeFromBuffer(data))?.mime;
      if (!mime || !VIDEO.has(mime)) throw new BadRequestException('só vídeos MP4 ou WebM');
      p.mime = mime;
    }
    const etag = await this.storage.partsPut(p.storageKey, p.uploadId, n, data);
    p.parts.push({ n, etag });
    p.bytes = sent;
    p.hashes.push(createHash('sha256').update(data).digest('hex'));
    await this.save(id, p);
    return { parts: n };
  }

  async complete(userId: string, id: string): Promise<Attachment> {
    const p = await this.load(userId, id);
    if (!p.mime || p.bytes !== p.size) throw new BadRequestException('envio incompleto');
    await this.storage.partsComplete(p.storageKey, p.uploadId, p.parts);
    const size = await this.storage.size(p.storageKey);
    if (size !== p.size) {
      await this.storage.remove(p.storageKey).catch(() => undefined);
      await this.r.del(key(id));
      throw new BadRequestException('o arquivo chegou com tamanho diferente do informado');
    }
    await this.r.multi().del(key(id)).zrem(PENDING_SET, id).exec();
    const row = await this.prisma.attachment.create({
      data: {
        uploaderId: userId,
        storageKey: p.storageKey,
        mime: p.mime,
        sizeBytes: size,
        originalName: p.name,
        sha256: createHash('sha256').update(p.hashes.join('')).digest('hex'),
      },
    });
    return this.attachments.serialize(row);
  }

  async abort(userId: string, id: string) {
    const p = await this.load(userId, id);
    await this.storage.partsAbort(p.storageKey, p.uploadId).catch(() => undefined);
    await this.r.multi().del(key(id)).zrem(PENDING_SET, id).exec();
    return null;
  }

  /** Envios abandonados: descarta as partes já gravadas. */
  async sweep(now = Date.now()) {
    const ids = await this.r.zrangebyscore(PENDING_SET, 0, now);
    for (const id of ids) {
      const raw = await this.r.get(key(id));
      if (raw) {
        const p = JSON.parse(raw) as Pending;
        await this.storage.partsAbort(p.storageKey, p.uploadId).catch(() => undefined);
        await this.r.del(key(id));
      }
      await this.r.zrem(PENDING_SET, id);
    }
    return ids.length;
  }
}

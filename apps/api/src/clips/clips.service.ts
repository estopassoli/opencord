import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ACCOUNT_CLIPS_MAX,
  ACCOUNT_CLIPS_MAX_BYTES,
  CLIP_FEATURED_MAX,
  type AccountClip,
  type AccountClipsResponse,
  type CreateAccountClipRequest,
  type UpdateAccountClipRequest,
} from '@opencord/contracts';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { StorageService } from '../attachments/storage.service.js';

const WITH_FILES = {
  video: { select: { id: true, sizeBytes: true, width: true, height: true, storageKey: true } },
  thumb: { select: { id: true, storageKey: true } },
} as const;

interface Row {
  id: string;
  title: string;
  game: string | null;
  durationMs: number;
  recordedAt: Date;
  featured: boolean;
  video: { id: string; sizeBytes: number; width: number | null; height: number | null };
  thumb: { id: string } | null;
}

/**
 * Clipes na conta (ADR-0057): o vídeo sobe como anexo grande e a miniatura como anexo comum; aqui eles ficam presos
 * ao clipe (sem mensagem e sem expirar). Até CLIP_FEATURED_MAX aparecem em destaque no perfil.
 */
@Injectable()
export class ClipsService {
  private readonly log = new Logger('Clips');

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
  ) {}

  private serialize(c: Row): AccountClip {
    return {
      id: c.id,
      title: c.title,
      game: c.game,
      durationMs: c.durationMs,
      sizeBytes: c.video.sizeBytes,
      width: c.video.width,
      height: c.video.height,
      recordedAt: c.recordedAt.getTime(),
      featured: c.featured,
      url: this.attachments.signedUrl(c.video.id),
      thumbUrl: c.thumb ? this.attachments.signedUrl(c.thumb.id) : null,
    };
  }

  async list(userId: string): Promise<AccountClipsResponse> {
    const rows = await this.prisma.profileClip.findMany({
      where: { userId },
      include: WITH_FILES,
      orderBy: { recordedAt: 'desc' },
    });
    return {
      clips: rows.map((r) => this.serialize(r)),
      usedBytes: rows.reduce((n, r) => n + r.video.sizeBytes, 0),
      maxBytes: ACCOUNT_CLIPS_MAX_BYTES,
      maxClips: ACCOUNT_CLIPS_MAX,
    };
  }

  /** destaques do perfil (quem pode ver o perfil vê) */
  async featured(userId: string): Promise<AccountClip[]> {
    const rows = await this.prisma.profileClip.findMany({
      where: { userId, featured: true },
      include: WITH_FILES,
      orderBy: { recordedAt: 'desc' },
      take: CLIP_FEATURED_MAX,
    });
    return rows.map((r) => this.serialize(r));
  }

  async create(userId: string, body: CreateAccountClipRequest): Promise<AccountClip> {
    const ids = [body.videoId, ...(body.thumbId ? [body.thumbId] : [])];
    const files = await this.prisma.attachment.findMany({
      where: {
        id: { in: ids },
        uploaderId: userId,
        messageId: null,
        caseId: null,
        clipVideo: { is: null },
        clipThumb: { is: null },
      },
      select: { id: true, mime: true, sizeBytes: true },
    });
    const video = files.find((f) => f.id === body.videoId);
    const thumb = body.thumbId ? files.find((f) => f.id === body.thumbId) : undefined;
    if (!video || !video.mime.startsWith('video/')) throw new BadRequestException('vídeo inválido ou já utilizado');
    if (body.thumbId && (!thumb || !thumb.mime.startsWith('image/')))
      throw new BadRequestException('miniatura inválida ou já utilizada');
    return this.prisma.$transaction(async (tx) => {
      const mine = await tx.profileClip.findMany({
        where: { userId },
        select: { video: { select: { sizeBytes: true } } },
      });
      if (mine.length >= ACCOUNT_CLIPS_MAX)
        throw new BadRequestException(`a conta guarda até ${ACCOUNT_CLIPS_MAX} clipes; apague algum para salvar este`);
      const used = mine.reduce((n, c) => n + c.video.sizeBytes, 0);
      if (used + video.sizeBytes > ACCOUNT_CLIPS_MAX_BYTES)
        throw new BadRequestException('sem espaço para clipes na conta; apague algum para salvar este');
      const row = await tx.profileClip.create({
        data: {
          userId,
          videoId: video.id,
          thumbId: thumb?.id ?? null,
          title: body.title.trim(),
          game: body.game?.trim() || null,
          durationMs: body.durationMs,
          recordedAt: new Date(body.recordedAt),
        },
        include: WITH_FILES,
      });
      return this.serialize(row);
    });
  }

  async update(userId: string, id: string, body: UpdateAccountClipRequest): Promise<AccountClip> {
    const cur = await this.prisma.profileClip.findFirst({ where: { id, userId }, select: { featured: true } });
    if (!cur) throw notFound('clipe');
    if (body.featured && !cur.featured) {
      const n = await this.prisma.profileClip.count({ where: { userId, featured: true } });
      if (n >= CLIP_FEATURED_MAX)
        throw new BadRequestException(`o perfil destaca até ${CLIP_FEATURED_MAX} clipes; tire o destaque de algum`);
    }
    const row = await this.prisma.profileClip.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.featured !== undefined ? { featured: body.featured } : {}),
      },
      include: WITH_FILES,
    });
    return this.serialize(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.prisma.profileClip.findFirst({ where: { id, userId }, include: WITH_FILES });
    if (!row) throw notFound('clipe');
    // apagar o anexo do vídeo leva o clipe junto (cascata); a miniatura sai em seguida
    await this.prisma.attachment.delete({ where: { id: row.video.id } });
    if (row.thumb) await this.prisma.attachment.delete({ where: { id: row.thumb.id } }).catch(() => undefined);
    for (const key of [row.video.storageKey, row.thumb?.storageKey])
      if (key) await this.storage.remove(key).catch((e: unknown) => this.log.warn(String(e)));
  }
}

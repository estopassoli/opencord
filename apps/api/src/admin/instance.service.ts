import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InstanceAnnouncement, InstanceInfo } from '@opencord/contracts';
import type { InstanceConfig } from '@opencord/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';

/** Quanto tempo a configuração lida do banco vale em memória (o painel invalida ao salvar). */
const CACHE_MS = 5_000;

/**
 * Configuração da instância editada pelo super admin (ADR-0020): cadastro aberto/fechado, aviso em faixa e
 * limite de upload (só para baixo do UPLOAD_MAX_BYTES do ambiente). Sem linha no banco, valem os padrões.
 */
@Injectable()
export class InstanceService {
  private readonly log = new Logger('Instance');
  private cache: { row: InstanceConfig | null; at: number } | null = null;
  private creator: { id: string | null; at: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async row(): Promise<InstanceConfig | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.row;
    // sem a tabela (API nova antes da migração): segue com os padrões em vez de derrubar o login
    const row = await this.prisma.instanceConfig.findUnique({ where: { id: 1 } }).catch((e: unknown) => {
      this.log.warn(`configuração da instância indisponível: ${String(e)}`);
      return null;
    });
    this.cache = { row, at: Date.now() };
    return row;
  }

  invalidate() {
    this.cache = null;
    this.creator = null;
  }

  /** Dono do servidor oficial: o criador do OpenCord. */
  async creatorId(): Promise<string | null> {
    if (this.creator && Date.now() - this.creator.at < CACHE_MS) return this.creator.id;
    const s = await this.prisma.server.findFirst({ where: { official: true }, select: { ownerId: true } });
    this.creator = { id: s?.ownerId ?? null, at: Date.now() };
    return this.creator.id;
  }

  async registrationOpen(): Promise<boolean> {
    return (await this.row())?.registrationOpen ?? true;
  }

  async uploadMaxBytes(): Promise<number> {
    const override = (await this.row())?.uploadMaxBytes;
    return override ? Math.min(override, this.cfg.UPLOAD_MAX_BYTES) : this.cfg.UPLOAD_MAX_BYTES;
  }

  announcementOf(row: InstanceConfig | null): InstanceAnnouncement | null {
    if (!row?.announcementText) return null;
    const tone = (['info', 'warning', 'success'] as const).find((t) => t === row.announcementTone) ?? 'info';
    return { text: row.announcementText, tone };
  }

  async info(): Promise<InstanceInfo> {
    const row = await this.row();
    return {
      name: this.cfg.INSTANCE_NAME,
      guestJoin: this.cfg.GUEST_JOIN_ENABLED,
      requiresAccessCode: Boolean(this.cfg.INSTANCE_ACCESS_CODE),
      youtubeSearch: Boolean(this.cfg.YOUTUBE_API_KEY),
      registrationOpen: row?.registrationOpen ?? true,
      announcement: this.announcementOf(row),
      uploadMaxBytes: await this.uploadMaxBytes(),
      creatorId: await this.creatorId(),
    };
  }
}

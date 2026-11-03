import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';

const SWEEP_MS = 6 * 3600_000;
const FIRST_SWEEP_MS = 60_000;
const DAY_MS = 86_400_000;

export interface RetentionResult {
  sessions: number;
  audit: number;
  moderationCases: number;
  deviceBans: number;
}

/**
 * Expurgo automático (ADR-0039, LGPD arts. 15 e 16): o que já não serve ao fim para o qual foi guardado é apagado.
 * Prazos em `RETENTION_*_DAYS`: sessões encerradas ou expiradas (IP, navegador, aparelho) após 180 dias (os 6 meses
 * do Marco Civil, art. 15); auditoria, casos de moderação já decididos e bloqueios de dispositivo após 365 dias.
 * Gravações (24 h) e anexos órfãos (24 h) já têm as próprias varreduras.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return;
    const run = () => void this.sweep().catch((e) => this.log.warn(`expurgo: ${String(e)}`));
    this.first = setTimeout(run, FIRST_SWEEP_MS);
    this.timer = setInterval(run, SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<RetentionResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const sessionsCut = before(this.cfg.RETENTION_SESSIONS_DAYS);
    const [sessions, audit, moderationCases, deviceBans] = await Promise.all([
      this.prisma.session.deleteMany({
        where: { OR: [{ revokedAt: { lt: sessionsCut } }, { expiresAt: { lt: sessionsCut } }] },
      }),
      this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: before(this.cfg.RETENTION_AUDIT_DAYS) } } }),
      // pendentes ficam até alguém decidir; os anexos retidos viram órfãos e a limpeza de anexos os apaga
      this.prisma.moderationCase.deleteMany({
        where: { status: { not: 'pending' }, createdAt: { lt: before(this.cfg.RETENTION_MODERATION_DAYS) } },
      }),
      this.prisma.deviceBan.deleteMany({ where: { createdAt: { lt: before(this.cfg.RETENTION_DEVICE_BANS_DAYS) } } }),
    ]);
    const r = {
      sessions: sessions.count,
      audit: audit.count,
      moderationCases: moderationCases.count,
      deviceBans: deviceBans.count,
    };
    if (r.sessions + r.audit + r.moderationCases + r.deviceBans > 0) this.log.log(`expurgo: ${JSON.stringify(r)}`);
    return r;
  }
}

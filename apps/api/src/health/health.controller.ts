import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, 'ok' | 'fail'> = {};
    checks.database = await this.prisma.$queryRaw`SELECT 1`.then(
      () => 'ok' as const,
      () => 'fail' as const,
    );
    checks.redis = await this.redis.client.ping().then(
      (r) => (r === 'PONG' ? ('ok' as const) : ('fail' as const)),
      () => 'fail' as const,
    );
    checks.livekit = await fetch(this.cfg.LIVEKIT_API_URL, { signal: AbortSignal.timeout(2000) }).then(
      (r) => (r.ok ? ('ok' as const) : ('fail' as const)),
      () => 'fail' as const,
    );
    const ok = checks.database === 'ok' && checks.redis === 'ok';
    const body = { status: ok ? 'ok' : 'degraded', checks, version: process.env.npm_package_version ?? '0.1.0' };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}

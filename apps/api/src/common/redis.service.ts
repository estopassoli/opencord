import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Prefixo de chaves: isola o OpenCord de outros usos do mesmo Redis. */
export const REDIS_PREFIX = 'oc:';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.client = new Redis(cfg.REDIS_URL, { keyPrefix: REDIS_PREFIX, maxRetriesPerRequest: 3, lazyConnect: false });
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}

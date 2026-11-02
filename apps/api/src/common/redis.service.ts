import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Prefixo de chaves: isola o OpenCord de outros usos do mesmo Redis. */
export const REDIS_PREFIX = 'oc:';
/** Canais de pub/sub não são chaves (o ioredis não os prefixa): o prefixo vai à mão. */
export const pubsubChannel = (name: string) => `${REDIS_PREFIX}${name}`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private sub: Redis | null = null;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.client = new Redis(cfg.REDIS_URL, { keyPrefix: REDIS_PREFIX, maxRetriesPerRequest: 3, lazyConnect: false });
  }
  /** Conexão dedicada a SUBSCRIBE (em modo assinante uma conexão não executa outros comandos); criada no primeiro uso. */
  get subscriber(): Redis {
    if (!this.sub) {
      this.sub = this.client.duplicate();
      // uma espera por interação de autocompletar: muitas ao mesmo tempo é normal
      this.sub.setMaxListeners(0);
    }
    return this.sub;
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }
}

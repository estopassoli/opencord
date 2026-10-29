import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@opencord/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super({ datasourceUrl: cfg.DATABASE_URL });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

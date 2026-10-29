import 'reflect-metadata';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Redis } from 'ioredis';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { REDIS_PREFIX } from './common/redis.service.js';

export async function createApp(cfg: AppConfig, opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    // nunca registrar cabeçalhos de autorização nem corpos (tokens/mensagens privadas)
    logger: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(cfg), adapter, {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
  });
  const fastify = app.getHttpAdapter().getInstance();

  // Webhooks LiveKit chegam como application/webhook+json e precisam do corpo bruto para validar a assinatura.
  fastify.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(multipart, { limits: { fileSize: cfg.UPLOAD_MAX_BYTES, files: 1, fields: 5 } });
  if (!cfg.RATE_LIMIT_DISABLED) {
    const redis = new Redis(cfg.REDIS_URL, { keyPrefix: `${REDIS_PREFIX}rl:`, maxRetriesPerRequest: 1 });
    await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', redis, nameSpace: '' });
    fastify.addHook('onClose', async () => {
      await redis.quit().catch(() => undefined);
    });
  }
  const origins = cfg.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    // Electron empacotado carrega de file:// (Origin "null"); aceito apenas porque a autenticação é por Bearer, não cookie.
    origin: (origin, cb) => cb(null, !origin || origin === 'null' || origins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
  });
  app.useWebSocketAdapter(new IoAdapter(app));
  // Só SIGTERM/SIGINT (Docker/systemd/Ctrl+C). SIGHUP NÃO: ao fechar o terminal, o Nest rodava o shutdown
  // (fechando Redis/Prisma) mas o processo seguia vivo respondendo 500.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  return app;
}

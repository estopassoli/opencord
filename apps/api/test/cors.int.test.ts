import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp } from './helpers.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await startApp({ CORS_ORIGINS: 'https://app.exemplo.com' });
});
afterAll(async () => {
  await app.close();
});

const preflight = (origin: string) =>
  app.inject({
    method: 'OPTIONS',
    url: '/auth/login',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });

describe('CORS', () => {
  it('aceita os apps desktop (Electron file:// e Tauri) e as origens configuradas', async () => {
    for (const origin of ['null', 'http://tauri.localhost', 'https://app.exemplo.com']) {
      const r = await preflight(origin);
      expect(r.headers['access-control-allow-origin'], origin).toBe(origin);
    }
  });

  it('recusa outras origens', async () => {
    for (const origin of ['https://malicioso.exemplo', 'http://localhost.tauri.localhost', 'https://tauri.localhost']) {
      const r = await preflight(origin);
      expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AppConfig } from '../src/config/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const TEST_API_PORT = 3101;
export const TEST_LIVEKIT_PORT = 7890;

export const TEST_ENV = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: String(TEST_API_PORT),
  PUBLIC_API_URL: `http://127.0.0.1:${TEST_API_PORT}`,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://opencord:opencord_dev@127.0.0.1:5432/opencord_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/11',
  JWT_ACCESS_SECRET: 'test-only-access-secret-0123456789abcdef0123456789',
  ATTACHMENT_URL_SECRET: 'test-only-attachment-secret-0123456789abcdef012',
  LIVEKIT_URL: `ws://127.0.0.1:${TEST_LIVEKIT_PORT}`,
  LIVEKIT_API_URL: `http://127.0.0.1:${TEST_LIVEKIT_PORT}`,
  LIVEKIT_API_KEY: 'testkey',
  LIVEKIT_API_SECRET: 'test-livekit-secret-0123456789abcdef0123456789',
  STORAGE_LOCAL_DIR: path.join(REPO_ROOT, 'apps/api/var/test-uploads'),
  UPLOAD_MAX_BYTES: String(2 * 1024 * 1024),
  RATE_LIMIT_DISABLED: 'true',
  GUEST_JOIN_PER_IP_HOUR: '100000',
  VOICE_RECONCILE_INTERVAL_MS: '0',
  CORS_ORIGINS: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  YOUTUBE_OEMBED: 'false',
} as const;

export function testConfig(over: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...TEST_ENV, ...over } as NodeJS.ProcessEnv);
}

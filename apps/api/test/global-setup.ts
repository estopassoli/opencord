/**
 * Setup de integração: banco de teste dedicado (migrations aplicadas com `migrate deploy`), Redis db 11 (apenas chaves "oc:*")
 * e um LiveKit real (binário oficial em .tools/) configurado para enviar webhooks à API de teste.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Redis } from 'ioredis';
import { REPO_ROOT, TEST_API_PORT, TEST_ENV, TEST_LIVEKIT_PORT } from './env.js';

let livekit: ChildProcess | null = null;

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout aguardando ${url}`);
}

export async function setup() {
  // Não destrutivo: aplica migrações pendentes no banco de teste dedicado; isolamento via TRUNCATE em cada suíte.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.join(REPO_ROOT, 'packages/db'),
    env: { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
  const redis = new Redis(TEST_ENV.REDIS_URL);
  const keys = await redis.keys('oc:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
  rmSync(TEST_ENV.STORAGE_LOCAL_DIR, { recursive: true, force: true });

  const bin = process.env.LIVEKIT_BIN ?? path.join(REPO_ROOT, '.tools/livekit/livekit-server');
  if (!existsSync(bin))
    throw new Error(`livekit-server não encontrado em ${bin} (ver spikes/f0.2-livekit-audio/README.md)`);
  const dir = path.join(REPO_ROOT, 'apps/api/var');
  mkdirSync(dir, { recursive: true });
  const cfgPath = path.join(dir, 'livekit-test.yaml');
  writeFileSync(
    cfgPath,
    [
      `port: ${TEST_LIVEKIT_PORT}`,
      'bind_addresses: ["127.0.0.1"]',
      `rtc: { tcp_port: ${TEST_LIVEKIT_PORT + 1}, port_range_start: 52000, port_range_end: 52100, use_external_ip: false, node_ip: 127.0.0.1 }`,
      `keys: { ${TEST_ENV.LIVEKIT_API_KEY}: ${TEST_ENV.LIVEKIT_API_SECRET} }`,
      `webhook: { api_key: ${TEST_ENV.LIVEKIT_API_KEY}, urls: ["http://127.0.0.1:${TEST_API_PORT}/livekit/webhook"] }`,
      'room: { empty_timeout: 10, departure_timeout: 1 }',
      'logging: { level: warn }',
    ].join('\n'),
  );
  livekit = spawn(bin, ['--config', cfgPath], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${TEST_LIVEKIT_PORT}`, 15000);
}

export async function teardown() {
  livekit?.kill('SIGTERM');
}

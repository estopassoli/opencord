import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { REPO_ROOT, TEST_API_PORT, testConfig } from './env.js';
import { Http, startApp } from './helpers.js';

const DIR = path.join(REPO_ROOT, 'apps/api/var/test-downloads');
let app: NestFastifyApplication | null = null;

async function start(over: Record<string, string>) {
  app = await createApp(testConfig(over), { logger: false });
  await app.listen({ host: '127.0.0.1', port: TEST_API_PORT });
  return new Http(app);
}

beforeAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, 'OpenCord Setup 0.1.0.exe'), Buffer.alloc(1024, 1));
  writeFileSync(path.join(DIR, 'OpenCord Setup 0.2.0.exe'), Buffer.alloc(2048, 2));
  writeFileSync(path.join(DIR, 'OpenCord-0.2.0-mac-arm64.dmg'), Buffer.alloc(300, 3));
  writeFileSync(path.join(DIR, 'OpenCord-0.2.0-mac-x64.dmg'), Buffer.alloc(301, 3));
  writeFileSync(path.join(DIR, 'OpenCord-0.2.0-linux-x86_64.AppImage'), Buffer.alloc(400, 4));
  writeFileSync(path.join(DIR, 'OpenCord-0.2.0-linux-amd64.deb'), Buffer.alloc(401, 4));
  writeFileSync(path.join(DIR, 'segredo.txt'), 'nao servir');
  // 0.2.0 é o mais recente
  utimesSync(path.join(DIR, 'OpenCord Setup 0.1.0.exe'), new Date(2026, 0, 1), new Date(2026, 0, 1));
});
afterEach(async () => {
  await app?.close();
  app = null;
});
afterAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  // outros arquivos de teste esperam a app padrão livre na porta
  const a = await startApp();
  await a.close();
});

describe('download do app desktop (para quem usa pelo navegador)', () => {
  it('sem configuração: windows = null', async () => {
    const h = await start({});
    const r = await h.req<{ windows: unknown; files: unknown[] }>('GET', '/downloads/desktop');
    expect(r.status).toBe(200);
    expect(r.body.windows).toBeNull();
    expect(r.body.files).toEqual([]);
  });

  it('link externo configurado tem prioridade', async () => {
    const h = await start({ DESKTOP_DOWNLOAD_URL: 'https://downloads.exemplo.com/OpenCord.exe', DOWNLOADS_DIR: DIR });
    const r = await h.req<{ windows: { url: string } }>('GET', '/downloads/desktop');
    expect(r.body.windows.url).toBe('https://downloads.exemplo.com/OpenCord.exe');
    // as demais plataformas continuam vindo da pasta
    const files = (r.body as unknown as { files: { platform: string; url: string }[] }).files;
    expect(files.filter((f) => f.platform === 'windows').map((f) => f.url)).toEqual([
      'https://downloads.exemplo.com/OpenCord.exe',
    ]);
    expect(files.filter((f) => f.platform === 'mac')).toHaveLength(2);
  });

  it('lista a versão mais recente de cada plataforma, arquitetura e formato', async () => {
    const h = await start({ DOWNLOADS_DIR: DIR });
    const r = await h.req<{
      files: { platform: string; arch: string; format: string; fileName: string; url: string }[];
    }>('GET', '/downloads/desktop');
    expect(r.body.files.map((f) => [f.platform, f.arch, f.format, f.fileName])).toEqual([
      ['windows', 'x64', 'exe', 'OpenCord Setup 0.2.0.exe'],
      ['mac', 'arm64', 'dmg', 'OpenCord-0.2.0-mac-arm64.dmg'],
      ['mac', 'x64', 'dmg', 'OpenCord-0.2.0-mac-x64.dmg'],
      ['linux', 'x64', 'AppImage', 'OpenCord-0.2.0-linux-x86_64.AppImage'],
      ['linux', 'x64', 'deb', 'OpenCord-0.2.0-linux-amd64.deb'],
    ]);
    const dmg = await fetch(r.body.files[1]!.url);
    expect(dmg.headers.get('content-type')).toBe('application/x-apple-diskimage');
    expect((await dmg.arrayBuffer()).byteLength).toBe(300);
  });

  it('pasta: aponta para o instalador mais recente e serve o arquivo', async () => {
    const h = await start({ DOWNLOADS_DIR: DIR });
    const r = await h.req<{ windows: { url: string; version: string; sizeBytes: number; fileName: string } }>(
      'GET',
      '/downloads/desktop',
    );
    expect(r.body.windows).toMatchObject({ version: '0.2.0', sizeBytes: 2048, fileName: 'OpenCord Setup 0.2.0.exe' });
    const res = await fetch(r.body.windows.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });

  it('não serve arquivos fora do padrão nem caminhos relativos', async () => {
    const h = await start({ DOWNLOADS_DIR: DIR });
    expect((await h.req('GET', '/downloads/files/segredo.txt')).status).toBe(404);
    expect((await h.req('GET', `/downloads/files/${encodeURIComponent('../package.json')}`)).status).toBe(404);
    expect((await h.req('GET', `/downloads/files/${encodeURIComponent('..\\x.exe')}`)).status).toBe(404);
    expect((await h.req('GET', '/downloads/files/inexistente.exe')).status).toBe(404);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@opencord/contracts';
import { imageSize, sanitizeFilename } from './attachments/attachments.service.js';
import type { FastifyRequest } from 'fastify';
import { clientIp } from './common/client-ip.js';
import { loadConfig } from './config/config.js';
import { sourcesFor } from './voice/voice.service.js';
import { ActivitiesService, parseMix } from './voice/activities.service.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  ATTACHMENT_URL_SECRET: 'y'.repeat(40),
  LIVEKIT_URL: 'ws://x',
  LIVEKIT_API_URL: 'http://x',
  LIVEKIT_API_KEY: 'k',
  LIVEKIT_API_SECRET: 's'.repeat(40),
};

describe('sanitizeFilename', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Windows\\evil.exe', 'evil.exe'],
    ['a<b>c:d|e?f*g".png', 'abcdefg.png'],
    ['...hidden', 'hidden'],
    ['\u0000\u001f', 'arquivo'],
    ['x'.repeat(300), 'x'.repeat(200)],
  ])('%s → %s', (input, out) => expect(sanitizeFilename(input)).toBe(out));
});

describe('imageSize', () => {
  it('lê PNG e GIF', () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png, 'image/png')).toEqual({ width: 640, height: 480 });
    const gif = Buffer.from('474946383961' + '2003' + '5802' + '00'.repeat(8), 'hex');
    expect(imageSize(gif, 'image/gif')).toEqual({ width: 800, height: 600 });
  });
  it('JPEG truncado não lança', () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toBeNull();
  });
});

describe('sourcesFor (grants LiveKit)', () => {
  it('mapeia permissões para fontes publicáveis', () => {
    expect(sourcesFor(DEFAULT_EVERYONE_PERMISSIONS)).toEqual([
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    expect(sourcesFor(Permission.CONNECT)).toEqual([]);
    expect(sourcesFor(Permission.CONNECT | Permission.SPEAK)).toEqual([TrackSource.MICROPHONE]);
  });
});

describe('loadConfig', () => {
  it('aplica defaults e valida', () => {
    const c = loadConfig(baseEnv as NodeJS.ProcessEnv);
    expect(c.API_PORT).toBe(3000);
    expect(() => loadConfig({ ...baseEnv, JWT_ACCESS_SECRET: 'curto' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
  it('recusa segredos de desenvolvimento em produção', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-' + 'x'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).toThrow(/produção/);
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: 'production', LIVEKIT_API_SECRET: 'secret' } as NodeJS.ProcessEnv),
    ).toThrow(/produção/);
  });
  it('recusa os placeholders públicos do LiveKit em produção', () => {
    const prod = { ...baseEnv, NODE_ENV: 'production' };
    expect(() =>
      loadConfig({
        ...prod,
        LIVEKIT_API_KEY: 'CHANGE_ME_API_KEY',
        LIVEKIT_API_SECRET: 'CHANGE_ME_SECRET_AT_LEAST_32_CHARACTERS_LONG',
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
    expect(() => loadConfig({ ...prod, LIVEKIT_API_KEY: 'devkey' } as NodeJS.ProcessEnv)).toThrow(/produção/);
    expect(() => loadConfig({ ...prod, LIVEKIT_API_SECRET: 's'.repeat(20) } as NodeJS.ProcessEnv)).toThrow(/32/);
    expect(loadConfig(prod as NodeJS.ProcessEnv).NODE_ENV).toBe('production');
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string | string[]>, ip = '172.70.1.1') =>
    ({ headers, ip }) as unknown as FastifyRequest;
  it('sem cabeçalho configurado usa req.ip', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('172.70.1.1');
  });
  it('usa o cabeçalho configurado quando é um IP válido (v4 ou v6)', () => {
    expect(clientIp(req({ 'cf-connecting-ip': ' 203.0.113.7 ' }), 'cf-connecting-ip')).toBe('203.0.113.7');
    expect(clientIp(req({ 'cf-connecting-ip': '2001:db8::1' }), 'cf-connecting-ip')).toBe('2001:db8::1');
    expect(clientIp(req({ 'cf-connecting-ip': ['198.51.100.2', '1.1.1.1'] }), 'cf-connecting-ip')).toBe('198.51.100.2');
  });
  it('ignora valor ausente ou que não é IP', () => {
    expect(clientIp(req({}), 'cf-connecting-ip')).toBe('172.70.1.1');
    expect(clientIp(req({ 'cf-connecting-ip': 'evil, 1.2.3.4' }), 'cf-connecting-ip')).toBe('172.70.1.1');
  });
  it('CLIENT_IP_HEADER: vazio vira ausente, nome é normalizado e validado', () => {
    expect(loadConfig({ ...baseEnv, CLIENT_IP_HEADER: '' } as NodeJS.ProcessEnv).CLIENT_IP_HEADER).toBeUndefined();
    // .env.example deixa opcionais vazios (DESKTOP_DOWNLOAD_URL=, S3_ENDPOINT=...)
    const empty = loadConfig({ ...baseEnv, DESKTOP_DOWNLOAD_URL: '', INSTANCE_ACCESS_CODE: '' } as NodeJS.ProcessEnv);
    expect(empty.DESKTOP_DOWNLOAD_URL).toBeUndefined();
    expect(empty.INSTANCE_ACCESS_CODE).toBeUndefined();
    expect(
      loadConfig({ ...baseEnv, CLIENT_IP_HEADER: ' CF-Connecting-IP ' } as NodeJS.ProcessEnv).CLIENT_IP_HEADER,
    ).toBe('cf-connecting-ip');
    expect(() => loadConfig({ ...baseEnv, CLIENT_IP_HEADER: 'x y' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_IP_HEADER/);
  });
});

describe('ActivitiesService.playlist (Data API, fetch simulado)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const svc = () =>
    new ActivitiesService(
      loadConfig({ ...baseEnv, YOUTUBE_API_KEY: 'k'.repeat(20) }),
      null as never,
      null as never,
      null as never,
    );
  const item = (id: string, title: string, privacy = 'public') => ({
    status: { privacyStatus: privacy },
    snippet: { title, videoOwnerChannelTitle: 'Banda - Topic', resourceId: { videoId: id } },
  });

  it('segue as páginas, pula privados e respeita o máximo', async () => {
    const pages = [
      { nextPageToken: 'p2', items: [item('aaaaaaaaaaa', 'Um &amp; Dois'), item('bbbbbbbbbbb', 'x', 'private')] },
      { items: [item('ccccccccccc', 'Três'), item('ddddddddddd', 'Quatro')] },
    ];
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        urls.push(String(u));
        return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
      }),
    );
    const out = await svc().playlist('PLabcdefghijklmnop', 2);
    expect(out).toEqual([
      { videoId: 'aaaaaaaaaaa', title: 'Um & Dois', author: 'Banda' },
      { videoId: 'ccccccccccc', title: 'Três', author: 'Banda' },
    ]);
    expect(urls[1]).toContain('pageToken=p2');
  });

  it('mix automático (404) vira erro claro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    await expect(svc().playlist('RDabcdefghijklmnop', 10)).rejects.toThrow(/mixes automáticos/);
  });
});

describe('parseMix (mix automático lido da página, não oficial)', () => {
  const page = (data: unknown) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
  const r = (videoId: string, title: string, by: string) => ({
    playlistPanelVideoRenderer: {
      videoId,
      title: { simpleText: title },
      shortBylineText: { runs: [{ text: by }] },
    },
  });
  it('tira as faixas em ordem, sem repetir, até o máximo', () => {
    const html = page({
      contents: { panel: { contents: [r('aaaaaaaaaaa', 'Um', 'Banda - Topic'), r('aaaaaaaaaaa', 'Um', 'x')] } },
      other: [r('bbbbbbbbbbb', 'Dois', 'Outra'), r('ccccccccccc', 'Três', 'Outra')],
    });
    expect(parseMix(html, 2)).toEqual([
      { videoId: 'aaaaaaaaaaa', title: 'Um', author: 'Banda' },
      { videoId: 'bbbbbbbbbbb', title: 'Dois', author: 'Outra' },
    ]);
  });
  it('página diferente do esperado vira erro claro', () => {
    expect(() => parseMix('<html>nada</html>', 10)).toThrow(/mudou a página/);
    expect(() => parseMix(page({ contents: {} }), 10)).toThrow(/mudou a página/);
  });
});

import { describe, expect, it } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@opencord/contracts';
import { imageSize, sanitizeFilename } from './attachments/attachments.service.js';
import type { FastifyRequest } from 'fastify';
import { clientIp } from './common/client-ip.js';
import { loadConfig } from './config/config.js';
import { sourcesFor } from './voice/voice.service.js';

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
    expect(
      loadConfig({ ...baseEnv, CLIENT_IP_HEADER: ' CF-Connecting-IP ' } as NodeJS.ProcessEnv).CLIENT_IP_HEADER,
    ).toBe('cf-connecting-ip');
    expect(() => loadConfig({ ...baseEnv, CLIENT_IP_HEADER: 'x y' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_IP_HEADER/);
  });
});

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { StorageService } from './storage.service.js';

/** S3 falso em memória (PUT/GET/HEAD/DELETE em /<bucket>/<chave>), para exercitar o driver `s3` sem rede. */
const objects = new Map<string, { body: Buffer; type: string }>();
let server: Server;
let endpoint = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const o = objects.get(key);
      if (req.method === 'PUT') {
        objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] ?? '' });
        res.writeHead(200, { ETag: '"x"' }).end();
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204).end();
      } else if (!o) {
        res
          .writeHead(404, { 'Content-Type': 'application/xml' })
          .end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
      } else {
        res.writeHead(200, { 'Content-Length': String(o.body.length), 'Content-Type': o.type });
        res.end(req.method === 'HEAD' ? undefined : o.body);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = () =>
  ({
    STORAGE_DRIVER: 's3',
    STORAGE_LOCAL_DIR: './var/uploads',
    S3_ENDPOINT: endpoint,
    S3_REGION: 'auto',
    S3_BUCKET: 'opencord',
    S3_ACCESS_KEY_ID: 'teste',
    S3_SECRET_ACCESS_KEY: 'teste',
    S3_FORCE_PATH_STYLE: true,
  }) as AppConfig;

describe('StorageService com driver s3', () => {
  it('grava, mede, lê e apaga pelo bucket', async () => {
    const s = new StorageService(cfg());
    await s.write('avatars/abc-png', Buffer.from('imagem'), 'image/png');
    expect(objects.get('/opencord/avatars/abc-png')).toMatchObject({ type: 'image/png' });
    expect(await s.size('avatars/abc-png')).toBe(6);
    const chunks: Buffer[] = [];
    for await (const c of await s.read('avatars/abc-png')) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('imagem');
    await s.remove('avatars/abc-png');
    await expect(s.size('avatars/abc-png')).rejects.toBeTruthy();
  });

  it('recusa chaves com caminho relativo', async () => {
    await expect(new StorageService(cfg()).write('../x', Buffer.from('a'))).rejects.toThrow('inválida');
  });
});

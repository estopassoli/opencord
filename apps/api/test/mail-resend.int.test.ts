/** E-mail pelo Resend (ADR-0047): a API manda pela API HTTPS do Resend quando RESEND_API_KEY está definida. */
import http from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InstanceInfo } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis.service.js';
import { Http, register, resetDb, startApp } from './helpers.js';

const PORT = 4793;
const PASS = 'password-123456';
const got: { auth: string | undefined; body: { from: string; to: string[]; subject: string; text: string } }[] = [];
let fail = false;

let app: NestFastifyApplication;
let httpc: Http;
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      if (req.url !== '/emails' || fail) {
        res.writeHead(fail ? 422 : 404, { 'content-type': 'application/json' });
        return res.end('{"message":"domínio não verificado"}');
      }
      got.push({ auth: req.headers.authorization, body: JSON.parse(raw) as (typeof got)[number]['body'] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"msg_1"}');
    });
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
  app = await startApp({
    RESEND_API_KEY: 're_teste_123456',
    RESEND_FROM: 'OpenCord <naoresponda@teste.local>',
    RESEND_API_URL: `http://127.0.0.1:${PORT}`,
  });
  httpc = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  got.length = 0;
  fail = false;
  const r = app.get(RedisService).client;
  const keys = await r.keys('email-code:*');
  if (keys.length) await r.del(...keys);
});

describe('e-mail pelo Resend', () => {
  it('manda o código de confirmação pela API do Resend; falha do Resend vira 503', async () => {
    expect((await httpc.req<InstanceInfo>('GET', '/auth/instance')).body.email).toBe(true);
    const ana = await register(httpc, 'Ana');
    await httpc.req('PUT', '/me/email', { token: ana.token, body: { email: 'ana@exemplo.com', password: PASS } });
    expect((await httpc.req('POST', '/me/email/verify/send', { token: ana.token })).status).toBe(204);
    expect(got).toHaveLength(1);
    expect(got[0]!.auth).toBe('Bearer re_teste_123456');
    expect(got[0]!.body).toMatchObject({ from: 'OpenCord <naoresponda@teste.local>', to: ['ana@exemplo.com'] });
    const code = /^(\d{6}) /.exec(got[0]!.body.subject)?.[1];
    expect(code).toBeTruthy();
    expect((await httpc.req('POST', '/me/email/verify', { token: ana.token, body: { code } })).status).toBe(204);

    // Resend recusando: a pessoa vê o erro em vez de esperar um código que não vem
    const bruno = await register(httpc, 'Bruno');
    await httpc.req('PUT', '/me/email', { token: bruno.token, body: { email: 'b@exemplo.com', password: PASS } });
    fail = true;
    expect((await httpc.req('POST', '/me/email/verify/send', { token: bruno.token })).status).toBe(503);
    // e pode tentar de novo na hora (sem esperar o minuto)
    fail = false;
    expect((await httpc.req('POST', '/me/email/verify/send', { token: bruno.token })).status).toBe(204);
  });
});

/** E-mail da conta e verificação em duas etapas por código no e-mail (ADR-0047), com um SMTP local de mentira. */
import net from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthResponse, InstanceInfo, Me, TwoFactorChallenge, TwoFactorRecoveryCodes } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis.service.js';
import { Http, register, resetDb, startApp } from './helpers.js';

const SMTP_PORT = 4792;
const PASS = 'password-123456';
const inbox: { to: string; data: string }[] = [];

/** SMTP mínimo (sem TLS nem AUTH): guarda cada mensagem recebida */
function smtpStub() {
  return net.createServer((sock) => {
    let to = '';
    let inData = false;
    let buf = '';
    sock.write('220 stub\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          inbox.push({ to, data: buf.slice(0, end) });
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 ok\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250 stub\r\n');
        else if (cmd === 'RCPT') {
          to = /<([^>]+)>/.exec(line)?.[1] ?? '';
          sock.write('250 ok\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (cmd === 'QUIT') {
          sock.end('221 bye\r\n');
        } else sock.write('250 ok\r\n');
      }
    });
  });
}

/** o código de 6 dígitos do último e-mail para `to` (vai no começo do texto e no assunto) */
const lastCode = (to: string) => {
  // o aviso de acesso novo (sem código) também chega: pega o último que tem código
  const code = [...inbox]
    .reverse()
    .filter((x) => x.to === to)
    .map((x) => /Subject: (?:=\?UTF-8\?[QB]\?)?(\d{6})/i.exec(x.data)?.[1])
    .find(Boolean);
  if (!code) throw new Error(`sem código para ${to}`);
  return code;
};

let app: NestFastifyApplication;
let http: Http;
let server: net.Server;

beforeAll(async () => {
  server = smtpStub();
  await new Promise<void>((r) => server.listen(SMTP_PORT, '127.0.0.1', r));
  app = await startApp({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(SMTP_PORT),
    SMTP_SECURE: 'false',
    MAIL_FROM: 'OpenCord <naoresponda@teste.local>',
  });
  http = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  inbox.length = 0;
  const r = app.get(RedisService).client;
  const keys = [...(await r.keys('email-code:*')), ...(await r.keys('2fa:*'))];
  if (keys.length) await r.del(...keys);
});

describe('e-mail e duas etapas por e-mail', () => {
  it('confirma o e-mail, liga o código por e-mail, entra com ele e desliga', async () => {
    const info = await http.req<InstanceInfo>('GET', '/auth/instance');
    expect(info.body.email).toBe(true);
    const ana = await register(http, 'Ana');
    const mail = 'ana@exemplo.com';

    // sem e-mail confirmado não liga
    expect(
      (await http.req('POST', '/me/2fa/email/enable', { token: ana.token, body: { password: PASS } })).status,
    ).toBe(400);
    expect(
      (await http.req('PUT', '/me/email', { token: ana.token, body: { email: mail, password: 'errada' } })).status,
    ).toBe(400);
    expect(
      (await http.req('PUT', '/me/email', { token: ana.token, body: { email: mail, password: PASS } })).status,
    ).toBe(204);
    expect((await http.req('POST', '/me/email/verify/send', { token: ana.token })).status).toBe(204);
    // um envio por minuto
    expect((await http.req('POST', '/me/email/verify/send', { token: ana.token })).status).toBe(429);
    expect((await http.req('POST', '/me/email/verify', { token: ana.token, body: { code: '000000' } })).status).toBe(
      400,
    );
    expect(
      (await http.req('POST', '/me/email/verify', { token: ana.token, body: { code: lastCode(mail) } })).status,
    ).toBe(204);
    expect((await http.req<Me>('GET', '/me', { token: ana.token })).body).toMatchObject({ emailVerified: true });

    const on = await http.req<TwoFactorRecoveryCodes>('POST', '/me/2fa/email/enable', {
      token: ana.token,
      body: { password: PASS },
    });
    expect(on.status).toBe(200);
    expect(on.body.recoveryCodes).toHaveLength(10);
    expect((await http.req<Me>('GET', '/me', { token: ana.token })).body).toMatchObject({
      twoFactorEnabled: true,
      twoFactorMethod: 'email',
    });
    // trocar o e-mail com a verificação por e-mail ligada: não
    expect(
      (await http.req('PUT', '/me/email', { token: ana.token, body: { email: 'outro@exemplo.com', password: PASS } }))
        .status,
    ).toBe(400);

    // login: o código chega no e-mail
    const first = await http.req<TwoFactorChallenge>('POST', '/auth/login', {
      body: { login: 'Ana', password: PASS, deviceId: 'dev-x' },
    });
    expect(first.body).toMatchObject({ twoFactorRequired: true, method: 'email', emailHint: 'a***@e***.com' });
    const code = lastCode(mail);
    const ok = await http.req<AuthResponse>('POST', '/auth/login/2fa', {
      body: { ticket: first.body.ticket, code },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();
    // aparelho novo com e-mail confirmado: o aviso também vai por e-mail
    await new Promise((r) => setTimeout(r, 300));
    expect(inbox.some((x) => x.to === mail && /Novo(_| )acesso/.test(x.data))).toBe(true);

    // desligar: pede o código mandado de novo para o e-mail (o anterior já foi gasto)
    await app.get(RedisService).client.del(`email-code:rl:2fa:${ana.id}`);
    expect((await http.req('POST', '/me/2fa/email/send', { token: ana.token })).status).toBe(204);
    expect(
      (
        await http.req('POST', '/me/2fa/disable', {
          token: ana.token,
          body: { password: PASS, code: lastCode(mail) },
        })
      ).status,
    ).toBe(204);
    expect((await http.req<Me>('GET', '/me', { token: ana.token })).body.twoFactorMethod).toBeNull();
  });
});

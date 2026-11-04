/** Segurança no login (ADR-0046): duas etapas (TOTP + recuperação), aparelhos conectados e aviso de aparelho novo. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AuthResponse,
  Conversation,
  Me,
  MessagePage,
  SessionInfo,
  TwoFactorChallenge,
  TwoFactorRecoveryCodes,
  TwoFactorSetupResponse,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, matchStep, totpAt } from '../src/auth/two-factor.service.js';
import { connectSocket, Http, nextEvent, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];
const PASS = 'password-123456';
const UA_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const step = () => Math.floor(Date.now() / 30_000);
const login = (nickname: string, deviceId: string, password = PASS) =>
  http.req<AuthResponse | TwoFactorChallenge>('POST', '/auth/login', {
    body: { login: nickname, password, deviceId },
    headers: { 'user-agent': UA_WIN },
  });

describe('TOTP', () => {
  it('bate com o vetor da RFC 6238 (SHA-1, 8 dígitos truncados para 6)', () => {
    // segredo da RFC: "12345678901234567890"; em T=59 s o código de 8 dígitos é 94287082 → 6 dígitos 287082
    expect(totpAt(Buffer.from('12345678901234567890'), 1)).toBe('287082');
    expect(matchStep(Buffer.from('12345678901234567890'), '287082', 1)).toBe(1);
    expect(matchStep(Buffer.from('12345678901234567890'), '000000', 1)).toBeNull();
  });
});

describe('verificação em duas etapas', () => {
  it('liga, pede o código no login, aceita recuperação uma vez e desliga', async () => {
    const ana = await register(http, 'Ana');
    // senha errada não gera segredo
    expect((await http.req('POST', '/me/2fa/setup', { token: ana.token, body: { password: 'x' } })).status).toBe(400);
    const setup = await http.req<TwoFactorSetupResponse>('POST', '/me/2fa/setup', {
      token: ana.token,
      body: { password: PASS },
    });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/OpenCord%3Aana?secret=');
    const secret = base32Decode(setup.body.secret);
    expect((await http.req('POST', '/me/2fa/enable', { token: ana.token, body: { code: '000000' } })).status).toBe(400);
    const on = await http.req<TwoFactorRecoveryCodes>('POST', '/me/2fa/enable', {
      token: ana.token,
      body: { code: totpAt(secret, step()) },
    });
    expect(on.status).toBe(200);
    expect(on.body.recoveryCodes).toHaveLength(10);
    const me = await http.req<Me>('GET', '/me', { token: ana.token });
    expect(me.body.twoFactorEnabled).toBe(true);
    // segredo guardado cifrado, não em base32
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ana.id } });
    expect(row.totpSecret).toMatch(/^v1\./);

    // login: senha certa não basta
    const first = await login('Ana', 'dev-2');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ twoFactorRequired: true });
    const ticket = (first.body as TwoFactorChallenge).ticket;
    expect((await http.req('POST', '/auth/login/2fa', { body: { ticket, code: '000000' } })).status).toBe(401);
    // o código já usado para ligar (mesmo passo) não serve de novo; o do próximo passo serve
    const ok = await http.req<AuthResponse>('POST', '/auth/login/2fa', {
      body: { ticket, code: totpAt(secret, step() + 1) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();
    // bilhete é de uso único
    expect(
      (await http.req('POST', '/auth/login/2fa', { body: { ticket, code: on.body.recoveryCodes[0]! } })).status,
    ).toBe(401);

    // código de recuperação: vale uma vez (com ou sem hífen, maiúsculas)
    const t2 = ((await login('Ana', 'dev-3')).body as TwoFactorChallenge).ticket;
    const rec = on.body.recoveryCodes[0]!;
    expect((await http.req('POST', '/auth/login/2fa', { body: { ticket: t2, code: rec.toUpperCase() } })).status).toBe(
      200,
    );
    const t3 = ((await login('Ana', 'dev-4')).body as TwoFactorChallenge).ticket;
    expect((await http.req('POST', '/auth/login/2fa', { body: { ticket: t3, code: rec } })).status).toBe(401);

    // muitas tentativas derrubam o bilhete
    for (let i = 0; i < 5; i++) await http.req('POST', '/auth/login/2fa', { body: { ticket: t3, code: '111111' } });
    expect(
      (await http.req('POST', '/auth/login/2fa', { body: { ticket: t3, code: on.body.recoveryCodes[1]! } })).status,
    ).toBe(401);

    // desligar pede senha e código
    expect(
      (
        await http.req('POST', '/me/2fa/disable', {
          token: ana.token,
          body: { password: PASS, code: '123456' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await http.req('POST', '/me/2fa/disable', {
          token: ana.token,
          body: { password: PASS, code: on.body.recoveryCodes[2]! },
        })
      ).status,
    ).toBe(204);
    expect((await login('Ana', 'dev-5')).body).toHaveProperty('tokens');
  });
});

describe('aparelhos conectados e aviso de aparelho novo', () => {
  it('lista os aparelhos, encerra um ou todos os outros, e avisa por DM o login de aparelho novo', async () => {
    const ana = await register(http, 'Ana');
    const s = await connectSocket(ana.token);
    sockets.push(s);
    // mesmo aparelho do cadastro? o cadastro do helper não manda deviceId: o primeiro login com deviceId avisa
    const conv = nextEvent<Conversation>(s, 'conversation:upserted');
    const notice = nextEvent<{ body: string }>(s, 'chat:message:created');
    const second = (await login('Ana', 'notebook-1')).body as AuthResponse;
    const c = await conv;
    await notice;
    expect(c.members.some((m) => m.system)).toBe(true);
    const msgs = await http.req<MessagePage>('GET', `/conversations/${c.id}/messages`, { token: ana.token });
    expect(msgs.body.messages[0]!.body).toContain('Chrome no Windows');
    // de novo do mesmo aparelho: sem aviso
    await login('Ana', 'notebook-1');
    await new Promise((r) => setTimeout(r, 200));
    const again = await http.req<MessagePage>('GET', `/conversations/${c.id}/messages`, { token: ana.token });
    expect(again.body.messages).toHaveLength(1);

    const list = await http.req<SessionInfo[]>('GET', '/me/sessions', { token: ana.token });
    expect(list.body).toHaveLength(3);
    expect(list.body.filter((x) => x.current)).toHaveLength(1);
    // os dois logins do notebook são aparelhos (famílias) separados; encerrar ambos derruba o token do primeiro
    const notebooks = list.body.filter((x) => !x.current && x.userAgent?.includes('Windows'));
    expect(notebooks).toHaveLength(2);
    for (const n of notebooks)
      expect((await http.req('DELETE', `/me/sessions/${n.id}`, { token: ana.token })).status).toBe(204);
    expect((await http.req('GET', '/me', { token: second.tokens.accessToken })).status).toBe(401);
    // de outra pessoa: 404
    const bruno = await register(http, 'Bruno');
    const mine = (await http.req<SessionInfo[]>('GET', '/me/sessions', { token: ana.token })).body[0]!;
    expect((await http.req('DELETE', `/me/sessions/${mine.id}`, { token: bruno.token })).status).toBe(404);

    const tablet = (await login('Ana', 'tablet-1')).body as AuthResponse;
    const out = await http.req<{ revoked: number }>('POST', '/me/sessions/revoke-others', { token: ana.token });
    expect(out.body.revoked).toBe(1);
    expect((await http.req('GET', '/me', { token: tablet.tokens.accessToken })).status).toBe(401);
    const left = await http.req<SessionInfo[]>('GET', '/me/sessions', { token: ana.token });
    expect(left.body).toEqual([expect.objectContaining({ current: true })]);
  });
});

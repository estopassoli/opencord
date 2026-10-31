import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthResponse, TokenPair } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('criar conta (opcional, sem convite — ADR-0007)', () => {
  it('cadastro aberto: apelido + senha; entra em todos os servidores; senha só como argon2id', async () => {
    const a = await bootstrapOwner(http);
    const b = await bootstrapOwner(http);
    const u = await register(http, 'Conta Nova');
    expect(u.auth.user).toMatchObject({ displayName: 'Conta Nova', email: null, hasAccount: true });
    expect(
      await prisma.serverMember.count({ where: { userId: u.id, serverId: { in: [a.serverId, b.serverId] } } }),
    ).toBe(2);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('e-mail é opcional e único', async () => {
    const r1 = await http.req<AuthResponse>('POST', '/auth/register', {
      body: { nickname: 'ComEmail', password: 'password-123456', email: 'Mail@Test.local' },
    });
    expect(r1.status).toBe(201);
    expect(r1.body.user.email).toBe('mail@test.local');
    const r2 = await http.req<{ message: string }>('POST', '/auth/register', {
      body: { nickname: 'Outro', password: 'password-123456', email: 'mail@test.local' },
    });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/e-mail/);
  });

  it('apelido de conta não pode ser usado para entrar sem senha (mensagem orienta login)', async () => {
    await register(http, 'Dona');
    const r = await http.req<{ message: string }>('POST', '/auth/guest', { body: { nickname: 'dona' } });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/entre com a senha/);
  });

  it('valida payload com Zod (400 com detalhes)', async () => {
    const r = await http.req<{ details: unknown[] }>('POST', '/auth/register', {
      body: { nickname: 'x', password: 'curta' },
    });
    expect(r.status).toBe(400);
    expect(Array.isArray(r.body.details)).toBe(true);
  });

  it('transformar apelido em conta mantém o mesmo usuário e permite login de outro dispositivo', async () => {
    const g = await http.req<AuthResponse>('POST', '/auth/guest', { body: { nickname: 'Viajante' } });
    expect(g.body.user.hasAccount).toBe(false);
    const c = await http.req<{ hasAccount: boolean; id: string }>('POST', '/auth/claim', {
      token: g.body.tokens.accessToken,
      body: { password: 'password-123456' },
    });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ hasAccount: true, id: g.body.user.id });
    const again = await http.req('POST', '/auth/claim', {
      token: g.body.tokens.accessToken,
      body: { password: 'password-123456' },
    });
    expect(again.status).toBe(400);
    const l = await http.req<AuthResponse>('POST', '/auth/login', {
      body: { login: 'VIAJANTE', password: 'password-123456' },
    });
    expect(l.status).toBe(200);
    expect(l.body.user.id).toBe(g.body.user.id);
  });
});

describe('login, refresh rotativo e logout', () => {
  it('login por apelido ou e-mail; senha errada e inexistente → mesmo 401 genérico', async () => {
    await bootstrapOwner(http);
    const u = await register(http, 'login_user');
    expect(
      (await http.req('POST', '/auth/login', { body: { login: u.nickname, password: 'password-123456' } })).status,
    ).toBe(200);
    const wrong = await http.req<{ message: string }>('POST', '/auth/login', {
      body: { login: u.nickname, password: 'nope-nope-nope' },
    });
    const missing = await http.req<{ message: string }>('POST', '/auth/login', {
      body: { login: 'ghost@test.local', password: 'nope-nope-nope' },
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it('bloqueia após 10 falhas na janela', async () => {
    await bootstrapOwner(http);
    const u = await register(http, 'brute_user');
    for (let i = 0; i < 10; i++)
      await http.req('POST', '/auth/login', { body: { login: u.nickname, password: 'wrong-password' } });
    const r = await http.req<{ message: string }>('POST', '/auth/login', {
      body: { login: u.nickname, password: 'password-123456' },
    });
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/tentativas/);
  });

  it('refresh rotaciona; reuso do token antigo revoga a família inteira', async () => {
    await bootstrapOwner(http);
    const u = await register(http);
    const r1 = await http.req<TokenPair>('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(u.refresh);
    const me = await http.req('GET', '/me', { token: r1.body.accessToken });
    expect(me.status).toBe(200);
    // reuso do refresh já rotacionado (cenário de roubo)
    const reuse = await http.req('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(reuse.status).toBe(401);
    // a sessão legítima derivada também foi revogada
    const r2 = await http.req('POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
    expect(r2.status).toBe(401);
    await new Promise((r) => setTimeout(r, 5100)); // expira cache de sessão (5 s)
    const after = await http.req('GET', '/me', { token: r1.body.accessToken });
    expect(after.status).toBe(401);
  });

  it('logout invalida access token imediatamente e o refresh', async () => {
    await bootstrapOwner(http);
    const u = await register(http);
    expect((await http.req('POST', '/auth/logout', { token: u.token })).status).toBe(204);
    expect((await http.req('GET', '/me', { token: u.token })).status).toBe(401);
    expect((await http.req('POST', '/auth/refresh', { body: { refreshToken: u.refresh } })).status).toBe(401);
  });

  it('rotas protegidas exigem token; token adulterado → 401', async () => {
    expect((await http.req('GET', '/me')).status).toBe(401);
    const { owner } = await bootstrapOwner(http);
    const tampered = owner.token.slice(0, -4) + (owner.token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await http.req('GET', '/me', { token: tampered })).status).toBe(401);
  });

  it('troca de senha revoga outras sessões e mantém a atual', async () => {
    await bootstrapOwner(http);
    const u = await register(http, 'pw_user');
    const other = await http.req<{ tokens: TokenPair }>('POST', '/auth/login', {
      body: { login: u.nickname, password: 'password-123456' },
    });
    const r = await http.req('POST', '/auth/password', {
      token: u.token,
      body: { currentPassword: 'password-123456', newPassword: 'new-password-987' },
    });
    expect(r.status).toBe(204);
    expect(
      (await http.req('POST', '/auth/refresh', { body: { refreshToken: other.body.tokens.refreshToken } })).status,
    ).toBe(401);
    expect((await http.req('GET', '/me', { token: u.token })).status).toBe(200);
  });
});

describe('health', () => {
  it('reporta banco, redis e livekit', async () => {
    const r = await http.req<{ checks: Record<string, string> }>('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.checks).toEqual({ database: 'ok', redis: 'ok', livekit: 'ok' });
  });
});

describe('trocar a senha', () => {
  it('derruba os sockets das outras sessões (o socket só autentica no handshake)', async () => {
    await bootstrapOwner(http);
    const u = await register(http);
    const other = await http.req<AuthResponse>('POST', '/auth/login', {
      body: { login: u.nickname, password: 'password-123456' },
    });
    const stolen = await connectSocket(other.body.tokens.accessToken);
    const revoked = nextEvent<{ reason: string }>(stolen, 'session:revoked');
    const r = await http.req('POST', '/auth/password', {
      token: u.token,
      body: { currentPassword: 'password-123456', newPassword: 'outra-senha-123456' },
    });
    expect(r.status).toBe(204);
    expect((await revoked).reason).toBe('password_changed');
    await new Promise((res) => setTimeout(res, 100));
    expect(stolen.connected).toBe(false);
    stolen.disconnect();
  });
});

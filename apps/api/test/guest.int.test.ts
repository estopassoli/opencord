import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthResponse, InstanceInfo, ServerSummary, TokenPair } from '@opencord/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createApp } from '../src/bootstrap.js';
import { TEST_API_PORT, TEST_ENV, testConfig } from './env.js';
import { bootstrapOwner, Http, prisma, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
// contador de apelidos por IP é compartilhado (todos os testes vêm de 127.0.0.1): zerar a cada teste
async function resetGuestIpCounter() {
  const r = new Redis(TEST_ENV.REDIS_URL);
  const keys = await r.keys('oc:guest:ip:*');
  if (keys.length) await r.del(...keys);
  await r.quit();
}
beforeEach(async () => {
  await resetDb();
  await resetGuestIpCounter();
});

const join = (nickname: string, extra: Record<string, unknown> = {}) =>
  http.req<AuthResponse & { message?: string }>('POST', '/auth/guest', { body: { nickname, ...extra } });

describe('entrada só com apelido (ADR-0007)', () => {
  it('instância informa que aceita apelido e não exige código', async () => {
    const r = await http.req<InstanceInfo>('GET', '/auth/instance');
    expect(r.body).toEqual({ name: 'OpenCord', guestJoin: true, requiresAccessCode: false, youtubeSearch: false });
  });

  it('cria identidade sem e-mail/senha e entra em TODOS os servidores (abertos, sem convite)', async () => {
    const a = await bootstrapOwner(http);
    const b = await bootstrapOwner(http);
    const r = await join('  João   Silva ');
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ displayName: 'João Silva', email: null, hasAccount: false });
    expect(r.body.user.username).toMatch(/^[a-z0-9_.]{2,32}$/);
    const servers = await http.req<ServerSummary[]>('GET', '/servers', { token: r.body.tokens.accessToken });
    expect(servers.body.map((s) => s.id).sort()).toEqual([a.serverId, b.serverId].sort());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: r.body.user.id } });
    expect(row).toMatchObject({ email: null, passwordHash: null, nickKey: 'joao silva' });
  });

  it('apelido único sem diferenciar maiúsculas, acentos e espaços', async () => {
    expect((await join('Joao')).status).toBe(201);
    const dup = await join('JOÃO');
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/em uso/);
  });

  it('apelido de usuário com senha também é reservado (sem personificação do dono)', async () => {
    const { owner } = await bootstrapOwner(http);
    expect((await join(owner.nickname.toUpperCase())).status).toBe(409);
  });

  it('rejeita apelido inválido', async () => {
    for (const n of ['a', '<b>', '@everyone', 'x'.repeat(33), '   ']) expect((await join(n)).status).toBe(400);
  });

  it('sessão do apelido persiste por refresh rotativo e não tem login por senha', async () => {
    const r = await join('Persistente');
    const ref = await http.req<TokenPair>('POST', '/auth/refresh', {
      body: { refreshToken: r.body.tokens.refreshToken },
    });
    expect(ref.status).toBe(200);
    expect((await http.req('GET', '/me', { token: ref.body.accessToken })).status).toBe(200);
    expect(
      (
        await http.req('POST', '/auth/password', {
          token: ref.body.accessToken,
          body: { currentPassword: 'x', newPassword: 'y'.repeat(12) },
        })
      ).status,
    ).toBe(400);
  });

  it('pedido de amizade pelo apelido (com acento/caixa diferentes)', async () => {
    await bootstrapOwner(http);
    const a = await join('Ana');
    await join('Zoé Lima');
    const r = await http.req<{ status: string; user: { displayName: string } }>('POST', '/friends/requests', {
      token: a.body.tokens.accessToken,
      body: { username: 'zoe lima' },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending_outgoing', user: { displayName: 'Zoé Lima' } });
  });

  it('troca de apelido respeita unicidade', async () => {
    const a = await join('Alfa');
    await join('Beta');
    expect(
      (await http.req('PATCH', '/me', { token: a.body.tokens.accessToken, body: { displayName: 'BETA' } })).status,
    ).toBe(409);
    const ok = await http.req<{ displayName: string }>('PATCH', '/me', {
      token: a.body.tokens.accessToken,
      body: { displayName: 'Gama' },
    });
    expect(ok.body.displayName).toBe('Gama');
    expect((await join('alfa')).status).toBe(201); // apelido antigo liberado
  });
});

describe('controles opcionais da instância', () => {
  let custom: NestFastifyApplication | null = null;
  afterEach(async () => {
    await custom?.close();
    custom = null;
  });
  const start = async (over: Record<string, string>) => {
    await app.close();
    custom = await createApp(testConfig(over as never), { logger: false });
    await custom.listen({ host: '127.0.0.1', port: TEST_API_PORT });
    return new Http(custom);
  };
  afterAll(async () => {
    app = await startApp();
    http = new Http(app);
  });

  it('código de acesso: exigido e comparado em tempo constante', async () => {
    const h = await start({ INSTANCE_ACCESS_CODE: 'segredo-dos-amigos' } as never);
    expect((await h.req<InstanceInfo>('GET', '/auth/instance')).body.requiresAccessCode).toBe(true);
    expect((await h.req('POST', '/auth/guest', { body: { nickname: 'Sem' } })).status).toBe(403);
    expect((await h.req('POST', '/auth/guest', { body: { nickname: 'Errado', accessCode: 'x' } })).status).toBe(403);
    expect(
      (await h.req('POST', '/auth/guest', { body: { nickname: 'Certo', accessCode: 'segredo-dos-amigos' } })).status,
    ).toBe(201);
  });

  it('limite de novos apelidos por IP', async () => {
    const h = await start({ GUEST_JOIN_PER_IP_HOUR: '3' } as never);
    const codes = [];
    for (let i = 0; i < 5; i++)
      codes.push((await h.req('POST', '/auth/guest', { body: { nickname: `Ip${i}` } })).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
  });

  it('pode ser desativado (apenas login com senha)', async () => {
    const h = await start({ GUEST_JOIN_ENABLED: 'false' } as never);
    expect((await h.req('POST', '/auth/guest', { body: { nickname: 'Nao' } })).status).toBe(403);
  });
});

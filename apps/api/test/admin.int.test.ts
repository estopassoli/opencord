/** Painel do super admin (ADR-0020): 404 para quem não é admin, suspensão, sessões, promoção, instância, auditoria. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AdminAuditPage,
  AdminInstanceConfig,
  AdminStats,
  AdminUser,
  AdminUserPage,
  InstanceInfo,
} from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

/** O dono do oficial é o criador e super admin (como na migração da ADR-0013). */
async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  await prisma.user.update({ where: { id: owner.id }, data: { isInstanceAdmin: true } });
  const alice = await register(http);
  return { owner, alice, serverId };
}

describe('painel do super admin', () => {
  it('quem não é admin recebe 404 em todas as rotas', async () => {
    const { alice, owner } = await setup();
    for (const [method, path] of [
      ['GET', '/admin/stats'],
      ['GET', '/admin/users'],
      ['GET', '/admin/instance'],
      ['PATCH', '/admin/instance'],
      ['GET', '/admin/audit'],
      ['POST', `/admin/users/${owner.id}/suspend`],
      ['PUT', `/admin/users/${owner.id}/admin`],
    ] as const) {
      const body = method === 'PUT' ? { admin: false } : method === 'GET' ? undefined : {};
      const r = await http.req(method, path, { token: alice.token, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it('números e lista de usuários com busca e filtros', async () => {
    const { owner, alice } = await setup();
    const stats = await http.req<AdminStats>('GET', '/admin/stats', { token: owner.token });
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ users: 2, admins: 1, suspended: 0, servers: 1 });

    const all = await http.req<AdminUserPage>('GET', '/admin/users', { token: owner.token });
    expect(all.body.users.map((u) => u.id)).toEqual([alice.id, owner.id]); // mais novos primeiro
    expect(all.body.users.find((u) => u.id === owner.id)).toMatchObject({ isCreator: true, isInstanceAdmin: true });
    const found = await http.req<AdminUserPage>(
      'GET',
      `/admin/users?q=${encodeURIComponent(alice.nickname.toUpperCase())}`,
      { token: owner.token },
    );
    expect(found.body.users.map((u) => u.id)).toEqual([alice.id]);
    const admins = await http.req<AdminUserPage>('GET', '/admin/users?filter=admins', { token: owner.token });
    expect(admins.body.users.map((u) => u.id)).toEqual([owner.id]);
  });

  it('suspender derruba as sessões e impede o login; reativar devolve o acesso', async () => {
    const { owner, alice } = await setup();
    const s = await http.req<AdminUser>('POST', `/admin/users/${alice.id}/suspend`, {
      token: owner.token,
      body: { reason: 'spam' },
    });
    expect(s.status).toBe(201);
    expect(s.body.disabledAt).not.toBeNull();
    expect(s.body.activeSessions).toBe(0);
    expect((await http.req('GET', '/me', { token: alice.token })).status).toBe(401);
    const login = await http.req('POST', '/auth/login', {
      body: { login: alice.nickname, password: 'password-123456' },
    });
    expect(login.status).toBe(401);

    const back = await http.req<AdminUser>('POST', `/admin/users/${alice.id}/unsuspend`, { token: owner.token });
    expect(back.body.disabledAt).toBeNull();
    const again = await http.req('POST', '/auth/login', {
      body: { login: alice.nickname, password: 'password-123456' },
    });
    expect(again.status).toBe(200);

    const audit = await http.req<AdminAuditPage>('GET', '/admin/audit', { token: owner.token });
    expect(audit.body.entries.map((e) => e.action)).toEqual(['admin.user.unsuspend', 'admin.user.suspend']);
    expect(audit.body.entries[1]).toMatchObject({ targetName: alice.nickname, metadata: { reason: 'spam' } });
  });

  it('não dá para mexer na própria conta, no criador, nem suspender outro admin', async () => {
    const { owner, alice } = await setup();
    expect((await http.req('POST', `/admin/users/${owner.id}/suspend`, { token: owner.token, body: {} })).status).toBe(
      400,
    );
    const promote = await http.req<AdminUser>('PUT', `/admin/users/${alice.id}/admin`, {
      token: owner.token,
      body: { admin: true },
    });
    expect(promote.body.isInstanceAdmin).toBe(true);
    // a nova admin não rebaixa nem suspende o criador
    expect(
      (await http.req('PUT', `/admin/users/${owner.id}/admin`, { token: alice.token, body: { admin: false } })).status,
    ).toBe(400);
    expect((await http.req('POST', `/admin/users/${owner.id}/suspend`, { token: alice.token, body: {} })).status).toBe(
      400,
    );
    // admin não é suspenso sem antes perder o admin
    const bob = await register(http);
    await http.req('PUT', `/admin/users/${bob.id}/admin`, { token: owner.token, body: { admin: true } });
    expect((await http.req('POST', `/admin/users/${bob.id}/suspend`, { token: alice.token, body: {} })).status).toBe(
      400,
    );
    await http.req('PUT', `/admin/users/${bob.id}/admin`, { token: alice.token, body: { admin: false } });
    expect((await http.req('POST', `/admin/users/${bob.id}/suspend`, { token: alice.token, body: {} })).status).toBe(
      201,
    );
  });

  it('encerrar sessões desloga a pessoa sem suspender', async () => {
    const { owner, alice } = await setup();
    const r = await http.req<AdminUser>('POST', `/admin/users/${alice.id}/logout`, { token: owner.token });
    expect(r.body).toMatchObject({ activeSessions: 0, disabledAt: null });
    expect((await http.req('GET', '/me', { token: alice.token })).status).toBe(401);
    expect(
      (await http.req('POST', '/auth/login', { body: { login: alice.nickname, password: 'password-123456' } })).status,
    ).toBe(200);
  });

  it('cadastro fechado, aviso e limite de upload valem para a instância', async () => {
    const { owner } = await setup();
    const up = await http.req<AdminInstanceConfig>('PATCH', '/admin/instance', {
      token: owner.token,
      body: {
        registrationOpen: false,
        announcement: { text: 'Manutenção às 23h', tone: 'warning' },
        uploadMaxBytes: 2 * 1024 * 1024,
      },
    });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ registrationOpen: false, uploadOverrideBytes: 2 * 1024 * 1024 });

    const info = await http.req<InstanceInfo>('GET', '/auth/instance');
    expect(info.body).toMatchObject({
      registrationOpen: false,
      announcement: { text: 'Manutenção às 23h', tone: 'warning' },
      uploadMaxBytes: 2 * 1024 * 1024,
    });
    const reg = await http.req<{ message: string }>('POST', '/auth/register', {
      body: { nickname: 'novato', password: 'password-123456' },
    });
    expect(reg.status).toBe(403);
    expect(reg.body.message).toMatch(/cadastros estão fechados/);

    // acima do teto do ambiente: recusado
    const big = await http.req('PATCH', '/admin/instance', {
      token: owner.token,
      body: { uploadMaxBytes: 10 * 1024 * 1024 * 1024 },
    });
    expect(big.status).toBe(400);

    await http.req('PATCH', '/admin/instance', {
      token: owner.token,
      body: { registrationOpen: true, announcement: null, uploadMaxBytes: null },
    });
    const open = await http.req<InstanceInfo>('GET', '/auth/instance');
    expect(open.body).toMatchObject({ registrationOpen: true, announcement: null });
    expect((await register(http, 'novato')).id).toBeTruthy();
  });

  it('auditoria global: filtro de ações de admin e tudo', async () => {
    const { owner, alice } = await setup();
    await http.req('PATCH', '/admin/instance', { token: owner.token, body: { registrationOpen: false } });
    const adminOnly = await http.req<AdminAuditPage>('GET', '/admin/audit', { token: owner.token });
    expect(adminOnly.body.entries.map((e) => e.action)).toEqual(['admin.instance.update']);
    expect(adminOnly.body.entries[0]?.actor.id).toBe(owner.id);
    const all = await http.req<AdminAuditPage>('GET', '/admin/audit?scope=all', { token: owner.token });
    expect(all.body.entries.some((e) => e.action === 'member.join' && e.targetId === alice.id)).toBe(true);
  });
});

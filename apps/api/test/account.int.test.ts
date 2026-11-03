/** Privacidade e dados (ADR-0039): aceite no cadastro, aceite tardio, exportar meus dados, excluir conta, expurgo. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthResponse, Me, ServerSummary } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetentionService } from '../src/users/retention.service.js';
import { bootstrapOwner, Http, prisma, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('aceite dos termos', () => {
  it('cadastro e apelido exigem acceptTerms; quem aceitou tem termsAccepted e a data gravada', async () => {
    await bootstrapOwner(http);
    const sem = await http.req<{ message: string }>('POST', '/auth/register', {
      body: { nickname: 'SemAceite', password: 'password-123456' },
    });
    expect(sem.status).toBe(400);
    const semGuest = await http.req('POST', '/auth/guest', { body: { nickname: 'SemAceite2', acceptTerms: false } });
    expect(semGuest.status).toBe(400);
    const ok = await http.req<AuthResponse>('POST', '/auth/guest', {
      body: { nickname: 'ComAceite', acceptTerms: true },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.user.termsAccepted).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ok.body.user.id } });
    expect(row.termsAcceptedAt).not.toBeNull();
  });

  it('conta anterior à regra vê termsAccepted=false e aceita depois', async () => {
    await bootstrapOwner(http);
    const u = await register(http, 'Antiga');
    await prisma.user.update({ where: { id: u.id }, data: { termsAcceptedAt: null } });
    const me = await http.req<Me>('GET', '/me', { token: u.token });
    expect(me.body.termsAccepted).toBe(false);
    expect((await http.req('POST', '/me/accept-terms', { token: u.token })).status).toBe(204);
    expect((await http.req<Me>('GET', '/me', { token: u.token })).body.termsAccepted).toBe(true);
  });
});

describe('meus dados', () => {
  it('exporta conta, sessões, servidores, conversas e mensagens em JSON', async () => {
    const { owner } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const conv = await http.req<{ id: string }>('POST', '/conversations', {
      token: ana.token,
      body: { userIds: [owner.id] },
    });
    for (let i = 0; i < 3; i++) {
      const m = await http.req('POST', `/conversations/${conv.body.id}/messages`, {
        token: ana.token,
        body: { requestId: rid(), body: `oi ${i}` },
      });
      expect(m.status).toBe(201);
    }
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/me/export', headers: { authorization: `Bearer ${ana.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/opencord-meus-dados-.*\.json/);
    const data = JSON.parse(res.body) as {
      conta: { apelido: string; termosAceitosEm: string | null };
      sessoes: { ip: string | null }[];
      servidores: { nome: string }[];
      conversas: { participantes: { apelido: string }[] }[];
      mensagens: { texto: string }[];
    };
    expect(data.conta.apelido).toBe('Ana');
    expect(data.conta.termosAceitosEm).not.toBeNull();
    expect(data.sessoes.length).toBeGreaterThanOrEqual(1);
    expect(data.servidores.map((s) => s.nome)).toContain('Teste');
    expect(data.conversas[0]?.participantes.map((p) => p.apelido).sort()).toEqual(['Ana', owner.nickname].sort());
    expect(data.mensagens.map((m) => m.texto)).toEqual(['oi 0', 'oi 1', 'oi 2']);
  });
});

describe('excluir conta', () => {
  it('exige a senha, anonimiza, derruba sessões, passa o servidor ao membro mais antigo e apaga o que é só da pessoa', async () => {
    const { owner } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    // servidor da Ana com o Bruno dentro; outro só dela
    const s1 = await http.req<ServerSummary & { channels: { id: string; kind: string }[] }>('POST', '/servers', {
      token: ana.token,
      body: { name: 'Clube' },
    });
    const invite = await http.req<{ code: string }>('POST', `/servers/${s1.body.id}/invites`, { token: ana.token });
    expect((await http.req('POST', `/invites/${invite.body.code}`, { token: bruno.token })).status).toBe(201);
    const s2 = await http.req<ServerSummary>('POST', '/servers', { token: ana.token, body: { name: 'Sozinha' } });
    // mensagem num canal e DM com o Bruno
    const conv = await http.req<{ id: string }>('POST', '/conversations', {
      token: ana.token,
      body: { userIds: [bruno.id] },
    });
    const dm = await http.req<{ id: string }>('POST', `/conversations/${conv.body.id}/messages`, {
      token: ana.token,
      body: { requestId: rid(), body: 'segredo' },
    });
    expect(dm.status).toBe(201);
    await http.req('POST', '/friends/requests', { token: ana.token, body: { username: bruno.auth.user.username } });

    expect((await http.req<{ message: string }>('POST', '/me/delete', { token: ana.token, body: {} })).status).toBe(
      400,
    );
    expect(
      (await http.req('POST', '/me/delete', { token: ana.token, body: { password: 'errada-errada-1' } })).status,
    ).toBe(400);
    const ok = await http.req('POST', '/me/delete', { token: ana.token, body: { password: 'password-123456' } });
    expect(ok.status).toBe(204);

    // sessão caiu e o login não volta
    expect((await http.req('GET', '/me', { token: ana.token })).status).toBe(401);
    expect(
      (await http.req('POST', '/auth/login', { body: { login: 'Ana', password: 'password-123456' } })).status,
    ).toBe(401);
    // linha anonimizada; apelido liberado para outra pessoa
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ana.id } });
    expect(row).toMatchObject({ email: null, displayName: 'Usuário removido', nickKey: null, passwordHash: null });
    expect(row.deletedAt).not.toBeNull();
    expect(row.username).toMatch(/^removido_[0-9a-f]{8}$/);
    expect((await http.req('POST', '/auth/guest', { body: { nickname: 'Ana', acceptTerms: true } })).status).toBe(201);
    // servidores: Clube passou ao Bruno, Sozinha sumiu
    expect((await prisma.server.findUniqueOrThrow({ where: { id: s1.body.id } })).ownerId).toBe(bruno.id);
    expect(await prisma.server.findUnique({ where: { id: s2.body.id } })).toBeNull();
    expect(await prisma.serverMember.count({ where: { userId: ana.id } })).toBe(0);
    // a mensagem fica para o Bruno, assinada pelo usuário removido
    const msgs = await http.req<{ messages: { id: string; author: { displayName: string } }[] }>(
      'GET',
      `/conversations/${conv.body.id}/messages`,
      { token: bruno.token },
    );
    expect(msgs.body.messages.find((m) => m.id === dm.body.id)?.author.displayName).toBe('Usuário removido');
    // o que era só dela foi embora
    expect(await prisma.session.count({ where: { userId: ana.id } })).toBe(0);
    expect(await prisma.friendship.count({ where: { requesterId: ana.id } })).toBe(0);
    expect(await prisma.conversationMember.count({ where: { userId: ana.id } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: 'user.delete', actorId: ana.id } });
    expect(log).not.toBeNull();
    // quem criou a instância não exclui pelo app
    const creator = await http.req<{ message: string }>('POST', '/me/delete', {
      token: owner.token,
      body: { password: 'owner-password-123' },
    });
    expect(creator.status).toBe(400);
    expect(creator.body.message).toMatch(/servidor oficial/);
  });

  it('identidade só com apelido exclui sem senha', async () => {
    await bootstrapOwner(http);
    const g = await http.req<AuthResponse>('POST', '/auth/guest', {
      body: { nickname: 'Passante', acceptTerms: true },
    });
    expect((await http.req('POST', '/me/delete', { token: g.body.tokens.accessToken, body: {} })).status).toBe(204);
    expect((await http.req('GET', '/me', { token: g.body.tokens.accessToken })).status).toBe(401);
  });
});

describe('expurgo automático', () => {
  it('apaga sessões antigas, auditoria, casos decididos e bloqueios de dispositivo vencidos; mantém o resto', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const old = new Date(Date.now() - 400 * 86_400_000);
    const recent = new Date(Date.now() - 10 * 86_400_000);
    const fam = rid();
    await prisma.session.createMany({
      data: [
        { userId: owner.id, refreshTokenHash: 'a1', familyId: fam, expiresAt: old, revokedAt: old, createdAt: old },
        { userId: owner.id, refreshTokenHash: 'a2', familyId: fam, expiresAt: recent, revokedAt: recent },
        { userId: owner.id, refreshTokenHash: 'a3', familyId: fam, expiresAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    await prisma.auditLog.createMany({
      data: [
        { actorId: owner.id, serverId, action: 'x.old', createdAt: old },
        { actorId: owner.id, serverId, action: 'x.new', createdAt: recent },
      ],
    });
    await prisma.moderationCase.createMany({
      data: [
        {
          authorId: owner.id,
          serverId,
          requestId: rid(),
          body: 'a',
          verdict: 'review',
          reason: 'r',
          status: 'rejected',
          createdAt: old,
        },
        {
          authorId: owner.id,
          serverId,
          requestId: rid(),
          body: 'b',
          verdict: 'review',
          reason: 'r',
          status: 'pending',
          createdAt: old,
        },
      ],
    });
    await prisma.deviceBan.createMany({
      data: [
        { kind: 'ip', value: '10.0.0.1', createdAt: old },
        { kind: 'ip', value: '10.0.0.2', createdAt: recent },
      ],
    });
    const r = await app.get(RetentionService).sweep();
    expect(r).toEqual({ sessions: 1, audit: 1, moderationCases: 1, deviceBans: 1 });
    expect(
      await prisma.session.count({ where: { userId: owner.id, refreshTokenHash: { in: ['a1', 'a2', 'a3'] } } }),
    ).toBe(2);
    expect((await prisma.auditLog.findMany({ where: { action: { startsWith: 'x.' } } })).map((a) => a.action)).toEqual([
      'x.new',
    ]);
    expect((await prisma.moderationCase.findMany()).map((c) => c.status)).toEqual(['pending']);
    expect((await prisma.deviceBan.findMany()).map((b) => b.value)).toEqual(['10.0.0.2']);
  });
});

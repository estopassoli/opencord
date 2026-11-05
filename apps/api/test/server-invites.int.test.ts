/** Configurações do servidor, leva 3 (ADR-0050): convites com validade/limite, lista, apagar, entradas e filtros da auditoria. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuditEntry, Invite, MemberJoin, ServerInvite } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, outsider, prisma, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('convites, entradas e auditoria do servidor', () => {
  it('limite de usos, validade, lista, apagar, quem convidou e filtros', async () => {
    const { owner, serverId } = await bootstrapOwner(http);

    // sem corpo: sempre o mesmo convite permanente
    const a = await http.req<Invite>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    const b = await http.req<Invite>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    expect(a.body.code).toBe(b.body.code);

    // com limite: convite novo que esgota no primeiro uso
    const once = await http.req<Invite>('POST', `/servers/${serverId}/invites`, {
      token: owner.token,
      body: { maxUses: 1 },
    });
    expect(once.body.code).not.toBe(a.body.code);
    const bia = await outsider(http);
    expect((await http.req('POST', `/invites/${once.body.code}`, { token: bia.token })).status).toBe(201);
    const caio = await outsider(http);
    expect((await http.req('POST', `/invites/${once.body.code}`, { token: caio.token })).status).toBe(404);
    expect((await http.req('GET', `/invites/${once.body.code}`, { token: caio.token })).status).toBe(404);

    // validade fora da lista é recusada; vencido não abre
    expect(
      (await http.req('POST', `/servers/${serverId}/invites`, { token: owner.token, body: { maxAgeSec: 7 } })).status,
    ).toBe(400);
    const day = await http.req<Invite>('POST', `/servers/${serverId}/invites`, {
      token: owner.token,
      body: { maxAgeSec: 86400 },
    });
    await prisma.invite.update({ where: { code: day.body.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http.req('POST', `/invites/${day.body.code}`, { token: caio.token })).status).toBe(404);

    // lista para quem gerencia; membro comum não vê
    const list = await http.req<ServerInvite[]>('GET', `/servers/${serverId}/invites`, { token: owner.token });
    expect(list.status).toBe(200);
    expect(list.body.find((i) => i.code === once.body.code)).toMatchObject({ uses: 1, maxUses: 1 });
    expect(list.body.find((i) => i.code === day.body.code)?.expiresAt).toBeTruthy();
    expect(list.body[0]!.creator?.id).toBe(owner.id);
    expect((await http.req('GET', `/servers/${serverId}/invites`, { token: bia.token })).status).toBe(403);

    // quem entrou por qual convite
    const joins = await http.req<MemberJoin[]>('GET', `/servers/${serverId}/members/joins`, { token: owner.token });
    expect(joins.body).toContainEqual({ userId: bia.id, inviteCode: once.body.code, inviterId: owner.id });

    // apagar: membro comum não apaga convite de outro; quem gerencia apaga
    expect((await http.req('DELETE', `/invites/${a.body.code}`, { token: bia.token })).status).toBe(403);
    expect((await http.req('DELETE', `/invites/${a.body.code}`, { token: owner.token })).status).toBe(204);
    expect((await http.req('GET', `/invites/${a.body.code}`, { token: caio.token })).status).toBe(404);

    // auditoria filtrada por tipo de ação e por autor
    const inv = await http.req<AuditEntry[]>('GET', `/servers/${serverId}/audit-log?action=invite`, {
      token: owner.token,
    });
    expect(inv.body.length).toBeGreaterThanOrEqual(4);
    expect(inv.body.every((e) => e.action.startsWith('invite.'))).toBe(true);
    expect(inv.body.some((e) => e.action === 'invite.delete')).toBe(true);
    const byBia = await http.req<AuditEntry[]>('GET', `/servers/${serverId}/audit-log?actorId=${bia.id}`, {
      token: owner.token,
    });
    expect(byBia.body.every((e) => e.actorId === bia.id)).toBe(true);
  });
});

/** Insígnias (ADR-0043): catálogo do super admin, atribuição a usuários e exibição em UserPublic/InstanceInfo. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AdminUser, Badge, InstanceInfo, Message, ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadgesService } from '../src/admin/badges.service.js';
import { bootstrapOwner, Http, prisma, register, resetDb, rid, startApp, tinyPng } from './helpers.js';
import { TEST_API_PORT } from './env.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  await app.get(BadgesService).reload();
});

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  await prisma.user.update({ where: { id: owner.id }, data: { isInstanceAdmin: true } });
  const ana = await register(http, 'Ana');
  return { owner, ana, serverId };
}

describe('insígnias', () => {
  it('super admin cria, atribui, troca a imagem e apaga; todo mundo vê no perfil e no catálogo', async () => {
    const { owner, ana, serverId } = await setup();
    // só super admin
    expect((await http.req('POST', '/admin/badges', { token: ana.token, body: { name: 'Hacker' } })).status).toBe(404);

    const tester = await http.req<Badge>('POST', '/admin/badges', {
      token: owner.token,
      body: { name: 'Testador', description: 'Ajudou a testar o app', icon: 'bug', color: '#22aa66' },
    });
    expect(tester.status).toBe(201);
    expect(tester.body).toMatchObject({ name: 'Testador', icon: 'bug', color: '#22aa66', imageKey: null });
    const founder = await http.req<Badge>('POST', '/admin/badges', { token: owner.token, body: { name: 'Fundador' } });
    expect(founder.body.icon).toBe('star');
    expect(
      (await http.req('POST', '/admin/badges', { token: owner.token, body: { name: 'x', color: 'vermelho' } })).status,
    ).toBe(400);

    const info = await http.req<InstanceInfo>('GET', '/auth/instance');
    expect(info.body.badges.map((b) => b.name)).toEqual(['Testador', 'Fundador']);

    // atribuir: a ordem segue o catálogo
    const set = await http.req<AdminUser>('PUT', `/admin/users/${ana.id}/badges`, {
      token: owner.token,
      body: { badgeIds: [founder.body.id, tester.body.id] },
    });
    expect(set.status).toBe(200);
    expect(set.body.badges).toEqual([tester.body.id, founder.body.id]);
    expect(
      (
        await http.req('PUT', `/admin/users/${ana.id}/badges`, {
          token: owner.token,
          body: { badgeIds: ['00000000-0000-7000-8000-000000000000'] },
        })
      ).status,
    ).toBe(400);

    // aparece para os outros: lista de membros e autor da mensagem
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(d.body.members.find((m) => m.user.id === ana.id)!.user.badges).toEqual([tester.body.id, founder.body.id]);
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    const msg = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: ana.token,
      body: { requestId: rid(), body: 'oi' },
    });
    expect(msg.body.author.badges).toEqual([tester.body.id, founder.body.id]);
    // quem não tem insígnia não leva o campo
    expect(d.body.members.find((m) => m.user.id === owner.id)!.user.badges).toBeUndefined();

    // imagem no lugar do ícone
    const form = new FormData();
    form.append('file', new Blob([tinyPng(32, 32)], { type: 'image/png' }), 'b.png');
    const up = await fetch(`http://127.0.0.1:${TEST_API_PORT}/admin/badges/${tester.body.id}/image`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: form,
    });
    expect(up.status).toBe(201);
    const key = ((await up.json()) as Badge).imageKey!;
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/badge-images/${key}`)).status).toBe(200);
    const edited = await http.req<Badge>('PATCH', `/admin/badges/${tester.body.id}`, {
      token: owner.token,
      body: { name: 'Beta tester' },
    });
    expect(edited.body).toMatchObject({ name: 'Beta tester', imageKey: key });

    // apagar tira de todo mundo e some a imagem
    expect((await http.req('DELETE', `/admin/badges/${tester.body.id}`, { token: owner.token })).status).toBe(204);
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/badge-images/${key}`)).status).toBe(404);
    const after = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(after.body.members.find((m) => m.user.id === ana.id)!.user.badges).toEqual([founder.body.id]);
    // tirar todas
    const none = await http.req<AdminUser>('PUT', `/admin/users/${ana.id}/badges`, {
      token: owner.token,
      body: { badgeIds: [] },
    });
    expect(none.body.badges).toBeUndefined();
  });
});

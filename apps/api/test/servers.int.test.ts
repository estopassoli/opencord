import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type Channel,
  type Invite,
  type InvitePreview,
  type Role,
  type ServerDirectoryEntry,
  type ServerDetail,
} from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, outsider, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http, `alice_${Date.now()}`);
  const out = await outsider(http);
  return { ...b, alice, outsider: out };
}

describe('servidores e RBAC (RF-02, RF-10)', () => {
  it('não membro recebe 404 (não revela existência)', async () => {
    const { serverId, outsider } = await setup();
    expect((await http.req('GET', `/servers/${serverId}`, { token: outsider.token })).status).toBe(404);
    const channel = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
    expect((await http.req('GET', `/channels/${channel.id}/messages`, { token: outsider.token })).status).toBe(404);
  });

  it('lista servidores do usuário e detalhe com canais/cargos/membros', async () => {
    const { serverId, alice } = await setup();
    const list = await http.req<{ id: string }[]>('GET', '/servers', { token: alice.token });
    expect(list.body.map((s) => s.id)).toEqual([serverId]);
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: alice.token });
    expect(d.body.channels.map((c) => c.kind).sort()).toEqual(['text', 'voice']);
    expect(d.body.roles.find((r) => r.isEveryone)).toBeTruthy();
    expect(d.body.members).toHaveLength(2);
    // membro comum não vê overrides de canal
    expect(d.body.channels.every((c) => c.overrides.length === 0)).toBe(true);
  });

  it('criar canal exige MANAGE_CHANNELS', async () => {
    const { serverId, alice, owner } = await setup();
    expect(
      (
        await http.req('POST', `/servers/${serverId}/channels`, {
          token: alice.token,
          body: { name: 'x', kind: 'text' },
        })
      ).status,
    ).toBe(403);
    const ok = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'Bate Papo', kind: 'text' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe('bate-papo');
  });

  it('override nega VIEW_CHANNEL para @everyone e libera para um cargo', async () => {
    const { serverId, alice, owner } = await setup();
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    const priv = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'staff', kind: 'text' },
    });
    const upd = await http.req('PATCH', `/channels/${priv.body.id}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL }] },
    });
    expect(upd.status).toBe(200);
    let view = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: alice.token });
    expect(view.body.channels.find((c) => c.id === priv.body.id)).toBeUndefined();
    expect((await http.req('GET', `/channels/${priv.body.id}/messages`, { token: alice.token })).status).toBe(404);

    const staff = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Staff', permissions: 0 },
    });
    await http.req('PATCH', `/channels/${priv.body.id}`, {
      token: owner.token,
      body: {
        overrides: [
          { subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL },
          { subjectType: 'role', subjectId: staff.body.id, allow: Permission.VIEW_CHANNEL, deny: 0 },
        ],
      },
    });
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/members/${alice.id}/roles`, {
          token: owner.token,
          body: { roleIds: [staff.body.id] },
        })
      ).status,
    ).toBe(200);
    view = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: alice.token });
    expect(view.body.channels.find((c) => c.id === priv.body.id)).toBeTruthy();
    expect((await http.req('GET', `/channels/${priv.body.id}/messages`, { token: alice.token })).status).toBe(200);
  });

  it('hierarquia: moderador não edita cargo igual/superior nem concede bits que não tem', async () => {
    const { serverId, alice, owner } = await setup();
    const mod = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Mod', permissions: Permission.MANAGE_ROLES | Permission.KICK_MEMBERS },
    });
    const admin = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Admin', permissions: Permission.ADMINISTRATOR },
    });
    expect(admin.body.position).toBeGreaterThan(mod.body.position);
    await http.req('PUT', `/servers/${serverId}/members/${alice.id}/roles`, {
      token: owner.token,
      body: { roleIds: [mod.body.id] },
    });
    // alice (Mod) tenta se promover a Admin
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/members/${alice.id}/roles`, {
          token: alice.token,
          body: { roleIds: [mod.body.id, admin.body.id] },
        })
      ).status,
    ).toBe(403);
    // alice tenta criar cargo com ADMINISTRATOR
    expect(
      (
        await http.req('POST', `/servers/${serverId}/roles`, {
          token: alice.token,
          body: { name: 'x', permissions: Permission.ADMINISTRATOR },
        })
      ).status,
    ).toBe(403);
    // alice tenta expulsar o owner
    expect((await http.req('DELETE', `/servers/${serverId}/members/${owner.id}`, { token: alice.token })).status).toBe(
      403,
    );
    // alice pode expulsar membro sem cargo
    const bob = await register(http);
    expect((await http.req('DELETE', `/servers/${serverId}/members/${bob.id}`, { token: alice.token })).status).toBe(
      204,
    );
    expect((await http.req('GET', `/servers/${serverId}`, { token: bob.token })).status).toBe(404);
    const log = await prisma.auditLog.findFirst({ where: { serverId, action: 'member.kick', targetId: bob.id } });
    expect(log?.actorId).toBe(alice.id);
  });

  it('owner não pode sair; membro sai e perde acesso', async () => {
    const { serverId, alice, owner } = await setup();
    expect((await http.req('POST', `/servers/${serverId}/leave`, { token: owner.token })).status).toBe(400);
    expect((await http.req('POST', `/servers/${serverId}/leave`, { token: alice.token })).status).toBe(204);
    expect((await http.req('GET', `/servers/${serverId}`, { token: alice.token })).status).toBe(404);
  });

  it('servidores abertos: diretório lista todos e entrar não exige convite', async () => {
    const { serverId, outsider: out } = await setup();
    const dir = await http.req<ServerDirectoryEntry[]>('GET', '/servers/directory', { token: out.token });
    expect(dir.body.find((d) => d.id === serverId)).toMatchObject({ joined: false, name: 'Teste' });
    const joined = await http.req<ServerDetail>('POST', `/servers/${serverId}/join`, { token: out.token });
    expect(joined.status).toBe(201);
    expect(joined.body.id).toBe(serverId);
    // idempotente
    expect((await http.req('POST', `/servers/${serverId}/join`, { token: out.token })).status).toBe(201);
    const dir2 = await http.req<ServerDirectoryEntry[]>('GET', '/servers/directory', { token: out.token });
    expect(dir2.body.find((d) => d.id === serverId)?.joined).toBe(true);
    expect(
      (await http.req('POST', '/servers/00000000-0000-7000-8000-000000000000/join', { token: out.token })).status,
    ).toBe(404);
  });

  it('servidor criado por usuário é privado: só o dono, fora do diretório e sem entrada direta', async () => {
    const { alice, serverId } = await setup();
    const created = await http.req<ServerDetail>('POST', '/servers', { token: alice.token, body: { name: 'Privado' } });
    expect(created.body.official).toBe(false);
    expect(created.body.members.map((m) => m.user.id)).toEqual([alice.id]);
    const late = await register(http);
    const mine = await http.req<{ id: string; official: boolean }[]>('GET', '/servers', { token: late.token });
    expect(mine.body.map((x) => x.id)).not.toContain(created.body.id);
    // o oficial continua com entrada automática
    expect(mine.body.find((x) => x.id === serverId)?.official).toBe(true);
    const dir = await http.req<ServerDirectoryEntry[]>('GET', '/servers/directory', { token: late.token });
    expect(dir.body.map((d) => d.id)).not.toContain(created.body.id);
    expect((await http.req('POST', `/servers/${created.body.id}/join`, { token: late.token })).status).toBe(404);
    expect((await http.req('GET', `/servers/${created.body.id}`, { token: late.token })).status).toBe(404);
  });

  it('convite: membro gera código, outra pessoa vê a prévia e entra; código inválido é 404', async () => {
    const { alice } = await setup();
    const created = await http.req<ServerDetail>('POST', '/servers', { token: alice.token, body: { name: 'Amigos' } });
    const sid = created.body.id;
    const inv = await http.req<Invite>('POST', `/servers/${sid}/invites`, { token: alice.token });
    expect(inv.status).toBe(201);
    expect(inv.body.code).toMatch(/^[A-Za-z0-9]{10}$/);
    // link de convite: PUBLIC_APP_URL/invite/<código>
    expect(inv.body.url).toBe(`http://localhost:5173/invite/${inv.body.code}`);
    // a mesma pessoa recebe o mesmo código
    expect((await http.req<Invite>('POST', `/servers/${sid}/invites`, { token: alice.token })).body.code).toBe(
      inv.body.code,
    );
    const bob = await register(http);
    // quem não é membro não gera convite
    expect((await http.req('POST', `/servers/${sid}/invites`, { token: bob.token })).status).toBe(404);
    const pre = await http.req<InvitePreview>('GET', `/invites/${inv.body.code}`, { token: bob.token });
    expect(pre.body).toMatchObject({
      server: { id: sid, name: 'Amigos', official: false },
      memberCount: 1,
      joined: false,
    });
    const joined = await http.req<ServerDetail>('POST', `/invites/${inv.body.code}`, { token: bob.token });
    expect(joined.status).toBe(201);
    expect(joined.body.members.map((m) => m.user.id).sort()).toEqual([alice.id, bob.id].sort());
    // idempotente e conta usos só uma vez
    expect((await http.req('POST', `/invites/${inv.body.code}`, { token: bob.token })).status).toBe(201);
    expect((await prisma.invite.findUnique({ where: { code: inv.body.code } }))?.uses).toBe(1);
    expect((await http.req('GET', '/invites/AAAAAAAAAA', { token: bob.token })).status).toBe(404);
    expect((await http.req('GET', '/invites/../x', { token: bob.token })).status).toBe(404);
  });

  it('expulsar ainda funciona como moderação (removido pode voltar pelo diretório)', async () => {
    const { serverId, owner, alice } = await setup();
    expect((await http.req('DELETE', `/servers/${serverId}/members/${alice.id}`, { token: owner.token })).status).toBe(
      204,
    );
    expect((await http.req('GET', `/servers/${serverId}`, { token: alice.token })).status).toBe(404);
    expect((await http.req('POST', `/servers/${serverId}/join`, { token: alice.token })).status).toBe(201);
  });

  it('owner exclui servidor; outros perdem acesso', async () => {
    const { serverId, owner, alice } = await setup();
    expect((await http.req('DELETE', `/servers/${serverId}`, { token: alice.token })).status).toBe(403);
    expect((await http.req('DELETE', `/servers/${serverId}`, { token: owner.token })).status).toBe(204);
    expect((await http.req('GET', `/servers/${serverId}`, { token: alice.token })).status).toBe(404);
  });

  it('criar servidor gera @everyone, categorias e canais', async () => {
    const { alice } = await setup();
    const r = await http.req<ServerDetail>('POST', '/servers', { token: alice.token, body: { name: 'Meu' } });
    expect(r.status).toBe(201);
    expect(r.body.ownerId).toBe(alice.id);
    expect(r.body.channels).toHaveLength(2);
    expect(r.body.categories).toHaveLength(2);
  });

  it('audit log exige VIEW_AUDIT_LOG', async () => {
    const { serverId, owner, alice } = await setup();
    expect((await http.req('GET', `/servers/${serverId}/audit-log`, { token: alice.token })).status).toBe(403);
    const r = await http.req<unknown[]>('GET', `/servers/${serverId}/audit-log`, { token: owner.token });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
  });
});

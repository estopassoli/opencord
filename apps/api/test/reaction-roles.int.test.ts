/** Cargos por reação (ADR-0019): configurar exige MANAGE_ROLES e cargo seguro; reagir dá, tirar a reação tira. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, type Message, type Role, type ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, prisma, register, resetDb, rid, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const alice = await register(http);
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
  const mk = (name: string, permissions = 0) =>
    http.req<Role>('POST', `/servers/${serverId}/roles`, { token: owner.token, body: { name, permissions } });
  const gamer = (await mk('Gamer')).body;
  const mod = (await mk('Mod', Permission.KICK_MEMBERS)).body;
  const msg = await http.req<Message>('POST', `/channels/${channel.id}/messages`, {
    token: owner.token,
    body: { requestId: rid(), body: 'Escolha seus cargos' },
  });
  return { owner, alice, serverId, channelId: channel.id, gamer, mod, messageId: msg.body.id };
}

const rolesOf = async (serverId: string, userId: string) =>
  (await prisma.memberRole.findMany({ where: { serverId, userId } })).map((r) => r.roleId);

describe('cargos por reação', () => {
  it('reagir dá o cargo, tirar a reação tira; a mensagem mostra a configuração', async () => {
    const { owner, alice, serverId, gamer, messageId } = await setup();
    const set = await http.req<Message>('PUT', `/messages/${messageId}/reaction-roles`, {
      token: owner.token,
      body: { pairs: [{ emoji: '🎮', roleId: gamer.id }] },
    });
    expect(set.status).toBe(200);
    expect(set.body.reactionRoles).toEqual([{ emoji: '🎮', roleId: gamer.id }]);

    const react = (on: boolean) =>
      http.req(on ? 'PUT' : 'DELETE', `/messages/${messageId}/reactions/${encodeURIComponent('🎮')}`, {
        token: alice.token,
      });
    expect((await react(true)).status).toBeLessThan(300);
    expect(await rolesOf(serverId, alice.id)).toEqual([gamer.id]);
    // o cargo aparece no detalhe do servidor para todos
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(d.body.members.find((m) => m.user.id === alice.id)?.roleIds).toEqual([gamer.id]);
    expect((await react(false)).status).toBeLessThan(300);
    expect(await rolesOf(serverId, alice.id)).toEqual([]);
    // emoji sem cargo ligado: só reação
    await http.req('PUT', `/messages/${messageId}/reactions/${encodeURIComponent('🔥')}`, { token: alice.token });
    expect(await rolesOf(serverId, alice.id)).toEqual([]);
  });

  it('só quem gerencia cargos configura; cargo com poder de moderação é recusado', async () => {
    const { owner, alice, gamer, mod, messageId } = await setup();
    expect(
      (
        await http.req('PUT', `/messages/${messageId}/reaction-roles`, {
          token: alice.token,
          body: { pairs: [{ emoji: '🎮', roleId: gamer.id }] },
        })
      ).status,
    ).toBe(403);
    const bad = await http.req<{ message: string }>('PUT', `/messages/${messageId}/reaction-roles`, {
      token: owner.token,
      body: { pairs: [{ emoji: '🛡️', roleId: mod.id }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/moderação/);
    expect(
      (
        await http.req('PUT', `/messages/${messageId}/reaction-roles`, {
          token: owner.token,
          body: {
            pairs: [
              { emoji: '🎮', roleId: gamer.id },
              { emoji: '🎮', roleId: gamer.id },
            ],
          },
        })
      ).status,
    ).toBe(400);
  });
});

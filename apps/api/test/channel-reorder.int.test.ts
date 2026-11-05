/** Arrastar canais na lista (ADR-0050): PUT /servers/:id/channels/order grava categoria e posição pela ordem enviada. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Category, Channel, ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, outsider, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('ordem dos canais', () => {
  it('reordena, muda de categoria e recusa quem não gerencia', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const cat = await http.req<Category>('POST', `/servers/${serverId}/categories`, {
      token: owner.token,
      body: { name: 'Jogos' },
    });
    const mk = async (name: string, categoryId: string | null) =>
      (
        await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
          token: owner.token,
          body: { name, kind: 'text', categoryId },
        })
      ).body;
    const a = await mk('a', cat.body.id);
    const b = await mk('b', cat.body.id);
    const c = await mk('c', null);

    const r = await http.req('PUT', `/servers/${serverId}/channels/order`, {
      token: owner.token,
      body: { categoryId: cat.body.id, channelIds: [c.id, b.id, a.id] },
    });
    expect(r.status).toBe(204);
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const inCat = d.body.channels
      .filter((x) => x.categoryId === cat.body.id)
      .sort((x, y) => x.position - y.position)
      .map((x) => x.name);
    expect(inCat).toEqual(['c', 'b', 'a']);

    // canal de outro servidor, repetido ou categoria alheia: 400
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/channels/order`, {
          token: owner.token,
          body: { categoryId: cat.body.id, channelIds: [a.id, a.id] },
        })
      ).status,
    ).toBe(400);
    const other = await bootstrapOwner(http);
    const foreign = (
      await http.req<Channel>('POST', `/servers/${other.serverId}/channels`, {
        token: other.owner.token,
        body: { name: 'x', kind: 'text' },
      })
    ).body;
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/channels/order`, {
          token: owner.token,
          body: { categoryId: null, channelIds: [foreign.id] },
        })
      ).status,
    ).toBe(400);

    // membro comum não reordena
    const bia = await outsider(http);
    const inv = await http.req<{ code: string }>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    await http.req('POST', `/invites/${inv.body.code}`, { token: bia.token });
    expect(
      (
        await http.req('PUT', `/servers/${serverId}/channels/order`, {
          token: bia.token,
          body: { categoryId: null, channelIds: [a.id] },
        })
      ).status,
    ).toBe(403);
  });
});

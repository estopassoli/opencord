/** Configurações do servidor, parte 2 (ADR-0050): perfil, engajamento (boas-vindas), imagens e convites pausados. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Invite, MessagePage, ServerDetail, ServerSummary } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, outsider, resetDb, startApp, tinyPng } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('perfil e engajamento do servidor', () => {
  it('descrição, características e faixa; boas-vindas no canal do sistema; convites pausados', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    const voice = d.body.channels.find((c) => c.kind === 'voice')!;

    const r = await http.req<ServerSummary>('PATCH', `/servers/${serverId}`, {
      token: owner.token,
      body: {
        description: 'Servidor da galera do rinha',
        traits: [
          { emoji: '🎮', label: 'Jogos' },
          { emoji: '🎵', label: 'Música' },
        ],
        bannerColor: 'rosa',
        systemChannelId: text.id,
        welcomeEnabled: true,
        defaultNotify: 'mentions',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      description: 'Servidor da galera do rinha',
      traits: [
        { emoji: '🎮', label: 'Jogos' },
        { emoji: '🎵', label: 'Música' },
      ],
      bannerColor: 'rosa',
      systemChannelId: text.id,
      welcomeEnabled: true,
      defaultNotify: 'mentions',
    });
    // canal do sistema precisa ser de texto; no máximo 5 características; cor fora da lista recusada
    expect(
      (await http.req('PATCH', `/servers/${serverId}`, { token: owner.token, body: { systemChannelId: voice.id } }))
        .status,
    ).toBe(400);
    expect(
      (
        await http.req('PATCH', `/servers/${serverId}`, {
          token: owner.token,
          body: { traits: Array.from({ length: 6 }, (_, i) => ({ emoji: '⭐', label: `t${i}` })) },
        })
      ).status,
    ).toBe(400);
    expect(
      (await http.req('PATCH', `/servers/${serverId}`, { token: owner.token, body: { bannerColor: 'xadrez' } })).status,
    ).toBe(400);

    // faixa com imagem: servida em /server-banners
    const form = new FormData();
    form.append('file', new Blob([tinyPng(64, 32)], { type: 'image/png' }), 'b.png');
    const up = await fetch(`http://127.0.0.1:${TEST_API_PORT}/servers/${serverId}/banner`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: form,
    });
    expect(up.status).toBe(201);
    const key = ((await up.json()) as ServerSummary).bannerKey!;
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/server-banners/${key}`)).status).toBe(200);

    // alguém entra pelo convite: boas-vindas com menção no canal do sistema
    const inv = await http.req<Invite>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    const bia = await outsider(http);
    expect((await http.req('POST', `/invites/${inv.body.code}`, { token: bia.token })).status).toBe(201);
    await new Promise((res) => setTimeout(res, 200));
    const page = await http.req<MessagePage>('GET', `/channels/${text.id}/messages`, { token: owner.token });
    const welcome = page.body.messages.at(-1)!;
    expect(welcome.body).toContain(`<@${bia.id}>`);
    expect(welcome.author).toMatchObject({ displayName: 'OpenCord', system: true });

    // convites pausados: ninguém entra
    await http.req('PATCH', `/servers/${serverId}`, { token: owner.token, body: { invitesPaused: true } });
    const caio = await outsider(http);
    const paused = await http.req<{ message: string }>('POST', `/invites/${inv.body.code}`, { token: caio.token });
    expect(paused.status).toBe(400);
    expect(paused.body.message).toMatch(/pausados/);
  });
});

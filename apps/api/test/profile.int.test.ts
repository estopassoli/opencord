/** Personalização do perfil (ADR-0048): bio, cores, banner (enviado ou KLIPY), foto por KLIPY e fotos recentes. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Me, ProfileUpdateResponse, RecentAvatar, ServerDetail, UserProfile } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, register, resetDb, startApp, tinyPng } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const GIF = 'https://static.klipy.com/ii/abc/um0L4dFH.gif';
const GIF2 = 'https://static.klipy.com/ii/abc/outro.gif';

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const upload = async (token: string, path: string, side = 32) => {
  const form = new FormData();
  form.append('file', new Blob([tinyPng(side, side)], { type: 'image/png' }), 'a.png');
  return fetch(`http://127.0.0.1:${TEST_API_PORT}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
};

describe('perfil', () => {
  it('bio, cores e banner aparecem no perfil visto por quem divide servidor', async () => {
    const { owner } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const r = await http.req<ProfileUpdateResponse>('PATCH', '/me/profile', {
      token: ana.token,
      body: { bio: '  oi, eu jogo **muito**  ', colors: ['#FF0000', '#220000'], bannerUrl: GIF },
    });
    expect(r.status).toBe(200);
    expect(r.body.appearance).toEqual({
      bio: 'oi, eu jogo **muito**',
      bannerKey: null,
      bannerUrl: GIF,
      colors: ['#ff0000', '#220000'],
    });
    // URL que não é do KLIPY: recusada (não vira rastreador de IP de quem abre o perfil)
    expect(
      (await http.req('PATCH', '/me/profile', { token: ana.token, body: { bannerUrl: 'https://evil.test/x.gif' } }))
        .status,
    ).toBe(400);
    expect((await http.req('PATCH', '/me/profile', { token: ana.token, body: { bio: 'x'.repeat(191) } })).status).toBe(
      400,
    );

    const seen = await http.req<UserProfile>('GET', `/users/${ana.id}/profile`, { token: owner.token });
    expect(seen.body.appearance).toMatchObject({ bio: 'oi, eu jogo **muito**', bannerUrl: GIF });

    // banner enviado tira o do KLIPY e é servido; apagar some com o arquivo
    const up = await upload(ana.token, '/me/banner', 64);
    expect(up.status).toBe(201);
    const key = ((await up.json()) as ProfileUpdateResponse).appearance.bannerKey!;
    expect(key).toMatch(/-png$/);
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/banners/${key}`)).status).toBe(200);
    const cleared = await http.req<ProfileUpdateResponse>('DELETE', '/me/banner', { token: ana.token });
    expect(cleared.body.appearance).toMatchObject({ bannerKey: null, bannerUrl: null });
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/banners/${key}`)).status).toBe(404);
    // tirar as cores
    const plain = await http.req<ProfileUpdateResponse>('PATCH', '/me/profile', {
      token: ana.token,
      body: { colors: null },
    });
    expect(plain.body.appearance.colors).toBeNull();
  });

  it('foto por GIF do KLIPY e fotos recentes (até 6, a que sai tem o arquivo apagado)', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const sent = await upload(ana.token, '/me/avatar');
    const firstKey = ((await sent.json()) as Me).avatarKey!;
    const viaGif = await http.req<ProfileUpdateResponse>('PATCH', '/me/profile', {
      token: ana.token,
      body: { avatarUrl: GIF },
    });
    expect(viaGif.body.me).toMatchObject({ avatarKey: null, avatarUrl: GIF });
    // quem divide servidor vê a foto nova
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(d.body.members.find((m) => m.user.id === ana.id)!.user.avatarUrl).toBe(GIF);

    // a enviada continua guardada nas recentes e o arquivo ainda existe
    const recent = await http.req<RecentAvatar[]>('GET', '/me/avatars/recent', { token: ana.token });
    expect(recent.body).toEqual([{ entry: `key:${firstKey}`, url: `/avatars/${firstKey}` }]);
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/avatars/${firstKey}`)).status).toBe(200);
    // voltar a usar a enviada; a do KLIPY vai para as recentes
    const back = await http.req<Me>('POST', '/me/avatars/recent', {
      token: ana.token,
      body: { entry: `key:${firstKey}` },
    });
    expect(back.body).toMatchObject({ avatarKey: firstKey });
    expect(back.body.avatarUrl).toBeUndefined();
    expect(
      (await http.req('POST', '/me/avatars/recent', { token: ana.token, body: { entry: 'url:https://x.test/a.gif' } }))
        .status,
    ).toBe(400);

    // mais 6 trocas: a primeira enviada sai das recentes e o arquivo é apagado
    await http.req('PATCH', '/me/profile', { token: ana.token, body: { avatarUrl: GIF2 } });
    for (let i = 0; i < 6; i++) await upload(ana.token, '/me/avatar');
    const after = await http.req<RecentAvatar[]>('GET', '/me/avatars/recent', { token: ana.token });
    expect(after.body).toHaveLength(6);
    expect(after.body.some((x) => x.entry === `key:${firstKey}`)).toBe(false);
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/avatars/${firstKey}`)).status).toBe(404);
  });
});

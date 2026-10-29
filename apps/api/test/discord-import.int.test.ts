/**
 * Importação de modelo de servidor do Discord contra um "Discord falso" local (o teste nunca chama o Discord real):
 * DISCORD_API_URL aponta para um servidor HTTP que serve o modelo fictício de test/fixtures.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, type DiscordImportPreview, type ServerDetail } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { TEST_API_PORT, testConfig } from './env.js';
import { bootstrapOwner, Http, register, resetDb } from './helpers.js';

const fixture = readFileSync(new URL('./fixtures/discord-template.json', import.meta.url), 'utf8');
let fake: Server;
let app: NestFastifyApplication;
let http: Http;
const hits: string[] = [];

beforeAll(async () => {
  fake = createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/api/v10/guilds/templates/ocFicticio1') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(fixture);
    } else if (req.url === '/api/v10/guilds/templates/quebrado') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"code":"x"}');
    } else {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"message":"Unknown server template","code":10057}');
    }
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as AddressInfo).port;
  app = await createApp(testConfig({ DISCORD_API_URL: `http://127.0.0.1:${port}/api/v10` }), { logger: false });
  await app.listen({ host: '127.0.0.1', port: TEST_API_PORT });
  http = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise((r) => fake.close(r));
});
beforeEach(resetDb);

describe('importar servidor do Discord por modelo', () => {
  it('prévia mostra a estrutura sem criar nada', async () => {
    const { owner } = await bootstrapOwner(http);
    const r = await http.req<DiscordImportPreview>('POST', '/servers/import/discord/preview', {
      token: owner.token,
      body: { link: 'https://discord.new/ocFicticio1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Guilda Fictícia');
    expect(r.body.textChannels).toBe(4);
    expect(r.body.voiceChannels).toBe(2);
    expect(r.body.roles.map((x) => x.name)).toEqual(['Moderação', 'Membros antigos']);
    expect(r.body.categories.map((c) => c.name)).toEqual([null, 'Informações', 'Bate-papo']);
    expect(r.body.skipped).toBe(2);
    const list = await http.req<{ name: string }[]>('GET', '/servers', { token: owner.token });
    expect(list.body.map((s) => s.name)).toEqual(['Teste']);
  });

  it('importa categorias, canais, cargos e permissões; todos viram membros', async () => {
    const { owner } = await bootstrapOwner(http);
    const alice = await register(http);
    const r = await http.req<ServerDetail>('POST', '/servers/import/discord', {
      token: owner.token,
      body: { link: 'discord.com/template/ocFicticio1' },
    });
    expect(r.status).toBe(201);
    const d = r.body;
    expect(d.name).toBe('Guilda Fictícia');
    expect(d.categories.map((c) => c.name)).toEqual(['Informações', 'Bate-papo']);
    const info = d.categories.find((c) => c.name === 'Informações')!;
    const regras = d.channels.find((c) => c.name === 'regras')!;
    expect(regras.categoryId).toBe(info.id);
    expect(regras.topic).toBe('Leia antes de postar');
    const everyone = d.roles.find((x) => x.isEveryone)!;
    // @everyone não escreve em #regras (override do modelo)
    expect(regras.overrides).toEqual([
      { subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.SEND_MESSAGES },
    ]);
    expect(d.channels.filter((c) => c.kind === 'voice').map((c) => c.name)).toEqual(['Sala geral', 'Palco']);
    const mod = d.roles.find((x) => x.name === 'Moderação')!;
    expect(mod.permissions).toBe(Permission.ADMINISTRATOR);
    expect(mod.color).toBe('#e74c3c');
    expect(d.members.map((m) => m.user.id).sort()).toEqual([owner.id, alice.id].sort());
    // membro comum: não pode escrever em #regras
    const a = await http.req<ServerDetail>('GET', `/servers/${d.id}`, { token: alice.token });
    const regrasA = a.body.channels.find((c) => c.name === 'regras')!;
    expect(regrasA.myPermissions & Permission.SEND_MESSAGES).toBe(0);
    expect(regrasA.myPermissions & Permission.VIEW_CHANNEL).toBeTruthy();
  });

  it('link inválido, modelo inexistente e resposta quebrada dão erros claros', async () => {
    const { owner } = await bootstrapOwner(http);
    const call = (link: string) =>
      http.req<{ message: string }>('POST', '/servers/import/discord/preview', { token: owner.token, body: { link } });
    hits.length = 0;
    const bad = await call('https://evil.example/template/abc');
    expect(bad.status).toBe(400);
    expect(hits).toEqual([]); // nada sai para a rede com link fora do padrão
    expect((await call('discord.new/naoexiste')).status).toBe(404);
    expect((await call('discord.new/quebrado')).status).toBe(502);
  });

  it('exige login', async () => {
    const r = await http.req('POST', '/servers/import/discord/preview', { body: { link: 'discord.new/ocFicticio1' } });
    expect(r.status).toBe(401);
  });
});

/** Bots oficiais (ADR-0037): o container pede o token com o segredo; cria uma vez, depois só renova o token. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Bot } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, Http, prisma, resetDb, startApp } from './helpers.js';

const SECRET = 'segredo-dos-bots-oficiais-0123';
let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp({ OFFICIAL_BOTS_SECRET: SECRET });
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

describe('bots oficiais', () => {
  it('cria o bot público do criador da instância e, na segunda vez, só troca o token', async () => {
    const { owner } = await bootstrapOwner(http);
    const body = { key: 'YOU6', name: 'YOU6', description: 'Níveis e XP', secret: SECRET };
    const a = await http.req<Bot & { token: string }>('POST', '/bots/official/claim', { body });
    expect(a.status).toBe(201);
    expect(a.body.public).toBe(true);
    expect(a.body.ownerId).toBe(owner.id);
    expect(a.body.user.displayName).toBe('YOU6');
    expect(a.body.token).toMatch(/^ocb_/);
    const b = await http.req<Bot & { token: string }>('POST', '/bots/official/claim', { body });
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.token).not.toBe(a.body.token);
    expect(await prisma.bot.count({ where: { ownerId: owner.id } })).toBe(1);
    // o token velho morreu, o novo entra
    const old = await http.req('GET', '/bots/@me', { token: a.body.token });
    expect(old.status).toBe(401);
    const fresh = await http.req<Bot>('GET', '/bots/@me', { token: b.body.token });
    expect(fresh.status).toBe(200);
    // aparece no diretório para qualquer servidor adicionar
    const dir = await http.req<Bot[]>('GET', '/bots/directory', { token: owner.token });
    expect(dir.body.map((x) => x.id)).toContain(a.body.id);
  });
  it('segredo errado ou ausente: recusado', async () => {
    await bootstrapOwner(http);
    const bad = await http.req('POST', '/bots/official/claim', {
      body: { key: 'YOU6', name: 'YOU6', secret: 'x'.repeat(20) },
    });
    expect(bad.status).toBe(403);
    const invalid = await http.req('POST', '/bots/official/claim', {
      body: { key: 'you6', name: 'YOU6', secret: SECRET },
    });
    expect(invalid.status).toBe(400);
  });
});

/** "Chamar atenção" (ADR-0064): quem pode, limites e o evento para quem recebe. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { UserSettings } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  noEvent,
  outsider,
  register,
  resetDb,
  startApp,
} from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const nudge = (token: string, userId: string) => http.req('POST', `/users/${userId}/nudge`, { token });

describe('Chamar atenção', () => {
  it('quem divide um servidor treme o app da pessoa; a mesma pessoa só de novo depois do intervalo', async () => {
    await bootstrapOwner(http);
    const alice = await register(http);
    const bob = await register(http);
    const sa = await connectSocket(alice.token);
    sockets.push(sa);
    const got = nextEvent<{ fromUserId: string; fromName: string }>(sa, 'user:nudge');
    expect((await nudge(bob.token, alice.id)).status).toBe(204);
    expect(await got).toEqual({ fromUserId: bob.id, fromName: bob.nickname });

    const again = await nudge(bob.token, alice.id);
    expect(again.status).toBe(429);
    expect((again.body as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    // o intervalo é por par: outra pessoa pode chamar na hora
    const owner2 = await register(http);
    expect((await nudge(owner2.token, alice.id)).status).toBe(204);
  });

  it('não chama a si mesmo, quem não tem nada em comum, quem bloqueou, quem desligou ou quem está offline', async () => {
    const { owner } = await bootstrapOwner(http);
    const alice = await register(http);
    const bob = await register(http);
    const carol = await outsider(http);
    const sa = await connectSocket(alice.token);
    const sc = await connectSocket(carol.token);
    sockets.push(sa, sc);

    expect((await nudge(alice.token, alice.id)).status).toBe(403);
    // sem servidor em comum nem amizade: 404, nos dois sentidos
    expect((await nudge(carol.token, alice.id)).status).toBe(404);
    expect((await nudge(alice.token, carol.id)).status).toBe(404);

    // bloqueio de qualquer lado: 404 (não revela quem bloqueou)
    expect((await http.req('PUT', `/blocks/${owner.id}`, { token: alice.token })).status).toBeLessThan(300);
    expect((await nudge(owner.token, alice.id)).status).toBe(404);

    // desligou nas configurações
    const cur = await http.req<UserSettings>('GET', '/me/settings', { token: alice.token });
    const off = { ...cur.body, notifications: { ...cur.body.notifications, nudges: false } };
    expect((await http.req('PUT', '/me/settings', { token: alice.token, body: off })).status).toBe(200);
    const denied = noEvent(sa, 'user:nudge');
    expect((await nudge(bob.token, alice.id)).status).toBe(403);
    await denied;

    // bob não tem o app aberto
    expect((await nudge(alice.token, bob.id)).status).toBe(409);
  });
});

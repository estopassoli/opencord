/** Eventos do servidor (ADR-0028): criar, listar, presença, tempo real, permissões e validações. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerEvent } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  outsider,
  prisma,
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

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const voice = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'voice' } });
  const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
  return { owner, alice, bob, serverId, voiceId: voice.id, textId: text.id };
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('eventos do servidor', () => {
  it('membro cria (já vai), outros confirmam e recebem em tempo real; lista ordenada pelo início', async () => {
    const { alice, bob, serverId, voiceId } = await setup();
    const sb = await connectSocket(bob.token);
    sockets.push(sb);
    const changed = nextEvent<{ serverId: string; event: ServerEvent }>(
      sb,
      'event:changed',
      (e) => e.serverId === serverId,
    );
    const created = await http.req<ServerEvent>('POST', `/servers/${serverId}/events`, {
      token: alice.token,
      body: { title: 'Raid de sexta', description: 'traz poção', channelId: voiceId, startsAt: inHours(48) },
    });
    expect(created.status).toBe(201);
    expect(created.body.going).toEqual([alice.id]);
    expect(created.body.me).toBe('going');
    expect((await changed).event.title).toBe('Raid de sexta');

    await http.req('POST', `/servers/${serverId}/events`, {
      token: bob.token,
      body: { title: 'Amanhã', startsAt: inHours(20) },
    });
    const list = await http.req<ServerEvent[]>('GET', `/servers/${serverId}/events`, { token: bob.token });
    expect(list.body.map((e) => e.title)).toEqual(['Amanhã', 'Raid de sexta']);
    expect(list.body[1]?.me).toBeNull();

    const rsvp = await http.req<ServerEvent>('PUT', `/events/${created.body.id}/rsvp`, {
      token: bob.token,
      body: { status: 'maybe' },
    });
    expect(rsvp.body.maybe).toEqual([bob.id]);
    expect(rsvp.body.me).toBe('maybe');
    const cleared = await http.req<ServerEvent>('PUT', `/events/${created.body.id}/rsvp`, {
      token: bob.token,
      body: { status: null },
    });
    expect(cleared.body.maybe).toEqual([]);
  });

  it('só quem criou ou gerencia canais edita/apaga; de fora é 404; validações', async () => {
    const { owner, alice, bob, serverId, voiceId, textId } = await setup();
    const ev = await http.req<ServerEvent>('POST', `/servers/${serverId}/events`, {
      token: alice.token,
      body: { title: 'Treino', startsAt: inHours(2) },
    });
    expect((await http.req('PATCH', `/events/${ev.body.id}`, { token: bob.token, body: { title: 'x' } })).status).toBe(
      403,
    );
    expect(
      (await http.req('PATCH', `/events/${ev.body.id}`, { token: alice.token, body: { title: 'Treino 2' } })).status,
    ).toBe(200);
    // dono tem MANAGE_CHANNELS
    expect(
      (await http.req('PATCH', `/events/${ev.body.id}`, { token: owner.token, body: { channelId: voiceId } })).status,
    ).toBe(200);
    const out = await outsider(http);
    expect((await http.req('GET', `/servers/${serverId}/events`, { token: out.token })).status).toBe(404);
    expect(
      (await http.req('PUT', `/events/${ev.body.id}/rsvp`, { token: out.token, body: { status: 'going' } })).status,
    ).toBe(404);
    // validações
    const bad = (body: Record<string, unknown>) =>
      http.req('POST', `/servers/${serverId}/events`, { token: alice.token, body });
    expect((await bad({ title: 'Passado', startsAt: inHours(-2) })).status).toBe(400);
    expect((await bad({ title: 'Texto', startsAt: inHours(1), channelId: textId })).status).toBe(400);
    expect((await bad({ title: 'Fim antes', startsAt: inHours(3), endsAt: inHours(2) })).status).toBe(400);
    expect((await bad({ title: '', startsAt: inHours(1) })).status).toBe(400);
    expect((await http.req('DELETE', `/events/${ev.body.id}`, { token: bob.token })).status).toBe(403);
    expect((await http.req('DELETE', `/events/${ev.body.id}`, { token: alice.token })).status).toBe(204);
    expect((await http.req<ServerEvent[]>('GET', `/servers/${serverId}/events`, { token: alice.token })).body).toEqual(
      [],
    );
  });

  it('eventos encerrados somem da lista; sem fim, somem 6 h depois de começar', async () => {
    const { alice, serverId } = await setup();
    const started = await prisma.serverEvent.create({
      data: { serverId, createdById: alice.id, title: 'Rolando', startsAt: new Date(Date.now() - 3_600_000) },
    });
    await prisma.serverEvent.create({
      data: { serverId, createdById: alice.id, title: 'Velho', startsAt: new Date(Date.now() - 7 * 3_600_000) },
    });
    await prisma.serverEvent.create({
      data: {
        serverId,
        createdById: alice.id,
        title: 'Acabou',
        startsAt: new Date(Date.now() - 5 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    const list = await http.req<ServerEvent[]>('GET', `/servers/${serverId}/events`, { token: alice.token });
    expect(list.body.map((e) => e.id)).toEqual([started.id]);
  });
});

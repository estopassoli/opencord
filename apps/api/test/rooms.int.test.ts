/** Salas privadas (ADR-0040): canal privado do servidor e sala temporária trancada com dona, convite, limite, remover. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Channel, ServerDetail, VoiceJoinResponse } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, register, resetDb, rid, startApp } from './helpers.js';

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
const sock = async (token: string) => {
  const s = await connectSocket(token);
  sockets.push(s);
  return s;
};
const join = (token: string, channelId: string) =>
  http.req<VoiceJoinResponse & { message?: string }>('POST', `/voice/channels/${channelId}/join`, { token });

describe('canal privado', () => {
  it('só quem foi escolhido (e quem criou) vê; tornar público libera todo mundo', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    const c = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'segredos', kind: 'text', private: true, allowedUserIds: [ana.id] },
    });
    expect(c.status).toBe(201);
    const sees = async (token: string) =>
      (await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token })).body.channels.some(
        (x) => x.id === c.body.id,
      );
    expect(await sees(owner.token)).toBe(true);
    expect(await sees(ana.token)).toBe(true);
    expect(await sees(bruno.token)).toBe(false);
    const forAna = (
      await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: ana.token })
    ).body.channels.find((x) => x.id === c.body.id);
    expect(forAna).toMatchObject({ private: true, overrides: [] });
    const post = await http.req('POST', `/channels/${c.body.id}/messages`, {
      token: bruno.token,
      body: { requestId: rid(), body: 'oi' },
    });
    expect(post.status).toBe(404);
    // tornar público: o deny do @everyone sai
    const pub = await http.req<Channel>('PATCH', `/channels/${c.body.id}`, {
      token: owner.token,
      body: { private: false },
    });
    expect(pub.status).toBe(200);
    expect(await sees(bruno.token)).toBe(true);
    // e privado de novo
    await http.req('PATCH', `/channels/${c.body.id}`, { token: owner.token, body: { private: true } });
    expect(await sees(bruno.token)).toBe(false);
    expect(await sees(ana.token)).toBe(true);
  });

  it('sem MANAGE_CHANNELS não cria canal privado', async () => {
    const { serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const r = await http.req('POST', `/servers/${serverId}/channels`, {
      token: ana.token,
      body: { name: 'meu', kind: 'voice', private: true },
    });
    expect(r.status).toBe(403);
  });
});

describe('sala trancada', () => {
  it('dona tranca, recebe pedido, convida, limita vagas, remove e passa a sala ao sair', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    const carla = await register(http, 'Carla');
    const hub = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'Criar sala', kind: 'voice', roomHub: true },
    });
    // Ana cria a sala já trancada, com 2 vagas
    const room = await http.req<Channel>('POST', `/channels/${hub.body.id}/rooms`, {
      token: ana.token,
      body: { name: 'Duo da Ana', locked: true, userLimit: 2 },
    });
    expect(room.status).toBe(201);
    expect(room.body).toMatchObject({ temporary: true, ownerId: ana.id, userLimit: 2, name: 'Duo da Ana' });
    expect((await join(ana.token, room.body.id)).status).toBe(201);

    // Bruno vê a sala como trancada (sem receber os overrides), mas não entra; pede e a Ana recebe o pedido
    const seenByBruno = (
      await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: bruno.token })
    ).body.channels.find((c) => c.id === room.body.id);
    expect(seenByBruno).toMatchObject({ locked: true, overrides: [] });
    expect((await join(bruno.token, room.body.id)).status).toBe(403);
    const sa = await sock(ana.token);
    const knock = nextEvent<{ kind: string; userId?: string; channelId?: string }>(
      sa,
      'notification:created',
      (n) => (n as { kind: string }).kind === 'room_knock',
    );
    expect((await http.req('POST', `/rooms/${room.body.id}/knock`, { token: bruno.token })).status).toBe(204);
    expect(await knock).toMatchObject({ kind: 'room_knock', userId: bruno.id, channelId: room.body.id });

    // só a dona convida
    expect(
      (await http.req('POST', `/rooms/${room.body.id}/invite`, { token: carla.token, body: { userIds: [carla.id] } }))
        .status,
    ).toBe(403);
    const sb = await sock(bruno.token);
    const invited = nextEvent<{ kind: string }>(
      sb,
      'notification:created',
      (n) => (n as { kind: string }).kind === 'room_invite',
    );
    expect(
      (
        await http.req('POST', `/rooms/${room.body.id}/invite`, {
          token: ana.token,
          body: { userIds: [bruno.id, carla.id] },
        })
      ).status,
    ).toBe(201);
    await invited;
    expect((await join(bruno.token, room.body.id)).status).toBe(201);
    // cheia (2 vagas): Carla, mesmo convidada, não entra
    const full = await join(carla.token, room.body.id);
    expect(full.status).toBe(400);
    expect(full.body.message).toMatch(/cheia/);

    // Ana tira o Bruno: sai da voz e perde o convite
    expect((await http.req('DELETE', `/rooms/${room.body.id}/members/${bruno.id}`, { token: ana.token })).status).toBe(
      204,
    );
    expect((await join(bruno.token, room.body.id)).status).toBe(403);
    expect((await join(carla.token, room.body.id)).status).toBe(201);

    // Ana sai: a sala fica com a Carla
    const updated = nextEvent<Channel>(sa, 'channel:updated', (c) => (c as Channel).id === room.body.id);
    expect((await http.req('POST', '/voice/leave', { token: ana.token })).status).toBe(204);
    expect((await updated).ownerId).toBe(carla.id);
    expect(
      (await http.req('PATCH', `/rooms/${room.body.id}`, { token: ana.token, body: { locked: false } })).status,
    ).toBe(403);
    // Carla destranca: Bruno entra
    const open = await http.req<Channel>('PATCH', `/rooms/${room.body.id}`, {
      token: carla.token,
      body: { locked: false, userLimit: null },
    });
    expect(open.status).toBe(200);
    expect((await join(bruno.token, room.body.id)).status).toBe(201);
  });

  it('trancar depois não derruba quem já está dentro; canal comum não aceita comandos de sala', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    const hub = await http.req<Channel>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'Criar sala', kind: 'voice', roomHub: true },
    });
    const j = await join(ana.token, hub.body.id);
    const roomId = j.body.channelId;
    expect((await join(bruno.token, roomId)).status).toBe(201);
    expect((await http.req('PATCH', `/rooms/${roomId}`, { token: ana.token, body: { locked: true } })).status).toBe(
      200,
    );
    // Bruno continua (override próprio): reentrar funciona
    expect((await join(bruno.token, roomId)).status).toBe(201);
    const voice = (
      await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token })
    ).body.channels.find((c) => c.kind === 'voice' && !c.roomHub && !c.temporary);
    expect(
      (await http.req('PATCH', `/rooms/${voice!.id}`, { token: owner.token, body: { locked: true } })).status,
    ).toBe(404);
  });
});

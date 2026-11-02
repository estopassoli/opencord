/** Chamada privada (ADR-0038): entrar pela conversa, tocar para os outros, listar, sair; quem não é da conversa não entra. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { VoiceJoinResponse, VoiceMemberState } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, register, resetDb, startApp } from './helpers.js';

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

describe('chamada privada', () => {
  it('membro entra, o outro é chamado e vê quem está; sai e a lista esvazia', async () => {
    await bootstrapOwner(http);
    const ana = await register(http, 'Ana');
    const bruno = await register(http, 'Bruno');
    const carla = await register(http, 'Carla');
    const conv = await http.req<{ id: string }>('POST', '/conversations', {
      token: ana.token,
      body: { userIds: [bruno.id] },
    });
    expect(conv.status).toBe(201);
    const sb = await connectSocket(bruno.token);
    sockets.push(sb);
    const ring = nextEvent<{ kind: string; title: string; conversationId?: string }>(sb, 'notification:created');
    const joined = nextEvent<VoiceMemberState>(sb, 'voice:member:joined');
    const j = await http.req<VoiceJoinResponse>('POST', `/voice/conversations/${conv.body.id}/join`, {
      token: ana.token,
    });
    expect(j.status).toBe(201);
    expect(j.body.conversationId).toBe(conv.body.id);
    expect(j.body.channelId).toBe(conv.body.id);
    expect(j.body.canSpeak && j.body.canVideo && j.body.canStream).toBe(true);
    expect(j.body.roomName).toMatch(/^vc_/);
    const n = await ring;
    expect(n.kind).toBe('call');
    expect(n.title).toContain('Ana');
    expect(n.conversationId).toBe(conv.body.id);
    const ev = await joined;
    expect(ev.userId).toBe(ana.id);
    expect(ev.serverId).toBeNull();
    expect(ev.conversationId).toBe(conv.body.id);
    const list = await http.req<VoiceMemberState[]>('GET', `/conversations/${conv.body.id}/voice-states`, {
      token: bruno.token,
    });
    expect(list.status).toBe(200);
    expect(list.body.map((v) => v.userId)).toEqual([ana.id]);
    // quem não é da conversa: nem entra, nem lista
    const out = await http.req('POST', `/voice/conversations/${conv.body.id}/join`, { token: carla.token });
    expect(out.status).toBe(404);
    const outList = await http.req('GET', `/conversations/${conv.body.id}/voice-states`, { token: carla.token });
    expect(outList.status).toBe(404);
    // Bruno entra: não toca de novo (já tinha gente), e a saída avisa a conversa
    const left = nextEvent<{ userId: string; conversationId?: string | null }>(sb, 'voice:member:left');
    const jb = await http.req<VoiceJoinResponse>('POST', `/voice/conversations/${conv.body.id}/join`, {
      token: bruno.token,
    });
    expect(jb.status).toBe(201);
    const leave = await http.req('POST', '/voice/leave', { token: ana.token });
    expect(leave.status).toBe(204);
    const l = await left;
    expect(l.userId).toBe(ana.id);
    expect(l.conversationId).toBe(conv.body.id);
    const after = await http.req<VoiceMemberState[]>('GET', `/conversations/${conv.body.id}/voice-states`, {
      token: bruno.token,
    });
    expect(after.body.map((v) => v.userId)).toEqual([bruno.id]);
  });
});

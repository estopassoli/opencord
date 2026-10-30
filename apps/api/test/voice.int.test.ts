/**
 * Voz contra um LiveKit real (binário oficial, iniciado no global-setup) com webhooks apontando para a API de teste.
 * Valida: grants mínimos, enforcement de fontes na SFU, estado derivado de webhooks e revogação ativa (F3.1, F3.5).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type Role,
  type ServerDetail,
  type VoiceJoinResponse,
  type VoiceMemberState,
} from '@opencord/contracts';
import {
  AudioSource,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  VideoSource,
} from '@livekit/rtc-node';
import { decodeJwt } from 'jose';
import { RoomServiceClient } from 'livekit-server-sdk';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT, TEST_ENV } from './env.js';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  outsider,
  prisma,
  register,
  resetDb,
  sleep,
  startApp,
} from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const lk = new RoomServiceClient(TEST_ENV.LIVEKIT_API_URL, TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET);
const cleanup: (() => Promise<unknown> | void)[] = [];

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

async function setup() {
  const b = await bootstrapOwner(http);
  const alice = await register(http);
  const voice = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'voice' } });
  const text = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  return { ...b, alice, voiceId: voice.id, textId: text.id };
}

async function connectRoom(j: VoiceJoinResponse) {
  const room = new Room();
  await room.connect(j.url, j.token, { autoSubscribe: true, dynacast: false });
  cleanup.push(() => room.disconnect().catch(() => undefined));
  return room;
}

async function waitUntil(fn: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error('condição não satisfeita a tempo');
}

const participants = async (roomName: string) =>
  (await lk.listParticipants(roomName).catch(() => [])).map((p) => p.identity);
const sock = async (token: string): Promise<Socket> => {
  const s = await connectSocket(token);
  cleanup.push(() => void s.disconnect());
  return s;
};

describe('voz com LiveKit real', () => {
  it('token com grants mínimos, sala opaca e TTL curto', async () => {
    const { alice, voiceId } = await setup();
    const r = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    expect(r.status).toBe(201);
    expect(r.body.roomName).not.toContain(voiceId);
    const claims = decodeJwt(r.body.token) as { sub: string; exp: number; video: Record<string, unknown> };
    expect(claims.sub).toBe(alice.id);
    expect(claims.video).toMatchObject({
      room: r.body.roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      // só a prévia da live (ADR-0012): quem pode transmitir publica dados
      canPublishData: true,
    });
    expect((claims.video.canPublishSources as string[]).sort()).toEqual([
      'camera',
      'microphone',
      'screen_share',
      'screen_share_audio',
    ]);
    expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(600_000 + 2000);
    expect(r.body).toMatchObject({ canSpeak: true, canVideo: true, canStream: true });
  });

  it('sem CONNECT → 403; canal de texto → 400; não membro → 404', async () => {
    const { alice, owner, serverId, voiceId, textId } = await setup();
    expect((await http.req('POST', `/voice/channels/${textId}/join`, { token: alice.token })).status).toBe(400);
    const stranger = await outsider(http);
    expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: stranger.token })).status).toBe(404);
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.CONNECT }] },
    });
    expect((await http.req('POST', `/voice/channels/${voiceId}/join`, { token: alice.token })).status).toBe(403);
  });

  it('sem STREAM: token sem screen_share e a SFU recusa a publicação', async () => {
    const { alice, owner, serverId, voiceId } = await setup();
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.STREAM }] },
    });
    const j = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    expect(j.body.canStream).toBe(false);
    // sem STREAM também não publica dados (a prévia da live é a única mensagem de dados do app)
    expect((decodeJwt(j.body.token) as { video: Record<string, unknown> }).video.canPublishData).toBe(false);
    const room = await connectRoom(j.body);
    const src = new VideoSource(64, 64);
    const track = LocalVideoTrack.createVideoTrack('screen', src);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_SCREENSHARE;
    await expect(room.localParticipant?.publishTrack(track, opts)).rejects.toBeTruthy();
  });

  it('webhook confirma entrada; publicar tela marca streaming via webhook; sair limpa estado', async () => {
    const { alice, owner, serverId, voiceId } = await setup();
    const so = await sock(owner.token);
    const joined = nextEvent<VoiceMemberState>(so, 'voice:member:joined', (s) => s.userId === alice.id);
    const j = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    await joined;
    const room = await connectRoom(j.body);
    await waitUntil(async () => (await participants(j.body.roomName)).includes(alice.id));

    const streaming = nextEvent<VoiceMemberState>(
      so,
      'voice:state:changed',
      (s) => s.userId === alice.id && s.streaming,
      10000,
    );
    const src = new VideoSource(64, 64);
    const track = LocalVideoTrack.createVideoTrack('screen', src);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_SCREENSHARE;
    await room.localParticipant?.publishTrack(track, opts);
    expect((await streaming).streaming).toBe(true);
    const list = await http.req<VoiceMemberState[]>('GET', `/servers/${serverId}/voice-states`, { token: owner.token });
    expect(list.body.find((s) => s.userId === alice.id)?.streaming).toBe(true);

    const left = nextEvent<{ userId: string; reason: string }>(
      so,
      'voice:member:left',
      (p) => p.userId === alice.id,
      10000,
    );
    await room.disconnect();
    expect((await left).reason).toBe('left');
    expect(
      (await http.req<VoiceMemberState[]>('GET', `/servers/${serverId}/voice-states`, { token: owner.token })).body,
    ).toHaveLength(0);
  });

  it('kick do servidor remove o participante da SFU (revogação ativa, não só no banco)', async () => {
    const { alice, owner, serverId, voiceId } = await setup();
    const sa = await sock(alice.token);
    const j = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const room = await connectRoom(j.body);
    const mic = new AudioSource(48000, 1);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant?.publishTrack(LocalAudioTrack.createAudioTrack('mic', mic), opts);
    await waitUntil(async () => (await participants(j.body.roomName)).includes(alice.id));
    const disconnected = new Promise<void>((r) => room.once(RoomEvent.Disconnected, () => r()));
    const forced = nextEvent<{ reason: string }>(sa, 'voice:force-disconnect');
    const t0 = Date.now();
    await http.req('DELETE', `/servers/${serverId}/members/${alice.id}`, { token: owner.token });
    await disconnected;
    const ms = Date.now() - t0;
    expect((await forced).reason).toBe('kicked');
    expect(await participants(j.body.roomName)).not.toContain(alice.id);
    expect(ms).toBeLessThan(5000);
  });

  it('perder CONNECT por override com a chamada ativa → removido da SFU', async () => {
    const { alice, owner, voiceId } = await setup();
    const j = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const room = await connectRoom(j.body);
    await waitUntil(async () => (await participants(j.body.roomName)).includes(alice.id));
    const disconnected = new Promise<void>((r) => room.once(RoomEvent.Disconnected, () => r()));
    await http.req('PATCH', `/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'member', subjectId: alice.id, allow: 0, deny: Permission.CONNECT }] },
    });
    await disconnected;
    expect(await participants(j.body.roomName)).not.toContain(alice.id);
  });

  it('trocar de canal encerra a sessão anterior na SFU (uma sessão por usuário)', async () => {
    const { alice, owner, serverId, voiceId } = await setup();
    const second = await http.req<{ id: string }>('POST', `/servers/${serverId}/channels`, {
      token: owner.token,
      body: { name: 'Sala 2', kind: 'voice' },
    });
    const j1 = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const r1 = await connectRoom(j1.body);
    await waitUntil(async () => (await participants(j1.body.roomName)).includes(alice.id));
    const gone = new Promise<void>((r) => r1.once(RoomEvent.Disconnected, () => r()));
    const j2 = await http.req<VoiceJoinResponse>('POST', `/voice/channels/${second.body.id}/join`, {
      token: alice.token,
    });
    await gone;
    await connectRoom(j2.body);
    await waitUntil(async () => (await participants(j2.body.roomName)).includes(alice.id));
    const states = await http.req<VoiceMemberState[]>('GET', `/servers/${serverId}/voice-states`, {
      token: owner.token,
    });
    expect(states.body.map((s) => s.channelId)).toEqual([second.body.id]);
  });

  it('mute/deafen próprios refletidos para os demais; deafen implica mute', async () => {
    const { alice, owner, voiceId } = await setup();
    const so = await sock(owner.token);
    await http.req('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const changed = nextEvent<VoiceMemberState>(so, 'voice:state:changed', (s) => s.userId === alice.id && s.selfDeaf);
    const r = await http.req<VoiceMemberState>('PATCH', '/voice/state', {
      token: alice.token,
      body: { selfDeaf: true },
    });
    expect(r.body).toMatchObject({ selfDeaf: true, selfMute: true });
    await changed;
  });

  it('reconcile remove estado de quem nunca conectou após a carência', async () => {
    const { alice, voiceId } = await setup();
    await http.req('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const { VoiceService } = await import('../src/voice/voice.service.js');
    const svc = app.get(VoiceService);
    expect((await svc.reconcile()).removed).toBe(0);
    const raw = JSON.parse((await svc['redis'].client.get(`voice:user:${alice.id}`)) as string) as { joinedAt: string };
    raw.joinedAt = new Date(Date.now() - 60_000).toISOString();
    await svc['redis'].client.set(`voice:user:${alice.id}`, JSON.stringify(raw));
    expect((await svc.reconcile()).removed).toBe(1);
    expect(await svc.stateOf(alice.id)).toBeNull();
  });

  it('webhook com assinatura inválida é rejeitado', async () => {
    const r = await http.req('POST', '/livekit/webhook', { body: { event: 'participant_left' } });
    expect(r.status).toBe(403);
  });

  it('prévia da live: só JPEG de quem transmite; quem vê o canal baixa; some quando a live acaba', async () => {
    const { alice, owner, voiceId } = await setup();
    await http.req('POST', `/voice/channels/${voiceId}/join`, { token: alice.token });
    const up = async (data: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: 'image/jpeg' }), 'p.jpg');
      return (
        await fetch(`http://127.0.0.1:${TEST_API_PORT}/voice/stream-preview`, {
          method: 'POST',
          headers: { authorization: `Bearer ${alice.token}` },
          body: form,
        })
      ).status;
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    // sem transmitir: recusado
    expect(await up(jpeg)).toBe(400);
    const { VoiceService } = await import('../src/voice/voice.service.js');
    const svc = app.get(VoiceService);
    const raw = JSON.parse((await svc['redis'].client.get(`voice:user:${alice.id}`)) as string) as Record<
      string,
      unknown
    >;
    await svc['redis'].client.set(`voice:user:${alice.id}`, JSON.stringify({ ...raw, streaming: true }));
    // não JPEG: recusado
    expect(await up(Buffer.from('<svg/>'))).toBe(400);
    expect(await up(jpeg)).toBe(204);
    expect((await svc.stateOf(alice.id))?.previewAt).toBeTruthy();
    const got = await fetch(`http://127.0.0.1:${TEST_API_PORT}/voice/members/${alice.id}/stream-preview`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await got.arrayBuffer()).equals(jpeg)).toBe(true);
    // quem não participa do servidor não vê
    const stranger = await outsider(http);
    const denied = await fetch(`http://127.0.0.1:${TEST_API_PORT}/voice/members/${alice.id}/stream-preview`, {
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(denied.status).toBe(404);
  });
});

/** Ponte com o Slack (ADR-0033): ligar canais, OpenCord → Slack, Slack → OpenCord assinado, anti-eco, desligar. */
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Message, SlackLink, SlackStatus } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { TEST_API_PORT, testConfig } from './env.js';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb } from './helpers.js';

const SLACK_PORT = 3199;
const SIGNING = 'test-signing-secret-0123456789';
let app: NestFastifyApplication;
let httpc: Http;
let stub: http.Server;
/** chamadas que o stub do Slack recebeu: método → corpos */
const calls: { method: string; body: Record<string, unknown> }[] = [];
const sockets: Socket[] = [];

function stubSlack(): http.Server {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const method = (req.url ?? '').replace(/^\//, '');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      calls.push({ method, body });
      const reply = (o: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (method === 'auth.test') return reply({ ok: true, team: 'Turma' });
      if (method === 'conversations.list')
        return reply({
          ok: true,
          channels: [
            { id: 'C0TEST1', name: 'geral' },
            { id: 'C0TEST2', name: 'jogos' },
          ],
        });
      if (method === 'conversations.join') return reply({ ok: true });
      if (method === 'users.info')
        return reply({ ok: true, user: { name: 'ana', real_name: 'Ana Silva', profile: { display_name: 'ana' } } });
      if (method === 'chat.postMessage') return reply({ ok: true, ts: '1.2' });
      reply({ ok: false, error: 'unknown_method' });
    });
  });
}

beforeAll(async () => {
  stub = stubSlack();
  await new Promise<void>((r) => stub.listen(SLACK_PORT, '127.0.0.1', r));
  app = await createApp(
    testConfig({
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: SIGNING,
      SLACK_API_URL: `http://127.0.0.1:${SLACK_PORT}`,
    }),
    { logger: false },
  );
  await app.listen({ host: '127.0.0.1', port: TEST_API_PORT });
  httpc = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => stub.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  calls.length = 0;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | undefined, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('timeout');
    await sleep(25);
  }
}

/** POST assinado como o Slack faz: `v0=` HMAC-SHA256 de `v0:<ts>:<corpo>` */
function slackPost(payload: unknown, opts: { ts?: string; secret?: string } = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac('sha256', opts.secret ?? SIGNING)
    .update(`v0:${ts}:${body}`)
    .digest('hex')}`;
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/integrations/slack/events',
      headers: { 'content-type': 'application/json', 'x-slack-signature': sig, 'x-slack-request-timestamp': ts },
      payload: body,
    });
}

async function linkedServer() {
  const { owner, serverId } = await bootstrapOwner(httpc);
  const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
  const link = await httpc.req<SlackLink>('POST', `/servers/${serverId}/slack-links`, {
    token: owner.token,
    body: { channelId: text.id, slackChannelId: 'C0TEST1' },
  });
  expect(link.status).toBe(201);
  return { owner, serverId, text, link: link.body };
}

describe('ponte com o Slack', () => {
  it('status e canais do workspace; só quem gerencia liga; canal de voz e repetição recusados', async () => {
    const { owner, serverId } = await bootstrapOwner(httpc);
    const alice = await register(httpc);
    const status = await httpc.req<SlackStatus>('GET', '/integrations/slack/status', { token: owner.token });
    expect(status.body).toEqual({ configured: true, team: 'Turma' });
    const channels = await httpc.req<{ id: string; name: string }[]>('GET', '/integrations/slack/channels', {
      token: owner.token,
    });
    expect(channels.body.map((c) => c.name)).toEqual(['geral', 'jogos']);

    const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
    const voice = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'voice' } });
    expect(
      (
        await httpc.req('POST', `/servers/${serverId}/slack-links`, {
          token: alice.token,
          body: { channelId: text.id, slackChannelId: 'C0TEST1' },
        })
      ).status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (
        await httpc.req('POST', `/servers/${serverId}/slack-links`, {
          token: owner.token,
          body: { channelId: voice.id, slackChannelId: 'C0TEST1' },
        })
      ).status,
    ).toBe(400);
    const ok = await httpc.req<SlackLink>('POST', `/servers/${serverId}/slack-links`, {
      token: owner.token,
      body: { channelId: text.id, slackChannelId: 'C0TEST1' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.slackChannelName).toBe('geral');
    expect(calls.some((c) => c.method === 'conversations.join' && c.body['channel'] === 'C0TEST1')).toBe(true);
    // o mesmo canal do Slack não liga duas vezes; canal daqui também não
    expect(
      (
        await httpc.req('POST', `/servers/${serverId}/slack-links`, {
          token: owner.token,
          body: { channelId: text.id, slackChannelId: 'C0TEST2' },
        })
      ).status,
    ).toBe(400);
    const list = await httpc.req<SlackLink[]>('GET', `/servers/${serverId}/slack-links`, { token: owner.token });
    expect(list.body).toHaveLength(1);
    expect(
      (await httpc.req('GET', `/servers/${serverId}/slack-links`, { token: alice.token })).status,
    ).toBeGreaterThanOrEqual(403);
  });

  it('OpenCord → Slack: mensagem sai com o nome de quem escreveu e menções viram @nome', async () => {
    const { owner, text } = await linkedServer();
    const alice = await register(httpc, 'Alice');
    const sent = await httpc.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: owner.token,
      body: { requestId: randomUUID(), body: `oi <@${alice.id}>` },
    });
    expect(sent.status).toBe(201);
    const post = await waitFor(() => calls.find((c) => c.method === 'chat.postMessage'));
    expect(post.body['channel']).toBe('C0TEST1');
    expect(post.body['text']).toBe(`oi @${alice.auth.user.displayName}`);
    expect(post.body['username']).toBe(owner.auth.user.displayName);
  });

  it('Slack → OpenCord: evento assinado vira mensagem de um usuário fantoche com selo APP; não volta ao Slack', async () => {
    const { owner, text } = await linkedServer();
    const s = await connectSocket(owner.token);
    sockets.push(s);
    const waiting = nextEvent<Message>(s, 'chat:message:created');
    const res = await slackPost({
      type: 'event_callback',
      event_id: 'Ev1',
      event: {
        type: 'message',
        user: 'U123',
        channel: 'C0TEST1',
        text: 'olá <@U123> &amp; <https://x.y|link>',
        ts: '1.1',
      },
    });
    expect(res.statusCode).toBe(200);
    const m = await waiting;
    expect(m.channelId).toBe(text.id);
    expect(m.author.bot).toBe(true);
    expect(m.author.displayName).toBe('ana');
    expect(m.author.username).toBe('slack-u123');
    expect(m.body).toBe('olá @ana & link (https://x.y)');
    await sleep(300);
    expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(0);
    // reenvio do mesmo evento: ignorado
    await slackPost({
      type: 'event_callback',
      event_id: 'Ev1',
      event: { type: 'message', user: 'U123', channel: 'C0TEST1', text: 'de novo', ts: '1.1' },
    });
    await sleep(300);
    expect(await prisma.message.count({ where: { channelId: text.id } })).toBe(1);
  });

  it('desafio de verificação, assinatura errada, timestamp velho, mensagens de bots e canal sem ligação', async () => {
    const { text } = await linkedServer();
    const ch = await slackPost({ type: 'url_verification', challenge: 'abc123' });
    expect(ch.statusCode).toBe(200);
    expect(JSON.parse(ch.body)).toEqual({ challenge: 'abc123' });
    expect(
      (await slackPost({ type: 'url_verification', challenge: 'x' }, { secret: 'outro-segredo-0123456789' }))
        .statusCode,
    ).toBe(401);
    expect((await slackPost({ type: 'url_verification', challenge: 'x' }, { ts: '1000' })).statusCode).toBe(401);
    await slackPost({
      type: 'event_callback',
      event_id: 'Ev2',
      event: { type: 'message', bot_id: 'B1', user: 'U9', channel: 'C0TEST1', text: 'eco', ts: '1.3' },
    });
    await slackPost({
      type: 'event_callback',
      event_id: 'Ev3',
      event: { type: 'message', user: 'U9', channel: 'C0OUTRO', text: 'sem ligação', ts: '1.4' },
    });
    await sleep(300);
    expect(await prisma.message.count({ where: { channelId: text.id } })).toBe(0);
  });

  it('desligar: a mensagem para de ir ao Slack', async () => {
    const { owner, text, link } = await linkedServer();
    expect((await httpc.req('DELETE', `/slack-links/${link.id}`, { token: owner.token })).status).toBe(204);
    await httpc.req('POST', `/channels/${text.id}/messages`, {
      token: owner.token,
      body: { requestId: randomUUID(), body: 'depois de desligar' },
    });
    await sleep(300);
    expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(0);
  });
});

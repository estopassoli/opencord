import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Interaction, Message as MessageDto, UserPublic } from '@opencord/contracts';
import { ChatInputCommandInteraction, Client, Message, type SocketLike, type SocketOptions } from '../src/index.js';

/** socket falso: guarda handlers e o que o cliente emitiu; `fire` simula um evento do servidor (com envelope) */
class FakeSocket implements SocketLike {
  connected = true;
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  emitted: { event: string; args: unknown[] }[] = [];
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    const ack = args.at(-1);
    if (typeof ack === 'function') ack({ ok: true, data: { ttlSeconds: 60 } });
    return true;
  }
  disconnect() {
    this.connected = false;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  fire(event: string, payload: unknown, eventId: string = crypto.randomUUID()) {
    const env = { eventId, schemaVersion: 1, occurredAt: new Date().toISOString(), payload };
    for (const h of this.handlers.get(event) ?? []) h(env);
  }
}

const BOT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const SERVER_ID = '44444444-4444-4444-8444-444444444444';
const MSG_ID = '55555555-5555-4555-8555-555555555555';
const INTERACTION_ID = '66666666-6666-4666-8666-666666666666';

const botUser: UserPublic = { id: BOT_ID, username: 'meubot', displayName: 'Meu Bot', avatarKey: null, bot: true };
const person: UserPublic = { id: USER_ID, username: 'ana', displayName: 'Ana', avatarKey: null, bot: false };

function messageDto(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: MSG_ID,
    channelId: CHANNEL_ID,
    conversationId: null,
    author: person,
    body: '!ping',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
    replyTo: null,
    reactions: [],
    attachments: [],
    mentions: [],
    pinnedAt: null,
    poll: null,
    reactionRoles: [],
    replyCount: 0,
    title: null,
    embeds: [],
    components: [],
    ...over,
  };
}

type Call = { method: string; path: string; body: unknown };

function setup() {
  const calls: Call[] = [];
  const sockets: { socket: FakeSocket; opts: SocketOptions }[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = input.replace('http://api.test', '');
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/me')
      return json(200, { ...botUser, email: null, hasAccount: true, createdAt: new Date().toISOString() });
    if (path === '/bots/@me') return json(200, { id: 'bot-row', user: botUser, commands: [] });
    if (path === '/servers') return json(200, []);
    if (path.startsWith('/channels/') && method === 'POST') {
      const b = init?.body ? (JSON.parse(String(init.body)) as { body: string; replyToId?: string }) : { body: '' };
      return json(201, messageDto({ id: '77777777-7777-4777-8777-777777777777', author: botUser, body: b.body }));
    }
    if (path.startsWith('/messages/') && method === 'PATCH') {
      const b = JSON.parse(String(init?.body)) as { body: string };
      return json(200, messageDto({ id: path.split('/')[2], author: botUser, body: b.body }));
    }
    if (path.endsWith('/reply')) {
      const b = JSON.parse(String(init?.body)) as { ephemeral: boolean };
      return json(201, { messageId: b.ephemeral ? null : MSG_ID });
    }
    if (path.endsWith('/defer')) return new Response(null, { status: 204 });
    if (/\/messages\/[^/]+(\/reactions\/.+)?$/.test(path) && (method === 'PUT' || method === 'DELETE'))
      return new Response(null, { status: 204 });
    if (path === '/falha') return json(403, { statusCode: 403, message: 'sem permissão', details: { x: 1 } });
    return json(404, { statusCode: 404, message: `rota ${method} ${path} não existe no mock` });
  });
  const client = new Client({
    baseUrl: 'http://api.test/',
    fetch: fetchMock,
    createSocket: (_url, opts) => {
      const socket = new FakeSocket();
      sockets.push({ socket, opts });
      return socket;
    },
  });
  return { client, calls, sockets, socket: () => sockets[0]!.socket };
}

describe('Client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('login autentica pelo REST, abre o socket com o token e agenda o heartbeat após ready', async () => {
    const { client, calls, sockets, socket } = setup();
    const ready = vi.fn();
    client.on('ready', ready);
    await client.login('ocb_teste');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/me' });
    expect(client.user?.username).toBe('meubot');
    expect(client.user?.bot).toBe(true);
    expect(client.application.id).toBe('bot-row');
    expect(sockets[0]?.opts).toEqual({ path: '/realtime', auth: { token: 'ocb_teste' }, transports: ['websocket'] });

    socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveBeenCalledWith(client);
    expect(client.isReady()).toBe(true);
    const beats = () => socket().emitted.filter((e) => e.event === 'presence:heartbeat');
    expect(beats()).toHaveLength(1);
    expect(beats()[0]?.args[0]).toEqual({ status: 'online' });
    await vi.advanceTimersByTimeAsync(2500);
    expect(beats()).toHaveLength(3);
    expect(client.ws.ping).toBeGreaterThanOrEqual(0);

    socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveBeenCalledTimes(1);

    client.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(beats()).toHaveLength(4);
    expect(socket().connected).toBe(false);
  });

  it('login sem token falha com mensagem clara', async () => {
    const { client } = setup();
    delete process.env.OPENCORD_TOKEN;
    await expect(client.login()).rejects.toThrow(/OPENCORD_TOKEN/);
  });

  it('erro HTTP vira OpenCordAPIError com status, message e details', async () => {
    const { client } = setup();
    await client.login('ocb_teste');
    await expect(client.rest.get('/falha')).rejects.toMatchObject({
      name: 'OpenCordAPIError',
      status: 403,
      message: 'sem permissão',
      details: { x: 1 },
    });
  });

  it('chat:message:created vira messageCreate e Message.reply faz POST com replyToId', async () => {
    const { client, calls, socket } = setup();
    await client.login('ocb_teste');
    const got: Message[] = [];
    client.on('messageCreate', (m) => got.push(m));
    socket().fire('chat:message:created', messageDto());
    expect(got).toHaveLength(1);
    const msg = got[0]!;
    expect(msg.content).toBe('!ping');
    expect(msg.author.bot).toBe(false);
    expect(msg.author.toString()).toBe(`<@${USER_ID}>`);
    expect(msg.channelId).toBe(CHANNEL_ID);
    expect(msg.inGuild()).toBe(true);

    const sent = await msg.reply('pong');
    const post = calls.find((c) => c.method === 'POST' && c.path === `/channels/${CHANNEL_ID}/messages`);
    expect(post?.body).toMatchObject({ body: 'pong', replyToId: MSG_ID });
    expect((post?.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.author.id).toBe(BOT_ID);
    expect(sent.content).toBe('pong');

    // eventos duplicados (mesmo eventId) são ignorados
    socket().fire('chat:message:created', messageDto(), 'dup');
    socket().fire('chat:message:created', messageDto(), 'dup');
    expect(got).toHaveLength(2);

    await msg.react('👍');
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: `/messages/${MSG_ID}/reactions/%F0%9F%91%8D` });
    await msg.edit('x');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: `/messages/${MSG_ID}`, body: { body: 'x' } });
    await msg.delete();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/messages/${MSG_ID}` });
  });

  it('mensagem de conversa direta responde em /conversations e não está em servidor', async () => {
    const { client, calls, socket } = setup();
    await client.login('ocb_teste');
    const got: Message[] = [];
    client.on('messageCreate', (m) => got.push(m));
    const CONV = '88888888-8888-4888-8888-888888888888';
    socket().fire('chat:message:created', messageDto({ channelId: null, conversationId: CONV }));
    const msg = got[0]!;
    expect(msg.inGuild()).toBe(false);
    expect(msg.guildId).toBeNull();
    expect(msg.channel.isDMBased()).toBe(true);
    await msg.channel.send('oi').catch(() => undefined);
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/conversations/${CONV}/messages` });
  });

  it('interaction:created vira interactionCreate; options e reply efêmera', async () => {
    const { client, calls, socket } = setup();
    await client.login('ocb_teste');
    const got: ChatInputCommandInteraction[] = [];
    client.on('interactionCreate', (i) => {
      if (i.isChatInputCommand()) got.push(i);
    });
    const dto: Interaction = {
      id: INTERACTION_ID,
      type: 'command',
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      botId: 'bot-row',
      user: person,
      command: 'ola',
      options: { nome: 'Ana', vezes: 2, alto: true, alvo: USER_ID },
      createdAt: new Date().toISOString(),
    };
    socket().fire('interaction:created', dto);
    expect(got).toHaveLength(1);
    const i = got[0]!;
    expect(i.isChatInputCommand()).toBe(true);
    expect(i.isButton()).toBe(false);
    expect(i.commandName).toBe('ola');
    expect(i.options.getString('nome')).toBe('Ana');
    expect(i.options.getInteger('vezes')).toBe(2);
    expect(i.options.getBoolean('alto')).toBe(true);
    expect(i.options.getUser('alvo')?.id).toBe(USER_ID);
    expect(i.options.getString('nada')).toBeNull();
    expect(() => i.options.getString('nada', true)).toThrow(/obrigatória "nada"/);
    expect(() => i.options.getInteger('nome')).toThrow(/não é integer/);

    await i.reply({ content: 'Olá, Ana!', ephemeral: true });
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/reply`,
      body: { content: 'Olá, Ana!', ephemeral: true },
    });
    expect(i.replied).toBe(true);
    await expect(i.reply('de novo')).rejects.toThrow(/já respondida/);
    // efêmera não tem mensagem: editReply responde de novo, ainda efêmera
    await i.editReply('Olá de novo');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { content: 'Olá de novo', ephemeral: true } });
  });

  it('deferReply chama /defer e editReply depois responde; reply com mensagem + editReply faz PATCH', async () => {
    const { client, calls, socket } = setup();
    await client.login('ocb_teste');
    const got: ChatInputCommandInteraction[] = [];
    client.on('interactionCreate', (i) => {
      if (i.isChatInputCommand()) got.push(i);
    });
    const base: Interaction = {
      id: INTERACTION_ID,
      type: 'command',
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      botId: 'bot-row',
      user: person,
      command: 'ola',
      options: {},
      createdAt: new Date().toISOString(),
    };
    socket().fire('interaction:created', base);
    const a = got[0]!;
    await expect(a.editReply('x')).rejects.toThrow(/responda ou adie/);
    await a.deferReply({ ephemeral: true });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/interactions/${INTERACTION_ID}/defer` });
    expect(a.deferred).toBe(true);
    await a.editReply('pronto');
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/reply`,
      body: { content: 'pronto', ephemeral: true },
    });

    socket().fire('interaction:created', { ...base, id: '99999999-9999-4999-8999-999999999999' });
    const b = got[1]!;
    await b.reply('pública');
    expect(calls.at(-1)).toMatchObject({ body: { content: 'pública', ephemeral: false } });
    const edited = await b.editReply('editada');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: `/messages/${MSG_ID}`, body: { body: 'editada' } });
    expect(edited).toBeInstanceOf(Message);
    await b.followUp('mais uma');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/channels/${CHANNEL_ID}/messages` });
  });

  it('application.commands.set aceita builders e objetos e faz PUT /bots/@me/commands', async () => {
    const { client, calls } = setup();
    await client.login('ocb_teste');
    const { SlashCommandBuilder } = await import('../src/index.js');
    const fetchCalls = calls.length;
    await client.application.commands
      .set([new SlashCommandBuilder().setName('a').setDescription('A'), { name: 'b', description: 'B', options: [] }])
      .catch(() => undefined);
    expect(calls[fetchCalls]).toMatchObject({
      method: 'PUT',
      path: '/bots/@me/commands',
      body: {
        commands: [
          { name: 'a', description: 'A', options: [] },
          { name: 'b', description: 'B', options: [] },
        ],
      },
    });
  });

  it('disconnect para o heartbeat e emite "disconnect"', async () => {
    const { client, socket } = setup();
    await client.login('ocb_teste');
    const disc = vi.fn();
    client.on('disconnect', disc);
    socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    for (const h of socket().handlers.get('disconnect') ?? []) h('transport close');
    expect(disc).toHaveBeenCalledWith('transport close');
    const before = socket().emitted.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(socket().emitted.length).toBe(before);
  });
});

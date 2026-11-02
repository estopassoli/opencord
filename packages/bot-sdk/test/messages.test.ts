import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Poll as PollDto } from '@opencord/contracts';
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  EmbedBuilder,
  type Message,
  type Presence,
} from '../src/index.js';
import {
  ATTACHMENT_ID,
  BOT_ID,
  CHANNEL_ID,
  CONV_ID,
  MSG2_ID,
  MSG_ID,
  SERVER_ID,
  USER2_ID,
  USER_ID,
  interactionDto,
  json,
  last,
  messageDto,
  noContent,
  person,
  person2,
  setup,
} from './helpers.js';

const pollDto = (over: Partial<PollDto> = {}): PollDto => ({
  id: 'p1',
  question: 'Próximo livro?',
  multiple: false,
  endsAt: null,
  closed: false,
  options: [
    { id: 'o1', text: 'Dom Casmurro', votes: 1 },
    { id: 'o2', text: 'Iracema', votes: 0 },
  ],
  voters: 1,
  mine: [],
  ...over,
});

describe('mensagens, enquetes, presença', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('send com embeds, componentes e files (upload multipart → attachmentIds); Message.embeds/components/attachments', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === '/attachments')
        return json(201, {
          attachment: {
            id: ATTACHMENT_ID,
            originalName: 'capa.png',
            mime: 'image/png',
            sizeBytes: 3,
            url: 'http://api.test/attachments/x/download',
            width: 10,
            height: 20,
          },
        });
      if (/^\/channels\/[^/]+\/messages$/.test(c.path) && c.method === 'POST') {
        const b = c.body as { body: string; attachmentIds?: string[] };
        return json(
          201,
          messageDto({
            id: MSG2_ID,
            author: { ...person, id: BOT_ID },
            body: b.body,
            attachments: (b.attachmentIds ?? []).map((id) => ({
              id,
              originalName: 'capa.png',
              mime: 'image/png',
              sizeBytes: 3,
              url: 'u',
              width: 10,
              height: 20,
            })),
          }),
        );
      }
      return undefined;
    });
    await s.ready();
    const ch = s.client.channels.cache.get(CHANNEL_ID)!;
    const sent = await ch.send({
      content: 'Capa',
      embeds: [new EmbedBuilder().setTitle('Livro').setColor('Gold')],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ver').setLabel('Ver'))],
      files: [{ attachment: Buffer.from([1, 2, 3]), name: 'capa.png' }],
    });
    const upload = s.calls.find((c) => c.path === '/attachments')!;
    expect(upload.method).toBe('POST');
    expect((upload.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(((upload.body as FormData).get('file') as File).type).toBe('image/png');
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/channels/${CHANNEL_ID}/messages`,
      body: {
        body: 'Capa',
        attachmentIds: [ATTACHMENT_ID],
        embeds: [{ title: 'Livro', color: '#f1c40f', fields: [] }],
        components: [{ type: 'row', components: [{ type: 'button', customId: 'ver', label: 'Ver' }] }],
      },
    });
    expect(sent.attachments.first()).toMatchObject({
      id: ATTACHMENT_ID,
      name: 'capa.png',
      contentType: 'image/png',
      size: 3,
      width: 10,
      height: 20,
    });
    expect(sent.attachments.first()?.url).toBe('u');
    await expect(ch.send({})).rejects.toThrow(/mensagem vazia/);
    await expect(ch.send({ content: 'x'.repeat(4001) })).rejects.toThrow(/4000/);
    await expect(ch.send({ content: 'x', files: new Array(11).fill(Buffer.from('a')) })).rejects.toThrow(
      /até 10 anexos/,
    );
    // só arquivo, sem texto, vale
    await ch.send({ files: [Buffer.from('a')] });
    expect(last(s.calls)).toMatchObject({ body: { body: '', attachmentIds: [ATTACHMENT_ID] } });
  });

  it('edit parcial (components: []), fetch (GET /messages/:id), fetchReplies, pinned, search, setReactionRoles, startThread', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === `/messages/${MSG_ID}/replies?limit=5`)
        return json(200, [
          messageDto({
            id: MSG2_ID,
            body: 'resposta',
            replyTo: { id: MSG_ID, author: person, bodyPreview: '!ping', deleted: false },
          }),
        ]);
      if (c.path === `/channels/${CHANNEL_ID}/pins`)
        return json(200, [messageDto({ pinnedAt: new Date().toISOString() })]);
      if (c.path.startsWith(`/servers/${SERVER_ID}/messages/search`))
        return json(200, { messages: [messageDto()], total: 1 });
      if (c.path.startsWith(`/conversations/${CONV_ID}/messages/search`)) return json(200, { messages: [], total: 0 });
      if (c.path === `/messages/${MSG_ID}/reaction-roles`)
        return json(
          200,
          messageDto({ reactionRoles: (c.body as { pairs: { emoji: string; roleId: string }[] }).pairs }),
        );
      return undefined;
    });
    await s.ready();
    const msg = await new Promise<Message>((r) => {
      s.client.once('messageCreate', r);
      s.socket().fire(
        'chat:message:created',
        messageDto({
          components: [
            {
              type: 'row',
              components: [{ type: 'button', style: 'primary', label: 'x', customId: 'x', disabled: false }],
            },
          ],
          embeds: [{ title: 'E', fields: [] }],
        }),
      );
    });
    expect(msg.components).toHaveLength(1);
    expect(msg.hasComponents).toBe(true);
    expect(msg.embeds[0]?.title).toBe('E');
    const edited = await msg.edit({ components: [] });
    expect(last(s.calls)).toMatchObject({ method: 'PATCH', path: `/messages/${MSG_ID}`, body: { components: [] } });
    expect(last(s.calls).body).not.toHaveProperty('body');
    expect(edited.components).toEqual([]);
    await msg.edit({ content: 'novo', embeds: [new EmbedBuilder().setDescription('d')] });
    expect(last(s.calls)).toMatchObject({ body: { body: 'novo', embeds: [{ description: 'd', fields: [] }] } });
    await expect(msg.edit({})).rejects.toThrow(/nada para editar/);
    await expect(msg.edit({ content: 'x', files: [Buffer.from('a')] })).rejects.toThrow(/anexos ao editar/);
    const fetched = await msg.fetch();
    expect(last(s.calls)).toMatchObject({ method: 'GET', path: `/messages/${MSG_ID}` });
    expect(fetched.content).toBe('buscada');
    const replies = await msg.fetchReplies({ limit: 5 });
    expect(replies.first()?.reference?.messageId).toBe(MSG_ID);
    const pinned = await msg.channel.messages.fetchPinned();
    expect(pinned.first()?.pinned).toBe(true);
    const found = await msg.channel.messages.search({ q: 'ping', authorId: USER_ID, has: 'link' });
    expect(last(s.calls)).toMatchObject({
      method: 'GET',
      path: `/servers/${SERVER_ID}/messages/search?q=ping&authorId=${USER_ID}&has=link&channelId=${CHANNEL_ID}`,
    });
    expect(found.total).toBe(1);
    expect(found.messages.first()?.id).toBe(MSG_ID);
    await s.client.guilds.cache.get(SERVER_ID)!.messages.search('livro');
    expect(last(s.calls)).toMatchObject({ path: `/servers/${SERVER_ID}/messages/search?q=livro` });
    const dm = await new Promise<Message>((r) => {
      s.client.once('messageCreate', r);
      s.socket().fire(
        'chat:message:created',
        messageDto({ id: '55555555-5555-4555-8555-555555555777', channelId: null, conversationId: CONV_ID }),
      );
    });
    await dm.channel.messages.search('x');
    expect(last(s.calls)).toMatchObject({ path: `/conversations/${CONV_ID}/messages/search?q=x` });
    const rr = await msg.setReactionRoles([
      { emoji: '📚', roleId: '77777777-7777-4777-8777-777777777771' },
      { emoji: '🎮', role: { id: '77777777-7777-4777-8777-777777777771' } },
    ]);
    expect(last(s.calls)).toMatchObject({
      method: 'PUT',
      path: `/messages/${MSG_ID}/reaction-roles`,
      body: { pairs: [{ emoji: '📚' }, { emoji: '🎮' }] },
    });
    expect(rr.reactionRoles).toHaveLength(2);
    expect(() => msg.startThread({ name: 'x' })).toThrow(/threads não existem/);
    const single = await msg.channel.messages.fetch(MSG2_ID);
    expect(single.id).toBe(MSG2_ID);
  });

  it('bulkDelete (n e ids) → POST bulk-delete + messageDeleteBulk; reactions.cache/removeAll; messageReactionRemoveAll', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === `/channels/${CHANNEL_ID}/messages?limit=2`)
        return json(200, { messages: [messageDto({ id: MSG_ID }), messageDto({ id: MSG2_ID })], nextBefore: null });
      if (c.path === `/channels/${CHANNEL_ID}/messages/bulk-delete`) return noContent();
      return undefined;
    });
    await s.ready();
    const ch = s.client.channels.cache.get(CHANNEL_ID)!;
    const bulk = vi.fn();
    s.client.on('messageDeleteBulk', bulk);
    const deleted = await ch.bulkDelete(2);
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/channels/${CHANNEL_ID}/messages/bulk-delete`,
      body: { messageIds: [MSG_ID, MSG2_ID] },
    });
    expect(deleted.size).toBe(2);
    expect(bulk).toHaveBeenCalledWith(deleted, ch);
    await ch.bulkDelete([MSG_ID]);
    expect(last(s.calls)).toMatchObject({ body: { messageIds: [MSG_ID] } });
    await expect(ch.bulkDelete(101)).rejects.toThrow(/de 1 a 100/);
    await expect(
      ch.bulkDelete(new Array(101).fill(MSG_ID).map((id, i) => `${id.slice(0, -3)}${String(i).padStart(3, '0')}`)),
    ).rejects.toThrow(/até 100/);
    expect(await ch.bulkDelete([])).toHaveProperty('size', 0);

    const msg = await new Promise<Message>((r) => {
      s.client.once('messageCreate', r);
      s.socket().fire(
        'chat:message:created',
        messageDto({ reactions: [{ emoji: '👍', count: 2, me: false, userIds: [USER_ID, BOT_ID] }] }),
      );
    });
    const reaction = msg.reactions.cache.get('👍')!;
    expect(reaction.count).toBe(2);
    expect(reaction.me).toBe(true);
    expect(reaction.users.cache.get(USER_ID)?.username).toBe('ana');
    expect(msg.reactions.resolve({ name: '👍' })).toBe(reaction);
    await msg.reactions.removeAll();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/messages/${MSG_ID}/reactions` });
    await reaction.remove();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/messages/${MSG_ID}/reactions/%F0%9F%91%8D` });
    await expect(reaction.users.remove(USER_ID)).rejects.toThrow(/própria reação/);
    const cleared = vi.fn();
    s.client.on('messageReactionRemoveAll', cleared);
    s.socket().fire('chat:reactions:cleared', { messageId: MSG_ID, channelId: CHANNEL_ID, conversationId: null });
    expect(cleared).toHaveBeenCalledWith(expect.objectContaining({ id: MSG_ID, partial: true }), expect.any(Map));
    const pins = vi.fn();
    s.client.on('channelPinsUpdate', pins);
    s.socket().fire('chat:message:updated', messageDto({ pinnedAt: '2026-11-02T13:00:00.000Z' }));
    expect(pins).toHaveBeenCalledWith(ch, new Date('2026-11-02T13:00:00.000Z'));
    s.socket().fire('chat:message:updated', messageDto({ pinnedAt: '2026-11-02T13:00:00.000Z', body: 'editada' }));
    expect(pins).toHaveBeenCalledTimes(1);
    s.socket().fire('chat:message:updated', messageDto({ pinnedAt: null }));
    expect(pins).toHaveBeenCalledTimes(2);
  });

  it('enquetes: send({ poll }) → POST /polls; Poll.vote/end; evento pollUpdate', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === `/channels/${CHANNEL_ID}/polls`)
        return json(201, messageDto({ id: MSG2_ID, body: '', poll: pollDto() }));
      if (c.path === '/polls/p1/vote')
        return json(
          200,
          pollDto({
            mine: (c.body as { optionIds: string[] }).optionIds,
            voters: 2,
            options: [
              { id: 'o1', text: 'Dom Casmurro', votes: 2 },
              { id: 'o2', text: 'Iracema', votes: 0 },
            ],
          }),
        );
      if (c.path === '/polls/p1/close') return json(200, pollDto({ closed: true }));
      return undefined;
    });
    await s.ready();
    const ch = s.client.channels.cache.get(CHANNEL_ID)!;
    const m = await ch.send({
      poll: {
        question: { text: 'Próximo livro?' },
        answers: [{ text: 'Dom Casmurro' }, 'Iracema'],
        allowMultiselect: false,
        duration: 24,
      },
    });
    const call = last(s.calls);
    expect(call).toMatchObject({
      method: 'POST',
      path: `/channels/${CHANNEL_ID}/polls`,
      body: { question: 'Próximo livro?', options: ['Dom Casmurro', 'Iracema'], multiple: false, durationHours: 24 },
    });
    expect((call.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    const poll = m.poll!;
    expect(poll.question.text).toBe('Próximo livro?');
    expect(poll.answers.get('o1')?.voteCount).toBe(1);
    expect(poll.answers.first()?.text).toBe('Dom Casmurro');
    expect(poll.allowMultiselect).toBe(false);
    expect(poll.resultsFinalized).toBe(false);
    const voted = await poll.vote(poll.answers.get('o1')!);
    expect(last(s.calls)).toMatchObject({ method: 'PUT', path: '/polls/p1/vote', body: { optionIds: ['o1'] } });
    expect(voted.mine).toEqual(['o1']);
    expect(voted.voters).toBe(2);
    const ended = await poll.end();
    expect(last(s.calls)).toMatchObject({ method: 'POST', path: '/polls/p1/close' });
    expect(ended.closed).toBe(true);
    await expect(ch.send({ poll: { question: 'x', answers: ['a'] } })).rejects.toThrow(/de 2 a 10/);
    await expect(ch.send({ poll: { question: 'x', answers: ['a', 'b'], duration: 5 } })).rejects.toThrow(/duração/);
    const updated = vi.fn();
    s.client.on('pollUpdate', updated);
    s.socket().fire('poll:updated', {
      messageId: MSG2_ID,
      channelId: CHANNEL_ID,
      conversationId: null,
      poll: pollDto({ voters: 3 }),
    });
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', voters: 3 }));
    expect(updated.mock.calls[0]![0].message.id).toBe(MSG2_ID);
  });

  it('sendTyping → chat:typing:start; typingStart; presença (setPresence/setStatus/setActivity/setStatusText) e presenceUpdate', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === '/me/presence') return json(200, { status: (c.body as { status: string }).status });
      if (c.path === '/me/status-text') return json(200, { text: (c.body as { text: string | null }).text });
      if (c.path === `/servers/${SERVER_ID}/presence`) return json(200, { [USER_ID]: 'online', [USER2_ID]: 'offline' });
      return undefined;
    });
    await s.ready();
    const ch = s.client.channels.cache.get(CHANNEL_ID)!;
    await ch.sendTyping();
    expect(s.socket().sent('chat:typing:start')[0]?.args[0]).toEqual({ channelId: CHANNEL_ID });
    const typing = vi.fn();
    s.client.on('typingStart', typing);
    s.socket().fire('chat:typing', { channelId: CHANNEL_ID, conversationId: null, userId: USER_ID, active: true });
    s.socket().fire('chat:typing', { channelId: CHANNEL_ID, conversationId: null, userId: USER_ID, active: false });
    expect(typing).toHaveBeenCalledTimes(1);
    const t = typing.mock.calls[0]![0];
    expect(t.user.id).toBe(USER_ID);
    expect(t.channel.id).toBe(CHANNEL_ID);
    expect(t.member?.displayName).toBe('Ana');
    expect(t.inGuild()).toBe(true);

    await s.client.user!.setPresence({ status: 'dnd', activities: [{ name: 'Xadrez', type: ActivityType.Playing }] });
    expect(s.calls.find((c) => c.path === '/me/presence')).toMatchObject({ method: 'PUT', body: { status: 'dnd' } });
    const game = s.socket().sent('presence:game');
    expect(game[0]?.args[0]).toMatchObject({ game: { name: 'Xadrez' } });
    expect(s.client.presenceStatus).toBe('dnd');
    // o heartbeat passa a levar o status escolhido
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.socket().sent('presence:heartbeat').at(-1)?.args[0]).toEqual({ status: 'dnd' });
    await s.client.user!.setStatus('invisible');
    expect(s.client.presenceStatus).toBe('invisible');
    await s.client.user!.setActivity();
    expect(s.socket().sent('presence:game').at(-1)?.args[0]).toEqual({ game: null });
    await s.client.user!.setActivity('Lendo');
    expect(s.socket().sent('presence:game').at(-1)?.args[0]).toMatchObject({ game: { name: 'Lendo' } });
    expect(await s.client.user!.setStatusText('lendo até 22h')).toBe('lendo até 22h');
    expect(last(s.calls)).toMatchObject({ method: 'PUT', path: '/me/status-text', body: { text: 'lendo até 22h' } });
    // após reconectar, o jogo é reenviado
    s.socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.socket().sent('presence:game').at(-1)?.args[0]).toMatchObject({ game: { name: 'Lendo' } });

    const updates: [Presence | null, Presence][] = [];
    s.client.on('presenceUpdate', (o, n) => updates.push([o, n]));
    s.socket().fire('presence:changed', { userId: USER_ID, status: 'idle' });
    s.socket().fire('presence:game:changed', { userId: USER_ID, game: { name: 'Tetris', startedAt: 1000 } });
    s.socket().fire('presence:text:changed', { userId: USER_ID, text: 'ocupada' });
    expect(updates[0]![0]).toBeNull();
    expect(updates[0]![1].status).toBe('idle');
    expect(updates[1]![0]?.activities).toEqual([]);
    expect(updates[1]![1].activities[0]?.name).toBe('Tetris');
    expect(updates[2]![1].statusText).toBe('ocupada');
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    expect(g.presences.cache.get(USER_ID)?.status).toBe('idle');
    expect(g.members.cache.get(USER_ID)?.presence?.activities[0]?.name).toBe('Tetris');
    expect(s.client.users.cache.get(USER_ID)?.presence?.statusText).toBe('ocupada');
    await g.presences.fetch();
    expect(last(s.calls)).toMatchObject({ method: 'GET', path: `/servers/${SERVER_ID}/presence` });
    expect(g.presences.cache.get(USER2_ID)?.status).toBe('offline');
  });

  it('users.fetch com perfil, block/unblock, fetchInvite, createDM com destinatários', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === `/users/${USER2_ID}/profile`)
        return json(200, {
          user: { ...person2, verified: true },
          createdAt: '2026-01-01T00:00:00.000Z',
          friendSince: null,
          mutualServers: [{ id: SERVER_ID, name: 'Clube', iconKey: null, official: false }],
          mutualFriends: [],
        });
      if (c.path === `/blocks/${USER2_ID}`) return noContent();
      if (c.path === '/invites/AbCdEfGhIj')
        return json(200, {
          code: 'AbCdEfGhIj',
          server: { id: SERVER_ID, name: 'Clube', iconKey: null, official: false },
          memberCount: 3,
          joined: true,
        });
      if (c.path === '/conversations' && c.method === 'POST')
        return json(201, {
          id: CONV_ID,
          kind: 'dm',
          name: null,
          members: [person2, { ...person, id: BOT_ID, bot: true }],
          lastMessageId: null,
        });
      return undefined;
    });
    await s.ready();
    const u = await s.client.users.fetch(USER2_ID);
    expect(u.profile?.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(u.profile?.mutualServers[0]?.name).toBe('Clube');
    expect(u.verified).toBe(true);
    expect(u.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    const n = s.calls.length;
    await s.client.users.fetch(USER2_ID);
    expect(s.calls.length).toBe(n); // já tinha perfil: não refaz
    await u.fetch();
    expect(s.calls.length).toBe(n + 1);
    await u.block();
    expect(last(s.calls)).toMatchObject({ method: 'PUT', path: `/blocks/${USER2_ID}` });
    await u.unblock();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/blocks/${USER2_ID}` });
    const inv = await s.client.fetchInvite('https://app.test/invite/AbCdEfGhIj');
    expect(last(s.calls)).toMatchObject({ method: 'GET', path: '/invites/AbCdEfGhIj' });
    expect(inv.guildName).toBe('Clube');
    expect(inv.memberCount).toBe(3);
    expect(inv.guild?.id).toBe(SERVER_ID);
    const dm = await u.createDM();
    expect(dm.recipient?.id).toBe(USER2_ID);
    expect(dm.recipients.size).toBe(2);
    expect(String(dm)).toBe(`<@${USER2_ID}>`);
    const i = interactionDto();
    expect(i.type).toBe('command');
  });
});

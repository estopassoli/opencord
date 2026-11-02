import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  type GuildBan,
  type GuildMember,
  type Role,
} from '../src/index.js';
import {
  BOT_ID,
  CATEGORY_ID,
  CHANNEL_ID,
  ROLE_EVERYONE,
  ROLE_MOD,
  SERVER_ID,
  USER2_ID,
  USER_ID,
  botUser,
  channelDto,
  json,
  last,
  memberDto,
  noContent,
  person,
  person2,
  roleDto,
  serverDetail,
  setup,
} from './helpers.js';

describe('servidor: permissões, moderação e gestão', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('member.permissions inclui @everyone; dono tem tudo; o bot usa myPermissions; permissionsIn aplica overrides', async () => {
    const s = setup({
      details: {
        [SERVER_ID]: serverDetail({
          channels: [
            channelDto({
              overrides: [
                { subjectType: 'role', subjectId: ROLE_EVERYONE, allow: 0, deny: PermissionFlagsBits.SendMessages },
              ],
              myPermissions: 1,
            }),
          ],
        }),
      },
    });
    await s.ready();
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    const ana = g.members.cache.get(USER_ID)!; // dona
    const bruno = g.members.cache.get(USER2_ID)!; // @everyone + Moderação
    const me = g.members.me!;
    expect(ana.permissions).toBeInstanceOf(PermissionsBitField);
    expect(ana.permissions.bitfield).toBe(PermissionsBitField.All);
    expect(bruno.permissions.bitfield).toBe(0b111011 | (1 << 2));
    expect(bruno.permissions.has('ManageMessages')).toBe(true);
    expect(bruno.permissions.has(['ViewChannel', 'SendMessages'])).toBe(true);
    expect(me.permissions.bitfield).toBe(g.myPermissions);
    const ch = g.channels.cache.get(CHANNEL_ID)!;
    expect(bruno.permissionsIn(ch).has('SendMessages')).toBe(false);
    expect(bruno.permissionsIn(ch).has('ManageMessages')).toBe(true);
    expect(me.permissionsIn(ch).bitfield).toBe(1);
    expect(ch.permissionsFor(bruno)?.has('SendMessages')).toBe(false);
    expect(ch.permissions.has('ViewChannel')).toBe(true);
    expect(g.roles.everyone?.id).toBe(ROLE_EVERYONE);
    expect(g.roles.highest?.name).toBe('Moderação');
    expect(bruno.roles.highest?.name).toBe('Moderação');
    expect(g.roles.cache.get(ROLE_MOD)?.members.size).toBe(2);
    expect(g.owner?.id).toBe(USER_ID);
    expect((await g.fetchOwner()).id).toBe(USER_ID);
    expect(me.kickable).toBe(false);
    expect(ana.kickable).toBe(false); // dona
    expect(ch.parent?.name).toBe('Texto');
    expect(ch.type).toBe(ChannelType.GuildText);
    expect(g.categories.cache.get(CATEGORY_ID)?.children.cache.has(CHANNEL_ID)).toBe(true);
  });

  it('kick/ban/unban/timeout: rotas e corpos; guild.bans.fetch', async () => {
    const s = setup();
    const banned: unknown[] = [];
    s.routes.push((c) => {
      if (c.path === `/servers/${SERVER_ID}/bans` && c.method === 'GET')
        return json(200, [
          { serverId: SERVER_ID, user: person2, reason: 'spam', by: botUser, createdAt: new Date().toISOString() },
        ]);
      if (/\/members\/[^/]+$/.test(c.path) && c.method === 'PATCH') {
        const b = c.body as { timeoutUntil: string | null };
        return json(200, memberDto(person2, { roleIds: [ROLE_MOD], timeoutUntil: b.timeoutUntil }));
      }
      if (/\/members\/[^/]+$/.test(c.path) && c.method === 'DELETE') return noContent();
      if (/\/bans\/[^/]+$/.test(c.path)) {
        banned.push(c.body);
        return noContent();
      }
      return undefined;
    });
    await s.ready();
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    const bruno = g.members.cache.get(USER2_ID)!;
    await bruno.kick('flood');
    expect(last(s.calls)).toMatchObject({
      method: 'DELETE',
      path: `/servers/${SERVER_ID}/members/${USER2_ID}`,
      body: { reason: 'flood' },
    });
    await bruno.ban({ reason: 'spam', deleteMessageSeconds: 3600 });
    expect(last(s.calls)).toMatchObject({
      method: 'PUT',
      path: `/servers/${SERVER_ID}/bans/${USER2_ID}`,
      body: { reason: 'spam', deleteMessageSeconds: 3600 },
    });
    await g.members.ban(USER_ID, { deleteMessageDays: 1 });
    expect(last(s.calls)).toMatchObject({ body: { deleteMessageSeconds: 86400 } });
    await expect(g.bans.create(USER_ID, { deleteMessageSeconds: 99999999 })).rejects.toThrow(/7 dias/);
    await g.members.unban(USER2_ID);
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/servers/${SERVER_ID}/bans/${USER2_ID}` });
    const bans = await g.bans.fetch();
    expect(bans.first()?.reason).toBe('spam');
    expect(bans.first()?.executor?.id).toBe(BOT_ID);
    expect((await g.bans.fetch(USER2_ID)).user.username).toBe('bruno');
    await expect(g.bans.fetch(USER_ID)).rejects.toThrow(/não está banido/);

    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const m = await bruno.timeout(60_000, 'calma');
    expect(last(s.calls)).toMatchObject({
      method: 'PATCH',
      path: `/servers/${SERVER_ID}/members/${USER2_ID}`,
      body: { timeoutUntil: '2026-11-02T12:01:00.000Z', reason: 'calma' },
    });
    expect(m.isCommunicationDisabled()).toBe(true);
    expect(m.communicationDisabledUntil?.toISOString()).toBe('2026-11-02T12:01:00.000Z');
    expect(g.members.cache.get(USER2_ID)?.isCommunicationDisabled()).toBe(true);
    const off = await m.timeout(null);
    expect(last(s.calls)).toMatchObject({ body: { timeoutUntil: null } });
    expect(off.isCommunicationDisabled()).toBe(false);
    await expect(m.timeout(29 * 24 * 3600 * 1000)).rejects.toThrow(/28 dias/);
    await expect(m.disableCommunicationUntil(new Date('2026-11-03T12:00:00Z'))).resolves.toBeTruthy();
  });

  it('member.roles.add/remove/set e setNickname (só o próprio bot)', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (/\/members\/[^/]+\/roles$/.test(c.path))
        return json(200, memberDto(person, { roleIds: (c.body as { roleIds: string[] }).roleIds }));
      if (c.path === `/servers/${SERVER_ID}/members/me`)
        return json(
          200,
          memberDto(botUser, { nickname: (c.body as { nickname: string }).nickname, roleIds: [ROLE_MOD] }),
        );
      return undefined;
    });
    await s.ready();
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    const ana = g.members.cache.get(USER_ID)!;
    const withRole = await ana.roles.add(ROLE_MOD);
    expect(last(s.calls)).toMatchObject({
      method: 'PUT',
      path: `/servers/${SERVER_ID}/members/${USER_ID}/roles`,
      body: { roleIds: [ROLE_MOD] },
    });
    expect(withRole.roles.cache.first()?.name).toBe('Moderação');
    expect(withRole.roles.has(ROLE_MOD)).toBe(true);
    const removed = await withRole.roles.remove(g.roles.cache.get(ROLE_MOD)!);
    expect(last(s.calls)).toMatchObject({ body: { roleIds: [] } });
    expect(removed.roleIds).toEqual([]);
    await removed.roles.set([ROLE_MOD, ROLE_MOD]);
    expect(last(s.calls)).toMatchObject({ body: { roleIds: [ROLE_MOD] } });
    await expect(ana.setNickname('x')).rejects.toThrow(/próprio bot/);
    const me = await g.members.me!.setNickname('Bibliotecário');
    expect(last(s.calls)).toMatchObject({
      method: 'PATCH',
      path: `/servers/${SERVER_ID}/members/me`,
      body: { nickname: 'Bibliotecário' },
    });
    expect(me.displayName).toBe('Bibliotecário');
    expect(g.members.me?.nickname).toBe('Bibliotecário');
  });

  it('canais e categorias: create/edit/delete; cargos: create/edit/delete; guild.edit/leave; convites; auditoria; webhooks; eventos', async () => {
    const s = setup();
    s.routes.push((c) => {
      if (c.path === `/servers/${SERVER_ID}/channels` && c.method === 'POST') {
        const b = c.body as {
          name: string;
          kind: 'text' | 'voice' | 'board';
          categoryId?: string | null;
          topic?: string | null;
        };
        return json(
          201,
          channelDto({
            id: '33333333-3333-4333-8333-333333333301',
            name: b.name,
            kind: b.kind,
            categoryId: b.categoryId ?? null,
            topic: b.topic ?? null,
          }),
        );
      }
      if (c.path === `/servers/${SERVER_ID}/categories` && c.method === 'POST')
        return json(201, {
          id: '99999999-9999-4999-8999-999999999991',
          serverId: SERVER_ID,
          name: (c.body as { name: string }).name,
          position: 1,
        });
      if (/^\/channels\/[^/]+$/.test(c.path) && c.method === 'PATCH')
        return json(200, channelDto({ ...(c.body as object), id: c.path.split('/')[2] }));
      if (/^\/(channels|categories|roles)\/[^/]+$/.test(c.path) && c.method === 'DELETE') return noContent();
      if (c.path === `/servers/${SERVER_ID}/roles` && c.method === 'POST') {
        const b = c.body as { name: string; permissions: number; color: string | null };
        return json(
          201,
          roleDto({
            id: '77777777-7777-4777-8777-777777777772',
            name: b.name,
            permissions: b.permissions,
            color: b.color ?? null,
            isEveryone: false,
            position: 2,
          }),
        );
      }
      if (/^\/roles\/[^/]+$/.test(c.path) && c.method === 'PATCH')
        return json(200, roleDto({ ...(c.body as object), id: c.path.split('/')[2], isEveryone: false, position: 2 }));
      if (c.path === `/servers/${SERVER_ID}` && c.method === 'PATCH')
        return json(200, { id: SERVER_ID, name: (c.body as { name: string }).name, accent: '#112233' });
      if (c.path === `/servers/${SERVER_ID}/leave`) return noContent();
      if (c.path === `/servers/${SERVER_ID}/invites`)
        return json(201, { code: 'AbCdEfGhIj', serverId: SERVER_ID, url: 'https://app.test/invite/AbCdEfGhIj' });
      if (c.path.startsWith(`/servers/${SERVER_ID}/audit-log`))
        return json(200, [
          {
            id: 'e1',
            actorId: USER_ID,
            serverId: SERVER_ID,
            action: 'member.ban',
            targetId: USER2_ID,
            metadata: { reason: 'spam' },
            createdAt: new Date().toISOString(),
          },
        ]);
      if (c.path === `/servers/${SERVER_ID}/webhooks` && c.method === 'GET')
        return json(200, [
          {
            id: 'w1',
            serverId: SERVER_ID,
            channelId: CHANNEL_ID,
            name: 'Alertas',
            createdBy: botUser,
            createdAt: new Date().toISOString(),
            url: 'http://api.test/webhooks/w1/tok3n',
          },
        ]);
      if (c.path === `/servers/${SERVER_ID}/webhooks` && c.method === 'POST')
        return json(201, {
          id: 'w2',
          serverId: SERVER_ID,
          channelId: (c.body as { channelId: string }).channelId,
          name: (c.body as { name: string }).name,
          createdBy: botUser,
          createdAt: new Date().toISOString(),
          url: 'http://api.test/webhooks/w2/s3cret',
        });
      if (c.path === 'http://api.test/webhooks/w2/s3cret' || c.path === '/webhooks/w2/s3cret') return noContent();
      if (c.path === '/webhooks/w2' && c.method === 'DELETE') return noContent();
      if (c.path === `/servers/${SERVER_ID}/events` && c.method === 'POST') {
        const b = c.body as {
          title: string;
          description: string;
          startsAt: string;
          endsAt: string | null;
          channelId: string | null;
        };
        return json(201, {
          id: 'ev1',
          serverId: SERVER_ID,
          channelId: b.channelId,
          createdBy: botUser,
          title: b.title,
          description: b.description,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          going: [],
          maybe: [],
          me: null,
        });
      }
      if (c.path === '/events/ev1/rsvp')
        return json(200, {
          id: 'ev1',
          serverId: SERVER_ID,
          channelId: null,
          createdBy: botUser,
          title: 'Leitura',
          description: '',
          startsAt: '2026-12-01T20:00:00.000Z',
          endsAt: null,
          going: [BOT_ID],
          maybe: [],
          me: 'going',
        });
      if (c.path === '/events/ev1' && c.method === 'PATCH')
        return json(200, {
          id: 'ev1',
          serverId: SERVER_ID,
          channelId: null,
          createdBy: botUser,
          title: (c.body as { title: string }).title,
          description: '',
          startsAt: '2026-12-01T20:00:00.000Z',
          endsAt: null,
          going: [],
          maybe: [],
          me: null,
        });
      if (c.path === '/events/ev1' && c.method === 'DELETE') return noContent();
      if (c.path === `/servers/${SERVER_ID}/events` && c.method === 'GET') return json(200, []);
      return undefined;
    });
    await s.ready();
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    const ch = await g.channels.create({
      name: 'resenhas',
      type: ChannelType.GuildText,
      parent: CATEGORY_ID,
      topic: 'livros',
    });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/servers/${SERVER_ID}/channels`,
      body: { name: 'resenhas', kind: 'text', categoryId: CATEGORY_ID, topic: 'livros' },
    });
    expect(ch.name).toBe('resenhas');
    expect(s.client.channels.cache.has(ch.id)).toBe(true);
    expect(g.channels.cache.has(ch.id)).toBe(true);
    const cat = await g.channels.create({ name: 'Voz', type: ChannelType.GuildCategory });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/servers/${SERVER_ID}/categories`,
      body: { name: 'Voz' },
    });
    expect(cat.type).toBe('category');
    expect(g.categories.cache.has(cat.id)).toBe(true);
    if (!('topic' in ch)) throw new Error('canal de texto esperado');
    await ch.edit({ name: 'resenhas-2', parent: null });
    expect(last(s.calls)).toMatchObject({
      method: 'PATCH',
      path: `/channels/${ch.id}`,
      body: { name: 'resenhas-2', categoryId: null },
    });
    await ch.setTopic('novo');
    expect(last(s.calls)).toMatchObject({ body: { topic: 'novo' } });
    await g.channels.delete(ch);
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/channels/${ch.id}` });
    await cat.delete();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/categories/${cat.id}` });

    const role = await g.roles.create({
      name: 'Leitores',
      permissions: ['ViewChannel', 'SendMessages'],
      color: 'Blue',
    });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/servers/${SERVER_ID}/roles`,
      body: { name: 'Leitores', permissions: 3, color: '#3498db' },
    });
    expect(role.permissions.has('SendMessages')).toBe(true);
    expect(g.roles.cache.get(role.id)?.hexColor).toBe('#3498db');
    const edited = await role.setPermissions(PermissionFlagsBits.ManageMessages);
    expect(last(s.calls)).toMatchObject({ method: 'PATCH', path: `/roles/${role.id}`, body: { permissions: 4 } });
    expect(edited.permissions.bitfield).toBe(4);
    await role.delete();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/roles/${role.id}` });
    expect(g.roles.cache.has(role.id)).toBe(false);

    await g.edit({ name: 'Clube 2', accent: 0x112233 });
    expect(last(s.calls)).toMatchObject({
      method: 'PATCH',
      path: `/servers/${SERVER_ID}`,
      body: { name: 'Clube 2', accent: '#112233' },
    });
    expect(g.name).toBe('Clube 2');
    expect(g.accent).toBe('#112233');
    const invite = await g.invites.create();
    expect(last(s.calls)).toMatchObject({ method: 'POST', path: `/servers/${SERVER_ID}/invites` });
    expect(invite.code).toBe('AbCdEfGhIj');
    expect(String(invite)).toBe('https://app.test/invite/AbCdEfGhIj');
    const logs = await g.fetchAuditLogs({ limit: 5 });
    expect(last(s.calls)).toMatchObject({ method: 'GET', path: `/servers/${SERVER_ID}/audit-log?limit=5` });
    expect(logs.entries.first()).toMatchObject({
      action: 'member.ban',
      targetId: USER2_ID,
      changes: { reason: 'spam' },
    });
    expect(logs.entries.first()?.executor?.id).toBe(USER_ID);
    const hooks = await g.fetchWebhooks();
    expect(hooks.first()?.token).toBe('tok3n');
    const geral = g.channels.cache.get(CHANNEL_ID)!;
    const hook = await geral.createWebhook({ name: 'Avisos' });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/servers/${SERVER_ID}/webhooks`,
      body: { name: 'Avisos', channelId: CHANNEL_ID },
    });
    await hook.send('olá do webhook');
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: '/webhooks/w2/s3cret',
      body: { content: 'olá do webhook' },
    });
    expect(s.fetchMock.mock.calls.at(-1)![0]).toBe('http://api.test/webhooks/w2/s3cret');
    expect(last(s.calls).headers.authorization).toBe('Bearer ocb_teste');
    await hook.delete();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: '/webhooks/w2' });

    const ev = await g.scheduledEvents.create({
      name: 'Leitura',
      scheduledStartTime: new Date('2026-12-01T20:00:00Z'),
      description: 'cap. 1',
    });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/servers/${SERVER_ID}/events`,
      body: {
        title: 'Leitura',
        description: 'cap. 1',
        startsAt: '2026-12-01T20:00:00.000Z',
        endsAt: null,
        channelId: null,
      },
    });
    expect(ev.name).toBe('Leitura');
    expect(g.scheduledEvents.cache.has('ev1')).toBe(true);
    const going = await ev.rsvp('going');
    expect(last(s.calls)).toMatchObject({ method: 'PUT', path: '/events/ev1/rsvp', body: { status: 'going' } });
    expect(going.me).toBe('going');
    expect(going.going).toContain(BOT_ID);
    await ev.setName('Leitura 2');
    expect(last(s.calls)).toMatchObject({ method: 'PATCH', path: '/events/ev1', body: { title: 'Leitura 2' } });
    await ev.delete();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: '/events/ev1' });
    expect(g.scheduledEvents.cache.has('ev1')).toBe(false);
    await g.leave();
    expect(last(s.calls)).toMatchObject({ method: 'POST', path: `/servers/${SERVER_ID}/leave` });
  });

  it('eventos: guildBanAdd/Remove, guildMemberUpdate, roleCreate/Update/Delete, categoryCreate, guildScheduledEvent*, guildUpdate, userUpdate', async () => {
    const s = setup();
    await s.ready();
    const g = s.client.guilds.cache.get(SERVER_ID)!;
    const bans: GuildBan[] = [];
    s.client.on('guildBanAdd', (b) => bans.push(b));
    s.client.on('guildBanRemove', (b) => bans.push(b));
    s.socket().fire('server:ban:added', {
      serverId: SERVER_ID,
      user: person2,
      reason: 'spam',
      by: person,
      createdAt: new Date().toISOString(),
    });
    expect(bans[0]?.user.id).toBe(USER2_ID);
    expect(bans[0]?.executor?.id).toBe(USER_ID);
    expect(g.bans.cache.has(USER2_ID)).toBe(true);
    s.socket().fire('server:ban:removed', { serverId: SERVER_ID, userId: USER2_ID });
    expect(bans[1]?.reason).toBe('spam');
    expect(g.bans.cache.has(USER2_ID)).toBe(false);

    const updates: [GuildMember | null, GuildMember][] = [];
    s.client.on('guildMemberUpdate', (o, n) => updates.push([o, n]));
    s.socket().fire('server:member:updated', {
      serverId: SERVER_ID,
      member: memberDto(person, { nickname: 'Aninha', timeoutUntil: '2030-01-01T00:00:00.000Z' }),
    });
    expect(updates[0]![0]?.nickname).toBeNull();
    expect(updates[0]![1].nickname).toBe('Aninha');
    expect(updates[0]![1].isCommunicationDisabled()).toBe(true);

    const roles: string[] = [];
    s.client.on('roleCreate', (r: Role) => roles.push(`+${r.name}`));
    s.client.on('roleUpdate', (o: Role, n: Role) => roles.push(`${o.name}>${n.name}`));
    s.client.on('roleDelete', (r: Role) => roles.push(`-${r.name}`));
    s.socket().fire(
      'role:upserted',
      roleDto({ id: '77777777-7777-4777-8777-777777777773', name: 'Novo', isEveryone: false, position: 3 }),
    );
    s.socket().fire(
      'role:upserted',
      roleDto({ id: '77777777-7777-4777-8777-777777777773', name: 'Renomeado', isEveryone: false, position: 3 }),
    );
    s.socket().fire('role:deleted', { serverId: SERVER_ID, roleId: '77777777-7777-4777-8777-777777777773' });
    expect(roles).toEqual(['+Novo', 'Novo>Renomeado', '-Renomeado']);
    expect(g.roles.cache.has('77777777-7777-4777-8777-777777777773')).toBe(false);

    const cats: string[] = [];
    s.client.on('categoryCreate', (c) => cats.push(`+${c.name}`));
    s.client.on('categoryUpdate', (o, n) => cats.push(`${o.name}>${n.name}`));
    s.client.on('categoryDelete', (c) => cats.push(`-${c.name}`));
    s.socket().fire('category:upserted', {
      id: '99999999-9999-4999-8999-999999999992',
      serverId: SERVER_ID,
      name: 'Voz',
      position: 1,
    });
    s.socket().fire('category:upserted', {
      id: '99999999-9999-4999-8999-999999999992',
      serverId: SERVER_ID,
      name: 'Áudio',
      position: 1,
    });
    s.socket().fire('category:deleted', { serverId: SERVER_ID, categoryId: '99999999-9999-4999-8999-999999999992' });
    expect(cats).toEqual(['+Voz', 'Voz>Áudio', '-Áudio']);

    const evs: string[] = [];
    s.client.on('guildScheduledEventCreate', (e) => evs.push(`+${e.name}`));
    s.client.on('guildScheduledEventUpdate', (o, n) => evs.push(`${o?.name}>${n.name}`));
    s.client.on('guildScheduledEventDelete', (e) => evs.push(`-${e.name}`));
    const event = {
      id: 'ev9',
      serverId: SERVER_ID,
      channelId: null,
      createdBy: person,
      title: 'Clube',
      description: '',
      startsAt: '2026-12-01T20:00:00.000Z',
      endsAt: null,
      going: [],
      maybe: [],
      me: null,
    };
    s.socket().fire('event:changed', { serverId: SERVER_ID, event });
    s.socket().fire('event:changed', { serverId: SERVER_ID, event: { ...event, title: 'Clube 2' } });
    s.socket().fire('event:deleted', { serverId: SERVER_ID, eventId: 'ev9' });
    expect(evs).toEqual(['+Clube', 'Clube>Clube 2', '-Clube 2']);

    const gu = vi.fn();
    s.client.on('guildUpdate', gu);
    s.socket().fire('server:updated', {
      id: SERVER_ID,
      name: 'Renomeado',
      iconKey: null,
      ownerId: USER_ID,
      official: false,
      accent: null,
      wallpaperKey: null,
    });
    expect(gu).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Clube' }),
      expect.objectContaining({ name: 'Renomeado' }),
    );
    expect(g.name).toBe('Renomeado');
    const uu = vi.fn();
    s.client.on('userUpdate', uu);
    s.socket().fire('user:updated', { ...person, displayName: 'Ana Maria' });
    expect(uu).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Ana' }),
      expect.objectContaining({ displayName: 'Ana Maria' }),
    );
    expect(g.members.cache.get(USER_ID)?.user.displayName).toBe('Ana Maria');
  });
});

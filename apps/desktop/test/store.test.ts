import type { Message } from '@opencord/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { keyOf, mergeMessages, useData, useMessages } from '../src/store/data';

const msg = (id: string, createdAt: string, extra: Partial<Message> = {}): Message => ({
  id,
  channelId: 'c1',
  conversationId: null,
  author: { id: 'u1', username: 'ana', displayName: 'Ana', avatarKey: null },
  body: id,
  createdAt,
  editedAt: null,
  deleted: false,
  replyTo: null,
  reactions: [],
  attachments: [],
  mentions: [],
  pinnedAt: null,
  poll: null,
  reactionRoles: [],
  ...extra,
});

describe('mergeMessages', () => {
  it('ordena por (createdAt, id) e deduplica', () => {
    const a = msg('00000000-0000-7000-8000-000000000002', '2026-01-01T00:00:01.000Z');
    const b = msg('00000000-0000-7000-8000-000000000001', '2026-01-01T00:00:01.000Z');
    const c = msg('00000000-0000-7000-8000-000000000003', '2026-01-01T00:00:00.500Z');
    const out = mergeMessages([a], [b, c, a, { ...a, body: 'editada' }]);
    expect(out.map((m) => m.id)).toEqual([c.id, b.id, a.id]);
    expect(out.at(-1)?.body).toBe('editada');
  });
});

describe('normalizeMessage', () => {
  it('API mais antiga (sem fixar, enquete e cargos por reação) não quebra: completa com vazio', () => {
    const {
      pinnedAt: _p,
      poll: _q,
      reactionRoles: _r,
      ...old
    } = msg('00000000-0000-7000-8000-000000000009', '2026-01-01T00:00:00.000Z');
    const [m] = mergeMessages([], [old as Message]);
    expect(m).toMatchObject({ pinnedAt: null, poll: null, reactionRoles: [] });
  });
});

describe('useMessages', () => {
  beforeEach(() => useMessages.getState().clear());
  it('evento duplicado/fora de ordem não duplica; reação calcula `me` localmente', () => {
    const key = keyOf({ channelId: 'c1' });
    const s = useMessages.getState();
    const m1 = msg('00000000-0000-7000-8000-000000000001', '2026-01-01T00:00:00Z');
    const m2 = msg('00000000-0000-7000-8000-000000000002', '2026-01-01T00:00:01Z');
    s.setPage(key, { messages: [m1], nextBefore: null }, 'replace');
    s.upsert(m2);
    s.upsert(m2);
    expect(useMessages.getState().get(key).messages).toHaveLength(2);
    s.reaction(key, m1.id, '👍', 'me', true, 1, 'me');
    s.reaction(key, m1.id, '👍', 'other', true, 2, 'me');
    const r = useMessages.getState().get(key).messages[0]?.reactions[0];
    expect(r).toEqual({ emoji: '👍', count: 2, me: true, userIds: ['me', 'other'] });
    // broadcast de edição com me=false preserva o me local
    s.upsert({ ...m1, body: 'x', reactions: [{ emoji: '👍', count: 2, me: false, userIds: ['me', 'other'] }] });
    expect(useMessages.getState().get(key).messages[0]?.reactions[0]?.me).toBe(true);
  });
  it('ignora mensagens de timelines não carregadas (evita estado parcial)', () => {
    useMessages.getState().upsert(msg('00000000-0000-7000-8000-000000000009', '2026-01-01T00:00:00Z'));
    expect(useMessages.getState().timelines['c:c1']).toBeUndefined();
  });
  it('pendentes: falha marca, sucesso remove', () => {
    const key = keyOf({ channelId: 'c1' });
    const s = useMessages.getState();
    s.addPending(key, 'r1', { body: 'oi', createdAt: '' });
    s.resolvePending(key, 'r1', true);
    expect(useMessages.getState().get(key).pending.r1?.failed).toBe(true);
    s.resolvePending(key, 'r1');
    expect(useMessages.getState().get(key).pending.r1).toBeUndefined();
  });
});

describe('useData.bumpUnread', () => {
  it('conta não lidas e menções; mensagem própria zera', () => {
    const k = keyOf({ channelId: 'c9' });
    useData.getState().bumpUnread(k, 'm1', false, false);
    useData.getState().bumpUnread(k, 'm2', true, false);
    expect(useData.getState().unread[k]).toMatchObject({ unreadCount: 2, mentionCount: 1, lastMessageId: 'm2' });
    useData.getState().bumpUnread(k, 'm3', false, true);
    expect(useData.getState().unread[k]).toMatchObject({ unreadCount: 0, mentionCount: 0, lastReadMessageId: 'm3' });
  });
});

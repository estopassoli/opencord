import type {
  Category,
  Channel,
  Conversation,
  Friend,
  InstanceInfo,
  Me,
  Member,
  Message,
  Poll,
  PresenceStatus,
  PlayingGame,
  Role,
  ServerDetail,
  ServerSummary,
  UnreadState,
  UserPublic,
  UserSettings,
  VoiceMemberState,
} from '@opencord/contracts';
import { create } from 'zustand';

export type TargetKey = `c:${string}` | `d:${string}`;
export const keyOf = (t: { channelId?: string | null; conversationId?: string | null }): TargetKey =>
  t.channelId ? `c:${t.channelId}` : `d:${t.conversationId as string}`;

export interface FriendWithPresence extends Friend {
  presence?: PresenceStatus;
  game?: PlayingGame | null;
}

interface DataState {
  me: Me | null;
  /** aviso, cadastro e limite de upload da instância (ADR-0020); atualiza em tempo real */
  instance: InstanceInfo | null;
  settings: UserSettings | null;
  servers: ServerSummary[];
  details: Record<string, ServerDetail>;
  conversations: Conversation[];
  friends: FriendWithPresence[];
  presence: Record<string, PresenceStatus>;
  /** jogo que cada pessoa está jogando agora (ADR-0021) */
  games: Record<string, PlayingGame>;
  myStatus: Exclude<PresenceStatus, 'offline'>;
  voiceStates: Record<string, VoiceMemberState>;
  unread: Record<string, UnreadState>;
  typing: Record<TargetKey, Record<string, number>>;

  reset(): void;
  setServerDetail(d: ServerDetail): void;
  removeServer(id: string): void;
  upsertChannel(c: Channel): void;
  removeChannel(serverId: string, channelId: string): void;
  upsertCategory(c: Category): void;
  removeCategory(serverId: string, categoryId: string): void;
  upsertRole(r: Role): void;
  removeRole(serverId: string, roleId: string): void;
  upsertMember(serverId: string, m: Member): void;
  removeMember(serverId: string, userId: string): void;
  setVoiceState(s: VoiceMemberState): void;
  removeVoiceState(userId: string): void;
  setGame(userId: string, game: PlayingGame | null): void;
  setUnread(u: UnreadState): void;
  bumpUnread(key: TargetKey, lastMessageId: string, mention: boolean, mine: boolean): void;
  markRead(key: TargetKey, messageId: string): void;
  setTyping(key: TargetKey, userId: string, active: boolean): void;
  upsertConversation(c: Conversation): void;
  /** perfil público mudou (foto/apelido): atualiza onde a pessoa aparece */
  patchUser(u: UserPublic): void;
}

const empty = {
  me: null,
  instance: null,
  settings: null,
  servers: [],
  details: {},
  conversations: [],
  friends: [],
  presence: {},
  games: {},
  myStatus: 'online' as const,
  voiceStates: {},
  unread: {},
  typing: {},
};

const withDetail = (s: DataState, serverId: string, fn: (d: ServerDetail) => ServerDetail) => {
  const d = s.details[serverId];
  return d ? { details: { ...s.details, [serverId]: fn(d) } } : {};
};

const summaryOf = (d: ServerSummary): ServerSummary => ({
  id: d.id,
  name: d.name,
  iconKey: d.iconKey,
  ownerId: d.ownerId,
  official: d.official,
  verified: d.verified ?? false,
});

export const useData = create<DataState>()((set) => ({
  ...empty,
  reset: () => set({ ...empty }),
  setServerDetail: (d) =>
    set((s) => ({
      details: { ...s.details, [d.id]: d },
      servers: s.servers.some((x) => x.id === d.id)
        ? s.servers.map((x) => (x.id === d.id ? summaryOf(d) : x))
        : [...s.servers, summaryOf(d)],
    })),
  removeServer: (id) =>
    set((s) => {
      const details = { ...s.details };
      delete details[id];
      return { servers: s.servers.filter((x) => x.id !== id), details };
    }),
  upsertChannel: (c) =>
    set((s) =>
      withDetail(s, c.serverId, (d) => ({
        ...d,
        channels: d.channels.some((x) => x.id === c.id)
          ? d.channels.map((x) => (x.id === c.id ? c : x))
          : [...d.channels, c],
      })),
    ),
  removeChannel: (serverId, channelId) =>
    set((s) => withDetail(s, serverId, (d) => ({ ...d, channels: d.channels.filter((x) => x.id !== channelId) }))),
  upsertCategory: (c) =>
    set((s) =>
      withDetail(s, c.serverId, (d) => ({
        ...d,
        categories: (d.categories.some((x) => x.id === c.id)
          ? d.categories.map((x) => (x.id === c.id ? c : x))
          : [...d.categories, c]
        ).sort((a, b) => a.position - b.position),
      })),
    ),
  removeCategory: (serverId, categoryId) =>
    set((s) =>
      withDetail(s, serverId, (d) => ({
        ...d,
        categories: d.categories.filter((x) => x.id !== categoryId),
        channels: d.channels.map((c) => (c.categoryId === categoryId ? { ...c, categoryId: null } : c)),
      })),
    ),
  upsertRole: (r) =>
    set((s) =>
      withDetail(s, r.serverId, (d) => ({
        ...d,
        roles: (d.roles.some((x) => x.id === r.id)
          ? d.roles.map((x) => (x.id === r.id ? r : x))
          : [...d.roles, r]
        ).sort((a, b) => a.position - b.position),
      })),
    ),
  removeRole: (serverId, roleId) =>
    set((s) =>
      withDetail(s, serverId, (d) => ({
        ...d,
        roles: d.roles.filter((x) => x.id !== roleId),
        members: d.members.map((m) => ({ ...m, roleIds: m.roleIds.filter((id) => id !== roleId) })),
      })),
    ),
  upsertMember: (serverId, m) =>
    set((s) =>
      withDetail(s, serverId, (d) => ({
        ...d,
        members: d.members.some((x) => x.user.id === m.user.id)
          ? d.members.map((x) => (x.user.id === m.user.id ? m : x))
          : [...d.members, m],
      })),
    ),
  removeMember: (serverId, userId) =>
    set((s) => withDetail(s, serverId, (d) => ({ ...d, members: d.members.filter((x) => x.user.id !== userId) }))),
  setVoiceState: (v) => set((s) => ({ voiceStates: { ...s.voiceStates, [v.userId]: v } })),
  removeVoiceState: (userId) =>
    set((s) => {
      const v = { ...s.voiceStates };
      delete v[userId];
      return { voiceStates: v };
    }),
  setGame: (userId, game) =>
    set((s) => {
      const games = { ...s.games };
      if (game) games[userId] = game;
      else delete games[userId];
      return { games };
    }),
  setUnread: (u) => set((s) => ({ unread: { ...s.unread, [keyOf(u)]: u } })),
  bumpUnread: (key, lastMessageId, mention, mine) =>
    set((s) => {
      const cur = s.unread[key];
      const base: UnreadState = cur ?? {
        channelId: key.startsWith('c:') ? key.slice(2) : null,
        conversationId: key.startsWith('d:') ? key.slice(2) : null,
        lastReadMessageId: null,
        lastMessageId: null,
        unreadCount: 0,
        mentionCount: 0,
      };
      return {
        unread: {
          ...s.unread,
          [key]: mine
            ? { ...base, lastMessageId, lastReadMessageId: lastMessageId, unreadCount: 0, mentionCount: 0 }
            : {
                ...base,
                lastMessageId,
                unreadCount: base.unreadCount + 1,
                mentionCount: base.mentionCount + (mention ? 1 : 0),
              },
        },
      };
    }),
  markRead: (key, messageId) =>
    set((s) => {
      const cur = s.unread[key];
      if (!cur) return {};
      return {
        unread: { ...s.unread, [key]: { ...cur, lastReadMessageId: messageId, unreadCount: 0, mentionCount: 0 } },
      };
    }),
  setTyping: (key, userId, active) =>
    set((s) => {
      const cur = { ...(s.typing[key] ?? {}) };
      if (active) cur[userId] = Date.now() + 8000;
      else delete cur[userId];
      return { typing: { ...s.typing, [key]: cur } };
    }),
  patchUser: (u) =>
    set((s) => {
      const fix = <T extends { id: string }>(x: T): T => (x.id === u.id ? { ...x, ...u } : x);
      const details = Object.fromEntries(
        Object.entries(s.details).map(([id, d]) => [
          id,
          d.members.some((m) => m.user.id === u.id)
            ? { ...d, members: d.members.map((m) => (m.user.id === u.id ? { ...m, user: { ...m.user, ...u } } : m)) }
            : d,
        ]),
      );
      return {
        me: s.me && s.me.id === u.id ? { ...s.me, displayName: u.displayName, avatarKey: u.avatarKey } : s.me,
        details,
        friends: s.friends.map((f) => (f.user.id === u.id ? { ...f, user: fix(f.user) } : f)),
        conversations: s.conversations.map((c) =>
          c.members.some((m) => m.id === u.id) ? { ...c, members: c.members.map(fix) } : c,
        ),
      };
    }),
  upsertConversation: (c) =>
    set((s) => ({
      conversations: s.conversations.some((x) => x.id === c.id)
        ? s.conversations.map((x) => (x.id === c.id ? c : x))
        : [c, ...s.conversations],
    })),
}));

// ---------- Mensagens por destino ----------
export interface Timeline {
  messages: Message[];
  nextBefore: string | null;
  loaded: boolean;
  loading: boolean;
  /** mensagens otimistas ainda sem confirmação, por requestId */
  pending: Record<
    string,
    { body: string; createdAt: string; failed?: boolean; replyToId?: string; attachmentIds?: string[] }
  >;
}

const emptyTimeline = (): Timeline => ({ messages: [], nextBefore: null, loaded: false, loading: false, pending: {} });

interface MessagesState {
  timelines: Record<TargetKey, Timeline>;
  get(key: TargetKey): Timeline;
  setLoading(key: TargetKey, loading: boolean): void;
  setPage(key: TargetKey, page: { messages: Message[]; nextBefore: string | null }, mode: 'replace' | 'prepend'): void;
  upsert(m: Message): void;
  addPending(key: TargetKey, requestId: string, p: Timeline['pending'][string]): void;
  resolvePending(key: TargetKey, requestId: string, failed?: boolean): void;
  markDeleted(key: TargetKey, messageId: string): void;
  /** enquete mudou (ADR-0018); `keepMine`: evento em tempo real, que não traz o meu voto */
  setPoll(key: TargetKey, messageId: string, poll: Poll, keepMine: boolean): void;
  reaction(
    key: TargetKey,
    messageId: string,
    emoji: string,
    userId: string,
    on: boolean,
    count: number,
    me: string,
  ): void;
  clear(): void;
}

/**
 * Campos que chegaram depois (fixar, enquete, cargos por reação) podem faltar quando a API é mais antiga que o app
 * (instância sem atualizar): completa com o vazio em vez de quebrar a conversa inteira.
 */
type LooseMessage = Omit<Message, 'pinnedAt' | 'poll' | 'reactionRoles'> &
  Partial<Pick<Message, 'pinnedAt' | 'poll' | 'reactionRoles'>>;
export function normalizeMessage(m: LooseMessage): Message {
  return { ...m, pinnedAt: m.pinnedAt ?? null, poll: m.poll ?? null, reactionRoles: m.reactionRoles ?? [] };
}

/** Inserção ordenada por (createdAt, id) e idempotente: eventos duplicados/fora de ordem não corrompem a lista. */
export function mergeMessages(list: Message[], incoming: Message[]): Message[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, normalizeMessage(m));
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

export const useMessages = create<MessagesState>()((set, get) => ({
  timelines: {},
  get: (key) => get().timelines[key] ?? emptyTimeline(),
  setLoading: (key, loading) =>
    set((s) => ({ timelines: { ...s.timelines, [key]: { ...(s.timelines[key] ?? emptyTimeline()), loading } } })),
  setPage: (key, page, mode) =>
    set((s) => {
      const cur = s.timelines[key] ?? emptyTimeline();
      return {
        timelines: {
          ...s.timelines,
          [key]: {
            ...cur,
            messages:
              mode === 'replace' ? mergeMessages([], page.messages) : mergeMessages(cur.messages, page.messages),
            nextBefore: page.nextBefore,
            loaded: true,
            loading: false,
          },
        },
      };
    }),
  upsert: (m) =>
    set((s) => {
      const key = keyOf(m);
      const cur = s.timelines[key];
      if (!cur?.loaded) return {};
      const prev = cur.messages.find((x) => x.id === m.id);
      // eventos broadcast trazem `me=false`; preservar o `me` local
      const merged = prev
        ? {
            ...m,
            // idem para o meu voto na enquete
            poll: m.poll && prev.poll && !m.poll.mine.length ? { ...m.poll, mine: prev.poll.mine } : m.poll,
            reactions: m.reactions.map((r) => ({
              ...r,
              me: prev.reactions.find((p) => p.emoji === r.emoji)?.me ?? r.me,
            })),
          }
        : m;
      return { timelines: { ...s.timelines, [key]: { ...cur, messages: mergeMessages(cur.messages, [merged]) } } };
    }),
  addPending: (key, requestId, p) =>
    set((s) => {
      const cur = s.timelines[key] ?? emptyTimeline();
      return { timelines: { ...s.timelines, [key]: { ...cur, pending: { ...cur.pending, [requestId]: p } } } };
    }),
  resolvePending: (key, requestId, failed) =>
    set((s) => {
      const cur = s.timelines[key];
      if (!cur) return {};
      const pending = { ...cur.pending };
      if (failed && pending[requestId]) pending[requestId] = { ...pending[requestId], failed: true };
      else delete pending[requestId];
      return { timelines: { ...s.timelines, [key]: { ...cur, pending } } };
    }),
  markDeleted: (key, messageId) =>
    set((s) => {
      const cur = s.timelines[key];
      if (!cur) return {};
      return {
        timelines: {
          ...s.timelines,
          [key]: {
            ...cur,
            messages: cur.messages.map((m) =>
              m.id === messageId ? { ...m, deleted: true, body: '', attachments: [], reactions: [], mentions: [] } : m,
            ),
          },
        },
      };
    }),
  setPoll: (key, messageId, poll, keepMine) =>
    set((s) => {
      const cur = s.timelines[key];
      if (!cur) return {};
      const messages = cur.messages.map((m) =>
        m.id === messageId ? { ...m, poll: keepMine && m.poll ? { ...poll, mine: m.poll.mine } : poll } : m,
      );
      return { timelines: { ...s.timelines, [key]: { ...cur, messages } } };
    }),
  reaction: (key, messageId, emoji, userId, on, count, me) =>
    set((s) => {
      const cur = s.timelines[key];
      if (!cur) return {};
      const messages = cur.messages.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        const userIds = existing ? existing.userIds.filter((u) => u !== userId) : [];
        if (on) userIds.push(userId);
        const next = { emoji, count, userIds, me: userId === me ? on : (existing?.me ?? false) };
        const reactions = existing ? m.reactions.map((r) => (r.emoji === emoji ? next : r)) : [...m.reactions, next];
        return { ...m, reactions: reactions.filter((r) => r.count > 0) };
      });
      return { timelines: { ...s.timelines, [key]: { ...cur, messages } } };
    }),
  clear: () => set({ timelines: {} }),
}));

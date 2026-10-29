import { z } from 'zod';
import {
  Channel,
  Category,
  Emoji,
  Id,
  Member,
  Message,
  MessageBody,
  PresenceStatus,
  Role,
  ServerSummary,
  Friend,
  Conversation,
  VoiceMemberState,
} from './api.js';
import { ActivityControl, type ActivityState, YouTubeVideoId } from './activities.js';

/** Versão do protocolo realtime; incrementar ao quebrar compatibilidade. */
export const REALTIME_SCHEMA_VERSION = 1 as const;
export const SOCKET_PATH = '/realtime';
/** Limite de payload aceito pelo servidor Socket.IO (bytes). */
export const SOCKET_MAX_PAYLOAD = 64 * 1024;

export interface EventEnvelope<T> {
  eventId: string;
  schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  occurredAt: string;
  payload: T;
}

// ---------- Comandos cliente → servidor (sempre com ACK) ----------
export const ClientCommands = {
  'chat:message:create': z.object({
    requestId: z.uuid(),
    channelId: Id.optional(),
    conversationId: Id.optional(),
    body: MessageBody,
    replyToId: Id.optional(),
    attachmentIds: z.array(Id).max(10).optional(),
  }),
  'chat:message:edit': z.object({ messageId: Id, body: MessageBody }),
  'chat:message:delete': z.object({ messageId: Id }),
  'chat:reaction:set': z.object({ messageId: Id, emoji: Emoji, on: z.boolean() }),
  'chat:typing:start': z.object({ channelId: Id.optional(), conversationId: Id.optional() }),
  'chat:typing:stop': z.object({ channelId: Id.optional(), conversationId: Id.optional() }),
  'chat:read': z.object({ channelId: Id.optional(), conversationId: Id.optional(), messageId: Id }),
  'presence:heartbeat': z.object({ status: PresenceStatus.exclude(['offline']).optional() }),
  'activity:get': z.object({ channelId: Id }),
  'activity:youtube:start': z.object({ channelId: Id, videoId: YouTubeVideoId }),
  'activity:youtube:control': ActivityControl,
  'activity:stop': z.object({ channelId: Id }),
  'sync:resume': z.object({
    /** último eventId/seq visto por canal, para ressincronização por cursor */
    channels: z.array(z.object({ channelId: Id, lastMessageId: Id.nullable() })).max(500),
  }),
} as const;
export type ClientCommandName = keyof typeof ClientCommands;
export type ClientCommand<N extends ClientCommandName> = z.infer<(typeof ClientCommands)[N]>;

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface ClientCommandResults {
  'chat:message:create': { messageId: string; createdAt: string; duplicate: boolean };
  'chat:message:edit': { messageId: string; editedAt: string };
  'chat:message:delete': { messageId: string };
  'chat:reaction:set': { messageId: string };
  'chat:typing:start': null;
  'chat:typing:stop': null;
  'chat:read': null;
  'presence:heartbeat': { ttlSeconds: number };
  'sync:resume': { missed: Message[]; truncated: boolean };
  'activity:get': ActivityState | null;
  'activity:youtube:start': ActivityState;
  'activity:youtube:control': ActivityState;
  'activity:stop': null;
}

// ---------- Eventos servidor → cliente ----------
export interface ServerEvents {
  ready: { userId: string; sessionId: string; heartbeatIntervalMs: number };
  'chat:message:created': Message;
  'chat:message:updated': Message;
  'chat:message:deleted': { messageId: string; channelId: string | null; conversationId: string | null };
  'chat:reaction:changed': {
    messageId: string;
    channelId: string | null;
    conversationId: string | null;
    emoji: string;
    userId: string;
    on: boolean;
    count: number;
  };
  'chat:typing': { channelId: string | null; conversationId: string | null; userId: string; active: boolean };
  'channel:unread:changed': {
    channelId: string | null;
    conversationId: string | null;
    lastMessageId: string;
    mention: boolean;
  };
  'presence:changed': { userId: string; status: z.infer<typeof PresenceStatus> };
  'voice:member:joined': VoiceMemberState;
  'voice:state:changed': VoiceMemberState;
  'voice:member:left': {
    userId: string;
    channelId: string;
    serverId: string;
    reason: 'left' | 'kicked' | 'timeout' | 'moved';
  };
  'voice:force-disconnect': { channelId: string; reason: 'kicked' | 'revoked' | 'replaced' };
  'server:updated': z.infer<typeof ServerSummary>;
  /** o usuário passou a ser membro de um servidor (servidor novo ou entrada pelo diretório) */
  'server:added': z.infer<typeof ServerSummary>;
  'server:deleted': { serverId: string };
  'server:member:joined': { serverId: string; member: z.infer<typeof Member> };
  'server:member:updated': { serverId: string; member: z.infer<typeof Member> };
  'server:member:left': { serverId: string; userId: string; reason: 'left' | 'kicked' };
  'server:removed': { serverId: string; reason: 'kicked' | 'left' | 'deleted' };
  'channel:created': z.infer<typeof Channel>;
  'channel:updated': z.infer<typeof Channel>;
  'channel:deleted': { serverId: string; channelId: string };
  'category:upserted': z.infer<typeof Category>;
  'category:deleted': { serverId: string; categoryId: string };
  'role:upserted': z.infer<typeof Role>;
  'role:deleted': { serverId: string; roleId: string };
  'permissions:changed': { serverId: string };
  'friend:changed': z.infer<typeof Friend> | { userId: string; removed: true };
  'conversation:upserted': z.infer<typeof Conversation>;
  'notification:created': {
    kind: 'mention' | 'dm' | 'friend_request';
    title: string;
    body: string;
    channelId?: string;
    conversationId?: string;
    serverId?: string;
  };
  'session:revoked': { reason: string };
  /** atividade da chamada começou ou mudou (vídeo, play/pausa/posição) */
  'activity:state': ActivityState;
  'activity:ended': { channelId: string; serverId: string };
}
export type ServerEventName = keyof ServerEvents;

export function envelope<T>(eventId: string, payload: T, occurredAt = new Date()): EventEnvelope<T> {
  return { eventId, schemaVersion: REALTIME_SCHEMA_VERSION, occurredAt: occurredAt.toISOString(), payload };
}

/** Rooms Socket.IO: nomes derivados no servidor, nunca aceitos do cliente. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  server: (serverId: string) => `server:${serverId}`,
  channel: (channelId: string) => `channel:${channelId}`,
  conversation: (conversationId: string) => `conv:${conversationId}`,
};

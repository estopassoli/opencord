import { z } from 'zod';
import {
  BoardCard,
  Poll,
  Channel,
  Category,
  Emoji,
  Id,
  Member,
  Message,
  MessageBody,
  PresenceStatus,
  ServerEvent,
  PlayingGame,
  ActiveRecording,
  CallRecording,
  Role,
  ServerSummary,
  Friend,
  Conversation,
  VoiceMemberState,
  UserPublic,
  InstanceInfo,
  Interaction,
  Embed,
  MessageComponents,
  Modal,
  ServerBan,
  ModerationCase,
} from './api.js';
import {
  ActivityControl,
  type ActivityState,
  MusicControl,
  type MusicState,
  SPOTIFY_KINDS,
  SpotifyId,
  YouTubePlaylistId,
  YouTubeVideoId,
} from './activities.js';

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
    privateReplyToId: Id.optional(),
    attachmentIds: z.array(Id).max(10).optional(),
  }),
  'chat:message:edit': z.object({ messageId: Id, body: MessageBody }),
  'chat:message:delete': z.object({ messageId: Id }),
  'chat:reaction:set': z.object({ messageId: Id, emoji: Emoji, on: z.boolean() }),
  'chat:typing:start': z.object({ channelId: Id.optional(), conversationId: Id.optional() }),
  'chat:typing:stop': z.object({ channelId: Id.optional(), conversationId: Id.optional() }),
  'chat:read': z.object({ channelId: Id.optional(), conversationId: Id.optional(), messageId: Id }),
  'presence:heartbeat': z.object({ status: PresenceStatus.exclude(['offline']).optional() }),
  /** jogo que estou jogando agora (null = parei ou escondi) */
  'presence:game': z.object({ game: PlayingGame.nullable() }),
  'activity:get': z.object({ channelId: Id }),
  'activity:youtube:start': z.object({ channelId: Id, videoId: YouTubeVideoId }),
  'activity:youtube:control': ActivityControl,
  'activity:stop': z.object({ channelId: Id }),
  'music:get': z.object({ channelId: Id }),
  /** um vídeo, uma playlist inteira ou os dois (link de vídeo dentro de playlist: começa por ele) */
  'music:add': z
    .object({
      channelId: Id,
      videoId: YouTubeVideoId.optional(),
      playlistId: YouTubePlaylistId.optional(),
      /** catálogo do Spotify: faixa, álbum ou playlist */
      spotify: z.object({ kind: z.enum(SPOTIFY_KINDS), id: SpotifyId }).optional(),
    })
    .refine((d) => d.videoId || d.playlistId || d.spotify, 'informe uma música, álbum ou playlist'),
  'music:control': MusicControl,
  'music:stop': z.object({ channelId: Id }),
  'sound:play': z.object({ channelId: Id, soundId: Id }),
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
  'presence:game': null;
  'sync:resume': { missed: Message[]; truncated: boolean };
  'activity:get': ActivityState | null;
  'activity:youtube:start': ActivityState;
  'activity:youtube:control': ActivityState;
  'activity:stop': null;
  'music:get': MusicState | null;
  'music:add': MusicState;
  'music:control': MusicState;
  'music:stop': null;
  'sound:play': null;
}

// ---------- Eventos servidor → cliente ----------
export interface ServerEvents {
  ready: { userId: string; sessionId: string; heartbeatIntervalMs: number };
  'chat:message:created': Message;
  'chat:message:updated': Message;
  /** votos/encerramento de uma enquete; `mine` vem vazio (cada app guarda o próprio voto) */
  'poll:updated': {
    messageId: string;
    channelId: string | null;
    conversationId: string | null;
    poll: z.infer<typeof Poll>;
  };
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
  /** gravação da chamada começou (recording) ou terminou (null) — todos no servidor veem o aviso (ADR-0023) */
  'recording:state': { channelId: string; serverId: string; recording: ActiveRecording | null };
  /** gravação pronta para baixar por 24 h */
  'recording:ready': { channelId: string; serverId: string; recording: CallRecording };
  /** jogo que a pessoa está jogando, como os outros veem (null quando parou, ficou invisível ou offline) */
  'presence:game:changed': { userId: string; game: PlayingGame | null };
  /** status personalizado da pessoa, como os outros veem (null quando limpou, ficou invisível ou offline) */
  'presence:text:changed': { userId: string; text: string | null };
  /** evento do servidor criado/alterado/com presença nova (ADR-0028) */
  'event:changed': { serverId: string; event: ServerEvent };
  'event:deleted': { serverId: string; eventId: string };
  'voice:member:joined': VoiceMemberState;
  'voice:state:changed': VoiceMemberState;
  'voice:member:left': {
    userId: string;
    channelId: string;
    serverId: string | null;
    conversationId?: string | null;
    reason: 'left' | 'kicked' | 'timeout' | 'moved';
  };
  'voice:force-disconnect': { channelId: string; reason: 'kicked' | 'revoked' | 'replaced' };
  /** um moderador arrastou você para outro canal de voz: o app reentra nele */
  'voice:force-move': { serverId: string; channelId: string; byUserId: string };
  'server:updated': z.infer<typeof ServerSummary>;
  /** o usuário passou a ser membro de um servidor (servidor novo ou entrada pelo diretório) */
  'server:added': z.infer<typeof ServerSummary>;
  'server:deleted': { serverId: string };
  'server:member:joined': { serverId: string; member: z.infer<typeof Member> };
  'server:member:updated': { serverId: string; member: z.infer<typeof Member> };
  'server:member:left': { serverId: string; userId: string; reason: 'left' | 'kicked' };
  'server:removed': { serverId: string; reason: 'kicked' | 'left' | 'deleted' };
  'channel:created': z.infer<typeof Channel>;
  /** quadro kanban (sala do canal do quadro: só quem o vê recebe) */
  'board:card:upserted': z.infer<typeof BoardCard>;
  'board:card:deleted': { boardId: string; cardId: string };
  'channel:updated': z.infer<typeof Channel>;
  'channel:deleted': { serverId: string; channelId: string };
  'category:upserted': z.infer<typeof Category>;
  'category:deleted': { serverId: string; categoryId: string };
  'role:upserted': z.infer<typeof Role>;
  'role:deleted': { serverId: string; roleId: string };
  'permissions:changed': { serverId: string };
  'friend:changed': z.infer<typeof Friend> | { userId: string; removed: true };
  'conversation:upserted': z.infer<typeof Conversation>;
  /** alguém da conversa leu até `messageId` (marcador "Visualizada" da DM) */
  'conversation:read': { conversationId: string; userId: string; messageId: string; at: string };
  'notification:created': {
    /** room_invite / room_knock: salas trancadas (ADR-0040); `userId` é quem pediu ou convidou */
    /** message: mensagem comum num servidor com notificação padrão "todas as mensagens" (ADR-0050); `userId` = autor */
    kind: 'mention' | 'dm' | 'friend_request' | 'moderation' | 'call' | 'room_invite' | 'room_knock' | 'message';
    title: string;
    body: string;
    channelId?: string;
    conversationId?: string;
    serverId?: string;
    userId?: string;
  };
  'session:revoked': { reason: string };
  /** moderação por IA (ADR-0036): caso novo na fila (só moderadores do servidor) e caso decidido */
  'moderation:case:created': z.infer<typeof ModerationCase>;
  'moderation:case:resolved': z.infer<typeof ModerationCase>;
  /** configuração da instância mudou (aviso, cadastro, limite de upload), para todos (ADR-0020) */
  'instance:updated': z.infer<typeof InstanceInfo>;
  /** atividade da chamada começou ou mudou (vídeo, play/pausa/posição) */
  'activity:state': ActivityState;
  'activity:ended': { channelId: string; serverId: string };
  /** música da chamada: fila, faixa atual, tocando/pausado e posição */
  'music:state': MusicState;
  'music:ended': { channelId: string; serverId: string };
  /** alguém tocou um efeito sonoro na chamada: quem está nela toca no próprio app */
  /** serverId é o da chamada; o som pode ser de outro servidor de quem tocou (volume vem junto) */
  'sound:played': { channelId: string; serverId: string; soundId: string; userId: string; volume: number };
  /** lista de efeitos do servidor mudou (envio/remoção) */
  'sound:list:changed': { serverId: string };
  /** perfil público mudou (foto, apelido): enviado a quem compartilha servidor com a pessoa */
  'user:updated': z.infer<typeof UserPublic>;
  /** bots (ADR-0032): alguém usou um comando de barra do bot — só o usuário do bot recebe */
  'interaction:created': z.infer<typeof Interaction>;
  /** o bot acusou recebimento (`defer`) ou respondeu de forma efêmera — só quem usou o comando recebe */
  'interaction:replied': {
    interactionId: string;
    channelId: string;
    serverId: string;
    bot: z.infer<typeof UserPublic>;
    command: string;
    /** null = "pensando…" (defer); texto = resposta efêmera */
    content: string | null;
    /** cartão efêmero rico (ADR-0034) */
    embeds?: z.infer<typeof Embed>[];
    /** botões/menus no cartão efêmero: o clique manda `component` com `ephemeralOf` = interactionId (ADR-0034) */
    components?: z.infer<typeof MessageComponents>;
    /** true = substitui o cartão efêmero anterior desta interação (`update`), em vez de criar outro */
    update?: boolean;
  };
  /** o bot abriu um formulário para quem interagiu (ADR-0034): o app mostra o modal e envia `modal` com `modalId` */
  'interaction:modal': {
    interactionId: string;
    modalId: string;
    channelId: string;
    serverId: string;
    bot: z.infer<typeof UserPublic>;
    modal: z.infer<typeof Modal>;
  };
  /** moderação (ADR-0034) */
  'server:ban:added': z.infer<typeof ServerBan>;
  'server:ban:removed': { serverId: string; userId: string };
  /** todas as reações de uma mensagem foram limpas */
  'chat:reactions:cleared': { messageId: string; channelId: string | null; conversationId: string | null };
  /** um bot membro do servidor mudou a lista de comandos (ou entrou/saiu): o app recarrega GET /servers/:id/commands */
  'bot:commands:changed': { serverId: string };
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

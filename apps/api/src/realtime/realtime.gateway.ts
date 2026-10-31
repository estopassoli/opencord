import { HttpException, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  ClientCommands,
  envelope,
  SOCKET_MAX_PAYLOAD,
  SOCKET_PATH,
  type Ack,
  type ClientCommandName,
  type ClientCommandResults,
  type MusicControl,
  type PlayingGame,
} from '@opencord/contracts';
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { TokenService } from '../auth/token.service.js';
import { RedisService } from '../common/redis.service.js';
import { ActivitiesService } from '../voice/activities.service.js';
import { MusicService } from '../voice/music.service.js';
import { SoundsService } from '../sounds/sounds.service.js';
import { MessagesService, type Target } from '../messages/messages.service.js';
import { HEARTBEAT_INTERVAL_MS, PresenceService } from './presence.service.js';
import { RealtimeService, type AppSocket } from './realtime.service.js';

const TYPING_TTL_S = 8;

/** Token bucket por socket: rajada de 30 comandos, recarga de 5/s. */
class Bucket {
  private tokens = 30;
  private last = Date.now();
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(30, this.tokens + ((now - this.last) / 1000) * 5);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function targetOf(p: { channelId?: string | undefined; conversationId?: string | undefined }): Target {
  if (p.channelId && !p.conversationId) return { channelId: p.channelId };
  if (p.conversationId && !p.channelId) return { conversationId: p.conversationId };
  throw new HttpException('informe channelId OU conversationId', 400);
}

@WebSocketGateway({
  path: SOCKET_PATH,
  maxHttpBufferSize: SOCKET_MAX_PAYLOAD,
  cors: { origin: true, credentials: false },
  serveClient: false,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('Gateway');
  @WebSocketServer() io!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
    private readonly activities: ActivitiesService,
    private readonly music: MusicService,
    private readonly sounds: SoundsService,
  ) {}

  afterInit(io: Server) {
    this.realtime.attach(io);
    // Autenticação no handshake: sem token válido a conexão é recusada.
    io.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      this.tokens.authenticate(token).then(
        (auth) => {
          socket.data = { userId: auth.userId, sessionId: auth.sessionId };
          next();
        },
        () => next(new Error('unauthorized')),
      );
    });
  }

  async handleConnection(socket: AppSocket) {
    const { userId, sessionId } = socket.data;
    if (!userId) return socket.disconnect(true);
    const bucket = new Bucket();
    this.register(socket, bucket);
    try {
      await this.realtime.joinInitialRooms(socket);
      await this.presence.connect(userId, socket.id);
    } catch (e) {
      this.log.error(`conexão ${userId}: ${String(e)}`);
      return socket.disconnect(true);
    }
    socket.emit('ready', envelope(randomUUID(), { userId, sessionId, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS }));
  }

  async handleDisconnect(socket: AppSocket) {
    if (socket.data?.userId) await this.presence.disconnect(socket.data.userId, socket.id).catch(() => undefined);
  }

  private register(socket: AppSocket, bucket: Bucket) {
    for (const name of Object.keys(ClientCommands) as ClientCommandName[]) {
      socket.on(name, (payload: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack<unknown>) => void) : () => undefined;
        if (!bucket.take()) return reply({ ok: false, error: { code: 'rate_limited', message: 'muitas requisições' } });
        const parsed = ClientCommands[name].safeParse(payload);
        if (!parsed.success)
          return reply({
            ok: false,
            error: {
              code: 'invalid',
              message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            },
          });
        this.dispatch(socket, name, parsed.data).then(
          (data) => reply({ ok: true, data }),
          (e: unknown) => {
            const status = e instanceof HttpException ? e.getStatus() : 500;
            const message = e instanceof HttpException ? e.message : 'erro interno';
            if (status >= 500) this.log.error(`${name}: ${String(e)}`);
            reply({ ok: false, error: { code: String(status), message } });
          },
        );
      });
    }
  }

  private async dispatch<N extends ClientCommandName>(
    socket: AppSocket,
    name: N,
    p: unknown,
  ): Promise<ClientCommandResults[N]> {
    const userId = socket.data.userId;
    type R = ClientCommandResults[N];
    switch (name) {
      case 'chat:message:create': {
        const d = p as import('zod').infer<(typeof ClientCommands)['chat:message:create']>;
        const r = await this.messages.create(userId, targetOf(d), d);
        return { messageId: r.message.id, createdAt: r.message.createdAt, duplicate: r.duplicate } as R;
      }
      case 'chat:message:edit': {
        const d = p as { messageId: string; body: string };
        const m = await this.messages.edit(userId, d.messageId, d.body);
        return { messageId: m.id, editedAt: m.editedAt ?? new Date().toISOString() } as R;
      }
      case 'chat:message:delete': {
        const d = p as { messageId: string };
        await this.messages.remove(userId, d.messageId);
        return { messageId: d.messageId } as R;
      }
      case 'chat:reaction:set': {
        const d = p as { messageId: string; emoji: string; on: boolean };
        await this.messages.react(userId, d.messageId, d.emoji, d.on);
        return { messageId: d.messageId } as R;
      }
      case 'chat:typing:start':
      case 'chat:typing:stop': {
        const d = p as { channelId?: string; conversationId?: string };
        const t = targetOf(d);
        const a = await this.messages.access(userId, t);
        const active = name === 'chat:typing:start';
        const key = `typing:${a.channelId ?? a.conversationId}:${userId}`;
        if (active) await this.redis.client.set(key, '1', 'EX', TYPING_TTL_S);
        else await this.redis.client.del(key);
        socket
          .to(a.room)
          .emit(
            'chat:typing',
            envelope(randomUUID(), { channelId: a.channelId, conversationId: a.conversationId, userId, active }),
          );
        return null as R;
      }
      case 'chat:read': {
        const d = p as { channelId?: string; conversationId?: string; messageId: string };
        await this.messages.markRead(userId, targetOf(d), d.messageId);
        return null as R;
      }
      case 'presence:heartbeat': {
        const d = p as { status?: 'online' | 'idle' | 'dnd' | 'invisible' };
        return (await this.presence.heartbeat(userId, socket.id, d.status)) as R;
      }
      case 'presence:game': {
        const d = p as { game: PlayingGame | null };
        await this.presence.setGame(userId, d.game);
        return null as R;
      }
      case 'activity:get': {
        const d = p as { channelId: string };
        return (await this.activities.get(userId, d.channelId)) as R;
      }
      case 'activity:youtube:start': {
        const d = p as { channelId: string; videoId: string };
        return (await this.activities.startYouTube(userId, d.channelId, d.videoId)) as R;
      }
      case 'activity:youtube:control': {
        const d = p as { channelId: string; action: 'play' | 'pause' | 'seek'; positionSec: number };
        return (await this.activities.control(userId, d.channelId, d.action, d.positionSec)) as R;
      }
      case 'activity:stop': {
        const d = p as { channelId: string };
        return (await this.activities.stop(userId, d.channelId)) as R;
      }
      case 'music:get': {
        const d = p as { channelId: string };
        return (await this.music.get(userId, d.channelId)) as R;
      }
      case 'music:add': {
        const d = p as { channelId: string; videoId?: string; playlistId?: string };
        return (await this.music.add(userId, d.channelId, {
          ...(d.videoId ? { videoId: d.videoId } : {}),
          ...(d.playlistId ? { playlistId: d.playlistId } : {}),
        })) as R;
      }
      case 'music:control': {
        const d = p as MusicControl;
        return (await this.music.control(userId, d.channelId, d.action, d.positionSec, d.trackId)) as R;
      }
      case 'music:stop': {
        const d = p as { channelId: string };
        return (await this.music.stop(userId, d.channelId)) as R;
      }
      case 'sound:play': {
        const d = p as { channelId: string; soundId: string };
        return (await this.sounds.play(userId, d.channelId, d.soundId)) as R;
      }
      case 'sync:resume': {
        const d = p as { channels: { channelId: string; lastMessageId: string | null }[] };
        await this.realtime.syncUserRooms(userId);
        return (await this.messages.missedSince(userId, d.channels)) as R;
      }
      default:
        throw new HttpException('comando desconhecido', 400);
    }
  }
}

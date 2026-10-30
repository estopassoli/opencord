import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { envelope, rooms, type ServerEventName, type ServerEvents } from '@opencord/contracts';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.service.js';
import { MEMBER_INCLUDE, member } from '../common/serialize.js';
import { PermissionsService } from '../servers/permissions.service.js';

export interface SocketData {
  userId: string;
  sessionId: string;
}
type LooseEvents = Record<string, (...args: unknown[]) => void>;
export type AppSocket = Socket<LooseEvents, LooseEvents, LooseEvents, SocketData>;

const MANAGED_PREFIXES = ['server:', 'channel:', 'conv:'];

@Injectable()
export class RealtimeService {
  private readonly log = new Logger('Realtime');
  private io: Server | null = null;

  constructor(
    private readonly perms: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  attach(io: Server) {
    this.io = io;
  }

  emit<N extends ServerEventName>(room: string | string[], name: N, payload: ServerEvents[N]) {
    if (!this.io) return;
    this.io.to(room).emit(name, envelope(randomUUID(), payload));
  }

  /** Para todos os conectados (ex.: aviso da instância). */
  emitAll<N extends ServerEventName>(name: N, payload: ServerEvents[N]) {
    this.io?.emit(name, envelope(randomUUID(), payload));
  }

  /** Quem tem ao menos um socket conectado agora. */
  async onlineUserIds(): Promise<Set<string>> {
    if (!this.io) return new Set();
    const sockets = await this.io.fetchSockets();
    return new Set(sockets.map((s) => (s.data as SocketData).userId).filter(Boolean));
  }

  /** Derruba todas as conexões do usuário (conta suspensa, sessões encerradas pelo admin). */
  async disconnectUser(userId: string, reason: string) {
    for (const s of await this.socketsOf(rooms.user(userId))) {
      s.emit('session:revoked', envelope(randomUUID(), { reason }));
      s.disconnect(true);
    }
  }

  toUser<N extends ServerEventName>(userId: string, name: N, payload: ServerEvents[N]) {
    this.emit(rooms.user(userId), name, payload);
  }

  private async socketsOf(room: string) {
    if (!this.io) return [];
    return this.io.in(room).fetchSockets();
  }

  /** Recalcula rooms (servidores/canais/DMs) de todos os sockets do usuário a partir das permissões atuais. */
  async syncUserRooms(userId: string) {
    const sockets = await this.socketsOf(rooms.user(userId));
    if (!sockets.length) return;
    const visible = await this.perms.visibleRooms(userId);
    const wanted = new Set([
      ...visible.serverIds.map(rooms.server),
      ...visible.channelIds.map(rooms.channel),
      ...visible.conversationIds.map(rooms.conversation),
    ]);
    for (const s of sockets) {
      for (const r of s.rooms) if (MANAGED_PREFIXES.some((p) => r.startsWith(p)) && !wanted.has(r)) s.leave(r);
      s.join([...wanted]);
    }
  }

  async joinInitialRooms(socket: AppSocket) {
    const visible = await this.perms.visibleRooms(socket.data.userId);
    await socket.join([
      rooms.user(socket.data.userId),
      ...visible.serverIds.map(rooms.server),
      ...visible.channelIds.map(rooms.channel),
      ...visible.conversationIds.map(rooms.conversation),
    ]);
  }

  /** Após mudança de cargos/overrides: ressincroniza todos os membros conectados do servidor. */
  async syncServer(serverId: string) {
    const sockets = await this.socketsOf(rooms.server(serverId));
    const users = new Set(sockets.map((s) => (s.data as SocketData).userId));
    for (const u of users) await this.syncUserRooms(u).catch((e) => this.log.warn(`sync ${u}: ${String(e)}`));
    this.emit(rooms.server(serverId), 'permissions:changed', { serverId });
  }

  async memberJoined(serverId: string, userId: string) {
    const m = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: MEMBER_INCLUDE,
    });
    if (m) this.emit(rooms.server(serverId), 'server:member:joined', { serverId, member: member(m) });
    await this.syncUserRooms(userId);
  }

  async memberRemoved(serverId: string, userId: string, reason: 'kicked' | 'left') {
    this.toUser(userId, 'server:removed', { serverId, reason });
    await this.syncUserRooms(userId);
    this.emit(rooms.server(serverId), 'server:member:left', { serverId, userId, reason });
  }

  async conversationJoined(conversationId: string, userIds: string[]) {
    for (const u of userIds) await this.syncUserRooms(u);
    void conversationId;
  }

  disconnectSession(userId: string, sessionId: string, reason: string) {
    void this.socketsOf(rooms.user(userId)).then((sockets) => {
      for (const s of sockets) {
        if ((s.data as SocketData).sessionId === sessionId) {
          s.emit('session:revoked', envelope(randomUUID(), { reason }));
          s.disconnect(true);
        }
      }
    });
  }
}

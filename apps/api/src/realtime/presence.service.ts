import { Injectable } from '@nestjs/common';
import { rooms, type PresenceStatus } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from './realtime.service.js';

export const PRESENCE_TTL_S = 60;
export const HEARTBEAT_INTERVAL_MS = 25_000;
type ChosenStatus = Exclude<PresenceStatus, 'offline'>;

/**
 * Presença efêmera em Redis:
 * - `presence:sock:<socketId>` (TTL) marca socket vivo; `presence:socks:<userId>` lista sockets.
 * - `presence:status:<userId>` guarda o status escolhido (online/idle/dnd/invisible).
 * Visível para outros: offline sem sockets vivos; `invisible` sempre aparece como offline.
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  private get r() {
    return this.redis.client;
  }

  async connect(userId: string, socketId: string) {
    const before = await this.visible(userId);
    await this.r
      .multi()
      .set(`presence:sock:${socketId}`, userId, 'EX', PRESENCE_TTL_S)
      .sadd(`presence:socks:${userId}`, socketId)
      .exec();
    await this.broadcastIfChanged(userId, before);
  }

  async heartbeat(userId: string, socketId: string, status?: ChosenStatus) {
    const before = await this.visible(userId);
    const m = this.r
      .multi()
      .set(`presence:sock:${socketId}`, userId, 'EX', PRESENCE_TTL_S)
      .sadd(`presence:socks:${userId}`, socketId);
    if (status) m.set(`presence:status:${userId}`, status);
    await m.exec();
    await this.broadcastIfChanged(userId, before);
    return { ttlSeconds: PRESENCE_TTL_S };
  }

  async setStatus(userId: string, status: ChosenStatus) {
    const before = await this.visible(userId);
    await this.r.set(`presence:status:${userId}`, status);
    await this.broadcastIfChanged(userId, before);
  }

  async disconnect(userId: string, socketId: string) {
    const before = await this.visible(userId);
    await this.r.multi().del(`presence:sock:${socketId}`).srem(`presence:socks:${userId}`, socketId).exec();
    await this.broadcastIfChanged(userId, before);
  }

  private async liveSockets(userId: string): Promise<number> {
    const ids = await this.r.smembers(`presence:socks:${userId}`);
    if (!ids.length) return 0;
    const alive = await this.r.mget(ids.map((id) => `presence:sock:${id}`));
    const dead = ids.filter((_, i) => !alive[i]);
    if (dead.length) await this.r.srem(`presence:socks:${userId}`, ...dead);
    return ids.length - dead.length;
  }

  async chosen(userId: string): Promise<ChosenStatus> {
    return ((await this.r.get(`presence:status:${userId}`)) as ChosenStatus | null) ?? 'online';
  }

  /** Status que OUTROS usuários veem. */
  async visible(userId: string): Promise<PresenceStatus> {
    if ((await this.liveSockets(userId)) === 0) return 'offline';
    const s = await this.chosen(userId);
    return s === 'invisible' ? 'offline' : s;
  }

  async visibleMany(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const out: Record<string, PresenceStatus> = {};
    for (const id of userIds) out[id] = await this.visible(id);
    return out;
  }

  private async broadcastIfChanged(userId: string, before: PresenceStatus) {
    const after = await this.visible(userId);
    if (after === before) return;
    const [servers, friends] = await Promise.all([
      this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } }),
      this.prisma.friendship.findMany({
        where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
        select: { requesterId: true, addresseeId: true },
      }),
    ]);
    const targets = [
      ...servers.map((s) => rooms.server(s.serverId)),
      ...friends.map((f) => rooms.user(f.requesterId === userId ? f.addresseeId : f.requesterId)),
      rooms.user(userId),
    ];
    this.realtime.emit(targets, 'presence:changed', { userId, status: after });
  }
}

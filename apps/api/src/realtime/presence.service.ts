import { Injectable } from '@nestjs/common';
import { rooms, type PlayingGame, type PresenceStatus } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from './realtime.service.js';

export const PRESENCE_TTL_S = 60;
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** o jogo expira sozinho se o app sumir sem avisar (o app reenvia enquanto o jogo segue aberto) */
export const GAME_TTL_S = 30 * 60;
const gameKey = (userId: string) => `presence:game:${userId}`;
type ChosenStatus = Exclude<PresenceStatus, 'offline'>;

/**
 * Presença efêmera em Redis:
 * - `presence:sock:<socketId>` (TTL) marca socket vivo; `presence:socks:<userId>` lista sockets.
 * - `presence:status:<userId>` guarda o status escolhido (online/idle/dnd/invisible).
 * - `presence:game:<userId>` (TTL) guarda o jogo que a pessoa está jogando (ADR-0021).
 * Visível para outros: offline sem sockets vivos; `invisible` sempre aparece como offline (e sem jogo).
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

  /** Jogo atual (null = parou). Só os outros que veem a pessoa online recebem o nome. */
  async setGame(userId: string, game: PlayingGame | null) {
    if (game) await this.r.set(gameKey(userId), JSON.stringify(game), 'EX', GAME_TTL_S);
    else await this.r.del(gameKey(userId));
    const visible = (await this.visible(userId)) !== 'offline';
    this.realtime.emit(await this.targets(userId), 'presence:game:changed', { userId, game: visible ? game : null });
  }

  private async rawGame(userId: string): Promise<PlayingGame | null> {
    const raw = await this.r.get(gameKey(userId));
    return raw ? (JSON.parse(raw) as PlayingGame) : null;
  }

  /** Jogo que OUTROS usuários veem: nada se a pessoa está offline ou invisível. */
  async visibleGame(userId: string): Promise<PlayingGame | null> {
    return (await this.visible(userId)) === 'offline' ? null : this.rawGame(userId);
  }

  async visibleGames(userIds: string[]): Promise<Record<string, PlayingGame>> {
    const out: Record<string, PlayingGame> = {};
    for (const id of userIds) {
      const g = await this.visibleGame(id);
      if (g) out[id] = g;
    }
    return out;
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
    // fechou o app (sem sockets): o jogo acaba junto
    if ((await this.liveSockets(userId)) === 0) await this.r.del(gameKey(userId));
    const targets = await this.targets(userId);
    this.realtime.emit(targets, 'presence:changed', { userId, status: after });
    // aparecer/sumir (invisível, offline) mostra ou esconde o jogo para os outros
    if ((before === 'offline') !== (after === 'offline')) {
      const game = after === 'offline' ? null : await this.rawGame(userId);
      if (game || after === 'offline') this.realtime.emit(targets, 'presence:game:changed', { userId, game });
    }
  }

  /** Quem acompanha a presença da pessoa: servidores dela, amigos e ela mesma (outras sessões). */
  private async targets(userId: string): Promise<string[]> {
    const [servers, friends] = await Promise.all([
      this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } }),
      this.prisma.friendship.findMany({
        where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
        select: { requesterId: true, addresseeId: true },
      }),
    ]);
    return [
      ...servers.map((s) => rooms.server(s.serverId)),
      ...friends.map((f) => rooms.user(f.requesterId === userId ? f.addresseeId : f.requesterId)),
      rooms.user(userId),
    ];
  }
}

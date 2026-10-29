import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { hasPermission, Permission, rooms, type VoiceJoinResponse, type VoiceMemberState } from '@opencord/contracts';
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { Subscription } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../common/domain-events.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { forbidden } from '../common/errors.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const MAX_PER_CHANNEL = 25;
/** Tempo para o cliente conectar à SFU após receber o token antes de ser considerado ausente. */
const CONNECT_GRACE_MS = 30_000;

interface StoredState extends VoiceMemberState {
  roomName: string;
  confirmed: boolean;
}

export function sourcesFor(perms: number): TrackSource[] {
  const s: TrackSource[] = [];
  if (hasPermission(perms, Permission.SPEAK)) s.push(TrackSource.MICROPHONE);
  if (hasPermission(perms, Permission.VIDEO)) s.push(TrackSource.CAMERA);
  if (hasPermission(perms, Permission.STREAM)) s.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  return s;
}

@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Voice');
  private readonly rooms: RoomServiceClient;
  private readonly webhooks: WebhookReceiver;
  private sub: Subscription | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
    private readonly events: DomainEvents,
  ) {
    this.rooms = new RoomServiceClient(cfg.LIVEKIT_API_URL, cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
    this.webhooks = new WebhookReceiver(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
  }

  onModuleInit() {
    this.sub = this.events.stream.subscribe((e) => {
      const run = async () => {
        if (e.type === 'member.removed') {
          if (e.userId === '*') await this.disconnectServer(e.serverId, 'revoked');
          else await this.forceDisconnectIfInServer(e.userId, e.serverId, e.reason === 'kicked' ? 'kicked' : 'revoked');
        } else if (e.type === 'permissions.changed') await this.reevaluateServer(e.serverId);
        else if (e.type === 'channel.deleted') await this.disconnectChannel(e.channelId);
      };
      run().catch((err: unknown) => this.log.error(`evento ${e.type}: ${String(err)}`));
    });
    if (this.cfg.VOICE_RECONCILE_INTERVAL_MS > 0) {
      this.timer = setInterval(
        () => void this.reconcile().catch((err: unknown) => this.log.warn(`reconcile: ${String(err)}`)),
        this.cfg.VOICE_RECONCILE_INTERVAL_MS,
      );
    }
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  private get r() {
    return this.redis.client;
  }

  /** Nome de sala opaco: não revela IDs internos à SFU nem a terceiros. */
  roomNameFor(channelId: string): string {
    return `vc_${createHmac('sha256', this.cfg.LIVEKIT_API_SECRET).update(channelId).digest('base64url').slice(0, 22)}`;
  }

  async stateOf(userId: string): Promise<StoredState | null> {
    const raw = await this.r.get(`voice:user:${userId}`);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  }

  private async save(s: StoredState) {
    await this.r
      .multi()
      .set(`voice:user:${s.userId}`, JSON.stringify(s))
      .sadd(`voice:channel:${s.channelId}`, s.userId)
      .sadd('voice:channels', s.channelId)
      .set(`voice:room:${s.roomName}`, s.channelId)
      .exec();
  }

  private async clear(s: StoredState) {
    await this.r.multi().del(`voice:user:${s.userId}`).srem(`voice:channel:${s.channelId}`, s.userId).exec();
    if ((await this.r.scard(`voice:channel:${s.channelId}`)) === 0) await this.r.srem('voice:channels', s.channelId);
  }

  private publicState(s: StoredState): VoiceMemberState {
    const { roomName: _r, confirmed: _c, ...pub } = s;
    return pub;
  }

  async join(userId: string, channelId: string): Promise<VoiceJoinResponse> {
    const access = await this.perms.requireChannel(channelId, userId, Permission.CONNECT);
    if (access.kind !== 'voice') throw new BadRequestException('não é um canal de voz');
    const current = await this.stateOf(userId);
    const occupants = await this.r.scard(`voice:channel:${channelId}`);
    if (occupants >= MAX_PER_CHANNEL && current?.channelId !== channelId)
      throw new BadRequestException('canal de voz cheio');
    // Uma sessão de voz por usuário: trocar de canal encerra a anterior na SFU.
    if (current && current.channelId !== channelId) await this.endSession(current, 'moved');

    const roomName = this.roomNameFor(channelId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    const sources = sourcesFor(access.perms);
    const at = new AccessToken(this.cfg.LIVEKIT_API_KEY, this.cfg.LIVEKIT_API_SECRET, {
      identity: userId,
      name: user.displayName,
      ttl: this.cfg.LIVEKIT_TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ channelId, serverId: access.serverId }),
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      roomCreate: true,
      canSubscribe: true,
      canPublish: sources.length > 0,
      canPublishSources: sources,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      hidden: false,
    });
    const token = await at.toJwt();
    const state: StoredState = {
      userId,
      channelId,
      serverId: access.serverId,
      selfMute: current?.channelId === channelId ? current.selfMute : false,
      selfDeaf: current?.channelId === channelId ? current.selfDeaf : false,
      serverMute: current?.channelId === channelId ? current.serverMute : false,
      video: false,
      streaming: false,
      joinedAt: current?.channelId === channelId ? current.joinedAt : new Date().toISOString(),
      roomName,
      confirmed: current?.channelId === channelId ? current.confirmed : false,
    };
    await this.save(state);
    if (current?.channelId !== channelId)
      this.realtime.emit(rooms.server(access.serverId), 'voice:member:joined', this.publicState(state));
    return {
      url: this.cfg.LIVEKIT_URL,
      token,
      roomName,
      expiresAt: new Date(Date.now() + this.cfg.LIVEKIT_TOKEN_TTL_SECONDS * 1000).toISOString(),
      channelId,
      canSpeak: sources.includes(TrackSource.MICROPHONE) && !state.serverMute,
      canVideo: sources.includes(TrackSource.CAMERA),
      canStream: sources.includes(TrackSource.SCREEN_SHARE),
    };
  }

  async leave(userId: string) {
    const s = await this.stateOf(userId);
    if (s) await this.endSession(s, 'left');
  }

  /** Remove da SFU (não apenas do banco/Redis) e notifica. */
  private async endSession(
    s: StoredState,
    reason: 'left' | 'kicked' | 'timeout' | 'moved',
    notifyUser?: 'kicked' | 'revoked',
  ) {
    await this.clear(s);
    await this.rooms.removeParticipant(s.roomName, s.userId).catch(() => undefined);
    this.realtime.emit(rooms.server(s.serverId), 'voice:member:left', {
      userId: s.userId,
      channelId: s.channelId,
      serverId: s.serverId,
      reason,
    });
    if (notifyUser)
      this.realtime.toUser(s.userId, 'voice:force-disconnect', { channelId: s.channelId, reason: notifyUser });
  }

  async updateSelf(
    userId: string,
    dto: { selfMute?: boolean | undefined; selfDeaf?: boolean | undefined },
  ): Promise<VoiceMemberState> {
    const s = await this.stateOf(userId);
    if (!s) throw new BadRequestException('não está em um canal de voz');
    if (dto.selfMute !== undefined) s.selfMute = dto.selfMute;
    if (dto.selfDeaf !== undefined) {
      s.selfDeaf = dto.selfDeaf;
      if (dto.selfDeaf) s.selfMute = true;
    }
    await this.save(s);
    this.realtime.emit(rooms.server(s.serverId), 'voice:state:changed', this.publicState(s));
    return this.publicState(s);
  }

  async serverMute(actorId: string, targetId: string, muted: boolean) {
    const s = await this.stateOf(targetId);
    if (!s) throw new BadRequestException('membro não está em voz');
    const actor = await this.perms.requireServer(s.serverId, actorId, Permission.MUTE_MEMBERS);
    void actor;
    s.serverMute = muted;
    await this.save(s);
    const access = await this.perms.channel(s.channelId, targetId);
    const sources = sourcesFor(access.perms).filter((src) => !(muted && src === TrackSource.MICROPHONE));
    await this.rooms
      .updateParticipant(s.roomName, targetId, {
        permission: { canPublish: sources.length > 0, canPublishSources: sources, canSubscribe: true },
      })
      .catch((e: unknown) => this.log.warn(`serverMute: ${String(e)}`));
    this.realtime.emit(rooms.server(s.serverId), 'voice:state:changed', this.publicState(s));
  }

  async disconnectMember(actorId: string, targetId: string) {
    const s = await this.stateOf(targetId);
    if (!s) return;
    const actor = await this.perms.requireServer(s.serverId, actorId, Permission.MOVE_MEMBERS);
    void actor;
    await this.endSession(s, 'kicked', 'kicked');
  }

  async listServer(userId: string, serverId: string): Promise<VoiceMemberState[]> {
    await this.perms.server(serverId, userId);
    const channels = await this.prisma.channel.findMany({ where: { serverId, kind: 'voice' }, select: { id: true } });
    const out: VoiceMemberState[] = [];
    for (const c of channels) {
      for (const uid of await this.r.smembers(`voice:channel:${c.id}`)) {
        const s = await this.stateOf(uid);
        if (s && s.channelId === c.id) out.push(this.publicState(s));
      }
    }
    return out;
  }

  private async forceDisconnectIfInServer(userId: string, serverId: string, reason: 'kicked' | 'revoked') {
    const s = await this.stateOf(userId);
    if (s && s.serverId === serverId) await this.endSession(s, 'kicked', reason);
  }

  private async disconnectChannel(channelId: string) {
    for (const uid of await this.r.smembers(`voice:channel:${channelId}`)) {
      const s = await this.stateOf(uid);
      if (s) await this.endSession(s, 'kicked', 'revoked');
    }
  }

  private async disconnectServer(serverId: string, reason: 'revoked') {
    for (const channelId of await this.r.smembers('voice:channels')) {
      for (const uid of await this.r.smembers(`voice:channel:${channelId}`)) {
        const s = await this.stateOf(uid);
        if (s?.serverId === serverId) await this.endSession(s, 'kicked', reason);
      }
    }
  }

  /** Após mudança de cargos/overrides: revoga quem perdeu CONNECT e ajusta fontes publicáveis na SFU. */
  async reevaluateServer(serverId: string) {
    for (const channelId of await this.r.smembers('voice:channels')) {
      for (const uid of await this.r.smembers(`voice:channel:${channelId}`)) {
        const s = await this.stateOf(uid);
        if (!s || s.serverId !== serverId) continue;
        const perms = await this.perms.channel(s.channelId, uid).then(
          (a) => a.perms,
          () => 0,
        );
        if (!hasPermission(perms, Permission.CONNECT)) {
          await this.endSession(s, 'kicked', 'revoked');
          continue;
        }
        const sources = sourcesFor(perms).filter((src) => !(s.serverMute && src === TrackSource.MICROPHONE));
        await this.rooms
          .updateParticipant(s.roomName, uid, {
            permission: { canPublish: sources.length > 0, canPublishSources: sources, canSubscribe: true },
          })
          .catch(() => undefined);
      }
    }
  }

  /** Concilia estado lógico (Redis) com participantes reais da SFU. */
  async reconcile(): Promise<{ removed: number }> {
    let removed = 0;
    for (const channelId of await this.r.smembers('voice:channels')) {
      const roomName = this.roomNameFor(channelId);
      const present = new Set((await this.rooms.listParticipants(roomName).catch(() => [])).map((p) => p.identity));
      for (const uid of await this.r.smembers(`voice:channel:${channelId}`)) {
        const s = await this.stateOf(uid);
        if (!s || s.channelId !== channelId) {
          await this.r.srem(`voice:channel:${channelId}`, uid);
          continue;
        }
        if (present.has(uid)) {
          if (!s.confirmed) await this.save({ ...s, confirmed: true });
          continue;
        }
        const age = Date.now() - new Date(s.joinedAt).getTime();
        if (s.confirmed || age > CONNECT_GRACE_MS) {
          await this.endSession(s, 'timeout');
          removed++;
        }
      }
    }
    return { removed };
  }

  // ---------- Webhooks LiveKit (fonte confiável de estado de mídia) ----------
  async handleWebhook(rawBody: string, authHeader: string | undefined): Promise<void> {
    let ev: WebhookEvent;
    try {
      ev = await this.webhooks.receive(rawBody, authHeader);
    } catch {
      throw forbidden('assinatura de webhook inválida');
    }
    const roomName = ev.room?.name;
    const identity = ev.participant?.identity;
    if (!roomName) return;
    const channelId = await this.r.get(`voice:room:${roomName}`);
    if (!channelId) return;
    if (ev.event === 'room_finished') {
      for (const uid of await this.r.smembers(`voice:channel:${channelId}`)) {
        const s = await this.stateOf(uid);
        if (s?.channelId === channelId) await this.endSession(s, 'left');
      }
      return;
    }
    if (!identity) return;
    const s = await this.stateOf(identity);
    if (!s || s.channelId !== channelId) {
      // participante na SFU sem autorização lógica atual: remover
      if (ev.event === 'participant_joined')
        await this.rooms.removeParticipant(roomName, identity).catch(() => undefined);
      return;
    }
    switch (ev.event) {
      case 'participant_joined':
        await this.save({ ...s, confirmed: true });
        break;
      case 'participant_left':
        await this.endSession(s, 'left');
        break;
      case 'track_published':
      case 'track_unpublished': {
        const on = ev.event === 'track_published';
        const source = ev.track?.source;
        if (source === TrackSource.CAMERA) s.video = on;
        else if (source === TrackSource.SCREEN_SHARE) s.streaming = on;
        else break;
        await this.save(s);
        this.realtime.emit(rooms.server(s.serverId), 'voice:state:changed', this.publicState(s));
        break;
      }
      default:
        break;
    }
  }
}

import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  hasPermission,
  Permission,
  rooms,
  type ActivityState,
  type MusicState,
  type VoiceJoinResponse,
  type VoiceMemberState,
} from '@opencord/contracts';
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { Subscription } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../common/domain-events.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const MAX_PER_CHANNEL = 25;
const PREVIEW_MAX_BYTES = 256 * 1024;
const PREVIEW_TTL_SECONDS = 15 * 60;
/** Tempo para o cliente conectar à SFU após receber o token antes de ser considerado ausente. */
const CONNECT_GRACE_MS = 30_000;
const MOVE_GRACE_MS = 10_000;

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

/**
 * Dados na sala só para quem pode transmitir: a única mensagem do app é a prévia da live (miniatura JPEG, tópico
 * `stream-preview`, ADR-0012). Sem STREAM não há canal de dados (evita mensagens fora da moderação do chat).
 */
export function permissionFor(sources: TrackSource[]) {
  return {
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canPublishData: sources.includes(TrackSource.SCREEN_SHARE),
    canSubscribe: true,
  };
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

  /** Prazos do "mover" (ver moveMember); cancelados ao desligar, para não tocar no Redis já fechado. */
  private readonly moveTimers = new Set<NodeJS.Timeout>();

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
    for (const t of this.moveTimers) clearTimeout(t);
    this.moveTimers.clear();
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

  /**
   * Quem iniciou o "Assistir juntos" saiu da chamada: a sessão passa para alguém que continua nela
   * (chamada vazia encerra logo abaixo).
   */
  private async handOffActivity(s: StoredState) {
    const raw = await this.r.get(`activity:${s.channelId}`);
    if (!raw) return;
    const a = JSON.parse(raw) as ActivityState;
    if (a.startedBy !== s.userId) return;
    const [next] = await this.r.smembers(`voice:channel:${s.channelId}`);
    if (!next) return;
    const now = Date.now();
    // congela a posição atual no novo dono
    const pos = a.playing ? a.positionSec + (now - a.updatedAt) / 1000 : a.positionSec;
    const out: ActivityState = {
      ...a,
      startedBy: next,
      updatedBy: next,
      positionSec: Math.round(pos * 10) / 10,
      updatedAt: now,
      revision: a.revision + 1,
      serverNow: now,
    };
    await this.r.set(`activity:${s.channelId}`, JSON.stringify(out), 'KEEPTTL');
    this.realtime.emit(rooms.server(s.serverId), 'activity:state', out);
  }

  /** DJ da música saiu: quem está na chamada há mais tempo assume a fila (decisão do mantenedor, ADR-0014). */
  private async handOffMusic(s: StoredState) {
    const raw = await this.r.get(`music:${s.channelId}`);
    if (!raw) return;
    const m = JSON.parse(raw) as Omit<MusicState, 'serverNow'>;
    if (m.djId !== s.userId) return;
    let next: { userId: string; joinedAt: string } | null = null;
    for (const uid of await this.r.smembers(`voice:channel:${s.channelId}`)) {
      const o = await this.stateOf(uid);
      if (o && o.channelId === s.channelId && (!next || o.joinedAt < next.joinedAt))
        next = { userId: uid, joinedAt: o.joinedAt };
    }
    if (!next) return; // ninguém ficou: a chamada vazia encerra a música logo abaixo
    const now = Date.now();
    const out = {
      ...m,
      djId: next.userId,
      positionSec: m.playing ? m.positionSec + (now - m.updatedAt) / 1000 : m.positionSec,
      updatedAt: now,
      updatedBy: next.userId,
      revision: m.revision + 1,
    };
    await this.r.set(`music:${s.channelId}`, JSON.stringify(out), 'KEEPTTL');
    this.realtime.emit(rooms.server(s.serverId), 'music:state', { ...out, serverNow: now });
  }

  private async clear(s: StoredState) {
    await this.r.multi().del(`voice:user:${s.userId}`).srem(`voice:channel:${s.channelId}`, s.userId).exec();
    await this.handOffActivity(s);
    await this.handOffMusic(s);
    if ((await this.r.scard(`voice:channel:${s.channelId}`)) === 0) {
      await this.r.srem('voice:channels', s.channelId);
      // chamada vazia: as atividades (Assistir juntos e música) acabam junto
      if ((await this.r.del(`activity:${s.channelId}`)) > 0)
        this.realtime.emit(rooms.server(s.serverId), 'activity:ended', {
          channelId: s.channelId,
          serverId: s.serverId,
        });
      if ((await this.r.del(`music:${s.channelId}`)) > 0)
        this.realtime.emit(rooms.server(s.serverId), 'music:ended', { channelId: s.channelId, serverId: s.serverId });
    }
  }

  // ---------- prévia da live (ADR-0012): última imagem de quem transmite, para quem está fora da chamada ----------
  /** Guarda a prévia (JPEG até 256 KB) de quem está transmitindo; vale 15 min e some quando a live acaba. */
  async setStreamPreview(userId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of file) {
      size += c.length;
      if (size > PREVIEW_MAX_BYTES) throw new PayloadTooLargeException('prévia passa de 256 KB');
      chunks.push(c);
    }
    if (file.truncated) throw new PayloadTooLargeException('prévia passa de 256 KB');
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff)
      throw new BadRequestException('a prévia precisa ser JPEG');
    const s = await this.stateOf(userId);
    if (!s?.streaming) throw new BadRequestException('você não está transmitindo');
    await this.r.set(`voice:preview:${userId}`, buf, 'EX', PREVIEW_TTL_SECONDS);
    s.previewAt = new Date().toISOString();
    await this.save(s);
    this.realtime.emit(rooms.server(s.serverId), 'voice:state:changed', this.publicState(s));
  }

  /** Prévia de alguém: só para quem pode ver o canal em que a pessoa está transmitindo. */
  async streamPreview(viewerId: string, userId: string): Promise<Buffer> {
    const s = await this.stateOf(userId);
    if (!s?.streaming || !s.previewAt) throw notFound('prévia');
    await this.perms.requireChannel(s.channelId, viewerId, Permission.VIEW_CHANNEL);
    const buf = await this.r.getBuffer(`voice:preview:${userId}`);
    if (!buf) throw notFound('prévia');
    return buf;
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
      ...permissionFor(sources),
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
      previewAt: null,
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

  /** Conta suspensa pelo super admin (ADR-0020): sai da chamada na hora. */
  async forceLeave(userId: string) {
    const s = await this.stateOf(userId);
    if (s) await this.endSession(s, 'kicked', 'revoked');
  }

  /** Quantas pessoas estão em chamada agora (painel do super admin). */
  async countInVoice(): Promise<number> {
    let n = 0;
    for (const channelId of await this.r.smembers('voice:channels'))
      n += await this.r.scard(`voice:channel:${channelId}`);
    return n;
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
        permission: permissionFor(sources),
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

  /**
   * Arrastar para outra chamada: quem move precisa de MOVE_MEMBERS no servidor e de CONNECT no destino;
   * o membro movido precisa poder entrar no destino. O app do membro reentra sozinho (token emitido para
   * ele pelo join normal); se não reentrar em MOVE_GRACE_MS, sai da chamada antiga do mesmo jeito.
   */
  async moveMember(actorId: string, targetId: string, channelId: string) {
    const s = await this.stateOf(targetId);
    if (!s) throw new BadRequestException('membro não está em voz');
    if (s.channelId === channelId) return;
    await this.perms.requireServer(s.serverId, actorId, Permission.MOVE_MEMBERS);
    const dest = await this.perms.requireChannel(channelId, actorId, Permission.CONNECT);
    if (dest.kind !== 'voice' || dest.serverId !== s.serverId)
      throw new BadRequestException('não é um canal de voz deste servidor');
    const theirs = await this.perms.channel(channelId, targetId).then(
      (a) => a.perms,
      () => 0,
    );
    if (!hasPermission(theirs, Permission.CONNECT)) throw forbidden('o membro não tem acesso a esse canal');
    if ((await this.r.scard(`voice:channel:${channelId}`)) >= MAX_PER_CHANNEL)
      throw new BadRequestException('canal de voz cheio');
    this.realtime.toUser(targetId, 'voice:force-move', { serverId: s.serverId, channelId, byUserId: actorId });
    const t = setTimeout(() => {
      this.moveTimers.delete(t);
      void this.stateOf(targetId)
        .then(async (cur) => {
          // ainda na chamada antiga (app fechado ou desatualizado): tira de lá
          if (cur && cur.channelId === s.channelId && cur.joinedAt === s.joinedAt) await this.endSession(cur, 'moved');
        })
        .catch((e: unknown) => this.log.warn(`moveMember: ${String(e)}`));
    }, MOVE_GRACE_MS);
    t.unref();
    this.moveTimers.add(t);
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
            permission: permissionFor(sources),
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
        else if (source === TrackSource.SCREEN_SHARE) {
          s.streaming = on;
          if (!on) {
            s.previewAt = null;
            await this.r.del(`voice:preview:${s.userId}`);
          }
        } else break;
        await this.save(s);
        this.realtime.emit(rooms.server(s.serverId), 'voice:state:changed', this.publicState(s));
        break;
      }
      default:
        break;
    }
  }
}

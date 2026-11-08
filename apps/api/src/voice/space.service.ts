import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  generateSpace,
  Permission,
  rooms,
  SpaceLayout,
  SPACE_TOGGLE_KINDS,
  type ServerSpace,
  type SpaceMove,
  type SpaceScreen,
  type SpaceSession,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { AuditService } from '../audit/audit.service.js';
import { forbidden } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { requireServerId, VoiceService } from './voice.service.js';

const TTL_S = 6 * 60 * 60;
const key = (channelId: string) => `space:${channelId}`;
/** quem está na chamada muda pouco: a lista para repassar posições é relida no máximo a cada 2 s */
const CALL_CACHE_MS = 2000;

/**
 * Espaço 3D da chamada (ADR-0055).
 * - Ambiente por servidor: salvo no banco quando alguém com EDIT_SPACE edita; sem edição, o gerado pelo id do servidor.
 * - Telão: o que passa nele é estado da chamada no Redis (como o "Assistir juntos"), apagado quando a chamada esvazia.
 * - Posições: só repassadas a quem está na mesma chamada, sem guardar nada (presença efêmera, sem garantia de entrega).
 */
@Injectable()
export class SpaceService {
  private readonly calls = new Map<string, { channelId: string; peers: string[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly perms: PermissionsService,
    private readonly voice: VoiceService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  private get r() {
    return this.redis.client;
  }

  // ---------- ambiente ----------
  async get(serverId: string, userId: string): Promise<ServerSpace> {
    await this.perms.server(serverId, userId);
    return this.load(serverId);
  }

  private async load(serverId: string): Promise<ServerSpace> {
    const row = await this.prisma.serverSpace.findUnique({ where: { serverId } });
    const parsed = row ? SpaceLayout.safeParse(row.layout) : null;
    if (row && parsed?.success)
      return {
        serverId,
        layout: parsed.data,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedById,
      };
    return {
      serverId,
      layout: generateSpace(serverId),
      revision: row?.revision ?? 0,
      updatedAt: null,
      updatedBy: null,
    };
  }

  async save(serverId: string, userId: string, layout: SpaceLayout, baseRevision: number): Promise<ServerSpace> {
    await this.perms.requireServer(serverId, userId, Permission.EDIT_SPACE);
    const json = layout as unknown as Prisma.InputJsonValue;
    // gravação condicional pela revisão: duas pessoas editando ao mesmo tempo não se sobrescrevem
    const updated = await this.prisma.serverSpace.updateMany({
      where: { serverId, revision: baseRevision },
      data: { layout: json, revision: { increment: 1 }, updatedById: userId },
    });
    if (updated.count === 0) {
      if (baseRevision !== 0) throw new ConflictException('o espaço foi alterado por outra pessoa; recarregue');
      try {
        await this.prisma.serverSpace.create({ data: { serverId, layout: json, revision: 1, updatedById: userId } });
      } catch {
        throw new ConflictException('o espaço foi alterado por outra pessoa; recarregue');
      }
    }
    const out = await this.load(serverId);
    await this.audit.log(userId, serverId, 'space.update', serverId, {
      revision: out.revision,
      theme: layout.theme,
      items: layout.items.length,
      walls: layout.walls.length,
    });
    this.realtime.emit(rooms.server(serverId), 'space:layout', out);
    return out;
  }

  /** Volta ao ambiente gerado (apaga a edição). */
  async reset(serverId: string, userId: string): Promise<ServerSpace> {
    await this.perms.requireServer(serverId, userId, Permission.EDIT_SPACE);
    await this.prisma.serverSpace.deleteMany({ where: { serverId } });
    await this.audit.log(userId, serverId, 'space.reset', serverId, {});
    const out = await this.load(serverId);
    this.realtime.emit(rooms.server(serverId), 'space:layout', out);
    return out;
  }

  // ---------- telão ----------
  private async requireInCall(userId: string, channelId: string): Promise<string> {
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId) throw forbidden('entre na chamada para usar o espaço 3D');
    return requireServerId(s.serverId);
  }

  async session(userId: string, channelId: string): Promise<SpaceSession | null> {
    await this.requireInCall(userId, channelId);
    return this.loadSession(channelId);
  }

  private async loadSession(channelId: string): Promise<SpaceSession | null> {
    const raw = await this.r.get(key(channelId));
    return raw ? (JSON.parse(raw) as SpaceSession) : null;
  }

  private async publishSession(s: SpaceSession): Promise<SpaceSession> {
    await this.r.set(key(s.channelId), JSON.stringify(s), 'EX', TTL_S);
    this.realtime.emit(rooms.channel(s.channelId), 'space:state', s);
    return s;
  }

  /** Liga/desliga luminária, lareira ou fliperama do ambiente do servidor (vale para todos da chamada). */
  async toggle(userId: string, channelId: string, itemId: string, on: boolean): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const { layout } = await this.load(serverId);
    const item = layout.items.find((i) => i.id === itemId);
    if (!item || !(SPACE_TOGGLE_KINDS as readonly string[]).includes(item.kind))
      throw new BadRequestException('essa peça não liga nem desliga');
    const prev = await this.loadSession(channelId);
    const toggles = { ...(prev?.toggles ?? {}), [itemId]: on };
    return this.publishSession({
      channelId,
      serverId,
      screen: prev?.screen ?? null,
      toggles,
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
    });
  }

  async setScreen(userId: string, channelId: string, screen: SpaceScreen | null): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    if (screen?.kind === 'stream') {
      const target = await this.voice.stateOf(screen.userId);
      if (!target || target.channelId !== channelId) throw forbidden('essa pessoa não está na chamada');
    }
    const prev = await this.loadSession(channelId);
    return this.publishSession({
      channelId,
      serverId,
      screen,
      ...(prev?.toggles ? { toggles: prev.toggles } : {}),
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
    });
  }

  // ---------- posições ----------
  private async peers(userId: string, channelId: string): Promise<string[] | null> {
    const hit = this.calls.get(userId);
    if (hit && hit.channelId === channelId && Date.now() - hit.at < CALL_CACHE_MS) return hit.peers;
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId || !s.serverId) {
      this.calls.delete(userId);
      return null;
    }
    const peers = (await this.r.smembers(`voice:channel:${channelId}`)).filter((u) => u !== userId);
    this.calls.set(userId, { channelId, peers, at: Date.now() });
    if (this.calls.size > 5000) this.calls.clear();
    return peers;
  }

  async move(userId: string, m: SpaceMove) {
    const peers = await this.peers(userId, m.channelId);
    if (!peers?.length) return;
    this.realtime.emitVolatile(peers.map(rooms.user), 'space:moved', { ...m, userId });
  }

  async leave(userId: string, channelId: string) {
    const peers = await this.peers(userId, channelId);
    this.calls.delete(userId);
    if (peers?.length) this.realtime.emit(peers.map(rooms.user), 'space:left', { channelId, userId });
  }
}

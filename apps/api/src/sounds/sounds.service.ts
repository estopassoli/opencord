import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import {
  hasPermission,
  Permission,
  rooms,
  SOUND_MAX_BYTES,
  SoundEffectUpload,
  SOUNDS_PER_SERVER,
  type SoundEffect,
} from '@opencord/contracts';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StorageService } from '../attachments/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { VoiceService } from '../voice/voice.service.js';

/** tipos aceitos pelos bytes (o declarado pelo cliente não vale) */
const AUDIO = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/vnd.wave']);
/** intervalo mínimo entre dois efeitos da mesma pessoa (contra flood na chamada) */
const PLAY_GAP_MS = 1500;
/** por quanto tempo quem está na chamada pode baixar um som de outro servidor tocado nela */
const HEARD_GRANT_MS = 10 * 60_000;
const heardKey = (channelId: string, soundId: string) => `sound:heard:${channelId}:${soundId}`;

/**
 * Efeitos sonoros do servidor (ADR-0016). Qualquer membro envia; remove quem enviou ou quem gerencia o servidor.
 * Tocar só manda um aviso para a chamada (Socket.IO); cada pessoa nela toca o arquivo no próprio app.
 * Quem é membro de vários servidores toca os sons de qualquer um deles em qualquer chamada.
 */
@Injectable()
export class SoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly voice: VoiceService,
  ) {}

  private dto(s: {
    id: string;
    serverId: string;
    name: string;
    emoji: string | null;
    volume: number;
    durationMs: number;
    createdAt: Date;
    createdBy: Parameters<typeof userPublic>[0];
  }): SoundEffect {
    return {
      id: s.id,
      serverId: s.serverId,
      name: s.name,
      emoji: s.emoji,
      volume: s.volume,
      durationMs: s.durationMs,
      createdAt: s.createdAt.toISOString(),
      createdBy: userPublic(s.createdBy),
    };
  }

  async list(serverId: string, userId: string): Promise<SoundEffect[]> {
    await this.perms.server(serverId, userId);
    const rows = await this.prisma.soundEffect.findMany({
      where: { serverId },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.dto(r));
  }

  /** Sons de todos os servidores de que a pessoa é membro (o painel agrupa por servidor). */
  async mine(userId: string): Promise<SoundEffect[]> {
    const rows = await this.prisma.soundEffect.findMany({
      where: { server: { members: { some: { userId } } } },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.dto(r));
  }

  async upload(
    serverId: string,
    userId: string,
    file: AsyncIterable<Buffer> & { truncated?: boolean },
    fields: Record<string, unknown>,
  ): Promise<SoundEffect> {
    await this.perms.server(serverId, userId);
    const meta = SoundEffectUpload.safeParse(fields);
    if (!meta.success)
      throw new BadRequestException('dê um nome ao som (até 32 caracteres) e envie um áudio de até 10 s');
    if ((await this.prisma.soundEffect.count({ where: { serverId } })) >= SOUNDS_PER_SERVER)
      throw new BadRequestException(`o servidor já tem ${SOUNDS_PER_SERVER} sons; remova algum antes`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of file) {
      size += c.length;
      if (size > SOUND_MAX_BYTES) throw new PayloadTooLargeException('o som passa de 1 MB');
      chunks.push(c);
    }
    if (file.truncated) throw new PayloadTooLargeException('o som passa de 1 MB');
    const buf = Buffer.concat(chunks);
    const { fileTypeFromBuffer } = await import('file-type');
    const mime = (await fileTypeFromBuffer(buf))?.mime;
    if (!mime || !AUDIO.has(mime)) throw new BadRequestException('use um arquivo MP3, OGG ou WAV');
    const key = `sounds/${randomUUID()}`;
    await this.storage.write(key, buf, mime);
    const row = await this.prisma.soundEffect.create({
      data: {
        serverId,
        name: meta.data.name,
        emoji: meta.data.emoji || null,
        volume: meta.data.volume,
        durationMs: meta.data.durationMs,
        storageKey: key,
        mime,
        sizeBytes: size,
        createdById: userId,
      },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
    });
    await this.audit.log(userId, serverId, 'sound.create', row.id, { name: row.name });
    this.realtime.emit(rooms.server(serverId), 'sound:list:changed', { serverId });
    return this.dto(row);
  }

  async remove(serverId: string, soundId: string, userId: string) {
    const access = await this.perms.server(serverId, userId);
    const s = await this.prisma.soundEffect.findFirst({ where: { id: soundId, serverId } });
    if (!s) throw notFound('som');
    if (s.createdById !== userId && !hasPermission(access.base, Permission.MANAGE_SERVER)) throw forbidden();
    await this.prisma.soundEffect.delete({ where: { id: s.id } });
    await this.storage.remove(s.storageKey).catch(() => undefined);
    await this.audit.log(userId, serverId, 'sound.delete', s.id, { name: s.name });
    this.realtime.emit(rooms.server(serverId), 'sound:list:changed', { serverId });
  }

  /**
   * Arquivo do som, para quem é membro do servidor dele ou está numa chamada em que ele foi tocado
   * há pouco (som de outro servidor, trazido por alguém da chamada).
   */
  async open(soundId: string, userId: string): Promise<{ mime: string; size: number; stream: Readable }> {
    const s = await this.prisma.soundEffect.findUnique({ where: { id: soundId } });
    if (!s) throw notFound('som');
    const member = await this.perms.server(s.serverId, userId).then(
      () => true,
      () => false,
    );
    if (!member) {
      const state = await this.voice.stateOf(userId);
      if (!state || !(await this.redis.client.exists(heardKey(state.channelId, soundId)))) throw notFound('som');
    }
    return { mime: s.mime, size: s.sizeBytes, stream: await this.storage.read(s.storageKey) };
  }

  /**
   * Toca na chamada em que a pessoa está: só um aviso; cada um toca o arquivo no próprio app.
   * O som pode ser de qualquer servidor de que ela é membro.
   */
  async play(userId: string, channelId: string, soundId: string): Promise<null> {
    const state = await this.voice.stateOf(userId);
    if (!state || state.channelId !== channelId) throw forbidden('entre na chamada para tocar um som');
    // som na chamada é como falar: precisa de SPEAK e não pode estar silenciado pela moderação
    if (state.serverMute) throw forbidden('você foi silenciado pela moderação');
    await this.perms.requireChannel(channelId, userId, Permission.SPEAK);
    const s = await this.prisma.soundEffect.findUnique({
      where: { id: soundId },
      select: { serverId: true, volume: true },
    });
    if (!s) throw notFound('som');
    if (s.serverId !== state.serverId)
      await this.perms.server(s.serverId, userId).catch(() => {
        throw notFound('som');
      });
    const ok = await this.redis.client.set(`sound:gap:${userId}`, '1', 'PX', PLAY_GAP_MS, 'NX');
    if (!ok) throw new BadRequestException('espere um instante antes de tocar outro som');
    if (s.serverId !== state.serverId)
      await this.redis.client.set(heardKey(channelId, soundId), '1', 'PX', HEARD_GRANT_MS);
    this.realtime.emit(rooms.channel(channelId), 'sound:played', {
      channelId,
      serverId: state.serverId,
      soundId,
      userId,
      volume: s.volume,
    });
    return null;
  }
}

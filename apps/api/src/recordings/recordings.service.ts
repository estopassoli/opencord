import {
  BadRequestException,
  ConflictException,
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
  RECORDING_MAX_BYTES,
  RECORDING_PART_BYTES,
  RECORDING_TTL_MS,
  rooms,
  type ActiveRecording,
  type CallRecording,
  type ChannelRecordings,
} from '@opencord/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StorageService } from '../attachments/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { VoiceService } from '../voice/voice.service.js';

/** a gravação "viva" some se o app de quem grava parar de avisar (caiu, fechou) */
const ALIVE_TTL_S = 120;
/** trava de uma parte em envio (o envio de 8 MB não leva mais que isso) */
const PART_LOCK_MS = 120_000;
const activeKey = (channelId: string) => `recording:active:${channelId}`;
const SWEEP_MS = 60_000;
/** gravação que ficou no meio (app caiu e não voltou) é descartada depois disto */
const ABANDONED_MS = 6 * 60 * 60_000;
const LINK_TTL_S = 10 * 60;

type Part = { n: number; etag: string };
type Row = {
  id: string;
  serverId: string;
  channelId: string;
  createdById: string;
  status: string;
  storageKey: string;
  uploadId: string | null;
  parts: unknown;
  sizeBytes: bigint;
  durationMs: number;
  startedAt: Date;
  endedAt: Date | null;
  expiresAt: Date;
};

/**
 * Gravação de chamada (ADR-0023). Quem grava monta o vídeo no próprio app e envia em partes de 8 MB enquanto a
 * chamada acontece; o servidor só guarda, avisa a chamada ("Gravando") e entrega o arquivo por 24 h a quem pode ver o
 * canal. Depois disso o arquivo e o registro são apagados por uma varredura periódica.
 */
@Injectable()
export class RecordingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Recordings');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly voice: VoiceService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`varredura: ${String(e)}`)), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get r() {
    return this.redis.client;
  }

  private dto(r: Row & { createdBy: Parameters<typeof userPublic>[0] }): CallRecording {
    return {
      id: r.id,
      channelId: r.channelId,
      createdBy: userPublic(r.createdBy),
      startedAt: r.startedAt.toISOString(),
      endedAt: (r.endedAt ?? r.startedAt).toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      durationMs: r.durationMs,
      sizeBytes: Number(r.sizeBytes),
    };
  }

  private async active(channelId: string): Promise<ActiveRecording | null> {
    const raw = await this.r.get(activeKey(channelId));
    return raw ? (JSON.parse(raw) as ActiveRecording) : null;
  }

  private announce(serverId: string, channelId: string, recording: ActiveRecording | null) {
    this.realtime.emit(rooms.server(serverId), 'recording:state', { channelId, serverId, recording });
  }

  /** Começa: só quem está na chamada; uma gravação por chamada. */
  async start(userId: string, channelId: string): Promise<{ id: string; partBytes: number }> {
    const state = await this.voice.stateOf(userId);
    if (!state || state.channelId !== channelId) throw forbidden('entre na chamada para gravar');
    await this.perms.requireChannel(channelId, userId, Permission.CONNECT);
    if (await this.active(channelId)) throw new ConflictException('esta chamada já está sendo gravada');
    const now = new Date();
    const row = await this.prisma.callRecording.create({
      data: {
        serverId: state.serverId,
        channelId,
        createdById: userId,
        storageKey: 'pending',
        // gravando: some na varredura se abandonada; pronta: fim + 24 h
        expiresAt: new Date(now.getTime() + ABANDONED_MS),
      },
    });
    const storageKey = `recordings/${row.id}`;
    const uploadId = await this.storage.partsBegin(storageKey, 'video/mp4');
    await this.prisma.callRecording.update({ where: { id: row.id }, data: { storageKey, uploadId } });
    const active: ActiveRecording = { id: row.id, channelId, userId, startedAt: now.toISOString() };
    const ok = await this.r.set(activeKey(channelId), JSON.stringify(active), 'EX', ALIVE_TTL_S, 'NX');
    if (!ok) {
      await this.discard({ ...row, storageKey, uploadId });
      throw new ConflictException('esta chamada já está sendo gravada');
    }
    await this.audit.log(userId, state.serverId, 'recording.start', row.id, { channelId });
    this.announce(state.serverId, channelId, active);
    return { id: row.id, partBytes: RECORDING_PART_BYTES };
  }

  private async mine(userId: string, id: string): Promise<Row> {
    const row = await this.prisma.callRecording.findUnique({ where: { id } });
    if (!row || row.createdById !== userId) throw notFound('gravação');
    return row;
  }

  /** Parte `n` (em ordem). Cada parte também renova o "estou gravando". */
  async part(userId: string, id: string, n: number, data: Buffer) {
    // uma parte por vez: duas com o mesmo número em paralelo passariam juntas pela checagem de ordem e de tamanho
    const lock = `rec:partlock:${id}`;
    if (!(await this.r.set(lock, '1', 'PX', PART_LOCK_MS, 'NX')))
      throw new ConflictException('a parte anterior desta gravação ainda está sendo enviada');
    try {
      return await this.putPart(userId, id, n, data);
    } finally {
      await this.r.del(lock);
    }
  }

  private async putPart(userId: string, id: string, n: number, data: Buffer) {
    const row = await this.mine(userId, id);
    if (row.status !== 'recording') throw new BadRequestException('a gravação já terminou');
    // quem saiu ou foi expulso (ou perdeu acesso à chamada) para de gravar ali
    await this.perms.requireChannel(row.channelId, userId, Permission.CONNECT);
    const parts = row.parts as Part[];
    if (n !== parts.length + 1) throw new BadRequestException(`parte fora de ordem (esperada ${parts.length + 1})`);
    if (!data.length || data.length > RECORDING_PART_BYTES) throw new BadRequestException('parte com tamanho inválido');
    const size = Number(row.sizeBytes) + data.length;
    if (size > RECORDING_MAX_BYTES) throw new PayloadTooLargeException('a gravação passou do limite de 16 GB');
    const etag = await this.storage.partsPut(row.storageKey, row.uploadId, n, data);
    await this.prisma.callRecording.update({
      where: { id },
      data: { parts: [...parts, { n, etag }], sizeBytes: BigInt(size) },
    });
    await this.alive(userId, id);
    return { parts: n, sizeBytes: size };
  }

  /** "Ainda gravando" (entre uma parte e outra, em chamadas paradas). */
  async alive(userId: string, id: string) {
    const row = await this.mine(userId, id);
    const cur = await this.active(row.channelId);
    if (cur?.id !== id) throw new BadRequestException('a gravação não está mais ativa');
    await this.r.expire(activeKey(row.channelId), ALIVE_TTL_S);
    return null;
  }

  /** Fecha o arquivo; disponível por 24 h a partir de agora. */
  async complete(userId: string, id: string, durationMs: number): Promise<CallRecording> {
    const row = await this.mine(userId, id);
    if (row.status !== 'recording') throw new BadRequestException('a gravação já terminou');
    const parts = row.parts as Part[];
    await this.clearActive(row);
    if (!parts.length) {
      await this.discard(row);
      throw new BadRequestException('nada foi gravado');
    }
    await this.storage.partsComplete(row.storageKey, row.uploadId, parts);
    const now = new Date();
    const done = await this.prisma.callRecording.update({
      where: { id },
      data: { status: 'ready', durationMs, endedAt: now, expiresAt: new Date(now.getTime() + RECORDING_TTL_MS) },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
    });
    const dto = this.dto(done);
    await this.audit.log(userId, row.serverId, 'recording.ready', id, { durationMs, sizeBytes: dto.sizeBytes });
    this.realtime.emit(rooms.server(row.serverId), 'recording:ready', {
      channelId: row.channelId,
      serverId: row.serverId,
      recording: dto,
    });
    return dto;
  }

  /** Desiste (erro no app de quem grava): apaga o que já subiu. */
  async abort(userId: string, id: string) {
    const row = await this.mine(userId, id);
    if (row.status !== 'recording') throw new BadRequestException('a gravação já terminou');
    await this.clearActive(row);
    await this.discard(row);
    return null;
  }

  private async clearActive(row: Row) {
    const cur = await this.active(row.channelId);
    if (cur?.id === row.id) {
      await this.r.del(activeKey(row.channelId));
      this.announce(row.serverId, row.channelId, null);
    }
  }

  private async discard(row: Pick<Row, 'id' | 'storageKey' | 'uploadId'>) {
    if (row.storageKey !== 'pending')
      await this.storage.partsAbort(row.storageKey, row.uploadId).catch(() => undefined);
    await this.prisma.callRecording.deleteMany({ where: { id: row.id } });
  }

  /** Gravação em andamento e gravações prontas do canal (quem pode ver o canal). */
  async list(userId: string, channelId: string): Promise<ChannelRecordings> {
    await this.perms.channel(channelId, userId);
    const ready = await this.prisma.callRecording.findMany({
      where: { channelId, status: 'ready', expiresAt: { gt: new Date() } },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
      orderBy: { startedAt: 'desc' },
    });
    return { active: await this.active(channelId), ready: ready.map((r) => this.dto(r)) };
  }

  private async readable(userId: string, id: string): Promise<Row> {
    const row = await this.prisma.callRecording.findUnique({ where: { id } });
    if (!row || row.status !== 'ready' || row.expiresAt <= new Date()) throw notFound('gravação');
    await this.perms.channel(row.channelId, userId).catch(() => {
      throw notFound('gravação');
    });
    return row;
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.cfg.ATTACHMENT_URL_SECRET).update(`recording.${id}.${exp}`).digest('base64url');
  }

  /** Link de download de 10 min (o navegador/app baixa direto, sem carregar o arquivo na memória). */
  async link(userId: string, id: string): Promise<{ url: string }> {
    await this.readable(userId, id);
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
    return { url: `${this.cfg.PUBLIC_API_URL}/recordings/${id}/download?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  verify(id: string, exp: string | undefined, sig: string | undefined): boolean {
    const e = Number(exp);
    if (!sig || !Number.isInteger(e) || e * 1000 < Date.now()) return false;
    const a = Buffer.from(this.sign(id, e));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async openForDownload(id: string): Promise<{ name: string; size: number; stream: Readable } | null> {
    const row = await this.prisma.callRecording.findUnique({
      where: { id },
      include: { channel: { select: { name: true } } },
    });
    if (!row || row.status !== 'ready' || row.expiresAt <= new Date()) return null;
    const d = row.startedAt;
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `Gravação ${row.channel.name} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}.mp4`;
    return { name, size: Number(row.sizeBytes), stream: await this.storage.read(row.storageKey) };
  }

  /** Quem gravou ou quem gerencia o servidor apaga antes das 24 h. */
  async remove(userId: string, id: string) {
    const row = await this.prisma.callRecording.findUnique({ where: { id } });
    if (!row || row.status !== 'ready') throw notFound('gravação');
    const access = await this.perms.server(row.serverId, userId).catch(() => {
      throw notFound('gravação');
    });
    if (row.createdById !== userId && !hasPermission(access.base, Permission.MANAGE_SERVER)) throw forbidden();
    await this.storage.remove(row.storageKey).catch(() => undefined);
    await this.prisma.callRecording.delete({ where: { id } });
    await this.audit.log(userId, row.serverId, 'recording.delete', id, {});
    return null;
  }

  /**
   * Varredura (a cada minuto): apaga gravações vencidas (24 h) e fecha as que perderam quem gravava (o app caiu ou
   * fechou sem terminar): o que já subiu vira uma gravação pronta; se nada subiu, é descartada.
   */
  async sweep(now = new Date()) {
    const due = await this.prisma.callRecording.findMany({
      where: { status: 'ready', expiresAt: { lte: now } },
      take: 100,
    });
    for (const row of due) {
      await this.storage.remove(row.storageKey).catch(() => undefined);
      await this.prisma.callRecording.deleteMany({ where: { id: row.id } });
    }
    const open = await this.prisma.callRecording.findMany({
      where: { status: 'recording', startedAt: { lte: new Date(now.getTime() - 30_000) } },
      take: 100,
    });
    for (const row of open) {
      const cur = await this.active(row.channelId);
      if (cur?.id === row.id && row.startedAt.getTime() > now.getTime() - ABANDONED_MS) continue;
      await this.clearActive(row);
      await this.salvage(row, now);
    }
    return due.length;
  }

  private async salvage(row: Row, now: Date) {
    const parts = row.parts as Part[];
    if (!parts.length) return this.discard(row);
    try {
      await this.storage.partsComplete(row.storageKey, row.uploadId, parts);
    } catch {
      return this.discard(row);
    }
    const done = await this.prisma.callRecording.update({
      where: { id: row.id },
      data: {
        status: 'ready',
        durationMs: now.getTime() - row.startedAt.getTime(),
        endedAt: now,
        expiresAt: new Date(now.getTime() + RECORDING_TTL_MS),
      },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
    });
    this.realtime.emit(rooms.server(row.serverId), 'recording:ready', {
      channelId: row.channelId,
      serverId: row.serverId,
      recording: this.dto(done),
    });
  }
}

/**
 * Eventos do servidor (ADR-0028): "sexta 21h, raid" com canal de voz opcional e confirmação de presença (vou/talvez).
 * Qualquer membro cria; edita e apaga quem criou ou quem tem MANAGE_CHANNELS. Eventos encerrados (ou começados há
 * mais de 6 h sem fim definido) somem da lista. Tudo é retransmitido à room do servidor.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  hasPermission,
  Permission,
  rooms,
  type CreateEventRequest,
  type RsvpStatus,
  type ServerEvent,
  type UpdateEventRequest,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const INCLUDE = {
  createdBy: { select: USER_PUBLIC_SELECT },
  rsvps: { select: { userId: true, status: true } },
} satisfies Prisma.ServerEventInclude;
type Row = Prisma.ServerEventGetPayload<{ include: typeof INCLUDE }>;

const MAX_UPCOMING = 50;
/** sem hora de fim, o evento some da lista 6 h depois de começar */
const DEFAULT_SPAN_MS = 6 * 3_600_000;
const MAX_AHEAD_MS = 366 * 24 * 3_600_000;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
  ) {}

  serialize(e: Row, me: string | null): ServerEvent {
    const going = e.rsvps.filter((r) => r.status === 'going').map((r) => r.userId);
    const maybe = e.rsvps.filter((r) => r.status === 'maybe').map((r) => r.userId);
    return {
      id: e.id,
      serverId: e.serverId,
      channelId: e.channelId,
      createdBy: userPublic(e.createdBy),
      title: e.title,
      description: e.description,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      going,
      maybe,
      me: me ? ((e.rsvps.find((r) => r.userId === me)?.status as RsvpStatus | undefined) ?? null) : null,
    };
  }

  /** próximos e em andamento, do mais próximo ao mais distante */
  async list(userId: string, serverId: string): Promise<ServerEvent[]> {
    await this.perms.server(serverId, userId);
    const now = new Date();
    const rows = await this.prisma.serverEvent.findMany({
      where: {
        serverId,
        OR: [{ endsAt: { gt: now } }, { endsAt: null, startsAt: { gt: new Date(now.getTime() - DEFAULT_SPAN_MS) } }],
      },
      include: INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: MAX_UPCOMING,
    });
    return rows.map((e) => this.serialize(e, userId));
  }

  private async validate(serverId: string, userId: string, dto: Partial<CreateEventRequest>, cur?: Row) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : (cur?.startsAt ?? null);
    const endsAt = dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : (cur?.endsAt ?? null);
    if (!startsAt || Number.isNaN(startsAt.getTime())) throw new BadRequestException('data de início inválida');
    if (startsAt.getTime() > Date.now() + MAX_AHEAD_MS) throw new BadRequestException('evento longe demais no futuro');
    if (!cur && startsAt.getTime() < Date.now() - 60_000)
      throw new BadRequestException('o evento precisa ser no futuro');
    if (endsAt && endsAt.getTime() <= startsAt.getTime())
      throw new BadRequestException('o fim precisa ser depois do início');
    const channelId = dto.channelId !== undefined ? dto.channelId : (cur?.channelId ?? null);
    if (channelId) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { serverId: true, kind: true },
      });
      if (!ch || ch.serverId !== serverId || ch.kind !== 'voice')
        throw new BadRequestException('escolha um canal de voz deste servidor');
      await this.perms.requireChannel(channelId, userId, Permission.CONNECT);
    }
    return { startsAt, endsAt, channelId };
  }

  async create(userId: string, serverId: string, dto: CreateEventRequest): Promise<ServerEvent> {
    await this.perms.server(serverId, userId);
    const v = await this.validate(serverId, userId, dto);
    const row = await this.prisma.serverEvent.create({
      data: {
        serverId,
        createdById: userId,
        title: dto.title,
        description: dto.description ?? '',
        channelId: v.channelId,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        // quem cria já vai
        rsvps: { create: { userId, status: 'going' } },
      },
      include: INCLUDE,
    });
    this.broadcast(row);
    return this.serialize(row, userId);
  }

  private async load(eventId: string): Promise<Row> {
    const row = await this.prisma.serverEvent.findUnique({ where: { id: eventId }, include: INCLUDE });
    if (!row) throw notFound('evento');
    return row;
  }

  private async canManage(row: Row, userId: string) {
    const access = await this.perms.server(row.serverId, userId).catch(() => {
      throw notFound('evento');
    });
    if (row.createdById !== userId && !hasPermission(access.base, Permission.MANAGE_CHANNELS))
      throw forbidden('só quem criou o evento (ou gerencia canais) pode mudá-lo');
  }

  async update(userId: string, eventId: string, dto: UpdateEventRequest): Promise<ServerEvent> {
    const cur = await this.load(eventId);
    await this.canManage(cur, userId);
    const v = await this.validate(cur.serverId, userId, dto, cur);
    const row = await this.prisma.serverEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        channelId: v.channelId,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
      },
      include: INCLUDE,
    });
    this.broadcast(row);
    return this.serialize(row, userId);
  }

  async remove(userId: string, eventId: string) {
    const cur = await this.load(eventId);
    await this.canManage(cur, userId);
    await this.prisma.serverEvent.delete({ where: { id: eventId } });
    this.realtime.emit(rooms.server(cur.serverId), 'event:deleted', { serverId: cur.serverId, eventId });
  }

  async rsvp(userId: string, eventId: string, status: RsvpStatus | null): Promise<ServerEvent> {
    const cur = await this.load(eventId);
    await this.perms.server(cur.serverId, userId).catch(() => {
      throw notFound('evento');
    });
    if (status)
      await this.prisma.eventRsvp.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId, status },
        update: { status },
      });
    else await this.prisma.eventRsvp.deleteMany({ where: { eventId, userId } });
    const row = await this.load(eventId);
    this.broadcast(row);
    return this.serialize(row, userId);
  }

  private broadcast(row: Row) {
    this.realtime.emit(rooms.server(row.serverId), 'event:changed', {
      serverId: row.serverId,
      event: this.serialize(row, null),
    });
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { hasPermission, Permission } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { channel } from '../common/serialize.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { PermissionsService } from './permissions.service.js';
import { ServersService } from './servers.service.js';

const ENTER = Permission.CONNECT | Permission.VIEW_CHANNEL;

/**
 * Salas privadas (ADR-0040): a sala temporária (ADR-0029) tem dona. Ela tranca (ninguém mais entra: @everyone e
 * cargos perdem CONNECT; quem já está dentro ganha um override próprio), convida (override de membro com CONNECT),
 * limita vagas, renomeia e remove gente. Quem não pode entrar pede (knock) e a dona recebe o pedido com "Deixar
 * entrar". Quem tem MANAGE_CHANNELS no servidor manda em qualquer sala.
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly servers: ServersService,
    private readonly voice: VoiceService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /** Sala criada direto no criador de salas, já trancada ou com limite; a pessoa entra em seguida pelo app. */
  async create(
    hubId: string,
    userId: string,
    dto: { name?: string | undefined; locked?: boolean | undefined; userLimit?: number | null | undefined },
  ) {
    const access = await this.perms.requireChannel(hubId, userId, Permission.CONNECT);
    const hub = await this.prisma.channel.findUnique({ where: { id: hubId }, select: { roomHub: true } });
    if (!hub?.roomHub) throw new BadRequestException('este canal não cria salas');
    if (access.hidden) throw forbidden('fique visível no servidor para criar uma sala');
    const { id } = await this.servers.createTemporaryRoom(hubId, userId, dto);
    if (dto.locked) await this.permissionsChanged(access.serverId);
    return this.serialize(id, userId);
  }

  async update(
    channelId: string,
    actorId: string,
    dto: { name?: string | undefined; locked?: boolean | undefined; userLimit?: number | null | undefined },
  ) {
    const room = await this.requireOwner(channelId, actorId);
    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.userLimit !== undefined ? { userLimit: dto.userLimit } : {}),
        },
      });
      if (dto.locked === undefined) return;
      const everyone = await tx.role.findFirstOrThrow({ where: { serverId: room.serverId, isEveryone: true } });
      const roleOverrides = await tx.channelPermissionOverride.findMany({ where: { channelId, subjectType: 'role' } });
      if (dto.locked) {
        // quem já está dentro continua: override próprio antes de fechar a porta
        for (const uid of await this.voice.occupants(channelId)) await this.allowMember(tx, channelId, uid);
        for (const o of roleOverrides)
          await tx.channelPermissionOverride.update({
            where: { channelId_subjectType_subjectId: { channelId, subjectType: 'role', subjectId: o.subjectId } },
            data: { allow: o.allow & ~Permission.CONNECT, deny: o.deny | Permission.CONNECT },
          });
        if (!roleOverrides.some((o) => o.subjectId === everyone.id))
          await tx.channelPermissionOverride.create({
            data: { channelId, subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.CONNECT },
          });
      } else {
        for (const o of roleOverrides)
          await tx.channelPermissionOverride.update({
            where: { channelId_subjectType_subjectId: { channelId, subjectType: 'role', subjectId: o.subjectId } },
            data: { deny: o.deny & ~Permission.CONNECT },
          });
      }
    });
    if (dto.locked !== undefined) {
      await this.audit.log(actorId, room.serverId, dto.locked ? 'room.lock' : 'room.unlock', channelId, {});
      await this.permissionsChanged(room.serverId);
    }
    await this.servers.emitChannelUpdated(room.serverId, channelId);
    return this.serialize(channelId, actorId);
  }

  /** Convida: override de membro com CONNECT e aviso "Entrar" para cada pessoa. */
  async invite(channelId: string, actorId: string, userIds: string[]) {
    const room = await this.requireOwner(channelId, actorId);
    const members = await this.prisma.serverMember.findMany({
      where: { serverId: room.serverId, userId: { in: userIds }, hidden: false },
      select: { userId: true },
    });
    if (!members.length) throw new BadRequestException('ninguém da lista está no servidor');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { displayName: true } });
    await this.prisma.$transaction(async (tx) => {
      for (const m of members) await this.allowMember(tx, channelId, m.userId);
    });
    await this.permissionsChanged(room.serverId);
    await this.servers.emitChannelUpdated(room.serverId, channelId);
    for (const m of members)
      if (m.userId !== actorId)
        this.realtime.toUser(m.userId, 'notification:created', {
          kind: 'room_invite',
          title: `${actor.displayName} convidou você para ${room.name}`,
          body: 'Toque para entrar na sala.',
          channelId,
          serverId: room.serverId,
          userId: actorId,
        });
    return this.serialize(channelId, actorId);
  }

  /** Tira alguém da sala e cancela o convite dela. */
  async kick(channelId: string, actorId: string, targetId: string) {
    const room = await this.requireOwner(channelId, actorId);
    if (targetId === actorId) throw new BadRequestException('use "sair"');
    if (targetId === room.ownerId) throw forbidden('a dona da sala não pode ser removida dela');
    await this.prisma.channelPermissionOverride
      .delete({ where: { channelId_subjectType_subjectId: { channelId, subjectType: 'member', subjectId: targetId } } })
      .catch(() => undefined);
    await this.voice.kickFromChannel(channelId, targetId);
    await this.permissionsChanged(room.serverId);
    await this.servers.emitChannelUpdated(room.serverId, channelId);
  }

  /** Quem vê a sala trancada mas não entra pede para entrar; a dona recebe o aviso com "Deixar entrar". */
  async knock(channelId: string, userId: string) {
    const access = await this.perms.requireChannel(channelId, userId, Permission.VIEW_CHANNEL);
    const room = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { temporary: true, ownerId: true, name: true },
    });
    if (!room?.temporary || !room.ownerId) throw notFound('sala');
    if (hasPermission(access.perms, Permission.CONNECT))
      throw new BadRequestException('você já pode entrar nesta sala');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    this.realtime.toUser(room.ownerId, 'notification:created', {
      kind: 'room_knock',
      title: `${user.displayName} quer entrar em ${room.name}`,
      body: 'Toque para deixar entrar.',
      channelId,
      serverId: access.serverId,
      userId,
    });
  }

  private async requireOwner(channelId: string, actorId: string) {
    const room = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, serverId: true, name: true, temporary: true, ownerId: true },
    });
    if (!room?.temporary) throw notFound('sala');
    const access = await this.perms.requireChannel(channelId, actorId, Permission.VIEW_CHANNEL);
    if (room.ownerId !== actorId && !hasPermission(access.base, Permission.MANAGE_CHANNELS))
      throw forbidden('só a dona da sala (ou quem gerencia canais) faz isso');
    return room;
  }

  private async allowMember(
    tx: { channelPermissionOverride: PrismaService['channelPermissionOverride'] },
    channelId: string,
    userId: string,
  ) {
    const key = { channelId, subjectType: 'member' as const, subjectId: userId };
    const cur = await tx.channelPermissionOverride.findUnique({ where: { channelId_subjectType_subjectId: key } });
    await tx.channelPermissionOverride.upsert({
      where: { channelId_subjectType_subjectId: key },
      create: { ...key, allow: ENTER, deny: 0 },
      update: { allow: (cur?.allow ?? 0) | ENTER, deny: (cur?.deny ?? 0) & ~ENTER },
    });
  }

  private async permissionsChanged(serverId: string) {
    await this.servers.permissionsChangedPublic(serverId);
  }

  private async serialize(channelId: string, userId: string) {
    const c = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { overrides: true } });
    const access = await this.perms.server(c.serverId, userId);
    return channel(
      c,
      (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0,
      await this.servers.everyoneId(c.serverId),
    );
  }
}

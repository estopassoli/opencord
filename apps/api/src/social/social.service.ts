import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { nickKeyOf, rooms, type Conversation, type Friend, type UserPublic } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const canonical = (a: string, b: string) => (a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a });
const MAX_GROUP_MEMBERS = 10;

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private async isBlockedEitherWay(a: string, b: string) {
    return Boolean(
      await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      }),
    );
  }

  private friendView(
    f: {
      requesterId: string;
      addresseeId: string;
      status: 'pending' | 'accepted';
      createdAt: Date;
      acceptedAt: Date | null;
      requester: UserRowLike;
      addressee: UserRowLike;
    },
    me: string,
  ): Friend {
    const other = f.requesterId === me ? f.addressee : f.requester;
    const status =
      f.status === 'accepted' ? 'accepted' : f.requesterId === me ? 'pending_outgoing' : 'pending_incoming';
    return { user: userPublic(other), status, since: (f.acceptedAt ?? f.createdAt).toISOString() };
  }

  async listFriends(userId: string): Promise<Friend[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: { requester: { select: USER_PUBLIC_SELECT }, addressee: { select: USER_PUBLIC_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.friendView(r, userId));
  }

  async request(userId: string, username: string): Promise<Friend> {
    const target =
      (await this.prisma.user.findUnique({
        where: { nickKey: nickKeyOf(username) },
        select: { id: true, disabledAt: true },
      })) ??
      (await this.prisma.user.findUnique({
        where: { username: username.toLowerCase() },
        select: { id: true, disabledAt: true },
      }));
    // mesma resposta para inexistente e bloqueado: não revela quem bloqueou
    if (!target || target.disabledAt || target.id === userId || (await this.isBlockedEitherWay(userId, target.id))) {
      throw notFound('usuário');
    }
    const key = canonical(userId, target.id);
    const existing = await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: key } });
    if (existing?.status === 'accepted') throw new ConflictException('já são amigos');
    let row;
    if (existing && existing.requesterId === target.id) {
      // pedido cruzado: aceitar automaticamente
      row = await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'accepted', acceptedAt: new Date() },
        include: INCLUDE,
      });
    } else if (existing) {
      row = await this.prisma.friendship.findUniqueOrThrow({ where: { id: existing.id }, include: INCLUDE });
    } else {
      row = await this.prisma.friendship.create({
        data: { requesterId: userId, addresseeId: target.id, ...key },
        include: INCLUDE,
      });
      this.realtime.toUser(target.id, 'notification:created', {
        kind: 'friend_request',
        title: 'Pedido de amizade',
        body: row.requester.displayName,
      });
    }
    this.realtime.toUser(target.id, 'friend:changed', this.friendView(row, target.id));
    this.realtime.toUser(userId, 'friend:changed', this.friendView(row, userId));
    return this.friendView(row, userId);
  }

  async accept(userId: string, otherId: string): Promise<Friend> {
    const f = await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: canonical(userId, otherId) } });
    if (!f || f.addresseeId !== userId || f.status !== 'pending') throw notFound('pedido de amizade');
    const row = await this.prisma.friendship.update({
      where: { id: f.id },
      data: { status: 'accepted', acceptedAt: new Date() },
      include: INCLUDE,
    });
    this.realtime.toUser(otherId, 'friend:changed', this.friendView(row, otherId));
    this.realtime.toUser(userId, 'friend:changed', this.friendView(row, userId));
    return this.friendView(row, userId);
  }

  /** Remove amizade, recusa ou cancela pedido. */
  async remove(userId: string, otherId: string): Promise<void> {
    const r = await this.prisma.friendship.deleteMany({ where: canonical(userId, otherId) });
    if (r.count) {
      this.realtime.toUser(otherId, 'friend:changed', { userId, removed: true });
      this.realtime.toUser(userId, 'friend:changed', { userId: otherId, removed: true });
    }
  }

  async block(userId: string, otherId: string): Promise<void> {
    if (userId === otherId) throw new BadRequestException('não é possível bloquear a si mesmo');
    const target = await this.prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
    if (!target) throw notFound('usuário');
    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: otherId } },
        create: { blockerId: userId, blockedId: otherId },
        update: {},
      }),
      this.prisma.friendship.deleteMany({ where: canonical(userId, otherId) }),
    ]);
    this.realtime.toUser(userId, 'friend:changed', { userId: otherId, removed: true });
    this.realtime.toUser(otherId, 'friend:changed', { userId, removed: true });
  }

  async unblock(userId: string, otherId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: otherId } });
  }

  async listBlocked(userId: string): Promise<UserPublic[]> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: USER_PUBLIC_SELECT } },
    });
    return rows.map((r) => userPublic(r.blocked));
  }

  // ---------- Conversas ----------
  private convView(c: {
    id: string;
    kind: 'dm' | 'group';
    name: string | null;
    members: { user: UserRowLike }[];
    messages?: { id: string }[];
  }): Conversation {
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      members: c.members.map((m) => userPublic(m.user)),
      lastMessageId: c.messages?.[0]?.id ?? null,
    };
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: { select: USER_PUBLIC_SELECT } } },
        messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true } },
      },
    });
    return rows
      .map((r) => this.convView(r))
      .sort((a, b) => (b.lastMessageId ?? '').localeCompare(a.lastMessageId ?? ''));
  }

  /**
   * DM 1:1 exige amizade aceita ou servidor em comum, e nenhum bloqueio.
   * Grupo: todos os convidados devem ser amigos do criador.
   */
  async openConversation(userId: string, userIds: string[], name?: string): Promise<Conversation> {
    const others = [...new Set(userIds)].filter((u) => u !== userId);
    if (!others.length) throw new BadRequestException('informe ao menos um participante');
    if (others.length + 1 > MAX_GROUP_MEMBERS) throw new BadRequestException('grupo grande demais');
    for (const o of others) {
      if (await this.isBlockedEitherWay(userId, o)) throw notFound('usuário');
      if (!(await this.canContact(userId, o, others.length > 1)))
        throw forbidden('vocês precisam ser amigos (ou compartilhar um servidor, para DM)');
    }
    const include = { members: { include: { user: { select: USER_PUBLIC_SELECT } } } } as const;
    if (others.length === 1) {
      const other = others[0] as string;
      const k = canonical(userId, other);
      const dmKey = `${k.userLowId}:${k.userHighId}`;
      const existing = await this.prisma.conversation.findUnique({ where: { dmKey }, include });
      if (existing) return this.convView(existing);
      const c = await this.prisma.conversation.create({
        data: { kind: 'dm', dmKey, members: { create: [{ userId }, { userId: other }] } },
        include,
      });
      await this.realtime.conversationJoined(c.id, [userId, other]);
      for (const u of [userId, other]) this.realtime.toUser(u, 'conversation:upserted', this.convView(c));
      return this.convView(c);
    }
    const c = await this.prisma.conversation.create({
      data: { kind: 'group', name: name ?? null, members: { create: [userId, ...others].map((u) => ({ userId: u })) } },
      include,
    });
    await this.realtime.conversationJoined(c.id, [userId, ...others]);
    this.realtime.emit(rooms.conversation(c.id), 'conversation:upserted', this.convView(c));
    return this.convView(c);
  }

  private async canContact(a: string, b: string, group: boolean): Promise<boolean> {
    const f = await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: canonical(a, b) } });
    if (f?.status === 'accepted') return true;
    if (group) return false;
    const shared = await this.prisma.serverMember.findFirst({
      where: { userId: a, server: { members: { some: { userId: b } } } },
    });
    return Boolean(shared);
  }

  async leaveConversation(userId: string, conversationId: string): Promise<void> {
    const c = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { members: true } });
    if (!c || !c.members.some((m) => m.userId === userId)) throw notFound('conversa');
    if (c.kind === 'dm') throw new BadRequestException('DMs não podem ser abandonadas');
    await this.prisma.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId } } });
    await this.realtime.syncUserRooms(userId);
  }
}

type UserRowLike = { id: string; username: string; displayName: string; avatarKey: string | null };
const INCLUDE = { requester: { select: USER_PUBLIC_SELECT }, addressee: { select: USER_PUBLIC_SELECT } } as const;

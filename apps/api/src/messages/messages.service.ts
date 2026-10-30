import { BadRequestException, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  extractMentions,
  hasPermission,
  MAX_PINS,
  REACTION_ROLE_FORBIDDEN,
  Permission,
  rooms,
  type Message,
  type MessagePage,
  type Poll,
  type ReactionSummary,
  type UnreadState,
} from '@opencord/contracts';
import { Prisma } from '@opencord/db';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { ServersService } from '../servers/servers.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export type Target =
  { channelId: string; conversationId?: undefined } | { conversationId: string; channelId?: undefined };

const MESSAGE_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
  attachments: { orderBy: { createdAt: 'asc' } },
  reactions: { select: { emoji: true, userId: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  replyTo: { select: { id: true, body: true, deletedAt: true, author: { select: USER_PUBLIC_SELECT } } },
  reactionRoles: { select: { emoji: true, roleId: true }, orderBy: { createdAt: 'asc' } },
  poll: {
    include: {
      options: { orderBy: { position: 'asc' } },
      votes: { select: { optionId: true, userId: true } },
    },
  },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

const MAX_REACTION_EMOJIS = 20;

interface TargetAccess {
  room: string;
  channelId: string | null;
  conversationId: string | null;
  serverId: string | null;
  perms: number;
  memberIds?: string[];
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly attachments: AttachmentsService,
    private readonly realtime: RealtimeService,
    private readonly boards: BoardsService,
    private readonly servers: ServersService,
  ) {}

  /** Resolve acesso ao destino. DMs: membros têm todas as permissões de mensagem. */
  async access(userId: string, target: Target): Promise<TargetAccess> {
    if (target.channelId) {
      const a = await this.perms.channel(target.channelId, userId);
      if (a.kind !== 'text') throw new BadRequestException('este canal não aceita mensagens');
      return {
        room: rooms.channel(a.channelId),
        channelId: a.channelId,
        conversationId: null,
        serverId: a.serverId,
        perms: a.perms,
      };
    }
    const conv = await this.prisma.conversation.findUnique({
      where: { id: target.conversationId },
      include: { members: { select: { userId: true } } },
    });
    const memberIds = conv?.members.map((m) => m.userId) ?? [];
    if (!conv || !memberIds.includes(userId)) throw notFound('conversa');
    const dmPerms =
      Permission.VIEW_CHANNEL |
      Permission.SEND_MESSAGES |
      Permission.ATTACH_FILES |
      Permission.ADD_REACTIONS |
      Permission.READ_HISTORY;
    return {
      room: rooms.conversation(conv.id),
      channelId: null,
      conversationId: conv.id,
      serverId: null,
      perms: dmPerms,
      memberIds,
    };
  }

  private reactions(rows: MessageRow['reactions'], me: string | null): ReactionSummary[] {
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.emoji, [...(by.get(r.emoji) ?? []), r.userId]);
    return [...by].map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      me: me ? userIds.includes(me) : false,
      userIds: userIds.slice(0, 100),
    }));
  }

  serialize(m: MessageRow, me: string | null): Message {
    const deleted = m.deletedAt !== null;
    return {
      id: m.id,
      channelId: m.channelId,
      conversationId: m.conversationId,
      author: userPublic(m.author),
      body: deleted ? '' : m.body,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      deleted,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            author: m.replyTo.author ? userPublic(m.replyTo.author) : null,
            bodyPreview: m.replyTo.deletedAt ? '' : m.replyTo.body.slice(0, 200),
            deleted: m.replyTo.deletedAt !== null,
          }
        : null,
      reactions: deleted ? [] : this.reactions(m.reactions, me),
      attachments: deleted ? [] : m.attachments.map((a) => this.attachments.serialize(a)),
      mentions: deleted ? [] : m.mentions,
      pinnedAt: deleted ? null : (m.pinnedAt?.toISOString() ?? null),
      poll: deleted || !m.poll ? null : this.serializePoll(m.poll, me),
      reactionRoles: deleted ? [] : m.reactionRoles,
    };
  }

  private serializePoll(p: NonNullable<MessageRow['poll']>, me: string | null): Poll {
    const count = new Map<string, number>();
    for (const v of p.votes) count.set(v.optionId, (count.get(v.optionId) ?? 0) + 1);
    return {
      id: p.id,
      question: p.question,
      multiple: p.multiple,
      endsAt: p.endsAt?.toISOString() ?? null,
      closed: p.endsAt !== null && p.endsAt.getTime() <= Date.now(),
      options: p.options.map((o) => ({ id: o.id, text: o.text, votes: count.get(o.id) ?? 0 })),
      voters: new Set(p.votes.map((v) => v.userId)).size,
      mine: me ? p.votes.filter((v) => v.userId === me).map((v) => v.optionId) : [],
    };
  }

  private targetWhere(a: TargetAccess): Prisma.MessageWhereInput {
    return a.channelId ? { channelId: a.channelId } : { conversationId: a.conversationId as string };
  }

  async list(
    userId: string,
    target: Target,
    q: { before?: string | undefined; after?: string | undefined; limit: number },
  ): Promise<MessagePage> {
    const a = await this.access(userId, target);
    if (!hasPermission(a.perms, Permission.READ_HISTORY)) throw forbidden('sem acesso ao histórico');
    const before = q.before ? decodeCursor(q.before) : null;
    const after = q.after ? decodeCursor(q.after) : null;
    if ((q.before && !before) || (q.after && !after)) throw new BadRequestException('cursor inválido');
    const cmp = (c: { createdAt: Date; id: string }, op: 'lt' | 'gt'): Prisma.MessageWhereInput => ({
      OR: [{ createdAt: { [op]: c.createdAt } }, { createdAt: c.createdAt, id: { [op]: c.id } }],
    });
    const where: Prisma.MessageWhereInput = {
      ...this.targetWhere(a),
      AND: [...(before ? [cmp(before, 'lt')] : []), ...(after ? [cmp(after, 'gt')] : [])],
    };
    const ascending = Boolean(after && !before);
    const rows = await this.prisma.message.findMany({
      where,
      include: MESSAGE_INCLUDE,
      orderBy: ascending ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const chronological = ascending ? page : page.reverse();
    const oldest = chronological[0];
    return {
      messages: chronological.map((m) => this.serialize(m, userId)),
      nextBefore: !ascending && hasMore && oldest ? encodeCursor(oldest) : null,
    };
  }

  async create(
    userId: string,
    target: Target,
    dto: {
      requestId: string;
      body: string;
      replyToId?: string | undefined;
      attachmentIds?: string[] | undefined;
      /** enquete (ADR-0018): criada na mesma transação da mensagem */
      poll?: { question: string; options: string[]; multiple: boolean; endsAt: Date | null } | undefined;
    },
  ): Promise<{ message: Message; duplicate: boolean }> {
    const a = await this.access(userId, target);
    if (!hasPermission(a.perms, Permission.SEND_MESSAGES)) throw forbidden('sem permissão para enviar mensagens');
    const attachmentIds = dto.attachmentIds ?? [];
    if (attachmentIds.length && !hasPermission(a.perms, Permission.ATTACH_FILES))
      throw forbidden('sem permissão para anexar arquivos');
    const body = dto.body.trim();
    if (!body && !attachmentIds.length) throw new BadRequestException('mensagem vazia');

    // Idempotência: reenvio com o mesmo requestId devolve a mensagem original.
    const existing = await this.prisma.message.findUnique({
      where: { authorId_requestId: { authorId: userId, requestId: dto.requestId } },
      include: MESSAGE_INCLUDE,
    });
    if (existing) return { message: this.serialize(existing, userId), duplicate: true };

    if (a.conversationId && a.memberIds) await this.assertNotBlocked(userId, a.memberIds);
    if (dto.replyToId) {
      const parent = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
        select: { channelId: true, conversationId: true },
      });
      if (!parent || parent.channelId !== a.channelId || parent.conversationId !== a.conversationId)
        throw new BadRequestException('resposta a mensagem de outro destino');
    }
    const parsed = extractMentions(body);
    const mentionEveryone = parsed.everyone && hasPermission(a.perms, Permission.MENTION_EVERYONE);
    const mentions = await this.validMentions(a, parsed.userIds);

    let row: MessageRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const m = await tx.message.create({
          data: {
            authorId: userId,
            requestId: dto.requestId,
            channelId: a.channelId,
            conversationId: a.conversationId,
            body,
            replyToId: dto.replyToId ?? null,
            mentions,
            mentionEveryone,
          },
        });
        await this.attachments.claimForMessage(tx, userId, attachmentIds, m.id);
        if (dto.poll)
          await tx.poll.create({
            data: {
              messageId: m.id,
              question: dto.poll.question,
              multiple: dto.poll.multiple,
              endsAt: dto.poll.endsAt,
              options: { create: dto.poll.options.map((text, position) => ({ text, position })) },
            },
          });
        return tx.message.findUniqueOrThrow({ where: { id: m.id }, include: MESSAGE_INCLUDE });
      });
    } catch (e) {
      // corrida entre dois envios com o mesmo requestId
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await this.prisma.message.findUniqueOrThrow({
          where: { authorId_requestId: { authorId: userId, requestId: dto.requestId } },
          include: MESSAGE_INCLUDE,
        });
        return { message: this.serialize(dup, userId), duplicate: true };
      }
      throw e;
    }
    const message = this.serialize(row, null);
    this.realtime.emit(a.room, 'chat:message:created', message);
    this.realtime.emit(a.room, 'channel:unread:changed', {
      channelId: a.channelId,
      conversationId: a.conversationId,
      lastMessageId: row.id,
      mention: mentionEveryone || mentions.length > 0,
    });
    await this.markRead(userId, target, row.id, false);
    this.notify(userId, a, row, mentions, mentionEveryone);
    // canal que alimenta um quadro kanban: a mensagem vira card (ADR-0017)
    if (a.channelId) await this.boards.fromMessage(row);
    return { message: this.serialize(row, userId), duplicate: false };
  }

  private notify(authorId: string, a: TargetAccess, row: MessageRow, mentions: string[], everyone: boolean) {
    const title = row.author.displayName;
    const body = row.body.slice(0, 140) || '[anexo]';
    if (a.conversationId && a.memberIds) {
      for (const uid of a.memberIds)
        if (uid !== authorId)
          this.realtime.toUser(uid, 'notification:created', {
            kind: 'dm',
            title,
            body,
            conversationId: a.conversationId,
          });
      return;
    }
    if (everyone && a.channelId) {
      this.realtime.emit(a.room, 'notification:created', {
        kind: 'mention',
        title,
        body,
        channelId: a.channelId,
        ...(a.serverId ? { serverId: a.serverId } : {}),
      });
      return;
    }
    for (const uid of mentions) {
      if (uid !== authorId && a.channelId)
        this.realtime.toUser(uid, 'notification:created', {
          kind: 'mention',
          title,
          body,
          channelId: a.channelId,
          ...(a.serverId ? { serverId: a.serverId } : {}),
        });
    }
  }

  /** Menções só valem para usuários que podem ver o destino. */
  private async validMentions(a: TargetAccess, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    if (a.memberIds) return ids.filter((id) => a.memberIds?.includes(id));
    const valid: string[] = [];
    for (const id of ids.slice(0, 50)) {
      const ok = await this.perms.channel(a.channelId as string, id).then(
        () => true,
        () => false,
      );
      if (ok) valid.push(id);
    }
    return valid;
  }

  private async assertNotBlocked(userId: string, memberIds: string[]) {
    const others = memberIds.filter((m) => m !== userId);
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: others } },
          { blockedId: userId, blockerId: { in: others } },
        ],
      },
    });
    if (block) throw forbidden('não é possível enviar mensagens: há um bloqueio entre os participantes');
  }

  private async load(messageId: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, include: MESSAGE_INCLUDE });
    if (!m) throw notFound('mensagem');
    return m;
  }

  private targetOf(m: { channelId: string | null; conversationId: string | null }): Target {
    return m.channelId ? { channelId: m.channelId } : { conversationId: m.conversationId as string };
  }

  async edit(userId: string, messageId: string, body: string): Promise<Message> {
    const m = await this.load(messageId);
    await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.authorId !== userId) throw forbidden('só o autor pode editar');
    if (m.poll) throw new BadRequestException('enquetes não podem ser editadas');
    if (m.deletedAt) throw notFound('mensagem');
    const a = await this.access(userId, this.targetOf(m));
    const parsed = extractMentions(body.trim());
    const row = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        body: body.trim(),
        editedAt: new Date(),
        mentions: await this.validMentions(a, parsed.userIds),
        mentionEveryone: parsed.everyone && hasPermission(a.perms, Permission.MENTION_EVERYONE),
      },
      include: MESSAGE_INCLUDE,
    });
    this.realtime.emit(a.room, 'chat:message:updated', this.serialize(row, null));
    return this.serialize(row, userId);
  }

  async remove(userId: string, messageId: string): Promise<void> {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.authorId !== userId && !hasPermission(a.perms, Permission.MANAGE_MESSAGES)) throw forbidden();
    if (m.deletedAt) return;
    // soft delete: conteúdo apagado, registro mantido para threads/replies
    await this.prisma.$transaction([
      this.prisma.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          body: '',
          mentions: [],
          mentionEveryone: false,
          pinnedAt: null,
          pinnedById: null,
        },
      }),
      this.prisma.reaction.deleteMany({ where: { messageId } }),
    ]);
    this.realtime.emit(a.room, 'chat:message:deleted', {
      messageId,
      channelId: m.channelId,
      conversationId: m.conversationId,
    });
  }

  /** Mensagens fixadas, mais recente primeiro. */
  async pins(userId: string, target: Target): Promise<Message[]> {
    const a = await this.access(userId, target);
    if (!hasPermission(a.perms, Permission.READ_HISTORY)) throw forbidden('sem acesso ao histórico');
    const rows = await this.prisma.message.findMany({
      where: { ...this.targetWhere(a), pinnedAt: { not: null }, deletedAt: null },
      include: MESSAGE_INCLUDE,
      orderBy: { pinnedAt: 'desc' },
      take: MAX_PINS,
    });
    return rows.map((m) => this.serialize(m, userId));
  }

  /** Fixar/desafixar: em canais exige MANAGE_MESSAGES; na DM qualquer participante. */
  async pin(userId: string, messageId: string, on: boolean): Promise<Message> {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.deletedAt) throw notFound('mensagem');
    if (a.channelId && !hasPermission(a.perms, Permission.MANAGE_MESSAGES)) throw forbidden();
    if (on === (m.pinnedAt !== null)) return this.serialize(m, userId);
    if (on) {
      const count = await this.prisma.message.count({
        where: { ...this.targetWhere(a), pinnedAt: { not: null }, deletedAt: null },
      });
      if (count >= MAX_PINS) throw new BadRequestException(`limite de ${MAX_PINS} mensagens fixadas`);
    }
    const row = await this.prisma.message.update({
      where: { id: messageId },
      data: on ? { pinnedAt: new Date(), pinnedById: userId } : { pinnedAt: null, pinnedById: null },
      include: MESSAGE_INCLUDE,
    });
    this.realtime.emit(a.room, 'chat:message:updated', this.serialize(row, null));
    return this.serialize(row, userId);
  }

  /**
   * Configura os cargos por reação de uma mensagem de canal (substitui o conjunto). Exige MANAGE_ROLES; cada cargo
   * precisa estar abaixo do meu e não pode ter bits de moderação (REACTION_ROLE_FORBIDDEN), porque qualquer um que
   * vê a mensagem ganha o cargo só de reagir.
   */
  async setReactionRoles(userId: string, messageId: string, pairs: { emoji: string; roleId: string }[]) {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.deletedAt || !a.serverId) throw new BadRequestException('só mensagens de canais de servidor');
    const actor = await this.perms.requireServer(a.serverId, userId, Permission.MANAGE_ROLES);
    const roles = await this.prisma.role.findMany({ where: { serverId: a.serverId } });
    for (const p of pairs) {
      const r = roles.find((x) => x.id === p.roleId);
      if (!r || r.isEveryone) throw new BadRequestException('cargo inválido');
      if (r.permissions & REACTION_ROLE_FORBIDDEN)
        throw new BadRequestException(`o cargo ${r.name} tem permissões de moderação e não pode ser dado por reação`);
      this.perms.assertAbove(actor, r.position);
    }
    await this.prisma.$transaction([
      this.prisma.reactionRole.deleteMany({ where: { messageId } }),
      this.prisma.reactionRole.createMany({ data: pairs.map((p) => ({ messageId, ...p })) }),
    ]);
    const row = await this.load(messageId);
    this.realtime.emit(a.room, 'chat:message:updated', this.serialize(row, null));
    return this.serialize(row, userId);
  }

  /** Enquete: confere acesso pela mensagem; encerrada ou apagada não aceita mais nada. */
  private async pollContext(userId: string, pollId: string) {
    const poll = await this.prisma.poll.findUnique({ where: { id: pollId }, select: { messageId: true } });
    if (!poll) throw notFound('enquete');
    const m = await this.load(poll.messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('enquete');
    });
    if (m.deletedAt || !m.poll) throw notFound('enquete');
    return { m, a, poll: m.poll };
  }

  private async emitPoll(a: TargetAccess, messageId: string, userId: string): Promise<Poll> {
    const row = await this.load(messageId);
    const poll = row.poll as NonNullable<MessageRow['poll']>;
    this.realtime.emit(a.room, 'poll:updated', {
      messageId,
      channelId: a.channelId,
      conversationId: a.conversationId,
      poll: this.serializePoll(poll, null),
    });
    return this.serializePoll(poll, userId);
  }

  /** Substitui o meu voto (vazio = retira). Precisa só de ver o canal: votar não é escrever. */
  async vote(userId: string, pollId: string, optionIds: string[]): Promise<Poll> {
    const { m, a, poll } = await this.pollContext(userId, pollId);
    if (poll.endsAt && poll.endsAt.getTime() <= Date.now()) throw new BadRequestException('enquete encerrada');
    const ids = [...new Set(optionIds)];
    if (!poll.multiple && ids.length > 1) throw new BadRequestException('esta enquete aceita uma opção');
    const valid = new Set(poll.options.map((o) => o.id));
    if (ids.some((id) => !valid.has(id))) throw new BadRequestException('opção inválida');
    await this.prisma.$transaction([
      this.prisma.pollVote.deleteMany({ where: { pollId, userId } }),
      this.prisma.pollVote.createMany({ data: ids.map((optionId) => ({ pollId, optionId, userId })) }),
    ]);
    return this.emitPoll(a, m.id, userId);
  }

  /** Encerrar antes do prazo: quem criou ou quem gerencia mensagens no canal. */
  async closePoll(userId: string, pollId: string): Promise<Poll> {
    const { m, a, poll } = await this.pollContext(userId, pollId);
    if (m.authorId !== userId && !(a.channelId && hasPermission(a.perms, Permission.MANAGE_MESSAGES)))
      throw forbidden();
    if (!poll.endsAt || poll.endsAt.getTime() > Date.now())
      await this.prisma.poll.update({ where: { id: pollId }, data: { endsAt: new Date() } });
    return this.emitPoll(a, m.id, userId);
  }

  async react(userId: string, messageId: string, emoji: string, on: boolean): Promise<void> {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.deletedAt) throw notFound('mensagem');
    if (on) {
      const exists = m.reactions.some((r) => r.emoji === emoji);
      // reagir com emoji novo exige ADD_REACTIONS; somar-se a um existente também (mesma regra simples)
      if (!hasPermission(a.perms, Permission.ADD_REACTIONS)) throw forbidden();
      if (!exists && new Set(m.reactions.map((r) => r.emoji)).size >= MAX_REACTION_EMOJIS)
        throw new BadRequestException('limite de reações distintas');
      await this.prisma.reaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
        create: { messageId, userId, emoji },
        update: {},
      });
    } else {
      await this.prisma.reaction.deleteMany({ where: { messageId, userId, emoji } });
    }
    // cargo por reação (ADR-0019): reagir dá o cargo, tirar a reação tira
    const rr = a.serverId ? m.reactionRoles.find((x) => x.emoji === emoji) : undefined;
    if (rr && a.serverId) await this.servers.applyReactionRole(a.serverId, userId, rr.roleId, on);
    const count = await this.prisma.reaction.count({ where: { messageId, emoji } });
    this.realtime.emit(a.room, 'chat:reaction:changed', {
      messageId,
      channelId: m.channelId,
      conversationId: m.conversationId,
      emoji,
      userId,
      on,
      count,
    });
  }

  async markRead(userId: string, target: Target, messageId: string, check = true): Promise<void> {
    const a = check ? await this.access(userId, target) : null;
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, conversationId: true, createdAt: true },
    });
    const channelId = target.channelId ?? null;
    const conversationId = target.conversationId ?? null;
    if (!msg || msg.channelId !== channelId || msg.conversationId !== conversationId)
      throw new BadRequestException('mensagem de outro destino');
    void a;
    const where = channelId
      ? { userId_channelId: { userId, channelId } }
      : { userId_conversationId: { userId, conversationId: conversationId as string } };
    const current = await this.prisma.readState.findUnique({ where, include: {} });
    if (current?.lastReadMessageId) {
      const prev = await this.prisma.message.findUnique({
        where: { id: current.lastReadMessageId },
        select: { createdAt: true },
      });
      // nunca regride o marcador de leitura
      if (prev && prev.createdAt > msg.createdAt) return;
    }
    await this.prisma.readState.upsert({
      where,
      create: { userId, channelId, conversationId, lastReadMessageId: messageId },
      update: { lastReadMessageId: messageId },
    });
  }

  async unreads(userId: string): Promise<UnreadState[]> {
    const visible = await this.perms.visibleRooms(userId);
    const textChannels = await this.prisma.channel.findMany({
      where: { id: { in: visible.channelIds }, kind: 'text' },
      select: { id: true },
    });
    const states = await this.prisma.readState.findMany({ where: { userId } });
    const out: UnreadState[] = [];
    const targets: { channelId: string | null; conversationId: string | null }[] = [
      ...textChannels.map((c) => ({ channelId: c.id, conversationId: null })),
      ...visible.conversationIds.map((id) => ({ channelId: null, conversationId: id })),
    ];
    for (const t of targets) {
      const st = states.find((s) =>
        t.channelId ? s.channelId === t.channelId : s.conversationId === t.conversationId,
      );
      const where: Prisma.MessageWhereInput = t.channelId
        ? { channelId: t.channelId }
        : { conversationId: t.conversationId as string };
      const last = await this.prisma.message.findFirst({
        where: { ...where, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      let since: Date | null = null;
      if (st?.lastReadMessageId)
        since =
          (await this.prisma.message.findUnique({ where: { id: st.lastReadMessageId }, select: { createdAt: true } }))
            ?.createdAt ?? null;
      const unreadWhere: Prisma.MessageWhereInput = {
        ...where,
        deletedAt: null,
        authorId: { not: userId },
        ...(since ? { createdAt: { gt: since } } : {}),
      };
      const [unreadCount, mentionCount] = await Promise.all([
        this.prisma.message.count({ where: unreadWhere }),
        this.prisma.message.count({
          where: { ...unreadWhere, OR: [{ mentions: { has: userId } }, { mentionEveryone: true }] },
        }),
      ]);
      out.push({
        channelId: t.channelId,
        conversationId: t.conversationId,
        lastReadMessageId: st?.lastReadMessageId ?? null,
        lastMessageId: last?.id ?? null,
        unreadCount,
        mentionCount,
      });
    }
    return out;
  }

  /** Mensagens perdidas desde o último id conhecido por canal (ressincronização após reconexão). */
  async missedSince(
    userId: string,
    channels: { channelId: string; lastMessageId: string | null }[],
  ): Promise<{ missed: Message[]; truncated: boolean }> {
    const missed: Message[] = [];
    let truncated = false;
    for (const c of channels.slice(0, 100)) {
      const ok = await this.access(userId, { channelId: c.channelId }).then(
        () => true,
        () => false,
      );
      if (!ok || !c.lastMessageId) continue;
      const ref = await this.prisma.message.findUnique({
        where: { id: c.lastMessageId },
        select: { createdAt: true, id: true, channelId: true },
      });
      if (!ref || ref.channelId !== c.channelId) continue;
      const page = await this.list(userId, { channelId: c.channelId }, { after: encodeCursor(ref), limit: 100 });
      if (page.messages.length === 100) truncated = true;
      missed.push(...page.messages);
    }
    return { missed, truncated };
  }
}

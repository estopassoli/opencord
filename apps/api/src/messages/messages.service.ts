import { BadRequestException, HttpException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  decodeCursor,
  encodeCursor,
  Embed,
  EMBED_LIMITS,
  extractMentions,
  FORUM_TITLE_MAX,
  hasPermission,
  MAX_PINS,
  MessageComponents,
  REACTION_ROLE_FORBIDDEN,
  Permission,
  rooms,
  type ForumPostPage,
  type Message,
  type MessagePage,
  type Poll,
  type PrivateReplyRef,
  type ReactionSummary,
  type SearchMessagesResponse,
  type Highlight,
  type UnreadState,
} from '@opencord/contracts';
import { Prisma } from '@opencord/db';
import { z } from 'zod';
import { DomainEvents } from '../common/domain-events.js';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { systemUserIds, USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { AiModerationService, isSevere, type Verdict } from '../ai-moderation/ai-moderation.service.js';
import { ModerationHoldService } from '../ai-moderation/moderation-hold.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { assertNotTimedOut, PermissionsService } from '../servers/permissions.service.js';
import { BoardsService, DELETED_CARD_TITLE } from '../boards/boards.service.js';
import { ServersService } from '../servers/servers.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export type Target =
  { channelId: string; conversationId?: undefined } | { conversationId: string; channelId?: undefined };

type Embeds = Message['embeds'];
type Components = Message['components'];
const Embeds = z.array(Embed).max(EMBED_LIMITS.perMessage);
/** O JSON do banco foi validado ao gravar; se o contrato apertar depois, uma lista inválida vira vazia. */
const parseEmbeds = (json: Prisma.JsonValue): Embeds => {
  const r = Embeds.safeParse(json);
  return r.success ? r.data : [];
};
const parseComponents = (json: Prisma.JsonValue): Components => {
  const r = MessageComponents.safeParse(json);
  return r.success ? r.data : [];
};
/** Para as colunas Json: tira `undefined` (que o JSON não representa) e satisfaz o tipo do Prisma. */
const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
/** até 100 por chamada (contrato) */
const BULK_DELETE_MAX = 100;

const MESSAGE_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
  attachments: { orderBy: { createdAt: 'asc' } },
  reactions: { select: { emoji: true, userId: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  replyTo: { select: { id: true, body: true, deletedAt: true, author: { select: USER_PUBLIC_SELECT } } },
  privateReplyTo: {
    select: {
      id: true,
      body: true,
      deletedAt: true,
      author: { select: USER_PUBLIC_SELECT },
      channel: { select: { id: true, name: true, server: { select: { id: true, name: true } } } },
    },
  },
  reactionRoles: { select: { emoji: true, roleId: true }, orderBy: { createdAt: 'asc' } },
  _count: { select: { replies: true } },
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
  /** castigo (ADR-0034) em vigor no servidor do canal; null em DMs */
  timeoutUntil: Date | null;
  /** super admin invisível no servidor (ADR-0013): não anuncia "digitando" */
  hidden: boolean;
  memberIds?: string[];
  /** canal de fórum (ADR-0052): mensagem raiz é post com título */
  forum?: boolean;
  /** modo lento (ADR-0052), em segundos; 0 ou ausente = desligado */
  slowmodeSec?: number;
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
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    private readonly ai: AiModerationService,
    private readonly hold: ModerationHoldService,
  ) {}
  private readonly log = new Logger('Messages');

  /** Resolve acesso ao destino. DMs: membros têm todas as permissões de mensagem. */
  async access(userId: string, target: Target): Promise<TargetAccess> {
    // conta de avisos (ADR-0045/0050): escreve em qualquer canal de texto (boas-vindas no canal do sistema)
    if (target.channelId && systemUserIds.has(userId)) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: target.channelId },
        select: { id: true, serverId: true, kind: true },
      });
      if (!ch || ch.kind !== 'text') throw notFound('canal');
      return {
        room: rooms.channel(ch.id),
        channelId: ch.id,
        conversationId: null,
        serverId: ch.serverId,
        perms: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.READ_HISTORY,
        timeoutUntil: null,
        hidden: false,
      };
    }
    if (target.channelId) {
      const a = await this.perms.channel(target.channelId, userId);
      if (a.kind !== 'text' && a.kind !== 'forum') throw new BadRequestException('este canal não aceita mensagens');
      return {
        room: rooms.channel(a.channelId),
        channelId: a.channelId,
        conversationId: null,
        serverId: a.serverId,
        perms: a.perms,
        timeoutUntil: a.timeoutUntil,
        hidden: a.hidden,
        forum: a.kind === 'forum',
        slowmodeSec: a.slowmodeSec,
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
      timeoutUntil: null,
      hidden: false,
      memberIds,
    };
  }

  /**
   * Embeds só para bots e webhooks; componentes só para bots (ADR-0034). Pessoas recebem 403 com o motivo, para o
   * app e o SDK não confundirem com falta de permissão no canal.
   */
  private async assertRichAllowed(
    userId: string,
    dto: { embeds?: Embeds | undefined; components?: Components | undefined },
  ) {
    if (!dto.embeds?.length && !dto.components?.length) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isBot: true, isWebhook: true } });
    const bot = u?.isBot ?? false;
    const webhook = u?.isWebhook ?? false;
    if (dto.embeds?.length && !bot && !webhook) throw forbidden('só bots e webhooks enviam embeds');
    if (dto.components?.length && !bot) throw forbidden('só bots enviam botões e menus');
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
      privateReplyTo: this.privateReplyRef(m),
      reactions: deleted ? [] : this.reactions(m.reactions, me),
      attachments: deleted ? [] : m.attachments.map((a) => this.attachments.serialize(a)),
      mentions: deleted ? [] : m.mentions,
      pinnedAt: deleted ? null : (m.pinnedAt?.toISOString() ?? null),
      poll: deleted || !m.poll ? null : this.serializePoll(m.poll, me),
      reactionRoles: deleted ? [] : m.reactionRoles,
      replyCount: m._count.replies,
      title: m.title ?? null,
      embeds: deleted ? [] : parseEmbeds(m.embeds),
      components: deleted ? [] : parseComponents(m.components),
    };
  }

  /** citação da mensagem de canal respondida no privado (ADR-0042); sem canal (excluído) vira null */
  private privateReplyRef(m: MessageRow): PrivateReplyRef | null {
    const p = m.privateReplyTo;
    if (!p?.channel || m.deletedAt) return null;
    return {
      id: p.id,
      author: userPublic(p.author),
      bodyPreview: p.deletedAt ? '' : p.body.slice(0, 200),
      deleted: p.deletedAt !== null,
      channelId: p.channel.id,
      channelName: p.channel.name,
      serverId: p.channel.server.id,
      serverName: p.channel.server.name,
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

  /**
   * Responder no privado (ADR-0042): só numa DM 1:1 entre quem responde e o autor da mensagem citada, que precisa ser
   * de um canal que quem responde consegue ler. Assim a citação só aparece para quem já podia vê-la.
   */
  private async assertPrivateReply(userId: string, a: TargetAccess, messageId: string, alsoReply: boolean) {
    if (alsoReply) throw new BadRequestException('escolha entre responder na conversa ou no privado');
    if (!a.conversationId || !a.memberIds)
      throw new BadRequestException('resposta no privado só vale em mensagem direta');
    const parent = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, authorId: true, deletedAt: true },
    });
    if (!parent?.channelId || parent.deletedAt) throw notFound('mensagem');
    const ch = await this.perms.channel(parent.channelId, userId).catch(() => {
      throw notFound('mensagem');
    });
    if (!hasPermission(ch.perms, Permission.VIEW_CHANNEL | Permission.READ_HISTORY)) throw notFound('mensagem');
    const members = new Set(a.memberIds);
    if (parent.authorId === userId || members.size !== 2 || !members.has(parent.authorId))
      throw new BadRequestException('resposta no privado só na conversa com quem escreveu a mensagem');
  }

  async create(
    userId: string,
    target: Target,
    dto: {
      requestId: string;
      body: string;
      replyToId?: string | undefined;
      /** responder no privado (ADR-0042): mensagem de canal citada numa DM 1:1 com o autor dela */
      privateReplyToId?: string | undefined;
      attachmentIds?: string[] | undefined;
      /** enquete (ADR-0018): criada na mesma transação da mensagem */
      poll?: { question: string; options: string[]; multiple: boolean; endsAt: Date | null } | undefined;
      /** cartões ricos (ADR-0034): só bots e webhooks */
      embeds?: Embeds | undefined;
      /** botões e menus (ADR-0034): só bots */
      components?: Components | undefined;
    },
    /** publicação de um caso aprovado (ADR-0036): sem nova análise; anexos presos ao caso */
    opts: { skipModeration?: boolean; caseId?: string } = {},
  ): Promise<{ message: Message; duplicate: boolean }> {
    const a = await this.access(userId, target);
    if (!hasPermission(a.perms, Permission.SEND_MESSAGES)) throw forbidden('sem permissão para enviar mensagens');
    // em castigo (ADR-0034) não escreve (nem cria enquete: passa por aqui)
    assertNotTimedOut(a);
    const attachmentIds = dto.attachmentIds ?? [];
    if (attachmentIds.length && !hasPermission(a.perms, Permission.ATTACH_FILES))
      throw forbidden('sem permissão para anexar arquivos');
    await this.assertRichAllowed(userId, dto);
    const embeds = dto.embeds ?? [];
    const components = dto.components ?? [];
    const body = dto.body.trim();
    if (!body && !attachmentIds.length && !embeds.length) throw new BadRequestException('mensagem vazia');

    // Idempotência: reenvio com o mesmo requestId devolve a mensagem original.
    const existing = await this.prisma.message.findUnique({
      where: { authorId_requestId: { authorId: userId, requestId: dto.requestId } },
      include: MESSAGE_INCLUDE,
    });
    if (existing) return { message: this.serialize(existing, userId), duplicate: true };

    if (a.conversationId && a.memberIds) await this.assertNotBlocked(userId, a.memberIds);
    const title = await this.forumTitle(a, dto);
    await this.assertSlowmode(userId, a);
    // DM com a conta de avisos do OpenCord (ADR-0045): só ela escreve
    if (a.memberIds?.some((m) => systemUserIds.has(m)) && !systemUserIds.has(userId))
      throw forbidden('esta conversa é só de avisos e não recebe respostas');
    if (dto.replyToId) {
      const parent = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
        select: { channelId: true, conversationId: true },
      });
      if (!parent || parent.channelId !== a.channelId || parent.conversationId !== a.conversationId)
        throw new BadRequestException('resposta a mensagem de outro destino');
    }
    if (dto.privateReplyToId) await this.assertPrivateReply(userId, a, dto.privateReplyToId, Boolean(dto.replyToId));
    // moderação por IA (ADR-0036): bloqueia ou retém ANTES de existir mensagem; 422 explica ao autor
    if (!opts.skipModeration && !dto.poll)
      await this.moderate(userId, a, {
        requestId: dto.requestId,
        body,
        replyToId: dto.replyToId ?? null,
        attachmentIds,
        editing: false,
      });
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
            privateReplyToId: dto.privateReplyToId ?? null,
            title,
            mentions,
            mentionEveryone,
            embeds: toJson(embeds),
            components: toJson(components),
          },
        });
        await this.attachments.claimForMessage(tx, userId, attachmentIds, m.id, opts.caseId ?? null);
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
    // ponte com o Slack e afins (ADR-0033): só canais de servidor
    if (a.channelId && a.serverId) this.events.emit({ type: 'message.created', serverId: a.serverId, message });
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

  /**
   * Mensagem vinda de um webhook de entrada (ADR-0030): o autor é o usuário do webhook (não é membro, então não passa
   * por `access`); sem menções, sem anexos, sem resposta. Mesmos eventos de uma mensagem comum.
   */
  async postAsWebhook(hook: { userId: string; channelId: string; serverId: string }, body: string): Promise<Message> {
    const row = await this.prisma.message.create({
      data: {
        authorId: hook.userId,
        requestId: randomUUID(),
        channelId: hook.channelId,
        conversationId: null,
        body: body.slice(0, 4000),
        mentions: [],
        mentionEveryone: false,
      },
      include: MESSAGE_INCLUDE,
    });
    const room = rooms.channel(hook.channelId);
    const message = this.serialize(row, null);
    this.realtime.emit(room, 'chat:message:created', message);
    this.realtime.emit(room, 'channel:unread:changed', {
      channelId: hook.channelId,
      conversationId: null,
      lastMessageId: row.id,
      mention: false,
    });
    await this.boards.fromMessage(row);
    return message;
  }

  /**
   * Moderação por IA (ADR-0036). Pula super admins e webhooks. Resultado: allow segue; block/review retêm o envio
   * como caso e lançam 422 com o motivo; IA indisponível libera (ou retém, com MODERATION_AI_FAIL_CLOSED).
   */
  private async moderate(
    userId: string,
    a: TargetAccess,
    s: { requestId: string; body: string; replyToId: string | null; attachmentIds: string[]; editing: boolean },
  ) {
    const direct = !a.channelId;
    if (!(await this.ai.appliesTo(direct))) return;
    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, isInstanceAdmin: true, isWebhook: true },
    });
    if (!author || author.isInstanceAdmin || author.isWebhook) return;
    const [channel, atts, recent] = await Promise.all([
      a.channelId
        ? this.prisma.channel.findUnique({
            where: { id: a.channelId },
            select: { name: true, topic: true, server: { select: { name: true, aiRules: true } } },
          })
        : null,
      s.attachmentIds.length
        ? this.prisma.attachment.findMany({
            where: { id: { in: s.attachmentIds }, uploaderId: userId },
            select: { id: true, originalName: true, mime: true, sizeBytes: true, storageKey: true },
          })
        : [],
      this.prisma.message.findMany({
        where: {
          ...(a.channelId ? { channelId: a.channelId } : { conversationId: a.conversationId }),
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { body: true, author: { select: { displayName: true } }, _count: { select: { attachments: true } } },
      }),
    ]);
    const result = await this.ai.classify({
      serverName: channel?.server.name ?? null,
      channelName: channel?.name ?? null,
      channelTopic: channel?.topic ?? null,
      serverRules: channel?.server.aiRules ?? null,
      direct,
      authorName: author.displayName,
      body: s.body,
      recent: recent
        .reverse()
        .map((m) => ({ author: m.author.displayName, body: m.body, attachments: m._count.attachments })),
      attachments: atts.map((x) => ({
        id: x.id,
        name: x.originalName,
        mime: x.mime,
        sizeBytes: x.sizeBytes,
        storageKey: x.storageKey,
      })),
      editing: s.editing,
    });
    if (result.kind === 'allow') return;
    let kind: 'block' | 'review';
    let verdict: Verdict;
    if (result.kind === 'unavailable') {
      if (!this.ai.failClosed) {
        this.log.warn(`IA indisponível, envio liberado sem análise (${result.error})`);
        return;
      }
      kind = 'review';
      verdict = {
        decision: 'review',
        category: 'outro',
        confidence: 0,
        reason: `IA indisponível (${result.error.slice(0, 120)}); envio retido por precaução.`,
      };
    } else {
      kind = result.kind;
      verdict = result.verdict;
    }
    // edição retida vira bloqueio: não há como publicar "depois" uma edição
    if (s.editing) kind = 'block';
    const held = await this.hold.hold({
      serverId: a.serverId,
      channelId: a.channelId,
      conversationId: a.conversationId,
      authorId: userId,
      requestId: s.requestId,
      body: s.body,
      replyToId: s.replyToId,
      attachmentIds: s.attachmentIds,
      verdict,
      kind,
      model: this.ai.model,
    });
    // conteúdo grave com certeza alta: bloqueio automático da pessoa, se o painel permitir
    let auto: string | null = null;
    if (kind === 'block' && a.serverId && isSevere(verdict)) {
      const inst = await this.ai.autoBlockPolicy();
      if (inst.enabled)
        auto = await this.hold.autoBlock(
          { id: held.id, authorId: userId, serverId: a.serverId, reason: verdict.reason },
          inst.device,
        );
    }
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: auto ? 'moderation_autoblock' : kind === 'block' ? 'moderation_blocked' : 'moderation_review',
      caseId: held.id,
      message: auto
        ? `Conteúdo grave bloqueado pela moderação; sua conta foi suspensa. ${verdict.reason}`
        : kind === 'block'
          ? `Mensagem bloqueada pela moderação: ${verdict.reason}`
          : `Mensagem retida para revisão dos moderadores: ${verdict.reason}`,
    });
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
    // notificação padrão "todas as mensagens" (ADR-0050): mensagem comum avisa quem vê o canal (o app ignora a própria)
    if (!mentions.length && a.channelId && a.serverId) {
      const channelId = a.channelId;
      const serverId = a.serverId;
      void this.notifyAll(serverId).then((all) => {
        if (all)
          this.realtime.emit(a.room, 'notification:created', {
            kind: 'message',
            title,
            body,
            channelId,
            serverId,
            userId: authorId,
          });
      });
    }
  }

  /** notificação padrão do servidor, com cache curto (lida a cada mensagem) */
  private notifyCache = new Map<string, { all: boolean; at: number }>();
  private async notifyAll(serverId: string): Promise<boolean> {
    const hit = this.notifyCache.get(serverId);
    if (hit && Date.now() - hit.at < 30_000) return hit.all;
    const s = await this.prisma.server
      .findUnique({ where: { id: serverId }, select: { defaultNotify: true } })
      .catch(() => null);
    const all = s?.defaultNotify === 'all';
    this.notifyCache.set(serverId, { all, at: Date.now() });
    return all;
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

  /** Uma mensagem pelo id (quem vê o canal/conversa e o histórico; senão 404). Apagada vem com `deleted: true`. */
  async get(userId: string, messageId: string): Promise<Message> {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (!hasPermission(a.perms, Permission.READ_HISTORY)) throw forbidden('sem acesso ao histórico');
    return this.serialize(m, userId);
  }

  /**
   * Edição parcial (ADR-0034): só o que veio muda; `components: []` tira os botões. Continua só do autor; embeds e
   * componentes seguem a mesma regra de quem pode enviá-los.
   */
  async edit(
    userId: string,
    messageId: string,
    dto: { body?: string | undefined; embeds?: Embeds | undefined; components?: Components | undefined },
  ): Promise<Message> {
    const m = await this.load(messageId);
    await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.authorId !== userId) throw forbidden('só o autor pode editar');
    if (m.poll) throw new BadRequestException('enquetes não podem ser editadas');
    if (m.deletedAt) throw notFound('mensagem');
    if (dto.body === undefined && dto.embeds === undefined && dto.components === undefined)
      throw new BadRequestException('nada para editar');
    await this.assertRichAllowed(userId, dto);
    const a = await this.access(userId, this.targetOf(m));
    const body = dto.body === undefined ? m.body : dto.body.trim();
    const embeds = dto.embeds ?? parseEmbeds(m.embeds);
    if (!body && !embeds.length && !m.attachments.length) throw new BadRequestException('mensagem vazia');
    // edição também passa pela IA (ADR-0036); em dúvida não dá para "reter" uma edição: fica como bloqueio
    if (dto.body !== undefined && body !== m.body)
      await this.moderate(userId, a, {
        requestId: m.requestId,
        body,
        replyToId: null,
        attachmentIds: [],
        editing: true,
      });
    const parsed = dto.body === undefined ? null : extractMentions(body);
    const row = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        editedAt: new Date(),
        ...(parsed
          ? {
              body,
              mentions: await this.validMentions(a, parsed.userIds),
              mentionEveryone: parsed.everyone && hasPermission(a.perms, Permission.MENTION_EVERYONE),
            }
          : {}),
        ...(dto.embeds !== undefined ? { embeds: toJson(dto.embeds) } : {}),
        ...(dto.components !== undefined ? { components: toJson(dto.components) } : {}),
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
    await this.softDelete(m, a.room);
  }

  /** Soft delete: conteúdo apagado, registro mantido para threads/replies; avisa a sala do destino. */
  private async softDelete(m: { id: string; channelId: string | null; conversationId: string | null }, room: string) {
    const messageId = m.id;
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
          embeds: [],
          components: [],
        },
      }),
      this.prisma.reaction.deleteMany({ where: { messageId } }),
      // o card do quadro é uma cópia do texto: apagar a mensagem apaga a cópia (o card fica, sem o conteúdo)
      this.prisma.boardCard.updateMany({ where: { messageId }, data: { title: DELETED_CARD_TITLE, body: '' } }),
    ]);
    await this.boards.refreshFromMessage(messageId);
    this.realtime.emit(room, 'chat:message:deleted', {
      messageId,
      channelId: m.channelId,
      conversationId: m.conversationId,
    });
  }

  /**
   * Apagar várias de um canal (ADR-0034): com MANAGE_MESSAGES qualquer uma; sem, só as próprias (senão 403, sem
   * apagar nada). Ids de outro destino → 400; já apagadas são ignoradas. Auditoria com a contagem.
   */
  async bulkDelete(userId: string, channelId: string, messageIds: string[]): Promise<void> {
    const a = await this.access(userId, { channelId });
    const ids = [...new Set(messageIds)].slice(0, BULK_DELETE_MAX);
    const rows = await this.prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, authorId: true, channelId: true, conversationId: true, deletedAt: true },
    });
    if (rows.length !== ids.length || rows.some((m) => m.channelId !== channelId))
      throw new BadRequestException('mensagem de outro destino');
    const manage = hasPermission(a.perms, Permission.MANAGE_MESSAGES);
    if (!manage && rows.some((m) => m.authorId !== userId)) throw forbidden('só as próprias mensagens');
    let deleted = 0;
    for (const m of rows) {
      if (m.deletedAt) continue;
      await this.softDelete(m, a.room);
      deleted++;
    }
    if (a.serverId)
      await this.audit.log(userId, a.serverId, 'message.bulk_delete', channelId, {
        count: deleted,
        requested: ids.length,
      });
  }

  /**
   * Banimento (ADR-0034): apaga as mensagens da pessoa nos canais do servidor dos últimos `seconds` segundos (soft
   * delete, mesmos eventos de uma exclusão comum). Devolve quantas foram.
   */
  async purgeByAuthor(serverId: string, authorId: string, seconds: number): Promise<number> {
    if (seconds <= 0) return 0;
    const rows = await this.prisma.message.findMany({
      where: {
        authorId,
        deletedAt: null,
        channel: { serverId },
        createdAt: { gte: new Date(Date.now() - seconds * 1000) },
      },
      select: { id: true, channelId: true, conversationId: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const m of rows) await this.softDelete(m, rooms.channel(m.channelId as string));
    return rows.length;
  }

  /** Limpa todas as reações de uma mensagem (ADR-0034): só MANAGE_MESSAGES (em DMs ninguém tem). */
  async clearReactions(userId: string, messageId: string): Promise<void> {
    const m = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(m)).catch(() => {
      throw notFound('mensagem');
    });
    if (m.deletedAt) throw notFound('mensagem');
    if (!hasPermission(a.perms, Permission.MANAGE_MESSAGES)) throw forbidden();
    await this.prisma.reaction.deleteMany({ where: { messageId } });
    this.realtime.emit(a.room, 'chat:reactions:cleared', {
      messageId,
      channelId: m.channelId,
      conversationId: m.conversationId,
    });
  }

  /** Mensagens fixadas, mais recente primeiro. */
  /**
   * Busca por texto (cada palavra precisa aparecer no corpo ou no nome de um anexo, sem diferenciar maiúsculas).
   * No servidor, só nos canais de texto em que vejo o histórico. Sem índice próprio: ILIKE por palavra, suficiente
   * para o tamanho das instâncias de hoje (ver docs/DECISIONS.md, busca de mensagens).
   */
  async search(
    userId: string,
    scope: { serverId: string } | { conversationId: string },
    q: {
      q: string;
      channelId?: string | undefined;
      authorId?: string | undefined;
      has?: 'link' | 'file' | 'image' | undefined;
      offset: number;
      limit: number;
    },
  ): Promise<SearchMessagesResponse> {
    let where: Prisma.MessageWhereInput;
    if ('serverId' in scope) {
      const access = await this.perms.server(scope.serverId, userId);
      const channels = await this.prisma.channel.findMany({
        where: {
          serverId: scope.serverId,
          kind: { in: ['text', 'forum'] },
          ...(q.channelId ? { id: q.channelId } : {}),
        },
        select: { id: true, overrides: true },
      });
      const need = Permission.VIEW_CHANNEL | Permission.READ_HISTORY;
      const ids = [...(await this.perms.channelsFor(access, channels))]
        .filter(([, p]) => hasPermission(p, need))
        .map(([id]) => id);
      if (ids.length === 0) return { messages: [], total: 0 };
      where = { channelId: { in: ids } };
    } else {
      const a = await this.access(userId, { conversationId: scope.conversationId });
      where = this.targetWhere(a);
    }
    const words = q.q.split(/\s+/).filter(Boolean).slice(0, 8);
    const has: Prisma.MessageWhereInput[] =
      q.has === 'link'
        ? [{ OR: [{ body: { contains: 'http://' } }, { body: { contains: 'https://' } }] }]
        : q.has === 'file'
          ? [{ attachments: { some: {} } }]
          : q.has === 'image'
            ? [{ attachments: { some: { mime: { startsWith: 'image/' } } } }]
            : [];
    const full: Prisma.MessageWhereInput = {
      ...where,
      deletedAt: null,
      ...(q.authorId ? { authorId: q.authorId } : {}),
      AND: [
        ...words.map((w) => ({
          OR: [
            { body: { contains: w, mode: 'insensitive' as const } },
            { attachments: { some: { originalName: { contains: w, mode: 'insensitive' as const } } } },
          ],
        })),
        ...has,
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where: full,
        include: MESSAGE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.message.count({ where: full }),
    ]);
    return { messages: rows.map((m) => this.serialize(m, userId)), total };
  }

  /**
   * Melhores momentos: mensagens com vídeo nos canais de texto que eu vejo, dos últimos `days` dias, ordenadas por
   * quantas pessoas distintas reagiram (empate: mais recente primeiro). Candidatos limitados a 300 para o ranking
   * ser feito em memória com os dados que a mensagem já carrega.
   */
  async highlights(userId: string, serverId: string, q: { days: number; limit: number }): Promise<Highlight[]> {
    const access = await this.perms.server(serverId, userId);
    const channels = await this.prisma.channel.findMany({
      where: { serverId, kind: { in: ['text', 'forum'] } },
      select: { id: true, name: true, overrides: true },
    });
    const need = Permission.VIEW_CHANNEL | Permission.READ_HISTORY;
    const perms = await this.perms.channelsFor(access, channels);
    const visible = channels.filter((c) => hasPermission(perms.get(c.id) ?? 0, need));
    if (!visible.length) return [];
    const names = new Map(visible.map((c) => [c.id, c.name]));
    const rows = await this.prisma.message.findMany({
      where: {
        channelId: { in: visible.map((c) => c.id) },
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - q.days * 86_400_000) },
        attachments: { some: { mime: { startsWith: 'video/' } } },
      },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    });
    return rows
      .map((m) => ({
        message: this.serialize(m, userId),
        score: new Set(m.reactions.map((r) => r.userId)).size,
        channelName: names.get(m.channelId as string) ?? '',
      }))
      .sort((a, b) => b.score - a.score || b.message.createdAt.localeCompare(a.message.createdAt))
      .slice(0, q.limit);
  }

  /**
   * Fórum (ADR-0052): post novo (sem replyToId) precisa de título; resposta não leva título e só responde a um post
   * (as respostas ficam todas penduradas no post, como uma thread). Fora do fórum, título não existe.
   */
  private async forumTitle(a: TargetAccess, dto: { title?: string | undefined; replyToId?: string | undefined }) {
    const title = dto.title?.trim() || null;
    if (!a.forum) {
      if (title) throw new BadRequestException('título só em posts de fórum');
      return null;
    }
    if (!dto.replyToId) {
      if (!title) throw new BadRequestException('o post do fórum precisa de um título');
      return title.slice(0, FORUM_TITLE_MAX);
    }
    if (title) throw new BadRequestException('respostas não têm título');
    const parent = await this.prisma.message.findUnique({
      where: { id: dto.replyToId },
      select: { replyToId: true, deletedAt: true },
    });
    if (!parent || parent.replyToId || parent.deletedAt) throw new BadRequestException('responda a um post do fórum');
    return null;
  }

  /**
   * Modo lento (ADR-0052): a mesma pessoa só escreve de novo no canal depois de `slowmodeSec`. Quem gerencia mensagens
   * ou o canal não espera. Conta também mensagens apagadas (apagar não fura a fila). 429 com `retryAfterSec`.
   */
  private async assertSlowmode(userId: string, a: TargetAccess) {
    const sec = a.slowmodeSec ?? 0;
    if (!sec || !a.channelId) return;
    if (hasPermission(a.perms, Permission.MANAGE_MESSAGES) || hasPermission(a.perms, Permission.MANAGE_CHANNELS))
      return;
    const last = await this.prisma.message.findFirst({
      where: { channelId: a.channelId, authorId: userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return;
    const wait = Math.ceil(sec - (Date.now() - last.createdAt.getTime()) / 1000);
    if (wait > 0)
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          code: 'slowmode',
          retryAfterSec: wait,
          message: `Modo lento: espere ${wait} s para mandar outra mensagem neste canal.`,
        },
        429,
      );
  }

  /**
   * Fórum (ADR-0052): posts do canal, do mais movimentado para o menos (a atividade é o post ou a última resposta).
   * `before` pagina pela atividade.
   */
  async forumPosts(userId: string, channelId: string, q: { before?: string; limit: number }): Promise<ForumPostPage> {
    const a = await this.access(userId, { channelId });
    if (!a.forum) throw new BadRequestException('não é um fórum');
    if (!hasPermission(a.perms, Permission.READ_HISTORY)) throw forbidden('sem acesso ao histórico');
    const before = q.before ? new Date(q.before) : null;
    const rows = await this.prisma.$queryRaw<{ id: string; activity: Date }[]>`
      SELECT m.id, GREATEST(m."createdAt", COALESCE(MAX(r."createdAt"), m."createdAt")) AS activity
      FROM "Message" m
      LEFT JOIN "Message" r ON r."replyToId" = m.id AND r."deletedAt" IS NULL
      WHERE m."channelId" = ${channelId}::uuid AND m."replyToId" IS NULL AND m."deletedAt" IS NULL
      GROUP BY m.id
      HAVING ${before}::timestamptz IS NULL
        OR GREATEST(m."createdAt", COALESCE(MAX(r."createdAt"), m."createdAt")) < ${before}::timestamptz
      ORDER BY activity DESC, m.id DESC
      LIMIT ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const full = await this.prisma.message.findMany({
      where: { id: { in: page.map((r) => r.id) } },
      include: MESSAGE_INCLUDE,
    });
    const byId = new Map(full.map((m) => [m.id, m]));
    return {
      posts: page.flatMap((r) => {
        const m = byId.get(r.id);
        return m ? [{ message: this.serialize(m, userId), lastActivityAt: r.activity.toISOString() }] : [];
      }),
      nextBefore: rows.length > q.limit ? page.at(-1)!.activity.toISOString() : null,
    };
  }

  /** Thread leve: as respostas diretas a uma mensagem, em ordem cronológica (quem vê o histórico do destino). */
  async replies(userId: string, messageId: string, limit: number): Promise<Message[]> {
    const root = await this.load(messageId);
    const a = await this.access(userId, this.targetOf(root)).catch(() => {
      throw notFound('mensagem');
    });
    if (!hasPermission(a.perms, Permission.READ_HISTORY)) throw forbidden('sem acesso ao histórico');
    const rows = await this.prisma.message.findMany({
      where: { replyToId: messageId },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((m) => this.serialize(m, userId));
  }

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
      if ((await this.servers.reactionRoleGrants(r.id, r.permissions)) & REACTION_ROLE_FORBIDDEN)
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
      // em castigo (ADR-0034) não reage (tirar a própria reação continua livre)
      assertNotTimedOut(a);
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
      where: { id: { in: visible.channelIds }, kind: { in: ['text', 'forum'] } },
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

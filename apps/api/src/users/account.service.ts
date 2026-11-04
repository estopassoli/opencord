import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { PrismaService } from '../common/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { isBotSession } from '../auth/token.service.js';
import { InstanceService } from '../admin/instance.service.js';
import { StorageService } from '../attachments/storage.service.js';
import { BotsService } from '../bots/bots.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ServersService } from '../servers/servers.service.js';
import { AvatarService } from './avatar.service.js';

const PAGE = 1000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Dados da própria pessoa (ADR-0039, LGPD art. 18): exportar tudo o que a instância guarda sobre ela em JSON e
 * excluir a conta. A exclusão anonimiza a linha do usuário (as mensagens ficam, assinadas "Usuário removido",
 * porque fazem parte das conversas dos outros) e apaga o que é só dela: sessões, arquivos enviados, foto, amizades,
 * bloqueios, participação em conversas, configurações, reações, votos, convites, casos de moderação e bots.
 * Servidores que ela possui passam ao membro mais antigo; sem outro membro, são excluídos.
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly instance: InstanceService,
    private readonly storage: StorageService,
    private readonly bots: BotsService,
    private readonly realtime: RealtimeService,
    private readonly servers: ServersService,
    private readonly avatars: AvatarService,
  ) {}

  /** Aceite dos Termos/Política por quem já tinha conta antes da ADR-0039. */
  async acceptTerms(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date() } });
  }

  /** Exportação em partes (JSON): o arquivo pode ser grande; as mensagens saem paginadas. */
  async *exportChunks(userId: string): AsyncGenerator<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { settings: true },
    });
    const sec = (name: string, value: unknown, first = false) =>
      `${first ? '' : ',\n'}${JSON.stringify(name)}: ${JSON.stringify(value, null, 1)}`;

    yield '{\n';
    yield sec('exportadoEm', new Date().toISOString(), true);
    yield sec('conta', {
      id: user.id,
      usuario: user.username,
      apelido: user.displayName,
      email: user.email,
      temSenha: user.passwordHash !== null,
      fotoDePerfil: user.avatarKey,
      perfil: { bio: user.bio, banner: user.bannerKey ?? user.bannerUrl, cores: user.profileColors },
      verificado: user.verified,
      criadaEm: iso(user.createdAt),
      termosAceitosEm: iso(user.termsAcceptedAt),
    });
    yield sec('configuracoes', user.settings?.json ?? null);

    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
        deviceId: true,
        hardwareId: true,
      },
    });
    yield sec(
      'sessoes',
      sessions.map((s) => ({
        criadaEm: iso(s.createdAt),
        expiraEm: iso(s.expiresAt),
        encerradaEm: iso(s.revokedAt),
        navegadorOuApp: s.userAgent,
        ip: s.ip,
        identificadorDoApp: s.deviceId,
        impressaoDoAparelho: s.hardwareId,
      })),
    );

    const memberships = await this.prisma.serverMember.findMany({
      where: { userId },
      include: { server: { select: { id: true, name: true, ownerId: true } }, roles: { include: { role: true } } },
    });
    yield sec(
      'servidores',
      memberships.map((m) => ({
        id: m.server.id,
        nome: m.server.name,
        dono: m.server.ownerId === userId,
        entrouEm: iso(m.joinedAt),
        apelidoNoServidor: m.nickname,
        cargos: m.roles.map((r) => r.role.name),
      })),
    );

    const convs = await this.prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: { include: { members: { include: { user: { select: { id: true, displayName: true } } } } } },
      },
    });
    yield sec(
      'conversas',
      convs.map((c) => ({
        id: c.conversation.id,
        tipo: c.conversation.kind,
        nome: c.conversation.name,
        entrouEm: iso(c.joinedAt),
        participantes: c.conversation.members.map((m) => ({ id: m.user.id, apelido: m.user.displayName })),
      })),
    );

    const friends = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: {
        requester: { select: { id: true, displayName: true } },
        addressee: { select: { id: true, displayName: true } },
      },
    });
    yield sec(
      'amizades',
      friends.map((f) => {
        const other = f.requesterId === userId ? f.addressee : f.requester;
        return {
          pessoa: { id: other.id, apelido: other.displayName },
          status: f.status,
          pedidoPorMim: f.requesterId === userId,
          desde: iso(f.acceptedAt ?? f.createdAt),
        };
      }),
    );
    const blocks = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, displayName: true } } },
    });
    yield sec(
      'bloqueios',
      blocks.map((b) => ({ pessoa: { id: b.blocked.id, apelido: b.blocked.displayName }, em: iso(b.createdAt) })),
    );

    const cases = await this.prisma.moderationCase.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        verdict: true,
        category: true,
        reason: true,
        status: true,
        reviewedAt: true,
        autoAction: true,
        body: true,
      },
    });
    yield sec(
      'moderacaoPorIA',
      cases.map((c) => ({
        id: c.id,
        em: iso(c.createdAt),
        veredito: c.verdict,
        categoria: c.category,
        motivo: c.reason,
        situacao: c.status,
        revisadoEm: iso(c.reviewedAt),
        acaoAutomatica: c.autoAction,
        texto: c.body,
      })),
    );

    const bans = await this.prisma.deviceBan.findMany({ where: { userId }, select: { kind: true, createdAt: true } });
    yield sec(
      'bloqueiosDeDispositivo',
      bans.map((b) => ({ tipo: b.kind, em: iso(b.createdAt) })),
    );

    const attachments = await this.prisma.attachment.findMany({
      where: { uploaderId: userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, messageId: true, originalName: true, mime: true, sizeBytes: true, createdAt: true },
    });
    yield sec(
      'arquivosEnviados',
      attachments.map((a) => ({
        id: a.id,
        mensagemId: a.messageId,
        nome: a.originalName,
        tipo: a.mime,
        bytes: a.sizeBytes,
        em: iso(a.createdAt),
      })),
    );

    yield ',\n"mensagens": [';
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const page: {
        id: string;
        channelId: string | null;
        conversationId: string | null;
        body: string;
        createdAt: Date;
        editedAt: Date | null;
        deletedAt: Date | null;
      }[] = await this.prisma.message.findMany({
        where: { authorId: userId },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          channelId: true,
          conversationId: true,
          body: true,
          createdAt: true,
          editedAt: true,
          deletedAt: true,
        },
      });
      for (const m of page) {
        yield `${first ? '\n' : ',\n'}${JSON.stringify({
          id: m.id,
          canalId: m.channelId,
          conversaId: m.conversationId,
          texto: m.body,
          em: iso(m.createdAt),
          editadaEm: iso(m.editedAt),
          apagadaEm: iso(m.deletedAt),
        })}`;
        first = false;
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
    yield '\n]\n}\n';
  }

  /** Exclui a conta (anonimiza) depois de conferir a senha de quem tem conta. */
  async deleteAccount(userId: string, sessionId: string, password: string | undefined): Promise<void> {
    if (isBotSession(sessionId)) throw new ForbiddenException('token de bot não exclui conta');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBot || user.isWebhook) throw new BadRequestException('bots e webhooks são removidos por quem os criou');
    if (user.deletedAt) throw new BadRequestException('esta conta já foi excluída');
    if (user.passwordHash) {
      if (!password) throw new BadRequestException('informe a sua senha para excluir a conta');
      if (!(await verify(user.passwordHash, password).catch(() => false)))
        throw new BadRequestException('senha incorreta');
    }
    if ((await this.instance.creatorId()) === userId)
      throw new BadRequestException(
        'quem criou a instância não exclui a conta pelo app: transfira o servidor oficial antes',
      );
    if (user.isInstanceAdmin)
      throw new BadRequestException('peça a outro super admin para tirar o seu super admin antes de excluir a conta');

    // 1. nenhuma sessão continua: derruba conexões e sai da chamada
    await this.auth.revokeAllForUser(userId, 'conta excluída');

    // 2. servidores que a pessoa possui: passam ao membro mais antigo; sem ninguém, são excluídos
    const owned = await this.prisma.server.findMany({ where: { ownerId: userId }, select: { id: true } });
    let transferred = 0;
    for (const s of owned) {
      const heir = await this.prisma.serverMember.findFirst({
        where: {
          serverId: s.id,
          userId: { not: userId },
          hidden: false,
          user: { isBot: false, isWebhook: false, disabledAt: null },
        },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      });
      if (heir) {
        await this.servers.transferOwnership(s.id, userId, heir.userId, 'account_deleted');
        transferred++;
      } else await this.servers.remove(s.id, userId);
    }

    // 3. bots da pessoa
    const bots = await this.prisma.bot.findMany({ where: { ownerId: userId }, select: { id: true } });
    for (const b of bots) await this.bots.remove(userId, b.id).catch((e: unknown) => this.log.warn(String(e)));

    // 4. sai de todos os servidores, avisando quem fica
    const memberships = await this.prisma.serverMember.findMany({
      where: { userId },
      select: { serverId: true, hidden: true },
    });
    for (const m of memberships) {
      await this.prisma.$transaction([
        this.prisma.serverMember.delete({ where: { serverId_userId: { serverId: m.serverId, userId } } }),
        this.prisma.channelPermissionOverride.deleteMany({
          where: { subjectType: 'member', subjectId: userId, channel: { serverId: m.serverId } },
        }),
      ]);
      if (!m.hidden) await this.realtime.memberRemoved(m.serverId, userId, 'left');
    }

    // 5. arquivos: anexos enviados (as mensagens ficam sem eles), gravações prontas e foto de perfil
    let files = 0;
    for (;;) {
      const batch = await this.prisma.attachment.findMany({
        where: { uploaderId: userId },
        take: 500,
        select: { id: true, storageKey: true },
      });
      if (!batch.length) break;
      for (const a of batch) {
        await this.storage.remove(a.storageKey).catch((e: unknown) => this.log.warn(String(e)));
        await this.prisma.attachment.delete({ where: { id: a.id } }).catch(() => undefined);
        files++;
      }
    }
    const recordings = await this.prisma.callRecording.findMany({
      where: { createdById: userId, status: 'ready' },
      select: { id: true, storageKey: true },
    });
    for (const r of recordings) {
      await this.storage.remove(r.storageKey).catch((e: unknown) => this.log.warn(String(e)));
      await this.prisma.callRecording.delete({ where: { id: r.id } }).catch(() => undefined);
      files++;
    }
    await this.avatars.purge(userId).catch(() => undefined);

    // 6. relações pessoais e a linha do usuário, anonimizada
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      this.prisma.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      this.prisma.conversationMember.deleteMany({ where: { userId } }),
      this.prisma.readState.deleteMany({ where: { userId } }),
      this.prisma.userSettings.deleteMany({ where: { userId } }),
      this.prisma.reaction.deleteMany({ where: { userId } }),
      this.prisma.pollVote.deleteMany({ where: { userId } }),
      this.prisma.eventRsvp.deleteMany({ where: { userId } }),
      this.prisma.invite.deleteMany({ where: { creatorId: userId } }),
      this.prisma.moderationCase.deleteMany({ where: { authorId: userId } }),
      // o bloqueio de aparelho/IP continua valendo, só deixa de apontar para a pessoa
      this.prisma.deviceBan.updateMany({ where: { userId }, data: { userId: null } }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          username: `removido_${randomBytes(4).toString('hex')}`,
          displayName: 'Usuário removido',
          nickKey: null,
          passwordHash: null,
          avatarKey: null,
          bio: '',
          profileColors: [],
          verified: false,
          termsAcceptedAt: null,
          disabledAt: now,
          deletedAt: now,
        },
      }),
    ]);
    await this.audit.log(userId, null, 'user.delete', userId, {
      servers: owned.length,
      transferred,
      files,
      bots: bots.length,
    });
    this.log.log(`conta excluída: ${userId} (${files} arquivos, ${owned.length} servidores)`);
  }
}

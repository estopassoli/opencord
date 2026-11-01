/**
 * Webhooks de entrada (ADR-0030): um link secreto por canal de texto; quem faz POST nele (servidor do jogo, GitHub,
 * Twitch…) vira mensagem no canal, assinada por um usuário próprio do webhook (isWebhook, selo "APP"). Criar, listar e
 * apagar exigem MANAGE_CHANNELS. Sem bots que respondem: só entrada.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_WEBHOOKS_PER_SERVER, Permission, type Webhook } from '@opencord/contracts';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { notFound } from '../common/errors.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { MessagesService } from '../messages/messages.service.js';
import type { Prisma } from '@opencord/db';

const INCLUDE = { createdBy: { select: USER_PUBLIC_SELECT } } satisfies Prisma.WebhookInclude;
type Row = Prisma.WebhookGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly messages: MessagesService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private serialize(w: Row): Webhook {
    return {
      id: w.id,
      serverId: w.serverId,
      channelId: w.channelId,
      name: w.name,
      createdBy: userPublic(w.createdBy),
      createdAt: w.createdAt.toISOString(),
      url: `${this.cfg.PUBLIC_API_URL.replace(/\/$/, '')}/webhooks/${w.id}/${w.token}`,
    };
  }

  async list(userId: string, serverId: string): Promise<Webhook[]> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_CHANNELS);
    const rows = await this.prisma.webhook.findMany({
      where: { serverId },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((w) => this.serialize(w));
  }

  async create(userId: string, serverId: string, dto: { name: string; channelId: string }): Promise<Webhook> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_CHANNELS);
    const ch = await this.prisma.channel.findUnique({
      where: { id: dto.channelId },
      select: { serverId: true, kind: true },
    });
    if (!ch || ch.serverId !== serverId || ch.kind !== 'text')
      throw new BadRequestException('escolha um canal de texto deste servidor');
    if ((await this.prisma.webhook.count({ where: { serverId } })) >= MAX_WEBHOOKS_PER_SERVER)
      throw new BadRequestException(`limite de ${MAX_WEBHOOKS_PER_SERVER} webhooks por servidor`);
    const id = randomBytes(6).toString('hex');
    const row = await this.prisma.webhook.create({
      data: {
        server: { connect: { id: serverId } },
        channel: { connect: { id: dto.channelId } },
        createdBy: { connect: { id: userId } },
        name: dto.name,
        token: randomBytes(32).toString('hex'),
        // usuário próprio do webhook: sem senha, sem e-mail, sem apelido reservado
        user: { create: { username: `webhook-${id}`, displayName: dto.name, isWebhook: true } },
      },
      include: INCLUDE,
    });
    return this.serialize(row);
  }

  async remove(userId: string, webhookId: string) {
    const w = await this.prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!w) throw notFound('webhook');
    await this.perms.requireServer(w.serverId, userId, Permission.MANAGE_CHANNELS).catch(() => {
      throw notFound('webhook');
    });
    // apagar o usuário leva o webhook junto (cascade); as mensagens antigas ficam, com o autor removido? Não:
    // o autor é obrigatório nas mensagens, então o usuário fica e só o webhook some.
    await this.prisma.webhook.delete({ where: { id: webhookId } });
  }

  /** POST público: valida o segredo em tempo constante e posta a mensagem. */
  async post(webhookId: string, token: string, body: { content?: string | undefined; text?: string | undefined }) {
    const w = await this.prisma.webhook.findUnique({ where: { id: webhookId } });
    const a = Buffer.from(w?.token ?? '');
    const b = Buffer.from(token);
    if (!w || a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException('webhook não encontrado');
    const text = (body.content ?? body.text ?? '').trim();
    if (!text) throw new BadRequestException('envie "content" ou "text"');
    return this.messages.postAsWebhook({ userId: w.userId, channelId: w.channelId, serverId: w.serverId }, text);
  }
}

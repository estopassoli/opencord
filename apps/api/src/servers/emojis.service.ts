import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MAX_SERVER_EMOJIS, EMOJI_NAME, Permission, rooms, type CustomEmoji } from '@opencord/contracts';
import { AuditService } from '../audit/audit.service.js';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { serverEmojiIndex, serverSummary } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AvatarService } from '../users/avatar.service.js';
import { PermissionsService } from './permissions.service.js';

/** Recarga periódica do índice (outra réplica da API pode ter mudado os emojis). */
const REFRESH_MS = 60_000;

type EmojiRow = { id: string; name: string; animated: boolean };
const toEmoji = (e: EmojiRow): CustomEmoji => ({ id: e.id, name: e.name, animated: e.animated });

/**
 * Emojis personalizados do servidor (ADR-0050): até 50 por servidor, animados para todos. A lista vai em
 * `ServerSummary.emojis` pelo índice em memória; a imagem é pública em `GET /emojis/:id`, o que deixa usar o emoji
 * em qualquer lugar (mensagens, reações, DMs).
 */
@Injectable()
export class EmojisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Emojis');
  private timer: ReturnType<typeof setInterval> | null = null;
  /** id → arquivo, para servir a imagem sem ir ao banco */
  private readonly files = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly images: AvatarService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.reload();
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lê todos os emojis do banco; sem a tabela (API nova antes da migração) segue vazio. */
  async reload() {
    try {
      const rows = await this.prisma.serverEmoji.findMany({ orderBy: { createdAt: 'asc' } });
      const by = new Map<string, CustomEmoji[]>();
      this.files.clear();
      for (const r of rows) {
        by.set(r.serverId, [...(by.get(r.serverId) ?? []), toEmoji(r)]);
        this.files.set(r.id, r.imageKey);
      }
      serverEmojiIndex.clear();
      for (const [k, v] of by) serverEmojiIndex.set(k, v);
    } catch (e) {
      this.log.warn(`não foi possível carregar os emojis: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** arquivo da imagem do emoji (para GET /emojis/:id); confere o banco se o índice ainda não sabe */
  async fileOf(id: string): Promise<string | null> {
    const known = this.files.get(id);
    if (known) return known;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await this.prisma.serverEmoji.findUnique({ where: { id }, select: { imageKey: true } });
    return row?.imageKey ?? null;
  }

  async list(serverId: string, userId: string): Promise<CustomEmoji[]> {
    await this.perms.server(serverId, userId);
    return serverEmojiIndex.get(serverId) ?? [];
  }

  async create(
    serverId: string,
    userId: string,
    name: string,
    file: AsyncIterable<Buffer> & { truncated?: boolean },
  ): Promise<CustomEmoji> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    if (!EMOJI_NAME.test(name)) throw new BadRequestException('o nome do emoji usa de 2 a 24 letras, números ou _');
    const count = await this.prisma.serverEmoji.count({ where: { serverId } });
    if (count >= MAX_SERVER_EMOJIS)
      throw new BadRequestException(`o servidor já tem ${MAX_SERVER_EMOJIS} emojis; apague um para enviar outro`);
    if (await this.prisma.serverEmoji.findUnique({ where: { serverId_name: { serverId, name } } }))
      throw new BadRequestException(`já existe um emoji :${name}: neste servidor`);
    const imageKey = await this.images.storeEmojiImage(file);
    const row = await this.prisma.serverEmoji
      .create({ data: { serverId, name, imageKey, animated: imageKey.endsWith('-gif'), createdById: userId } })
      .catch(async (e: unknown) => {
        await this.images.removeEmojiImage(imageKey);
        throw e;
      });
    await this.audit.log(userId, serverId, 'emoji.create', row.id, { name });
    await this.changed(serverId);
    return toEmoji(row);
  }

  async rename(id: string, userId: string, name: string): Promise<CustomEmoji> {
    const row = await this.prisma.serverEmoji.findUnique({ where: { id } });
    if (!row) throw notFound('emoji');
    await this.perms.requireServer(row.serverId, userId, Permission.MANAGE_SERVER);
    const clash = await this.prisma.serverEmoji.findUnique({
      where: { serverId_name: { serverId: row.serverId, name } },
    });
    if (clash && clash.id !== id) throw new BadRequestException(`já existe um emoji :${name}: neste servidor`);
    const updated = await this.prisma.serverEmoji.update({ where: { id }, data: { name } });
    await this.audit.log(userId, row.serverId, 'emoji.update', id, { name });
    await this.changed(row.serverId);
    return toEmoji(updated);
  }

  async remove(id: string, userId: string) {
    const row = await this.prisma.serverEmoji.findUnique({ where: { id } });
    if (!row) throw notFound('emoji');
    await this.perms.requireServer(row.serverId, userId, Permission.MANAGE_SERVER);
    await this.prisma.serverEmoji.delete({ where: { id } });
    // mensagens e reações antigas com ele passam a mostrar o :nome: em texto
    await this.images.removeEmojiImage(row.imageKey);
    await this.audit.log(userId, row.serverId, 'emoji.delete', id, { name: row.name });
    await this.changed(row.serverId);
  }

  /** atualiza o índice e avisa os membros (a lista vai no resumo do servidor) */
  private async changed(serverId: string) {
    await this.reload();
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (server) this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
  }
}

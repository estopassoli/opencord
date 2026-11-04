import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Badge, CreateBadgeRequest, UpdateBadgeRequest } from '@opencord/contracts';
import type { z } from 'zod';
import { PrismaService } from '../common/prisma.service.js';
import { notFound } from '../common/errors.js';
import { userBadgeIndex } from '../common/serialize.js';

/** Recarga periódica do índice (outra réplica da API pode ter mudado as insígnias). */
const REFRESH_MS = 60_000;
const MAX_BADGES = 100;

type BadgeRow = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  imageKey: string | null;
};
const toBadge = (b: BadgeRow): Badge => ({
  id: b.id,
  name: b.name,
  description: b.description,
  icon: b.icon,
  color: b.color,
  imageKey: b.imageKey,
});

/**
 * Insígnias (ADR-0043): catálogo do super admin e quem tem cada uma. O catálogo vai em InstanceInfo.badges; as de
 * cada pessoa vão em UserPublic.badges pelo índice em memória (`userBadgeIndex`).
 */
@Injectable()
export class BadgesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Insígnias');
  private catalog: Badge[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lê catálogo e atribuições do banco; sem as tabelas (API nova antes da migração) segue vazio. */
  async reload() {
    try {
      const [badges, held] = await Promise.all([
        this.prisma.badge.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
        this.prisma.userBadge.findMany({ select: { userId: true, badgeId: true } }),
      ]);
      this.catalog = badges.map(toBadge);
      const order = new Map(badges.map((b, i) => [b.id, i]));
      const by = new Map<string, string[]>();
      for (const h of held) by.set(h.userId, [...(by.get(h.userId) ?? []), h.badgeId]);
      userBadgeIndex.clear();
      for (const [userId, ids] of by)
        userBadgeIndex.set(
          userId,
          ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
        );
    } catch (e) {
      this.log.warn(`insígnias indisponíveis: ${String(e)}`);
    }
  }

  list(): Badge[] {
    return this.catalog;
  }

  async create(dto: z.infer<typeof CreateBadgeRequest>): Promise<Badge> {
    if (this.catalog.length >= MAX_BADGES) throw new BadRequestException(`limite de ${MAX_BADGES} insígnias`);
    const last = await this.prisma.badge.aggregate({ _max: { position: true } });
    const b = await this.prisma.badge.create({
      data: {
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        color: dto.color,
        position: (last._max.position ?? -1) + 1,
      },
    });
    await this.reload();
    return toBadge(b);
  }

  async update(id: string, dto: z.infer<typeof UpdateBadgeRequest>): Promise<Badge> {
    await this.get(id);
    const b = await this.prisma.badge.update({ where: { id }, data: dto });
    await this.reload();
    return toBadge(b);
  }

  /** Apaga a insígnia e tira de todo mundo; devolve quem tinha (para avisar) e a imagem a apagar. */
  async remove(id: string): Promise<{ badge: Badge; holders: string[] }> {
    const b = await this.get(id);
    const holders = (await this.prisma.userBadge.findMany({ where: { badgeId: id }, select: { userId: true } })).map(
      (h) => h.userId,
    );
    await this.prisma.badge.delete({ where: { id } });
    await this.reload();
    return { badge: toBadge(b), holders };
  }

  /** Imagem (já gravada) no lugar do ícone; `null` volta ao ícone. Devolve a insígnia e a imagem anterior. */
  async setImage(id: string, imageKey: string | null): Promise<{ badge: Badge; previous: string | null }> {
    const prev = await this.get(id);
    const b = await this.prisma.badge.update({ where: { id }, data: { imageKey } });
    await this.reload();
    return { badge: toBadge(b), previous: prev.imageKey };
  }

  /** Substitui as insígnias da pessoa; devolve se mudou algo. */
  async setForUser(actorId: string, userId: string, badgeIds: string[]): Promise<boolean> {
    const wanted = [...new Set(badgeIds)];
    const known = new Set(this.catalog.map((b) => b.id));
    // o catálogo em memória pode estar atrasado em relação a outra réplica: confere no banco
    if (wanted.some((id) => !known.has(id))) await this.reload();
    const ids = new Set(this.catalog.map((b) => b.id));
    const unknown = wanted.find((id) => !ids.has(id));
    if (unknown) throw new BadRequestException('insígnia não existe');
    const current = new Set(userBadgeIndex.get(userId) ?? []);
    const add = wanted.filter((id) => !current.has(id));
    const drop = [...current].filter((id) => !wanted.includes(id));
    if (!add.length && !drop.length) return false;
    await this.prisma.$transaction([
      this.prisma.userBadge.deleteMany({ where: { userId, badgeId: { in: drop } } }),
      this.prisma.userBadge.createMany({
        data: add.map((badgeId) => ({ userId, badgeId, grantedById: actorId })),
        skipDuplicates: true,
      }),
    ]);
    await this.reload();
    return true;
  }

  private async get(id: string) {
    const b = await this.prisma.badge.findUnique({ where: { id } });
    if (!b) throw notFound('insígnia');
    return b;
  }
}

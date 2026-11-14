import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { NUDGE_COOLDOWN_MS, UserSettingsV1 } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** chamadas de atenção por pessoa por minuto, somando todos os alvos */
const NUDGES_PER_MINUTE = 10;

const tooMany = (retryAfterSec: number, message: string) =>
  new HttpException({ statusCode: 429, error: 'Too Many Requests', code: 'nudge', retryAfterSec, message }, 429);

/**
 * "Chamar atenção" (ADR-0064), como o de mensageiros antigos: treme o app da outra pessoa e toca um aviso. Nada vai
 * para o banco; é só um evento em tempo real para quem está conectado.
 *
 * Quem pode: alguém com quem eu divido um servidor ou de quem sou amigo, sem bloqueio de nenhum lado, que não
 * desligou "Chamar atenção" nas configurações. Limites: a mesma pessoa a cada 15 s e 10 por minuto no total.
 */
@Injectable()
export class NudgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
  ) {}

  async nudge(fromId: string, targetId: string): Promise<void> {
    if (fromId === targetId) throw forbidden('não dá para chamar a sua própria atenção');
    const [from, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: fromId }, select: { displayName: true } }),
      this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, displayName: true, disabledAt: true, deletedAt: true, isBot: true },
      }),
    ]);
    // inexistente, desativado, bloqueado ou sem nada em comum: a mesma resposta (não revela quem bloqueou)
    if (!from || !target || target.disabledAt || target.deletedAt || target.isBot) throw notFound('usuário');
    const [blocked, friends, shared] = await Promise.all([
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: fromId, blockedId: targetId },
            { blockerId: targetId, blockedId: fromId },
          ],
        },
        select: { blockerId: true },
      }),
      this.prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          userLowId: fromId < targetId ? fromId : targetId,
          userHighId: fromId < targetId ? targetId : fromId,
        },
        select: { id: true },
      }),
      this.prisma.serverMember.findFirst({
        where: { userId: targetId, hidden: false, server: { members: { some: { userId: fromId } } } },
        select: { serverId: true },
      }),
    ]);
    if (blocked || (!friends && !shared)) throw notFound('usuário');

    const row = await this.prisma.userSettings.findUnique({ where: { userId: targetId }, select: { json: true } });
    const settings = row ? UserSettingsV1.safeParse(row.json) : null;
    if (settings?.success && !settings.data.notifications.nudges)
      throw forbidden(`${target.displayName} desligou "Chamar atenção".`);
    if (!(await this.realtime.isUserConnected(targetId)))
      throw new ConflictException(`${target.displayName} não está conectado agora.`);

    const redis = this.redis.client;
    const pair = `nudge:${fromId}:${targetId}`;
    if ((await redis.set(pair, '1', 'PX', NUDGE_COOLDOWN_MS, 'NX')) !== 'OK') {
      const ttl = await redis.pttl(pair);
      const sec = Math.max(1, Math.ceil(ttl / 1000));
      throw tooMany(sec, `Espere ${sec} s para chamar a atenção de ${target.displayName} de novo.`);
    }
    const total = `nudge:${fromId}`;
    const n = await redis.incr(total);
    if (n === 1) await redis.pexpire(total, 60_000);
    if (n > NUDGES_PER_MINUTE) {
      const sec = Math.max(1, Math.ceil((await redis.pttl(total)) / 1000));
      throw tooMany(sec, `Muitas chamadas de atenção seguidas. Espere ${sec} s.`);
    }
    this.realtime.toUser(targetId, 'user:nudge', { fromUserId: fromId, fromName: from.displayName });
  }
}

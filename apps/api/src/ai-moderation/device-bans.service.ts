/**
 * Bloqueio de dispositivo (adendo ADR-0036): quem tentar entrar com um aparelho/IP bloqueado é recusado em qualquer
 * porta (apelido, conta, login, refresh). Os valores vêm das sessões da pessoa: `hardwareId` (app desktop: hash dos
 * MACs), `deviceId` (identificador do app no aparelho) e `ip`. Não existe "MAC" visível pela internet; isto é o
 * mais perto que dá.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { DeviceBan } from '@opencord/contracts';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';

export interface DeviceSignals {
  hardwareId?: string | undefined;
  deviceId?: string | undefined;
  ip?: string | undefined;
}

/** sessões dos últimos 30 dias contam para o bloqueio */
const WINDOW_MS = 30 * 24 * 3600 * 1000;
/** IPs locais nunca entram num bloqueio (tudo atrás de um proxy mal configurado pareceria o mesmo IP) */
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;

@Injectable()
export class DeviceBansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 403 se qualquer sinal do aparelho estiver bloqueado. */
  async assertAllowed(s: DeviceSignals): Promise<void> {
    const or: { kind: string; value: string }[] = [];
    if (s.hardwareId) or.push({ kind: 'hardware', value: s.hardwareId });
    if (s.deviceId) or.push({ kind: 'device', value: s.deviceId });
    if (s.ip && !PRIVATE_IP.test(s.ip)) or.push({ kind: 'ip', value: s.ip });
    if (!or.length) return;
    const hit = await this.prisma.deviceBan.findFirst({ where: { OR: or }, select: { id: true } });
    if (hit) throw new ForbiddenException('este dispositivo está bloqueado nesta instância');
  }

  /** Bloqueia todos os sinais conhecidos da pessoa (sessões recentes). Devolve quantos bloqueios novos. */
  async banDevicesOf(userId: string, reason: string, createdById: string | null): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
      select: { hardwareId: true, deviceId: true, ip: true },
    });
    const values = new Map<string, { kind: string; value: string }>();
    for (const s of sessions) {
      if (s.hardwareId) values.set(`hardware:${s.hardwareId}`, { kind: 'hardware', value: s.hardwareId });
      if (s.deviceId) values.set(`device:${s.deviceId}`, { kind: 'device', value: s.deviceId });
      if (s.ip && !PRIVATE_IP.test(s.ip)) values.set(`ip:${s.ip}`, { kind: 'ip', value: s.ip });
    }
    let created = 0;
    for (const v of values.values()) {
      const r = await this.prisma.deviceBan.upsert({
        where: { kind_value: v },
        create: { ...v, userId, reason, createdById },
        update: {},
        select: { createdAt: true },
      });
      if (Date.now() - r.createdAt.getTime() < 5000) created++;
    }
    return created;
  }

  async list(): Promise<DeviceBan[]> {
    const rows = await this.prisma.deviceBan.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_PUBLIC_SELECT })
      : [];
    const byId = new Map(users.map((u) => [u.id, userPublic(u)]));
    return rows.map((r) => ({
      id: r.id,
      kind: (['hardware', 'device', 'ip'] as const).find((k) => k === r.kind) ?? 'device',
      value: r.kind === 'ip' ? r.value : `${r.value.slice(0, 12)}…`,
      user: r.userId ? (byId.get(r.userId) ?? null) : null,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async remove(actorId: string, id: string): Promise<void> {
    const r = await this.prisma.deviceBan.findUnique({ where: { id } });
    if (!r) return;
    await this.prisma.deviceBan.delete({ where: { id } });
    await this.audit.log(actorId, null, 'admin.device.unban', r.userId, { kind: r.kind });
  }

  /** Tira todos os bloqueios que vieram de uma pessoa (ao reativar a conta). */
  async removeForUser(actorId: string, userId: string): Promise<number> {
    const r = await this.prisma.deviceBan.deleteMany({ where: { userId } });
    if (r.count) await this.audit.log(actorId, null, 'admin.device.unban', userId, { count: r.count });
    return r.count;
  }
}

import { BadRequestException, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  DUEL_COUNTDOWN_MS,
  DUEL_FIGHT_MS,
  DUEL_HP,
  DUEL_INVITE_MS,
  DUEL_JAB_COOLDOWN_MS,
  DUEL_STRONG_COOLDOWN_MS,
  duelDamage,
  duelReaches,
  rooms,
  type SpaceDuel,
} from '@opencord/contracts';
import { randomUUID } from 'node:crypto';
import { forbidden, notFound } from '../common/errors.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SpaceService } from './space.service.js';
import { VoiceService } from './voice.service.js';

/** distância máxima para desafiar alguém (os dois precisam estar no espaço, perto) */
const CHALLENGE_RANGE = 4;
/** tolerância de latência no alcance do soco */
const REACH_SLACK = 0.4;
const KEEP_ENDED_MS = 10_000;

type Duel = Omit<SpaceDuel, 'serverNow'>;

/**
 * x1 no soco do Espaço 3D (ADR-0055). O servidor decide: quem pode desafiar, contagem, tempo, cada golpe (alcance,
 * mira, recarga, defesa, pela última posição recebida de cada um) e o resultado. As lutas vivem em memória: duram no
 * máximo ~2 min e somem depois de 10 s do fim (uma API reiniciada encerra as lutas em andamento).
 */
@Injectable()
export class DuelService implements OnModuleDestroy {
  private readonly duels = new Map<string, Duel>();
  private readonly byUser = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  /** última vez que cada um acertou cada tipo de golpe (recarga) */
  private readonly cooldown = new Map<string, number>();

  constructor(
    private readonly voice: VoiceService,
    private readonly space: SpaceService,
    private readonly realtime: RealtimeService,
  ) {
    space.onLeave = (userId) => this.left(userId);
  }

  onModuleDestroy() {
    for (const ts of this.timers.values()) for (const t of ts) clearTimeout(t);
  }

  private publish(d: Duel): SpaceDuel {
    const out = { ...d, serverNow: Date.now() };
    this.realtime.emit(rooms.channel(d.channelId), 'space:duel', out);
    return out;
  }

  private schedule(id: string, ms: number, fn: () => void) {
    const t = setTimeout(fn, ms);
    this.timers.set(id, [...(this.timers.get(id) ?? []), t]);
  }

  private finish(d: Duel, winner: string | null, reason: NonNullable<Duel['reason']>): SpaceDuel {
    for (const t of this.timers.get(d.id) ?? []) clearTimeout(t);
    this.timers.delete(d.id);
    d.status = 'ended';
    d.winner = winner;
    d.reason = reason;
    d.until = Date.now();
    for (const u of [d.a, d.b]) if (this.byUser.get(u) === d.id) this.byUser.delete(u);
    for (const k of [...this.cooldown.keys()]) if (k.startsWith(`${d.id}:`)) this.cooldown.delete(k);
    setTimeout(() => this.duels.delete(d.id), KEEP_ENDED_MS).unref?.();
    return this.publish(d);
  }

  private async requireInCall(userId: string, channelId: string) {
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId || !s.serverId) throw forbidden('entre na chamada para o x1');
  }

  private mine(userId: string, duelId: string): Duel {
    const d = this.duels.get(duelId);
    if (!d || (d.a !== userId && d.b !== userId)) throw notFound('x1');
    return d;
  }

  list(channelId: string): SpaceDuel[] {
    return [...this.duels.values()]
      .filter((d) => d.channelId === channelId)
      .map((d) => ({ ...d, serverNow: Date.now() }));
  }

  async get(userId: string, channelId: string): Promise<SpaceDuel[]> {
    await this.requireInCall(userId, channelId);
    return this.list(channelId);
  }

  async challenge(userId: string, channelId: string, targetId: string): Promise<SpaceDuel> {
    if (targetId === userId) throw new BadRequestException('escolha outra pessoa');
    await this.requireInCall(userId, channelId);
    await this.requireInCall(targetId, channelId).catch(() => {
      throw forbidden('essa pessoa não está na chamada');
    });
    if (this.byUser.has(userId)) throw new BadRequestException('você já está num x1');
    if (this.byUser.has(targetId)) throw new BadRequestException('essa pessoa já está num x1');
    const pa = this.space.poseOf(userId, 5000);
    const pb = this.space.poseOf(targetId, 5000);
    if (!pa || !pb || pa.channelId !== channelId || pb.channelId !== channelId)
      throw new BadRequestException('os dois precisam estar no espaço 3D');
    if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > CHALLENGE_RANGE) throw new BadRequestException('chegue mais perto');
    const d: Duel = {
      id: randomUUID(),
      channelId,
      a: userId,
      b: targetId,
      status: 'pending',
      hp: { [userId]: DUEL_HP, [targetId]: DUEL_HP },
      ring: { x: Math.round(((pa.x + pb.x) / 2) * 100) / 100, z: Math.round(((pa.z + pb.z) / 2) * 100) / 100 },
      until: Date.now() + DUEL_INVITE_MS,
      winner: null,
      reason: null,
      lastHit: null,
    };
    this.duels.set(d.id, d);
    this.byUser.set(userId, d.id);
    this.byUser.set(targetId, d.id);
    this.schedule(d.id, DUEL_INVITE_MS, () => {
      if (d.status === 'pending') this.finish(d, null, 'expired');
    });
    return this.publish(d);
  }

  async answer(userId: string, duelId: string, accept: boolean): Promise<SpaceDuel> {
    const d = this.mine(userId, duelId);
    if (d.status !== 'pending') throw new BadRequestException('esse convite já foi respondido');
    if (d.b !== userId) throw forbidden('só quem foi desafiado responde');
    if (!accept) return this.finish(d, null, 'declined');
    await this.requireInCall(d.a, d.channelId).catch(() => {
      this.finish(d, null, 'left');
      throw forbidden('quem desafiou saiu da chamada');
    });
    for (const t of this.timers.get(d.id) ?? []) clearTimeout(t);
    this.timers.delete(d.id);
    d.status = 'countdown';
    d.until = Date.now() + DUEL_COUNTDOWN_MS;
    this.schedule(d.id, DUEL_COUNTDOWN_MS, () => {
      if (d.status !== 'countdown') return;
      d.status = 'fighting';
      d.until = Date.now() + DUEL_FIGHT_MS;
      this.publish(d);
      this.schedule(d.id, DUEL_FIGHT_MS, () => {
        if (d.status !== 'fighting') return;
        const ha = d.hp[d.a] ?? 0;
        const hb = d.hp[d.b] ?? 0;
        this.finish(d, ha === hb ? null : ha > hb ? d.a : d.b, 'time');
      });
    });
    return this.publish(d);
  }

  /** Golpe: só conta se a luta está valendo, a recarga passou e o soco alcança o adversário. */
  hit(userId: string, duelId: string, strong: boolean): SpaceDuel {
    const d = this.mine(userId, duelId);
    if (d.status !== 'fighting') return { ...d, serverNow: Date.now() };
    const target = d.a === userId ? d.b : d.a;
    const now = Date.now();
    const key = `${d.id}:${userId}:${strong ? 's' : 'j'}`;
    const cd = strong ? DUEL_STRONG_COOLDOWN_MS : DUEL_JAB_COOLDOWN_MS;
    // 50 ms de folga para o relógio do cliente
    if (now - (this.cooldown.get(key) ?? 0) < cd - 50) return { ...d, serverNow: now };
    this.cooldown.set(key, now);
    const me = this.space.poseOf(userId);
    const them = this.space.poseOf(target);
    if (!me || !them || !duelReaches(me, them, REACH_SLACK)) return { ...d, serverNow: now };
    const blocked = them.a === 8;
    const dmg = duelDamage(strong, blocked);
    d.hp[target] = Math.max(0, (d.hp[target] ?? 0) - dmg);
    d.lastHit = { by: userId, on: target, dmg, blocked, at: now };
    if (d.hp[target] === 0) return this.finish(d, userId, 'ko');
    return this.publish(d);
  }

  forfeit(userId: string, duelId: string): SpaceDuel {
    const d = this.mine(userId, duelId);
    if (d.status === 'ended') return { ...d, serverNow: Date.now() };
    if (d.status === 'pending') return this.finish(d, null, 'declined');
    return this.finish(d, d.a === userId ? d.b : d.a, 'forfeit');
  }

  /** saiu do espaço (ou da chamada): perde a luta; convite some */
  left(userId: string) {
    const id = this.byUser.get(userId);
    const d = id ? this.duels.get(id) : undefined;
    if (!d || d.status === 'ended') return;
    if (d.status === 'pending') this.finish(d, null, 'left');
    else this.finish(d, d.a === userId ? d.b : d.a, 'left');
  }
}

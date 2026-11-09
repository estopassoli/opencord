import { BadRequestException, ConflictException, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  generateSpace,
  isMatchZone,
  MATCH_COUNTDOWN_MS,
  MATCH_RULES,
  matchPhase,
  matchWinner,
  RACE_CLOSE_MS,
  Permission,
  rooms,
  SpaceLayout,
  SPACE_TOGGLE_KINDS,
  type ServerSpace,
  type SpaceBall,
  type SpaceGun,
  type SpaceMove,
  type SpacePool,
  RACE_COUNTDOWN_MS,
  RACE_LAPS,
  RACE_MIN_LAP_MS,
  type SpaceScreen,
  type SpaceSession,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { AuditService } from '../audit/audit.service.js';
import { forbidden } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { requireServerId, VoiceService } from './voice.service.js';

const TTL_S = 6 * 60 * 60;
const key = (channelId: string) => `space:${channelId}`;
/** quem está na chamada muda pouco: a lista para repassar posições é relida no máximo a cada 2 s */
const CALL_CACHE_MS = 2000;
/** posição mais velha que isto não conta para "quem está na arena" (treino e largada) */
const POSE_FRESH_MS = 6000;

/**
 * Espaço 3D da chamada (ADR-0055).
 * - Ambiente por servidor: salvo no banco quando alguém com EDIT_SPACE edita; sem edição, o gerado pelo id do servidor.
 * - Telão: o que passa nele é estado da chamada no Redis (como o "Assistir juntos"), apagado quando a chamada esvazia.
 * - Posições: só repassadas a quem está na mesma chamada, sem guardar nada (presença efêmera, sem garantia de entrega).
 */
@Injectable()
export class SpaceService implements OnModuleDestroy {
  /** viradas de tempo (fim do tempo da partida, fechamento da corrida) por chamada */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly calls = new Map<string, { channelId: string; peers: string[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly perms: PermissionsService,
    private readonly voice: VoiceService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  private get r() {
    return this.redis.client;
  }

  // ---------- ambiente ----------
  async get(serverId: string, userId: string): Promise<ServerSpace> {
    await this.perms.server(serverId, userId);
    return this.load(serverId);
  }

  private async load(serverId: string): Promise<ServerSpace> {
    const row = await this.prisma.serverSpace.findUnique({ where: { serverId } });
    const parsed = row ? SpaceLayout.safeParse(row.layout) : null;
    if (row && parsed?.success)
      return {
        serverId,
        layout: parsed.data,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedById,
      };
    return {
      serverId,
      layout: generateSpace(serverId),
      revision: row?.revision ?? 0,
      updatedAt: null,
      updatedBy: null,
    };
  }

  async save(serverId: string, userId: string, layout: SpaceLayout, baseRevision: number): Promise<ServerSpace> {
    await this.perms.requireServer(serverId, userId, Permission.EDIT_SPACE);
    const json = layout as unknown as Prisma.InputJsonValue;
    // gravação condicional pela revisão: duas pessoas editando ao mesmo tempo não se sobrescrevem
    const updated = await this.prisma.serverSpace.updateMany({
      where: { serverId, revision: baseRevision },
      data: { layout: json, revision: { increment: 1 }, updatedById: userId },
    });
    if (updated.count === 0) {
      if (baseRevision !== 0) throw new ConflictException('o espaço foi alterado por outra pessoa; recarregue');
      try {
        await this.prisma.serverSpace.create({ data: { serverId, layout: json, revision: 1, updatedById: userId } });
      } catch {
        throw new ConflictException('o espaço foi alterado por outra pessoa; recarregue');
      }
    }
    const out = await this.load(serverId);
    await this.audit.log(userId, serverId, 'space.update', serverId, {
      revision: out.revision,
      theme: layout.theme,
      items: layout.items.length,
      walls: layout.walls.length,
    });
    this.realtime.emit(rooms.server(serverId), 'space:layout', out);
    return out;
  }

  /** Volta ao ambiente gerado (apaga a edição). */
  async reset(serverId: string, userId: string): Promise<ServerSpace> {
    await this.perms.requireServer(serverId, userId, Permission.EDIT_SPACE);
    await this.prisma.serverSpace.deleteMany({ where: { serverId } });
    await this.audit.log(userId, serverId, 'space.reset', serverId, {});
    const out = await this.load(serverId);
    this.realtime.emit(rooms.server(serverId), 'space:layout', out);
    return out;
  }

  // ---------- telão ----------
  private async requireInCall(userId: string, channelId: string): Promise<string> {
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId) throw forbidden('entre na chamada para usar o espaço 3D');
    return requireServerId(s.serverId);
  }

  async session(userId: string, channelId: string): Promise<SpaceSession | null> {
    await this.requireInCall(userId, channelId);
    const s = await this.loadSession(channelId);
    if (!s) return null;
    const settled = this.settle(s, Date.now());
    return settled === s ? s : this.publishSession(settled);
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * Viradas que dependem só do relógio: contagem → em jogo, tempo esgotado → fim (se houver vencedor) e a corrida que
   * fecha 30 s depois do 1º (quem não chegou = DNF). Devolve a mesma sessão quando nada mudou.
   */
  private settle(s: SpaceSession, now: number): SpaceSession {
    let out = s;
    if (s.matches) {
      let matches: NonNullable<SpaceSession['matches']> | null = null;
      for (const [k, m] of Object.entries(s.matches)) {
        const zone = Number(k);
        if (!isMatchZone(zone)) continue;
        const phase = matchPhase(m, now);
        let next = m;
        if (phase === 'playing') {
          const w = matchWinner(zone, s.scores?.[k] ?? { a: 0, b: 0 }, now - m.startAt);
          next = w ? { phase: 'ended', startAt: m.startAt, winner: w, endedAt: now } : { ...m, phase: 'playing' };
        }
        if (next.phase !== m.phase) (matches ??= { ...s.matches })[k] = next;
      }
      if (matches) out = { ...out, matches };
    }
    const race = s.race;
    if (race && !race.closed && race.endsAt !== undefined && now >= race.endsAt) {
      const done = new Set(race.results.map((r) => r.userId));
      out = { ...out, race: { ...race, closed: true, dnf: (race.racers ?? []).filter((u) => !done.has(u)) } };
    }
    if (out !== s) out = { ...out, revision: s.revision + 1 };
    return out;
  }

  /** acorda em `at` (relógio do servidor) para virar o que depende do tempo e avisar todos da chamada */
  private wakeAt(channelId: string, what: string, at: number) {
    const k = `${channelId}:${what}`;
    const old = this.timers.get(k);
    if (old) clearTimeout(old);
    const t = setTimeout(
      () => {
        this.timers.delete(k);
        void this.tick(channelId).catch(() => undefined);
      },
      Math.max(0, at - Date.now()) + 50,
    );
    t.unref?.();
    this.timers.set(k, t);
  }

  private async tick(channelId: string) {
    const s = await this.loadSession(channelId);
    if (!s) return;
    const settled = this.settle(s, Date.now());
    if (settled !== s) await this.publishSession(settled);
  }

  /** quantos de cada time estão numa arena agora, pelas posições recentes de quem está na chamada */
  private async teamsIn(channelId: string, zone: number): Promise<{ a: number; b: number; known: boolean }> {
    const members = await this.r.smembers(`voice:channel:${channelId}`);
    const out = { a: 0, b: 0, known: false };
    for (const u of members) {
      const p = this.poseOf(u, POSE_FRESH_MS);
      if (!p || p.channelId !== channelId || (p.zone ?? 0) !== zone) continue;
      out.known = true;
      if (p.team === 'b') out.b++;
      else out.a++;
    }
    return out;
  }

  private async loadSession(channelId: string): Promise<SpaceSession | null> {
    const raw = await this.r.get(key(channelId));
    return raw ? (JSON.parse(raw) as SpaceSession) : null;
  }

  private async publishSession(s: SpaceSession): Promise<SpaceSession> {
    await this.r.set(key(s.channelId), JSON.stringify(s), 'EX', TTL_S);
    this.realtime.emit(rooms.channel(s.channelId), 'space:state', s);
    return s;
  }

  /** Liga/desliga luminária, lareira ou fliperama do ambiente do servidor (vale para todos da chamada). */
  async toggle(userId: string, channelId: string, itemId: string, on: boolean): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const { layout } = await this.load(serverId);
    const item = layout.items.find((i) => i.id === itemId);
    if (!item || !(SPACE_TOGGLE_KINDS as readonly string[]).includes(item.kind))
      throw new BadRequestException('essa peça não liga nem desliga');
    const prev = await this.loadSession(channelId);
    const toggles = { ...(prev?.toggles ?? {}), [itemId]: on };
    return this.publishSession({
      channelId,
      serverId,
      screen: prev?.screen ?? null,
      toggles,
      ...(prev?.scores ? { scores: prev.scores } : {}),
      ...(prev?.board ? { board: prev.board } : {}),
      ...(prev?.race ? { race: prev.race } : {}),
      ...(prev?.matches ? { matches: prev.matches } : {}),
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
    });
  }

  async setScreen(userId: string, channelId: string, screen: SpaceScreen | null): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    if (screen?.kind === 'stream') {
      const target = await this.voice.stateOf(screen.userId);
      if (!target || target.channelId !== channelId) throw forbidden('essa pessoa não está na chamada');
    }
    const prev = await this.loadSession(channelId);
    return this.publishSession({
      channelId,
      serverId,
      screen,
      ...(prev?.toggles ? { toggles: prev.toggles } : {}),
      ...(prev?.scores ? { scores: prev.scores } : {}),
      ...(prev?.board ? { board: prev.board } : {}),
      ...(prev?.race ? { race: prev.race } : {}),
      ...(prev?.matches ? { matches: prev.matches } : {}),
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
    });
  }

  // ---------- posições ----------
  private async peers(userId: string, channelId: string): Promise<string[] | null> {
    const hit = this.calls.get(userId);
    if (hit && hit.channelId === channelId && Date.now() - hit.at < CALL_CACHE_MS) return hit.peers;
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId || !s.serverId) {
      this.calls.delete(userId);
      return null;
    }
    const peers = (await this.r.smembers(`voice:channel:${channelId}`)).filter((u) => u !== userId);
    this.calls.set(userId, { channelId, peers, at: Date.now() });
    if (this.calls.size > 5000) this.calls.clear();
    return peers;
  }

  /** última posição de cada um (memória, ~segundos): usada pelo x1 para decidir golpes */
  private readonly poses = new Map<string, SpaceMove & { at: number }>();
  /** avisado quando alguém sai do espaço (o x1 dá a luta por perdida) */
  onLeave: ((userId: string) => void) | null = null;

  poseOf(userId: string, maxAgeMs = 2000): (SpaceMove & { at: number }) | null {
    const p = this.poses.get(userId);
    return p && Date.now() - p.at <= maxAgeMs ? p : null;
  }

  async move(userId: string, m: SpaceMove) {
    const peers = await this.peers(userId, m.channelId);
    if (peers) {
      this.poses.set(userId, { ...m, at: Date.now() });
      if (this.poses.size > 5000) this.poses.clear();
    }
    if (!peers?.length) return;
    this.realtime.emitVolatile(peers.map(rooms.user), 'space:moved', { ...m, userId });
  }

  /** bola de uma arena: repassa só para quem está na chamada (quem tocou por último manda) */
  async ball(userId: string, b: SpaceBall) {
    const peers = await this.peers(userId, b.channelId);
    if (!peers?.length) return;
    this.realtime.emitVolatile(peers.map(rooms.user), 'space:ball', { ...b, by: userId });
  }

  /** gunfight: tiro, acerto, morte e renascer, repassados só para quem está na chamada. Só o tiro (efeito) é volátil:
   * acerto, morte, renascer e recomeço mudam o placar e não podem se perder num tiroteio. */
  async gun(userId: string, g: SpaceGun) {
    const peers = await this.peers(userId, g.channelId);
    if (!peers?.length) return;
    const to = peers.map(rooms.user);
    if (g.kind === 'fire') this.realtime.emitVolatile(to, 'space:gun', { ...g, sender: userId });
    else this.realtime.emit(to, 'space:gun', { ...g, sender: userId });
  }

  /** sinuca: bolas e vez, repassadas só para quem está na chamada */
  async pool(userId: string, p: SpacePool) {
    const peers = await this.peers(userId, p.channelId);
    if (!peers?.length) return;
    this.realtime.emitVolatile(peers.map(rooms.user), 'space:pool', { ...p, by: userId });
  }

  /** corrida: qualquer um na chamada larga (contagem para todos); recomeçar zera as chegadas */
  async raceStart(userId: string, channelId: string): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const prev = await this.loadSession(channelId);
    const base: SpaceSession = prev ?? { channelId, serverId, screen: null, updatedBy: null, revision: 0 };
    // quem está na pista agora (e quem largou) corre; quem não chegar até o fechamento fica como DNF
    const racers = new Set([userId]);
    for (const u of await this.r.smembers(`voice:channel:${channelId}`)) {
      const p = this.poseOf(u, POSE_FRESH_MS);
      if (p?.channelId === channelId && p.zone === 7) racers.add(u);
    }
    const race = { startAt: Date.now() + RACE_COUNTDOWN_MS, laps: RACE_LAPS, results: [], racers: [...racers] };
    const pending = this.timers.get(`${channelId}:race`);
    if (pending) clearTimeout(pending);
    this.timers.delete(`${channelId}:race`);
    return this.publishSession({ ...base, race, updatedBy: userId, revision: base.revision + 1 });
  }

  /** chegada: uma por pessoa; o tempo precisa caber no relógio do servidor e ser plausível */
  async raceFinish(userId: string, channelId: string, ms: number): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const loaded = await this.loadSession(channelId);
    if (!loaded?.race) throw new BadRequestException('nenhuma corrida em andamento');
    const now = Date.now();
    const prev = this.settle(loaded, now);
    const race = prev.race!;
    // fechada: quem chega depois fica como DNF (a sessão volta como está)
    if (race.closed) return prev === loaded ? prev : this.publishSession(prev);
    const elapsed = now - race.startAt;
    if (ms < race.laps * RACE_MIN_LAP_MS || ms > elapsed + 3000) throw new BadRequestException('tempo inválido');
    if (race.results.some((r) => r.userId === userId)) return prev;
    const results = [...race.results, { userId, ms }].sort((a, b) => a.ms - b.ms);
    const racers = [...new Set([...(race.racers ?? []), userId])];
    // o 1º chegou: a corrida fecha daqui a 30 s; todos chegaram: fecha já
    const endsAt = race.endsAt ?? now + RACE_CLOSE_MS;
    const all = racers.every((u) => results.some((r) => r.userId === u));
    const next = all
      ? { ...race, results, racers, endsAt, closed: true, dnf: [] }
      : { ...race, results, racers, endsAt };
    if (!all) this.wakeAt(channelId, 'race', endsAt);
    return this.publishSession({
      ...prev,
      serverId,
      race: next,
      updatedBy: userId,
      revision: prev.revision + 1,
    });
  }

  /** último ponto de cada arena: um mesmo lance detectado por dois apps não conta duas vezes */
  private readonly lastScore = new Map<string, number>();

  async score(
    userId: string,
    channelId: string,
    zone: number,
    side: 'a' | 'b',
    points: number,
    by?: string,
    teams?: { a: number; b: number },
  ): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const loaded = await this.loadSession(channelId);
    const k = `${channelId}:${zone}`;
    const now = Date.now();
    const base: SpaceSession = loaded
      ? this.settle(loaded, now)
      : { channelId, serverId, screen: null, updatedBy: null, revision: 0 };
    const key = String(zone);
    const match = isMatchZone(zone) ? base.matches?.[key] : undefined;
    // partida com alvo: ponto só vale em jogo (antes do VAI, esperando o Jogar ou depois do fim, não conta)
    if (match && matchPhase(match, now) !== 'playing') return base === loaded ? base : this.publishSession(base);
    if (now - (this.lastScore.get(k) ?? 0) < 1500) return base;
    this.lastScore.set(k, now);
    if (this.lastScore.size > 2000) this.lastScore.clear();
    const scores = { ...(base.scores ?? {}) };
    const cur = scores[key] ?? { a: 0, b: 0 };
    const score = { ...cur, [side]: Math.min(999, cur[side] + points) };
    scores[key] = score;
    // classificação: só conta para quem está na mesma chamada, e não no treino (um lado vazio)
    const board = { ...(base.board ?? {}) };
    const seen = await this.teamsIn(channelId, zone);
    const count = seen.known ? seen : teams;
    const practice = !!count && (count.a === 0 || count.b === 0);
    if (by && !practice) {
      const st = await this.voice.stateOf(by);
      if (st?.channelId === channelId) {
        const z = { ...(board[key] ?? {}) };
        z[by] = Math.min(9999, (z[by] ?? 0) + points);
        board[key] = z;
      }
    }
    let matches = base.matches;
    if (match && isMatchZone(zone)) {
      const w = matchWinner(zone, score, now - match.startAt);
      matches = {
        ...matches,
        [key]: w ? { phase: 'ended', startAt: match.startAt, winner: w, endedAt: now } : { ...match, phase: 'playing' },
      };
    }
    return this.publishSession({
      ...base,
      scores,
      board,
      ...(matches ? { matches } : {}),
      updatedBy: userId,
      revision: base.revision + 1,
    });
  }

  /** Jogar/Revanche: zera e abre a contagem de 3 s para todos; no meio de uma partida não faz nada */
  async matchStart(userId: string, channelId: string, zone: number): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    if (!isMatchZone(zone)) throw new BadRequestException('essa arena não tem partida');
    const loaded = await this.loadSession(channelId);
    const now = Date.now();
    const base: SpaceSession = loaded
      ? this.settle(loaded, now)
      : { channelId, serverId, screen: null, updatedBy: null, revision: 0 };
    const key = String(zone);
    const phase = matchPhase(base.matches?.[key], now);
    if (phase === 'countdown' || phase === 'playing') return base === loaded ? base : this.publishSession(base);
    const startAt = now + MATCH_COUNTDOWN_MS;
    this.lastScore.delete(`${channelId}:${zone}`);
    const time = MATCH_RULES[zone].timeMs;
    if (time !== null) this.wakeAt(channelId, `match:${zone}`, startAt + time);
    return this.publishSession({
      ...base,
      scores: { ...(base.scores ?? {}), [key]: { a: 0, b: 0 } },
      board: { ...(base.board ?? {}), [key]: {} },
      matches: { ...(base.matches ?? {}), [key]: { phase: 'countdown', startAt } },
      updatedBy: userId,
      revision: base.revision + 1,
    });
  }

  /** Zerar: só com a partida parada (esperando ou encerrada); no meio da partida devolve a sessão sem mudar nada */
  async resetScore(userId: string, channelId: string, zone: number): Promise<SpaceSession> {
    const serverId = await this.requireInCall(userId, channelId);
    const loaded = await this.loadSession(channelId);
    const now = Date.now();
    const base: SpaceSession = loaded
      ? this.settle(loaded, now)
      : { channelId, serverId, screen: null, updatedBy: null, revision: 0 };
    const key = String(zone);
    const match = isMatchZone(zone) ? base.matches?.[key] : undefined;
    const phase = matchPhase(match, now);
    if (match && (phase === 'countdown' || phase === 'playing'))
      return base === loaded ? base : this.publishSession(base);
    const scores = { ...(base.scores ?? {}), [key]: { a: 0, b: 0 } };
    const board = { ...(base.board ?? {}), [key]: {} };
    const matches = isMatchZone(zone)
      ? { ...(base.matches ?? {}), [key]: { phase: 'idle' as const, startAt: now } }
      : base.matches;
    return this.publishSession({
      ...base,
      scores,
      board,
      ...(matches ? { matches } : {}),
      updatedBy: userId,
      revision: base.revision + 1,
    });
  }

  async leave(userId: string, channelId: string) {
    const peers = await this.peers(userId, channelId);
    this.calls.delete(userId);
    this.poses.delete(userId);
    this.onLeave?.(userId);
    if (peers?.length) this.realtime.emit(peers.map(rooms.user), 'space:left', { channelId, userId });
  }
}

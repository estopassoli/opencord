import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  nickKeyOf,
  type AuthResponse,
  type InstanceInfo,
  type LoginRequest,
  type Me,
  type RegisterRequest,
  type TokenPair,
} from '@opencord/contracts';
import { joinAllServers, Prisma } from '@opencord/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { randomToken, sha256, TokenService } from './token.service.js';

// Argon2id (algorithm 2) com parâmetros OWASP (m=19 MiB, t=2, p=1).
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_S = 15 * 60;

export interface ClientInfo {
  deviceId?: string | undefined;
  userAgent?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class AuthService {
  /** Hash real calculado uma vez: equaliza o tempo de resposta quando o e-mail não existe. */
  private readonly dummyHash = hash(randomToken(16), ARGON);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly realtime: RealtimeService,
  ) {}

  toMe(u: {
    id: string;
    email: string | null;
    username: string;
    displayName: string;
    avatarKey: string | null;
    passwordHash: string | null;
    createdAt: Date;
    isInstanceAdmin?: boolean;
  }): Me {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      avatarKey: u.avatarKey,
      hasAccount: u.passwordHash !== null,
      createdAt: u.createdAt.toISOString(),
      isInstanceAdmin: u.isInstanceAdmin ?? false,
    };
  }

  instanceInfo(): InstanceInfo {
    return {
      name: this.cfg.INSTANCE_NAME,
      guestJoin: this.cfg.GUEST_JOIN_ENABLED,
      requiresAccessCode: Boolean(this.cfg.INSTANCE_ACCESS_CODE),
      youtubeSearch: Boolean(this.cfg.YOUTUBE_API_KEY),
    };
  }

  private checkAccessCode(code: string | undefined) {
    const expected = this.cfg.INSTANCE_ACCESS_CODE;
    if (!expected) return;
    const a = Buffer.from(code ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('código de acesso incorreto');
  }

  /** Limite de novas identidades (apelido ou conta) por IP por hora. */
  private async limitNewIdentity(ip: string | undefined) {
    const key = `guest:ip:${sha256(ip ?? 'unknown')}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, 3600);
    if (count > this.cfg.GUEST_JOIN_PER_IP_HOUR) {
      throw new HttpException('muitas identidades criadas a partir deste endereço; tente mais tarde', 429);
    }
  }

  /**
   * Cria uma identidade (ADR-0007) e a coloca em TODOS os servidores (servidores abertos, sem convite).
   * Sem senha = identidade presa ao dispositivo; com senha = conta (login de qualquer dispositivo).
   */
  private async createIdentity(
    data: { nickname: string; passwordHash: string | null; email: string | null; via: 'nickname' | 'account' },
    client: ClientInfo,
    deviceId: string | undefined,
  ): Promise<AuthResponse> {
    const nickKey = nickKeyOf(data.nickname);
    const existing = await this.prisma.user.findUnique({ where: { nickKey }, select: { passwordHash: true } });
    if (existing) {
      throw new ConflictException(
        existing.passwordHash ? 'esse apelido tem conta: entre com a senha' : 'esse apelido já está em uso',
      );
    }
    const base =
      nickKey
        .replace(/[^a-z0-9_.]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'user';
    try {
      const { user, serverIds } = await this.prisma.$transaction(async (tx) => {
        let username = base.length >= 2 ? base : `${base}_x`;
        if (await tx.user.findUnique({ where: { username }, select: { id: true } })) {
          username = `${username.slice(0, 24)}_${randomBytes(3).toString('hex')}`;
        }
        const user = await tx.user.create({
          data: { username, displayName: data.nickname, nickKey, email: data.email, passwordHash: data.passwordHash },
        });
        const serverIds = await joinAllServers(tx, user.id);
        for (const serverId of serverIds) {
          await tx.auditLog.create({
            data: { actorId: user.id, serverId, action: 'member.join', targetId: user.id, metadata: { via: data.via } },
          });
        }
        return { user, serverIds };
      });
      for (const s of serverIds) await this.realtime.memberJoined(s, user.id);
      const tokens = await this.issueSession(user.id, randomUUID(), {
        ...client,
        deviceId: deviceId ?? client.deviceId,
      });
      return { user: this.toMe(user), tokens };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
        throw new ConflictException(target.includes('email') ? 'e-mail já em uso' : 'esse apelido já está em uso');
      }
      throw e;
    }
  }

  /** Entrar só com apelido (sem conta). */
  async guestJoin(
    dto: { nickname: string; accessCode?: string | undefined; deviceId?: string | undefined },
    client: ClientInfo,
  ): Promise<AuthResponse> {
    if (!this.cfg.GUEST_JOIN_ENABLED)
      throw new ForbiddenException('entrada só com apelido está desativada nesta instância');
    this.checkAccessCode(dto.accessCode);
    await this.limitNewIdentity(client.ip);
    return this.createIdentity(
      { nickname: dto.nickname, passwordHash: null, email: null, via: 'nickname' },
      client,
      dto.deviceId,
    );
  }

  /** Criar conta (opcional): apelido + senha, e-mail opcional. Sem convite. */
  async register(dto: RegisterRequest, client: ClientInfo): Promise<AuthResponse> {
    this.checkAccessCode(dto.accessCode);
    await this.limitNewIdentity(client.ip);
    const passwordHash = await hash(dto.password, ARGON);
    const email = dto.email?.trim().toLowerCase() ?? null;
    return this.createIdentity(
      { nickname: dto.nickname as string, passwordHash, email, via: 'account' },
      client,
      dto.deviceId,
    );
  }

  /** Transforma a identidade só com apelido em conta, mantendo usuário, servidores e histórico. */
  async claim(userId: string, dto: { password: string; email?: string | undefined }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) throw new BadRequestException('esta identidade já tem conta');
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hash(dto.password, ARGON), email: dto.email?.trim().toLowerCase() ?? null },
      });
      return this.toMe(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('e-mail já em uso');
      throw e;
    }
  }

  /** Troca de apelido com a mesma regra de unicidade. */
  async rename(userId: string, nickname: string) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { displayName: nickname, nickKey: nickKeyOf(nickname) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('esse apelido já está em uso');
      throw e;
    }
  }

  /** Login de conta: `login` é o apelido ou o e-mail. */
  async login(dto: LoginRequest, client: ClientInfo): Promise<AuthResponse> {
    const login = dto.login.trim();
    const failKey = `login:fail:${sha256(nickKeyOf(login))}`;
    const fails = Number((await this.redis.client.get(failKey)) ?? 0);
    if (fails >= LOGIN_MAX_FAILS) throw new UnauthorizedException('muitas tentativas; tente mais tarde');
    const user = login.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: login.toLowerCase() } })
      : await this.prisma.user.findUnique({ where: { nickKey: nickKeyOf(login) } });
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!user || !user.passwordHash || !ok || user.disabledAt) {
      await this.redis.client.multi().incr(failKey).expire(failKey, LOGIN_WINDOW_S).exec();
      throw new UnauthorizedException('apelido/e-mail ou senha incorretos');
    }
    await this.redis.client.del(failKey);
    const tokens = await this.issueSession(user.id, randomUUID(), {
      ...client,
      deviceId: dto.deviceId ?? client.deviceId,
    });
    return { user: this.toMe(user), tokens };
  }

  private async issueSession(userId: string, familyId: string, client: ClientInfo): Promise<TokenPair> {
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_SECONDS * 1000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        deviceId: client.deviceId ?? null,
        userAgent: client.userAgent?.slice(0, 256) ?? null,
        expiresAt: refreshExpiresAt,
      },
    });
    const access = await this.tokens.signAccess(userId, session.id);
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  /**
   * Rotação: cada refresh token é de uso único. Reapresentar um token já rotacionado
   * indica roubo → revoga a família inteira (todas as sessões derivadas).
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!session) throw new UnauthorizedException('refresh inválido');
    if (session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException('sessão encerrada');
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(session.familyId, 'refresh_reuse');
      throw new UnauthorizedException('refresh reutilizado; sessões revogadas');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { disabledAt: true } });
    if (!user || user.disabledAt) throw new UnauthorizedException('conta desativada');
    return this.issueSession(session.userId, session.familyId, {
      ...client,
      deviceId: session.deviceId ?? client.deviceId,
    });
  }

  async logout(sessionId: string): Promise<void> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { familyId: true } });
    if (s) await this.revokeFamily(s.familyId, 'logout');
  }

  async revokeFamily(familyId: string, reason: string) {
    const sessions = await this.prisma.session.findMany({ where: { familyId }, select: { id: true, userId: true } });
    await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    this.tokens.invalidateCache(sessions.map((s) => s.id));
    for (const s of sessions) this.realtime.disconnectSession(s.userId, s.id, reason);
  }

  async revokeAllForUser(userId: string, reason: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    this.tokens.invalidateCache(sessions.map((s) => s.id));
    for (const s of sessions) this.realtime.disconnectSession(userId, s.id, reason);
  }

  async changePassword(userId: string, current: string, next: string, keepSessionId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) throw new BadRequestException('esta identidade entra só com apelido e não tem senha');
    if (!(await verify(user.passwordHash, current).catch(() => false)))
      throw new BadRequestException('senha atual incorreta');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(next, ARGON) } });
    const others = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, NOT: { id: keepSessionId } },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { revokedAt: new Date() },
    });
    this.tokens.invalidateCache(others.map((o) => o.id));
  }
}

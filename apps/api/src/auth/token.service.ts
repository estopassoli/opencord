import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { BOT_TOKEN_PREFIX } from '@opencord/contracts';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';
import type { AuthUser } from '../common/auth.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const ISSUER = 'opencord';
const AUDIENCE = 'opencord-api';

/** Sessão de bot (ADR-0032): `bot:<id do Bot>`. Não existe na tabela Session, então quem consulta por id ignora. */
const BOT_SESSION_PREFIX = 'bot:';
export const botSessionId = (botId: string) => `${BOT_SESSION_PREFIX}${botId}`;
export const isBotSession = (sessionId: string) => sessionId.startsWith(BOT_SESSION_PREFIX);
/** id do Bot a partir da sessão (null para sessão de pessoa). */
export const botIdOf = (sessionId: string) =>
  isBotSession(sessionId) ? sessionId.slice(BOT_SESSION_PREFIX.length) : null;

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  /** Cache curto de sessões válidas para não consultar o banco em toda requisição. */
  private readonly sessionCache = new Map<string, number>();
  /** Tokens de bot válidos, por hash: evita a consulta ao banco a cada requisição do bot. */
  private readonly botCache = new Map<string, { auth: AuthUser; until: number }>();
  /** Última gravação de lastSeenAt por bot: no máximo uma por minuto. */
  private readonly botSeen = new Map<string, number>();
  private static readonly CACHE_MS = 5000;
  private static readonly SEEN_MS = 60_000;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.key = new TextEncoder().encode(cfg.JWT_ACCESS_SECRET);
  }

  async signAccess(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.cfg.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  /** Valida assinatura, expiração e se a sessão (família) não foi revogada. Tokens `ocb_…` são de bot. */
  async authenticate(token: string): Promise<AuthUser> {
    if (token.startsWith(BOT_TOKEN_PREFIX)) return this.authenticateBot(token);
    let sub: string | undefined;
    let sid: unknown;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      sub = payload.sub;
      sid = payload.sid;
    } catch {
      throw new UnauthorizedException('token inválido ou expirado');
    }
    if (!sub || typeof sid !== 'string') throw new UnauthorizedException('token inválido');
    const cached = this.sessionCache.get(sid);
    if (cached && cached > Date.now()) return { userId: sub, sessionId: sid };
    const session = await this.prisma.session.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, user: { select: { disabledAt: true } } },
    });
    if (!session || session.userId !== sub || session.revokedAt || session.user.disabledAt) {
      this.sessionCache.delete(sid);
      throw new UnauthorizedException('sessão encerrada');
    }
    this.sessionCache.set(sid, Date.now() + TokenService.CACHE_MS);
    return { userId: sub, sessionId: sid };
  }

  /** Token de bot (ADR-0032): só o SHA-256 está no banco; o usuário do bot vira o `userId` como qualquer pessoa. */
  private async authenticateBot(token: string): Promise<AuthUser> {
    const hash = sha256(token);
    const cached = this.botCache.get(hash);
    if (cached && cached.until > Date.now()) {
      this.touchBot(botIdOf(cached.auth.sessionId) ?? '');
      return cached.auth;
    }
    const bot = await this.prisma.bot.findUnique({
      where: { tokenHash: hash },
      select: { id: true, userId: true, user: { select: { disabledAt: true } } },
    });
    if (!bot || bot.user.disabledAt) {
      this.botCache.delete(hash);
      throw new UnauthorizedException('token de bot inválido');
    }
    const auth: AuthUser = { userId: bot.userId, sessionId: botSessionId(bot.id) };
    this.botCache.set(hash, { auth, until: Date.now() + TokenService.CACHE_MS });
    this.touchBot(bot.id);
    return auth;
  }

  /** `lastSeenAt` sem bloquear a requisição e no máximo uma vez por minuto por bot. */
  private touchBot(botId: string) {
    const now = Date.now();
    const last = this.botSeen.get(botId) ?? 0;
    if (now - last < TokenService.SEEN_MS) return;
    this.botSeen.set(botId, now);
    // updateMany: um bot apagado entre a autenticação e a gravação não vira erro
    void this.prisma.bot
      .updateMany({ where: { id: botId }, data: { lastSeenAt: new Date(now) } })
      .catch(() => undefined);
  }

  /** Das sessões informadas, as que ainda valem (não revogadas, conta ativa). Para revalidar sockets abertos. */
  async stillValid(sessionIds: string[]): Promise<Set<string>> {
    if (!sessionIds.length) return new Set();
    const botIds = sessionIds.map(botIdOf).filter((id): id is string => id !== null);
    const personIds = sessionIds.filter((id) => !isBotSession(id));
    const valid = new Set<string>();
    if (personIds.length) {
      const rows = await this.prisma.session.findMany({
        where: { id: { in: personIds }, revokedAt: null, user: { disabledAt: null } },
        select: { id: true },
      });
      for (const r of rows) valid.add(r.id);
    }
    if (botIds.length) {
      // sessão de bot vale enquanto o Bot existir (token regenerado = Bot com outro hash, mesmo id) e a conta ativa
      const bots = await this.prisma.bot.findMany({
        where: { id: { in: botIds }, user: { disabledAt: null } },
        select: { id: true },
      });
      for (const b of bots) valid.add(botSessionId(b.id));
    }
    return valid;
  }

  invalidateCache(sessionIds: string[]) {
    for (const id of sessionIds) {
      this.sessionCache.delete(id);
      if (!isBotSession(id)) continue;
      for (const [hash, entry] of this.botCache) if (entry.auth.sessionId === id) this.botCache.delete(hash);
    }
  }
}

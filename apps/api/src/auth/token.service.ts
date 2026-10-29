import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';
import type { AuthUser } from '../common/auth.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const ISSUER = 'opencord';
const AUDIENCE = 'opencord-api';

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  /** Cache curto de sessões válidas para não consultar o banco em toda requisição. */
  private readonly sessionCache = new Map<string, number>();
  private static readonly CACHE_MS = 5000;

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

  /** Valida assinatura, expiração e se a sessão (família) não foi revogada. */
  async authenticate(token: string): Promise<AuthUser> {
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

  invalidateCache(sessionIds: string[]) {
    for (const id of sessionIds) this.sessionCache.delete(id);
  }
}

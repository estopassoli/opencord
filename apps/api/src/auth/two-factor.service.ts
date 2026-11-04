import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { sha256 } from './token.service.js';

const STEP_S = 30;
const DIGITS = 6;
const RECOVERY_COUNT = 10;
const PENDING_TTL_S = 10 * 60;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s), o que os apps autenticadores usam por padrão */
export function totpAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

const nowStep = () => Math.floor(Date.now() / 1000 / STEP_S);

/** passo em que o código bate (aceita o anterior e o seguinte, relógio do celular adiantado/atrasado) ou null */
export function matchStep(secret: Buffer, code: string, around = nowStep()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const step of [around, around - 1, around + 1]) {
    const a = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(a, Buffer.from(code))) return step;
  }
  return null;
}

const recoveryCode = () => {
  const raw = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
};
const normRecovery = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Verificação em duas etapas (ADR-0046): TOTP de app autenticador + códigos de recuperação. O segredo fica cifrado
 * (AES-256-GCM, chave derivada do JWT_ACCESS_SECRET); os códigos de recuperação só em hash.
 */
@Injectable()
export class TwoFactorService {
  private readonly key: Buffer;

  constructor(
    @Inject(APP_CONFIG) cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', cfg.JWT_ACCESS_SECRET, 'opencord', 'totp-secret-v1', 32));
  }

  private seal(secret: Buffer): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(secret), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  private open(sealed: string): Buffer {
    const [v, iv, tag, enc] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || !enc) throw new Error('segredo em formato desconhecido');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]);
  }

  private async requirePassword(userId: string, password: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, username: true, totpEnabledAt: true },
    });
    if (!u.passwordHash)
      throw new BadRequestException('crie uma senha na conta antes de ligar a verificação em duas etapas');
    if (!(await verify(u.passwordHash, password).catch(() => false))) throw new BadRequestException('senha incorreta');
    return u;
  }

  /** passo 1: gera o segredo (pendente por 10 min) para ler no app autenticador */
  async setup(userId: string, password: string) {
    const u = await this.requirePassword(userId, password);
    if (u.totpEnabledAt) throw new ConflictException('a verificação em duas etapas já está ligada');
    const secret = base32Encode(randomBytes(20));
    await this.redis.client.set(`2fa:pending:${userId}`, secret, 'EX', PENDING_TTL_S);
    const label = encodeURIComponent(`OpenCord:${u.username}`);
    return {
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=OpenCord&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`,
    };
  }

  /** passo 2: confere o primeiro código e liga; devolve os códigos de recuperação (só agora, em claro) */
  async enable(userId: string, code: string) {
    const pending = await this.redis.client.get(`2fa:pending:${userId}`);
    if (!pending) throw new BadRequestException('comece de novo: a configuração expirou');
    const step = matchStep(base32Decode(pending), code);
    if (step === null) throw new BadRequestException('código incorreto; confira o relógio do celular e tente de novo');
    const codes = Array.from({ length: RECOVERY_COUNT }, recoveryCode);
    const done = await this.prisma.user.updateMany({
      where: { id: userId, totpEnabledAt: null },
      data: {
        totpSecret: this.seal(base32Decode(pending)),
        totpEnabledAt: new Date(),
        totpLastStep: BigInt(step),
        totpRecoveryHashes: codes.map((c) => sha256(normRecovery(c))),
      },
    });
    await this.redis.client.del(`2fa:pending:${userId}`);
    if (!done.count) throw new ConflictException('a verificação em duas etapas já está ligada');
    return { recoveryCodes: codes };
  }

  async disable(userId: string, password: string, code: string) {
    await this.requirePassword(userId, password);
    if (!(await this.check(userId, code))) throw new BadRequestException('código incorreto');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] },
    });
  }

  async regenerateRecovery(userId: string, password: string, code: string) {
    await this.requirePassword(userId, password);
    if (!(await this.check(userId, code))) throw new BadRequestException('código incorreto');
    const codes = Array.from({ length: RECOVERY_COUNT }, recoveryCode);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpRecoveryHashes: codes.map((c) => sha256(normRecovery(c))) },
    });
    return { recoveryCodes: codes };
  }

  /**
   * Confere um código do app (uma vez por passo de 30 s) ou de recuperação (gasto ao usar). Atômico: dois pedidos
   * com o mesmo código não passam os dois.
   */
  async check(userId: string, code: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true, totpRecoveryHashes: true },
    });
    if (!u?.totpEnabledAt || !u.totpSecret) return false;
    if (/^\d{6}$/.test(code)) {
      const step = matchStep(this.open(u.totpSecret), code);
      if (step === null) return false;
      const ok = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
        data: { totpLastStep: BigInt(step) },
      });
      return ok.count === 1;
    }
    const h = sha256(normRecovery(code));
    if (!u.totpRecoveryHashes.includes(h)) return false;
    const rest = u.totpRecoveryHashes.filter((x) => x !== h);
    const ok = await this.prisma.user.updateMany({
      where: { id: userId, totpRecoveryHashes: { has: h } },
      data: { totpRecoveryHashes: rest },
    });
    return ok.count === 1;
  }
}

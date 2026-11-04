import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { Prisma } from '@opencord/db';
import { PrismaService } from '../common/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { TwoFactorService } from './two-factor.service.js';

/** E-mail da conta (ADR-0047): definir/trocar (com a senha) e confirmar por código. */
@Injectable()
export class AccountEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async set(userId: string, email: string, password: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, email: true, twoFactorEmailAt: true },
    });
    if (!u.passwordHash) throw new BadRequestException('crie uma senha na conta antes');
    if (!(await verify(u.passwordHash, password).catch(() => false))) throw new BadRequestException('senha incorreta');
    const next = email.trim().toLowerCase();
    if (next === u.email) return;
    // trocar o e-mail com a segunda etapa por e-mail ligada deixaria a pessoa sem o código
    if (u.twoFactorEmailAt) throw new BadRequestException('desligue a verificação por e-mail antes de trocar o e-mail');
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { email: next, emailVerifiedAt: null } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('esse e-mail já é usado por outra conta');
      throw e;
    }
  }

  async sendVerification(userId: string) {
    if (!this.mail.enabled) throw new BadRequestException('esta instância não envia e-mail');
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!u.email) throw new BadRequestException('adicione um e-mail antes');
    if (u.emailVerifiedAt) throw new BadRequestException('o e-mail já está confirmado');
    await this.twoFactor.sendEmailCode(userId, u.email, 'verify');
  }

  async verify(userId: string, code: string) {
    if (!(await this.twoFactor.checkEmailCode(userId, 'verify', code)))
      throw new BadRequestException('código incorreto ou vencido');
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }
}

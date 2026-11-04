import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { systemUserIds } from '../common/serialize.js';

/**
 * Usuário reservado: o cadastro deriva o nome do apelido e tira "_" do começo (auth.service), então ninguém chega a
 * um nome que começa com "_" por conta própria.
 */
export const SYSTEM_USERNAME = '_opencord';

/**
 * Conta de avisos do OpenCord (ADR-0045): manda DMs automáticas (ex.: ideia recusada no quadro). Fica suspensa (não
 * entra, não recebe pedido de amizade nem DM aberta por gente) e a DM com ela não aceita resposta.
 */
@Injectable()
export class SystemUserService implements OnModuleInit {
  private readonly log = new Logger('Avisos');
  private id: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensure().catch((e: unknown) => this.log.warn(`conta de avisos indisponível: ${String(e)}`));
  }

  /** id da conta, criando na primeira vez */
  async ensure(): Promise<string> {
    // confere a cada uso (é raro): a linha pode ter sumido (ex.: banco recriado)
    if (this.id && (await this.prisma.user.count({ where: { id: this.id } }))) return this.id;
    if (this.id) systemUserIds.delete(this.id);
    this.id = null;
    const found = await this.prisma.user.findUnique({
      where: { username: SYSTEM_USERNAME },
      select: { id: true, passwordHash: true, email: true, isBot: true },
    });
    // nunca transforma uma conta de gente na conta de avisos
    if (found && (found.passwordHash || found.email || !found.isBot))
      throw new Error(`o nome ${SYSTEM_USERNAME} pertence a outra conta`);
    const u = await this.prisma.user.upsert({
      where: { username: SYSTEM_USERNAME },
      update: {},
      create: {
        username: SYSTEM_USERNAME,
        displayName: 'OpenCord',
        isBot: true,
        verified: true,
        disabledAt: new Date(),
      },
      select: { id: true },
    });
    this.id = u.id;
    systemUserIds.add(u.id);
    return u.id;
  }

  isSystem(userId: string) {
    return systemUserIds.has(userId);
  }
}

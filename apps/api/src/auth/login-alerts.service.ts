import { Injectable, Logger } from '@nestjs/common';
import { describeDevice, maskIp } from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { SystemNoticesService } from '../system/system-notices.service.js';
import { MailService } from '../mail/mail.service.js';

/** texto do aviso de acesso novo (Markdown do chat) */
export function newLoginText(o: { device: string; ip: string | null; at: Date }) {
  const when = o.at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  return [
    `**Novo acesso à sua conta**`,
    `Sua conta entrou de um aparelho que ainda não conhecíamos:`,
    `- **Aparelho:** ${o.device}`,
    ...(o.ip ? [`- **IP:** ${o.ip}`] : []),
    `- **Quando:** ${when} (horário de Brasília)`,
    `Foi você? Então está tudo certo. Se não foi, troque a senha agora e encerre esse aparelho em **Configurações → Minha conta → Aparelhos conectados**. Para mais proteção, ligue a verificação em duas etapas.`,
    `_Mensagem automática: esta conversa não recebe respostas._`,
  ].join('\n');
}

/** versão do aviso para e-mail (texto puro) */
export function newLoginEmail(o: { device: string; ip: string | null; at: Date }) {
  const when = o.at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  return [
    'Sua conta do OpenCord entrou de um aparelho que ainda não conhecíamos.',
    [`Aparelho: ${o.device}`, ...(o.ip ? [`IP: ${o.ip}`] : []), `Quando: ${when} (horário de Brasília)`].join('\n'),
    'Foi você? Então está tudo certo. Se não foi, troque a senha agora e encerre esse aparelho em Configurações → Minha conta → Aparelhos conectados.',
  ].join('\n\n');
}

/**
 * Aviso de login de aparelho novo (ADR-0046): quando uma conta com senha entra de um aparelho (deviceId) que nunca
 * teve sessão dela, a conta de avisos do OpenCord manda uma DM. O primeiro login da conta não avisa.
 */
@Injectable()
export class LoginAlertsService {
  private readonly log = new Logger('Avisos de acesso');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: SystemNoticesService,
    private readonly mail: MailService,
  ) {}

  /** chame ANTES de criar a sessão nova; devolve a função que manda o aviso (ou null se não precisa) */
  async prepare(
    userId: string,
    client: { deviceId?: string | undefined; userAgent?: string | undefined; ip?: string | undefined },
  ) {
    if (!client.deviceId) return null;
    const [any, sameDevice] = await Promise.all([
      this.prisma.session.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.session.findFirst({ where: { userId, deviceId: client.deviceId }, select: { id: true } }),
    ]);
    if (!any || sameDevice) return null;
    const info = { device: describeDevice(client.userAgent), ip: maskIp(client.ip), at: new Date() };
    const text = newLoginText(info);
    // e-mail confirmado (ADR-0047): o aviso também vai por e-mail
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    const to = this.mail.enabled && u?.email && u.emailVerifiedAt ? u.email : null;
    return () => {
      void this.notices.notify(userId, text).catch((e: unknown) => this.log.warn(`aviso não enviado: ${String(e)}`));
      if (to)
        void this.mail
          .send({ to, subject: 'Novo acesso à sua conta do OpenCord', text: newLoginEmail(info) })
          .catch(() => undefined);
    };
  }
}

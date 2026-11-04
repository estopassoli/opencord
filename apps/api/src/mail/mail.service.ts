import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface Mail {
  to: string;
  subject: string;
  /** texto puro; o HTML é montado a partir dele (parágrafos, código em destaque) */
  text: string;
  /** código grande em destaque no HTML (ex.: 123456) */
  code?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML simples e legível em qualquer cliente de e-mail, sem imagens nem CSS externo */
export function mailHtml(m: Mail): string {
  const paras = m.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const code = m.code
    ? `<p style="margin:8px 0 22px;font:700 30px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:6px">${esc(m.code)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f6;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d22"><div style="max-width:480px;margin:0 auto;padding:28px;background:#fff;border-radius:12px"><p style="margin:0 0 18px;font-weight:800;font-size:18px">OpenCord</p>${code}${paras}<p style="margin:22px 0 0;font-size:12px;color:#6b6b76">Mensagem automática: não responda este e-mail.</p></div></body></html>`;
}

/**
 * Envio de e-mail (ADR-0047): API do Resend (RESEND_API_KEY) ou SMTP (SMTP_HOST), nessa ordem. Sem nenhum dos dois,
 * `enabled` é false e `send` recusa.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('E-mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.transport = cfg.SMTP_HOST
      ? createTransport({
          host: cfg.SMTP_HOST,
          port: cfg.SMTP_PORT,
          secure: cfg.SMTP_SECURE ?? cfg.SMTP_PORT === 465,
          ...(cfg.SMTP_USER ? { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' } } : {}),
        })
      : null;
  }

  private get resend() {
    return this.cfg.RESEND_API_KEY ?? null;
  }

  get enabled() {
    return this.resend !== null || this.transport !== null;
  }

  async send(m: Mail): Promise<void> {
    if (this.resend) return this.sendResend(m, this.resend);
    if (!this.transport) throw new ServiceUnavailableException('esta instância não envia e-mail');
    try {
      await this.transport.sendMail({
        from: this.cfg.MAIL_FROM ?? this.cfg.SMTP_USER,
        to: m.to,
        subject: m.subject,
        text: m.code ? `${m.code}\n\n${m.text}` : m.text,
        html: mailHtml(m),
      });
    } catch (e) {
      this.log.error(`envio falhou: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('não foi possível enviar o e-mail agora; tente de novo em instantes');
    }
  }

  private async sendResend(m: Mail, key: string) {
    const r = await fetch(`${this.cfg.RESEND_API_URL.replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.cfg.RESEND_FROM ?? this.cfg.MAIL_FROM,
        to: [m.to],
        subject: m.subject,
        text: m.code ? `${m.code}\n\n${m.text}` : m.text,
        html: mailHtml(m),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e: unknown) => {
      this.log.error(`Resend fora do ar: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!r?.ok) {
      if (r) this.log.error(`Resend recusou (${r.status}): ${(await r.text().catch(() => '')).slice(0, 300)}`);
      throw new ServiceUnavailableException('não foi possível enviar o e-mail agora; tente de novo em instantes');
    }
  }
}

/** a***@g***.com */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${user.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

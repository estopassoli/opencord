import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** IP do cliente: o do cabeçalho CLIENT_IP_HEADER (se configurado e válido) ou `req.ip`. */
    clientIp: string;
  }
}

/**
 * IP do cliente para limites por IP e registro de sessão.
 *
 * Atrás de um proxy que reescreve o X-Forwarded-For com o próprio IP (ex.: Cloudflare -> Traefik sem
 * trustedIPs), `req.ip` é o do proxy e todos os usuários dividiriam os mesmos limites. Com `header`
 * (ex.: `cf-connecting-ip`), usa o IP que o proxy de borda informa. Só configure quando TODO o tráfego
 * passa por esse proxy: quem alcançar a API direto pode forjar o cabeçalho.
 */
export function clientIp(req: FastifyRequest, header?: string): string {
  if (header) {
    const raw = req.headers[header];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && isIP(value)) return value;
  }
  return req.ip;
}

import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DiscordImportPreview, ServerDetail } from '@opencord/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DiscordTemplate, parseTemplateCode, planImport, type ImportPlan } from './discord-template.js';
import { ServersService } from './servers.service.js';

/** Resposta máxima aceita da API de modelos (estrutura de servidor, sem mensagens: alguns KB na prática). */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/**
 * Busca um modelo de servidor na API pública do Discord e cria a estrutura equivalente (ver discord-template.ts).
 * Só a URL configurada (DISCORD_API_URL, oficial por padrão) é chamada, com o código validado: sem SSRF.
 */
@Injectable()
export class DiscordImportService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly servers: ServersService,
  ) {}

  private async plan(link: string): Promise<ImportPlan> {
    const code = parseTemplateCode(link);
    if (!code) throw new BadRequestException('link de modelo inválido: use o link discord.new/… do modelo do servidor');
    let res: Response;
    try {
      res = await fetch(`${this.cfg.DISCORD_API_URL}/guilds/templates/${encodeURIComponent(code)}`, {
        headers: { accept: 'application/json', 'user-agent': 'OpenCord (self-hosted; server template import)' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('não foi possível falar com o Discord agora; tente de novo');
    }
    if (res.status === 404)
      throw new NotFoundException('modelo não encontrado: o link pode ter expirado ou sido apagado');
    if (res.status === 429) throw new ServiceUnavailableException('o Discord pediu para esperar; tente em instantes');
    if (!res.ok) throw new BadGatewayException(`o Discord respondeu ${res.status}`);
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > MAX_BYTES) throw new BadGatewayException('modelo grande demais');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new BadGatewayException('modelo grande demais');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BadGatewayException('resposta do Discord em formato inesperado');
    }
    const parsed = DiscordTemplate.safeParse(json);
    if (!parsed.success) throw new BadGatewayException('modelo em formato inesperado');
    return planImport(parsed.data);
  }

  async preview(link: string): Promise<DiscordImportPreview> {
    const p = await this.plan(link);
    const groups = [
      { key: null as string | null, name: null as string | null },
      ...p.categories.map((c) => ({ key: c.key as string | null, name: c.name as string | null })),
    ];
    return {
      name: p.name,
      roles: p.roles.map((r) => ({ name: r.name, color: r.color })),
      categories: groups
        .map((g) => ({
          name: g.name,
          channels: p.channels.filter((c) => c.categoryKey === g.key).map((c) => ({ name: c.name, kind: c.kind })),
        }))
        .filter((g) => g.name !== null || g.channels.length > 0),
      textChannels: p.channels.filter((c) => c.kind === 'text').length,
      voiceChannels: p.channels.filter((c) => c.kind === 'voice').length,
      skipped: p.skipped,
    };
  }

  async import(userId: string, link: string): Promise<ServerDetail> {
    const p = await this.plan(link);
    return this.servers.createFromPlan(userId, p, 'discord-template');
  }
}

import { AUTOCOMPLETE_TIMEOUT_MS } from '@opencord/contracts';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  PUBLIC_API_URL: z.url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Interface no navegador (ex.: https://app.opencord.pro): links de convite apontam para `<url>/invite/<código>`. */
  PUBLIC_APP_URL: z.url().optional(),
  TRUST_PROXY: bool.default(false),
  /** Cabeçalho com o IP real do cliente, posto pelo proxy de borda (ex.: `cf-connecting-ip`). Ver common/client-ip.ts. */
  CLIENT_IP_HEADER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : undefined),
    z
      .string()
      .regex(/^[a-z0-9-]+$/, 'CLIENT_IP_HEADER deve ser um nome de cabeçalho')
      .optional(),
  ),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres'),
  ATTACHMENT_URL_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(60 * 60 * 24 * 30),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/uploads'),
  /** Driver `s3` (ex.: Cloudflare R2 — endpoint https://<account-id>.r2.cloudflarestorage.com, região `auto`). */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(25 * 1024 * 1024),
  RATE_LIMIT_DISABLED: bool.default(false),
  /** Requisições por minuto/IP nas rotas de credenciais (/auth/*). Padrão 10; aumente só em dev/E2E. */
  AUTH_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
  /** Entrada só com apelido (ADR-0007). */
  GUEST_JOIN_ENABLED: bool.default(true),
  /** Código opcional exigido para entrar com apelido (recomendado se a instância estiver exposta na internet). */
  INSTANCE_ACCESS_CODE: z.string().max(128).optional(),
  INSTANCE_NAME: z.string().max(100).default('OpenCord'),
  /** Download do app desktop para quem acessa pelo navegador: link externo OU pasta servida pela API. */
  DESKTOP_DOWNLOAD_URL: z.url().optional(),
  DOWNLOADS_DIR: z.string().optional(),
  /** API pública do Discord para modelos de servidor (importação). Só muda em testes. */
  DISCORD_API_URL: z.url().default('https://discord.com/api/v10'),
  /** Ponte com o Slack (ADR-0033): token do bot (xoxb-…) e segredo de assinatura do app do Slack da instância. */
  SLACK_BOT_TOKEN: z.string().min(10).optional(),
  SLACK_SIGNING_SECRET: z.string().min(10).optional(),
  /** Só muda em testes (stub local). */
  SLACK_API_URL: z.url().default('https://slack.com/api'),
  /** Chave da YouTube Data API v3: liga a pesquisa no "Assistir juntos" (sem ela, só por link). */
  YOUTUBE_API_KEY: z.string().min(10).optional(),
  /** Catálogo do Spotify na atividade Música (client credentials; só metadados, o áudio não vem do Spotify). */
  SPOTIFY_CLIENT_ID: z.string().min(10).optional(),
  SPOTIFY_CLIENT_SECRET: z.string().min(10).optional(),
  /**
   * Envio de e-mail (ADR-0047): confirmar e-mail, código da verificação em duas etapas e aviso de acesso novo.
   * Sem SMTP_HOST, a instância não manda e-mail (o app esconde as opções).
   */
  /** Resend (API HTTPS): tem prioridade sobre o SMTP quando definida */
  RESEND_API_KEY: z.string().min(8).optional(),
  /** remetente no Resend, ex.: "OpenCord <naoresponda@opencord.pro>" (domínio validado no Resend) */
  RESEND_FROM: z.string().min(3).optional(),
  /** Só muda em testes (stub local). */
  RESEND_API_URL: z.url().default('https://api.resend.com'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true = TLS direto (porta 465); false = STARTTLS quando o servidor oferece (587) */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  /** remetente, ex.: "OpenCord <naoresponda@opencord.pro>" */
  MAIL_FROM: z.string().min(3).optional(),
  /**
   * Seletor de GIFs (ADR-0044): chave de app do KLIPY (partner panel). Não é segredo: pelos termos do KLIPY as buscas
   * saem do app de cada pessoa, então a chave vai ao cliente em InstanceInfo.gifs. Sem ela, o botão GIF não aparece.
   */
  KLIPY_APP_KEY: z.string().min(8).optional(),
  KLIPY_API_URL: z.url().default('https://api.klipy.com'),
  /** Só mudam em testes (stubs locais). */
  SPOTIFY_API_URL: z.url().default('https://api.spotify.com/v1'),
  SPOTIFY_ACCOUNTS_URL: z.url().default('https://accounts.spotify.com'),
  YOUTUBE_API_URL: z.url().default('https://www.googleapis.com/youtube/v3'),
  /**
   * Referenciador mandado nas chamadas à Data API do YouTube. Chave com restrição por site (referenciador HTTP)
   * recusa chamadas do servidor sem ele. Padrão: PUBLIC_APP_URL, ou a origem do app em CORS_ORIGINS.
   */
  YOUTUBE_API_REFERER: z.url().optional(),
  /** Busca título/canal do vídeo no oEmbed público do YouTube (desligado nos testes: sem rede externa). */
  YOUTUBE_OEMBED: bool.default(true),
  /** Limite de novos apelidos por IP por hora. */
  GUEST_JOIN_PER_IP_HOUR: z.coerce.number().int().min(1).default(10),
  VOICE_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
  /** Moderação por IA (ADR-0036): chave da Anthropic liga o recurso; modelo barato por padrão (Claude Haiku 5.5). */
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  MODERATION_AI_MODEL: z.string().min(3).default('claude-haiku-5-5'),
  /** Só muda em testes (stub local da API da Anthropic). */
  MODERATION_AI_BASE_URL: z.url().optional(),
  /** Tempo máximo esperando a IA; passou, a mensagem é liberada (ou retida com FAIL_CLOSED). */
  MODERATION_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(12_000),
  /** true: IA indisponível retém a mensagem em vez de liberar. */
  MODERATION_AI_FAIL_CLOSED: bool.default(false),
  /** Bots oficiais (ADR-0037): segredo compartilhado com o container dos bots; sem ele a rota de claim não existe. */
  OFFICIAL_BOTS_SECRET: z.string().min(16).optional(),
  /** Retenção (ADR-0039), em dias: sessões encerradas/expiradas, auditoria, casos de moderação decididos e bloqueios de dispositivo. */
  RETENTION_SESSIONS_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  RETENTION_AUDIT_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  RETENTION_MODERATION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  RETENTION_DEVICE_BANS_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  /** Autocompletar de comandos de bot (ADR-0034): quanto a API espera o bot antes de devolver sem sugestões. */
  AUTOCOMPLETE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(AUTOCOMPLETE_TIMEOUT_MS),
});
export type AppConfig = z.infer<typeof ConfigSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `VAR=` vazio (como no .env.example) = não definida; senão campos opcionais como URLs falham na validação
  const defined = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = ConfigSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.STORAGE_DRIVER === 's3') {
    const missing = (['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter(
      (k) => !cfg[k],
    );
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 exige ${missing.join(', ')}`);
  }
  if (cfg.NODE_ENV === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'ATTACHMENT_URL_SECRET'] as const) {
      if (cfg[k].startsWith('dev-only')) throw new Error(`${k} de desenvolvimento não pode ser usado em produção`);
    }
    if (cfg.LIVEKIT_API_SECRET === 'secret') throw new Error('LIVEKIT_API_SECRET de desenvolvimento em produção');
    // Os placeholders do repositório (infra/docker/livekit.yaml) são públicos: com eles qualquer um assina
    // tokens LiveKit e webhooks. Recusa também o devkey e segredos curtos.
    for (const k of ['JWT_ACCESS_SECRET', 'ATTACHMENT_URL_SECRET', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const) {
      if (/CHANGE_ME/i.test(cfg[k])) throw new Error(`${k} ainda é o placeholder do repositório; não use em produção`);
    }
    if (cfg.LIVEKIT_API_KEY === 'devkey') throw new Error('LIVEKIT_API_KEY de desenvolvimento em produção');
    if (cfg.LIVEKIT_API_SECRET.length < 32)
      throw new Error('LIVEKIT_API_SECRET precisa de ao menos 32 caracteres em produção');
  }
  return cfg;
}

/** Cabeçalhos das chamadas do servidor à Data API do YouTube (referenciador do app; ver YOUTUBE_API_REFERER). */
export function youtubeApiHeaders(cfg: AppConfig): Record<string, string> {
  const origins = cfg.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\//.test(o));
  const ref =
    cfg.YOUTUBE_API_REFERER ?? cfg.PUBLIC_APP_URL ?? origins.find((o) => /^https:\/\/app\./.test(o)) ?? origins[0];
  if (!ref) return {};
  return { referer: ref.endsWith('/') ? ref : `${ref}/` };
}

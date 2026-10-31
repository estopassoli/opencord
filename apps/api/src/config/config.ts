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
  /** Chave da YouTube Data API v3: liga a pesquisa no "Assistir juntos" (sem ela, só por link). */
  YOUTUBE_API_KEY: z.string().min(10).optional(),
  /** Busca título/canal do vídeo no oEmbed público do YouTube (desligado nos testes: sem rede externa). */
  YOUTUBE_OEMBED: bool.default(true),
  /** Limite de novos apelidos por IP por hora. */
  GUEST_JOIN_PER_IP_HOUR: z.coerce.number().int().min(1).default(10),
  VOICE_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
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

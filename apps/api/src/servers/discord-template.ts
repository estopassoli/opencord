/**
 * Importação da ESTRUTURA de um servidor do Discord a partir de um modelo de servidor oficial (link discord.new/…,
 * gerado pelo dono em Configurações do servidor → Modelo de servidor). Usa a API pública documentada do Discord
 * (`GET /guilds/templates/{code}`), sem login nem token. O modelo traz só categorias, canais, cargos e permissões:
 * mensagens, membros, emojis e arquivos não fazem parte dele e não são importados (ver docs/DECISIONS.md).
 *
 * Tudo aqui é puro (sem rede/banco) para ser testado com modelos fictícios.
 */
import { Permission } from '@opencord/contracts';
import { z } from 'zod';

/** Aceita discord.new/CODE, discord.com/template/CODE (ou discordapp.com) ou só o código. */
export function parseTemplateCode(input: string): string | null {
  const s = input.trim();
  const m =
    /^(?:https?:\/\/)?(?:www\.)?(?:discord\.new\/|(?:canary\.|ptb\.)?discord(?:app)?\.com\/template\/)([A-Za-z0-9-]{2,64})\/?(?:[?#].*)?$/i.exec(
      s,
    ) ?? /^([A-Za-z0-9-]{2,64})$/.exec(s);
  return m ? m[1]! : null;
}

// bits de permissão do Discord (documentação pública) → equivalentes do OpenCord
const D = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
} as const;

const MAP: [bigint, number][] = [
  [D.VIEW_CHANNEL, Permission.VIEW_CHANNEL],
  [D.SEND_MESSAGES, Permission.SEND_MESSAGES],
  [D.MANAGE_MESSAGES, Permission.MANAGE_MESSAGES],
  [D.ATTACH_FILES, Permission.ATTACH_FILES],
  [D.ADD_REACTIONS, Permission.ADD_REACTIONS],
  [D.READ_MESSAGE_HISTORY, Permission.READ_HISTORY],
  [D.MENTION_EVERYONE, Permission.MENTION_EVERYONE],
  [D.CONNECT, Permission.CONNECT],
  [D.SPEAK, Permission.SPEAK],
  // no Discord, "Vídeo" cobre câmera e transmissão de tela
  [D.STREAM, Permission.VIDEO | Permission.STREAM],
  [D.MUTE_MEMBERS, Permission.MUTE_MEMBERS],
  [D.MOVE_MEMBERS, Permission.MOVE_MEMBERS],
  [D.KICK_MEMBERS | D.BAN_MEMBERS, Permission.KICK_MEMBERS],
  [D.MANAGE_CHANNELS, Permission.MANAGE_CHANNELS],
  [D.MANAGE_ROLES, Permission.MANAGE_ROLES],
  [D.MANAGE_GUILD, Permission.MANAGE_SERVER],
  [D.VIEW_AUDIT_LOG, Permission.VIEW_AUDIT_LOG],
  [D.ADMINISTRATOR, Permission.ADMINISTRATOR],
];

/** Bitset de permissões do Discord (string decimal, pode passar de 2^53) → bitset do OpenCord. */
export function mapPermissions(bits: string): number {
  let b: bigint;
  try {
    b = BigInt(bits);
  } catch {
    return 0;
  }
  let out = 0;
  for (const [d, o] of MAP) if (b & d) out |= o;
  return out;
}

const Snowflake = z.union([z.number(), z.string()]).transform(String);
const Overwrite = z.object({
  id: Snowflake,
  type: z.union([z.number(), z.string()]).transform(Number),
  allow: z.union([z.string(), z.number()]).transform(String),
  deny: z.union([z.string(), z.number()]).transform(String),
});
const TemplateChannel = z.object({
  id: Snowflake,
  type: z.number(),
  name: z.string(),
  position: z.number().default(0),
  topic: z.string().nullish(),
  parent_id: Snowflake.nullish(),
  permission_overwrites: z.array(Overwrite).max(100).default([]),
});
const TemplateRole = z.object({
  id: Snowflake,
  name: z.string(),
  color: z.number().default(0),
  permissions: z.union([z.string(), z.number()]).transform(String),
});
export const DiscordTemplate = z.object({
  code: z.string(),
  name: z.string(),
  serialized_source_guild: z.object({
    name: z.string(),
    roles: z.array(TemplateRole).max(500),
    channels: z.array(TemplateChannel).max(1000),
  }),
});
export type DiscordTemplate = z.infer<typeof DiscordTemplate>;

/** Tipos de canal do Discord: texto (0), anúncios (5), fórum (15), mídia (16) → texto; voz (2), palco (13) → voz. */
const TEXT_TYPES = new Set([0, 5, 15, 16]);
const VOICE_TYPES = new Set([2, 13]);
const CATEGORY = 4;

export interface ImportPlan {
  name: string;
  everyonePermissions: number;
  roles: { key: string; name: string; color: string | null; permissions: number }[];
  categories: { key: string; name: string }[];
  channels: {
    name: string;
    kind: 'text' | 'voice';
    topic: string | null;
    categoryKey: string | null;
    overrides: { roleKey: string; allow: number; deny: number }[];
  }[];
  /** itens que não cabem no OpenCord: tipos de canal desconhecidos, permissões por membro, excesso sobre os limites */
  skipped: number;
}

export const LIMITS = { channels: 200, roles: 99, categories: 50 } as const;

const clip = (s: string, n: number) => s.trim().slice(0, n) || '-';
const hex = (c: number) => (c > 0 ? `#${(c & 0xffffff).toString(16).padStart(6, '0')}` : null);

/** Converte o modelo do Discord no plano do que será criado no OpenCord. */
export function planImport(t: DiscordTemplate): ImportPlan {
  const g = t.serialized_source_guild;
  let skipped = 0;
  // @everyone: no modelo tem o id 0 (ou o nome); os demais na ordem do modelo (da base para o topo)
  const everyone = g.roles.find((r) => r.id === '0') ?? g.roles.find((r) => r.name === '@everyone');
  const others = g.roles.filter((r) => r !== everyone);
  if (others.length > LIMITS.roles) skipped += others.length - LIMITS.roles;
  const roles = others.slice(0, LIMITS.roles).map((r) => ({
    key: r.id,
    name: clip(r.name, 64),
    color: hex(r.color),
    permissions: mapPermissions(r.permissions),
  }));
  const roleKeys = new Set(roles.map((r) => r.key));

  const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
  const cats = g.channels.filter((c) => c.type === CATEGORY).sort(byPos);
  if (cats.length > LIMITS.categories) skipped += cats.length - LIMITS.categories;
  const categories = cats.slice(0, LIMITS.categories).map((c) => ({ key: c.id, name: clip(c.name, 64) }));
  const catKeys = new Set(categories.map((c) => c.key));

  const channels: ImportPlan['channels'] = [];
  // dentro de cada categoria, texto antes de voz (como o Discord mostra), cada grupo pela posição
  const usable = g.channels
    .filter((c) => c.type !== CATEGORY)
    .filter((c) => {
      const ok = TEXT_TYPES.has(c.type) || VOICE_TYPES.has(c.type);
      if (!ok) skipped++;
      return ok;
    })
    .sort((a, b) => Number(VOICE_TYPES.has(a.type)) - Number(VOICE_TYPES.has(b.type)) || byPos(a, b));
  for (const c of usable) {
    if (channels.length >= LIMITS.channels) {
      skipped++;
      continue;
    }
    const overrides: ImportPlan['channels'][number]['overrides'] = [];
    for (const o of c.permission_overwrites) {
      // 0 = cargo, 1 = membro (membros não vêm no modelo)
      const key = o.id === everyone?.id ? 'everyone' : o.id;
      if (o.type !== 0 || (key !== 'everyone' && !roleKeys.has(key))) {
        skipped++;
        continue;
      }
      overrides.push({ roleKey: key, allow: mapPermissions(o.allow), deny: mapPermissions(o.deny) });
    }
    channels.push({
      name: clip(c.name, 64),
      kind: VOICE_TYPES.has(c.type) ? 'voice' : 'text',
      topic: c.topic ? c.topic.slice(0, 1024) : null,
      categoryKey: c.parent_id && catKeys.has(c.parent_id) ? c.parent_id : null,
      overrides,
    });
  }
  return {
    name: clip(g.name || t.name, 100),
    everyonePermissions: everyone ? mapPermissions(everyone.permissions) : 0,
    roles,
    categories,
    channels,
    skipped,
  };
}

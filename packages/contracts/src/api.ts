import { z } from 'zod';
import { Permission } from './permissions.js';

// ---------- Primitivos ----------
export const Id = z.uuid();
export const IsoDate = z.iso.datetime({ offset: true });
export const Username = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9_.]+$/, 'use letras minúsculas, números, "_" ou "."');
export const DisplayName = z.string().trim().min(1).max(64);
export const Password = z.string().min(10).max(256);

export const ApiError = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- Apelido (entrada sem conta, ADR-0007) ----------
/** Normalização usada para unicidade: minúsculas, sem acentos, espaços colapsados. */
export function nickKeyOf(nick: string): string {
  return nick
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export const Nickname = z
  .string()
  .trim()
  .min(2, 'mínimo de 2 caracteres')
  .max(32, 'máximo de 32 caracteres')
  .refine((s) => !/[\p{Cc}\p{Cf}<>@#`]/u.test(s), 'caracteres não permitidos (< > @ # `)')
  .refine((s) => /[\p{L}\p{N}]/u.test(s), 'use ao menos uma letra ou número')
  .transform((s) => s.replace(/\s+/g, ' '));

/** Aviso em faixa no topo do app, definido pelo super admin (ADR-0020). */
export const ANNOUNCEMENT_TONES = ['info', 'warning', 'success'] as const;
export const InstanceAnnouncement = z.object({
  text: z.string().trim().min(1).max(280),
  tone: z.enum(ANNOUNCEMENT_TONES),
});
export type InstanceAnnouncement = z.infer<typeof InstanceAnnouncement>;

export const InstanceInfo = z.object({
  name: z.string(),
  guestJoin: z.boolean(),
  requiresAccessCode: z.boolean(),
  /** pesquisa do YouTube no "Assistir juntos" (servidor com YOUTUBE_API_KEY) */
  youtubeSearch: z.boolean().default(false),
  /** false: novos cadastros fechados pelo super admin (quem já tem conta continua entrando) */
  registrationOpen: z.boolean().default(true),
  announcement: InstanceAnnouncement.nullable().default(null),
  /** limite de upload em vigor (bytes) */
  uploadMaxBytes: z.number().int().positive().optional(),
  /** moderação por IA em vigor (chave configurada e ligada pelo super admin; ADR-0036) */
  aiModeration: z.boolean().default(false),
  /** quem criou o OpenCord (dono do servidor oficial): selo de verificado em qualquer servidor */
  creatorId: z.string().uuid().nullable().default(null),
  /** contato para pedidos sobre dados pessoais (LGPD, ADR-0039), definido no painel; null = só o canal do projeto */
  privacyContact: z.string().nullable().default(null),
});
export type InstanceInfo = z.infer<typeof InstanceInfo>;

/** Aceite dos Termos de uso e da Política de privacidade, com a declaração de 13 anos ou mais (ADR-0039). */
export const AcceptTerms = z.literal(true, {
  error: 'é preciso ter 13 anos ou mais e aceitar os Termos de uso e a Política de privacidade',
});

export const GuestJoinRequest = z.object({
  nickname: Nickname,
  accessCode: z.string().max(128).optional(),
  deviceId: z.string().min(1).max(128).optional(),
  acceptTerms: AcceptTerms,
});
export type GuestJoinRequest = z.input<typeof GuestJoinRequest>;

// ---------- Auth ----------
/** Criar conta (opcional, ADR-0007): apelido + senha; e-mail é opcional (apenas para contato/recuperação futura). */
export const RegisterRequest = z.object({
  nickname: Nickname,
  password: Password,
  email: z.email().max(254).optional(),
  accessCode: z.string().max(128).optional(),
  deviceId: z.string().min(1).max(128).optional(),
  acceptTerms: AcceptTerms,
});
export type RegisterRequest = z.input<typeof RegisterRequest>;

/** Excluir a própria conta (ADR-0039): quem tem senha confirma com ela. */
export const DeleteAccountRequest = z.object({ password: z.string().max(256).optional() });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

/** Login de conta: `login` aceita o apelido ou o e-mail. */
export const LoginRequest = z.object({
  login: z.string().trim().min(2).max(254),
  password: z.string().min(1).max(256),
  deviceId: z.string().min(1).max(128).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Transforma a identidade só com apelido em conta (mantém o mesmo usuário, servidores e histórico). */
export const ClaimAccountRequest = z.object({
  password: Password,
  email: z.email().max(254).optional(),
});
export type ClaimAccountRequest = z.infer<typeof ClaimAccountRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(512) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const TokenPair = z.object({
  accessToken: z.string(),
  accessExpiresAt: IsoDate,
  refreshToken: z.string(),
  refreshExpiresAt: IsoDate,
});
export type TokenPair = z.infer<typeof TokenPair>;

// ---------- Usuários ----------
export const UserPublic = z.object({
  id: Id,
  username: Username,
  displayName: DisplayName,
  avatarKey: z.string().nullable(),
  /** identidade de um webhook de entrada (ADR-0030): mostra o selo "APP" */
  bot: z.boolean().default(false),
  /** super admin da instância (ADR-0013): fica acima de todo mundo nos servidores; ninguém expulsa, silencia ou muda os cargos */
  isInstanceAdmin: z.boolean().optional(),
  /** selo de verificado no perfil, dado pelo super admin (só vem quando é verdade) */
  verified: z.boolean().optional(),
});
export type UserPublic = z.infer<typeof UserPublic>;

/** `email` é null para quem entrou só com apelido (sem login por senha). */
/** `hasAccount=false`: entrou só com apelido (identidade presa ao dispositivo). */
export const Me = UserPublic.extend({
  email: z.email().nullable(),
  hasAccount: z.boolean(),
  createdAt: IsoDate,
  /** false: ainda não aceitou os Termos/Política atuais (conta anterior à ADR-0039); o app pede antes de seguir */
  termsAccepted: z.boolean().default(true),
});
export type Me = z.infer<typeof Me>;

export const AuthResponse = z.object({ user: Me, tokens: TokenPair });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const UpdateProfileRequest = z.object({ displayName: Nickname.optional() });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ---------- Servidores, cargos, canais ----------
export const ChannelKind = z.enum(['text', 'voice', 'board']);
export type ChannelKind = z.infer<typeof ChannelKind>;

export const Role = z.object({
  id: Id,
  serverId: Id,
  name: z.string().min(1).max(64),
  position: z.number().int(),
  permissions: z.number().int().nonnegative(),
  color: z.string().nullable(),
  isEveryone: z.boolean(),
});
export type Role = z.infer<typeof Role>;

export const Category = z.object({ id: Id, serverId: Id, name: z.string().min(1).max(64), position: z.number().int() });
export type Category = z.infer<typeof Category>;

export const PermissionOverrideDto = z.object({
  subjectType: z.enum(['role', 'member']),
  subjectId: Id,
  allow: z.number().int().nonnegative(),
  deny: z.number().int().nonnegative(),
});
export type PermissionOverrideDto = z.infer<typeof PermissionOverrideDto>;

export const Channel = z.object({
  id: Id,
  serverId: Id,
  categoryId: Id.nullable(),
  kind: ChannelKind,
  name: z.string().min(1).max(64),
  topic: z.string().max(1024).nullable(),
  position: z.number().int(),
  /** Permissões efetivas do usuário atual neste canal. */
  myPermissions: z.number().int().nonnegative(),
  overrides: z.array(PermissionOverrideDto),
  /** canal de texto que alimenta um quadro kanban: cada mensagem nova vira card nele (ADR-0017) */
  boardId: Id.nullable().default(null),
  /** canal de voz "criador de salas": entrar nele cria uma sala temporária só sua (ADR-0029) */
  roomHub: z.boolean().default(false),
  /** sala temporária: some quando a última pessoa sai */
  temporary: z.boolean().default(false),
});
export type Channel = z.infer<typeof Channel>;

// ---------- Quadros kanban (ADR-0017) ----------
export const BoardColumn = z.enum(['new', 'triage', 'doing', 'done']);
export type BoardColumn = z.infer<typeof BoardColumn>;
export const BOARD_COLUMNS: readonly { id: BoardColumn; label: string }[] = [
  { id: 'new', label: 'Novo' },
  { id: 'triage', label: 'Em análise' },
  { id: 'doing', label: 'Em andamento' },
  { id: 'done', label: 'Resolvido' },
];

export const BoardCard = z.object({
  id: Id,
  boardId: Id,
  column: BoardColumn,
  position: z.number(),
  title: z.string(),
  body: z.string(),
  reporter: UserPublic.nullable(),
  /** mensagem de origem e o canal dela (para abrir a conversa) */
  messageId: Id.nullable(),
  sourceChannelId: Id.nullable(),
  attachments: z.number().int().nonnegative(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type BoardCard = z.infer<typeof BoardCard>;

export const CreateBoardCardRequest = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).default(''),
});
export type CreateBoardCardRequest = z.input<typeof CreateBoardCardRequest>;

/** mover (coluna e/ou posição) e editar título/descrição */
export const UpdateBoardCardRequest = z.object({
  column: BoardColumn.optional(),
  position: z.number().finite().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(4000).optional(),
});
export type UpdateBoardCardRequest = z.input<typeof UpdateBoardCardRequest>;

export const Member = z.object({
  user: UserPublic,
  roleIds: z.array(Id),
  joinedAt: IsoDate,
  nickname: z.string().nullable(),
  /** castigo (ADR-0034): até quando não pode escrever, reagir nem entrar em voz; null = sem castigo */
  timeoutUntil: IsoDate.nullable().default(null),
  /** super admin invisível (ADR-0013): só vem na própria visão; para os outros o membro nem aparece */
  hidden: z.boolean().optional(),
});
export type Member = z.infer<typeof Member>;

export const ServerSummary = z.object({
  id: Id,
  name: z.string().min(1).max(100),
  iconKey: z.string().nullable(),
  ownerId: Id,
  /** Servidor oficial da instância: aberto a todos e com selo de verificado. */
  official: z.boolean(),
  /** Selo de verificado marcado pelo super admin (o servidor continua privado). */
  verified: z.boolean().optional(),
  /** cor de destaque do servidor (#rrggbb); null = a cor de quem usa */
  accent: z.string().nullable().default(null),
  /** papel de parede da conversa (GET /wallpapers/:nome); null = sem */
  wallpaperKey: z.string().nullable().default(null),
  /** regras do servidor que a moderação por IA leva em conta (ADR-0036); só quem gerencia o servidor edita */
  aiRules: z.string().nullable().optional(),
});
export type ServerSummary = z.infer<typeof ServerSummary>;

export const ServerDetail = ServerSummary.extend({
  roles: z.array(Role),
  categories: z.array(Category),
  channels: z.array(Channel),
  members: z.array(Member),
  myPermissions: z.number().int().nonnegative(),
});
export type ServerDetail = z.infer<typeof ServerDetail>;

export const CreateServerRequest = z.object({ name: z.string().trim().min(1).max(100) });
export type CreateServerRequest = z.infer<typeof CreateServerRequest>;
/** Importação da estrutura de um servidor do Discord por link de modelo oficial (discord.new/…). */
export const DiscordImportRequest = z.object({ link: z.string().trim().min(2).max(200) });
export type DiscordImportRequest = z.infer<typeof DiscordImportRequest>;
export const DiscordImportPreview = z.object({
  name: z.string(),
  roles: z.array(z.object({ name: z.string(), color: z.string().nullable() })),
  categories: z.array(
    z.object({
      name: z.string().nullable(),
      channels: z.array(z.object({ name: z.string(), kind: z.enum(['text', 'voice']) })),
    }),
  ),
  textChannels: z.number().int(),
  voiceChannels: z.number().int(),
  /** itens sem equivalente no OpenCord (tipos de canal, permissões por membro, excesso sobre os limites) */
  skipped: z.number().int(),
});
export type DiscordImportPreview = z.infer<typeof DiscordImportPreview>;

export const UpdateServerRequest = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  /** regras para a moderação por IA (ADR-0036); '' ou null apaga */
  aiRules: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateServerRequest = z.infer<typeof UpdateServerRequest>;

export const ChannelName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((s) => s.replace(/\s+/g, '-').toLowerCase());

export const CreateChannelRequest = z.object({
  name: ChannelName,
  kind: ChannelKind,
  categoryId: Id.nullable().optional(),
  topic: z.string().max(1024).nullable().optional(),
  /** só canal de voz: criador de salas temporárias (ADR-0029) */
  roomHub: z.boolean().optional(),
});
export type CreateChannelRequest = z.input<typeof CreateChannelRequest>;

export const UpdateChannelRequest = z.object({
  name: ChannelName.optional(),
  topic: z.string().max(1024).nullable().optional(),
  categoryId: Id.nullable().optional(),
  position: z.number().int().min(0).optional(),
  overrides: z.array(PermissionOverrideDto).max(100).optional(),
  /** canal de texto: quadro kanban alimentado pelas mensagens dele (null desliga) */
  boardId: Id.nullable().optional(),
  /** canal de voz: liga/desliga o criador de salas temporárias (ADR-0029) */
  roomHub: z.boolean().optional(),
});
export type UpdateChannelRequest = z.input<typeof UpdateChannelRequest>;

export const CreateCategoryRequest = z.object({ name: z.string().trim().min(1).max(64) });
export const UpdateCategoryRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  position: z.number().int().min(0).optional(),
});

export const CreateRoleRequest = z.object({
  name: z.string().trim().min(1).max(64),
  permissions: z.number().int().nonnegative().default(0),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
});
export type CreateRoleRequest = z.input<typeof CreateRoleRequest>;
export const UpdateRoleRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  permissions: z.number().int().nonnegative().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  position: z.number().int().min(1).optional(),
});
export type UpdateRoleRequest = z.input<typeof UpdateRoleRequest>;
export const SetMemberRolesRequest = z.object({ roleIds: z.array(Id).max(50) });

// ---------- Moderação: banimento e castigo (ADR-0034) ----------
/** castigo máximo (28 dias) */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
export const ServerBan = z.object({
  serverId: Id,
  user: UserPublic,
  reason: z.string().nullable(),
  /** quem baniu (null se a conta sumiu) */
  by: UserPublic.nullable(),
  createdAt: IsoDate,
});
export type ServerBan = z.infer<typeof ServerBan>;
export const BanRequest = z.object({
  reason: z.string().trim().max(200).optional(),
  /** apaga as mensagens da pessoa das últimas N segundos (até 7 dias) */
  deleteMessageSeconds: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600)
    .default(0),
});
export type BanRequest = z.input<typeof BanRequest>;

/** PATCH /servers/:id/members/:userId (MODERATE_MEMBERS): castigo até a data (null tira) */
export const UpdateMemberRequest = z
  .object({
    timeoutUntil: IsoDate.nullable().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((m) => m.timeoutUntil !== undefined, 'nada para alterar');
export type UpdateMemberRequest = z.input<typeof UpdateMemberRequest>;

// ---------- Servidor oficial aberto + convites para os privados (ADR-0007, revisado) ----------
export const ServerDirectoryEntry = z.object({
  id: Id,
  name: z.string(),
  iconKey: z.string().nullable(),
  memberCount: z.number().int(),
  joined: z.boolean(),
});
export type ServerDirectoryEntry = z.infer<typeof ServerDirectoryEntry>;

/** Lista do super admin (ADR-0013): todos os servidores da instância. */
export const AdminServerEntry = ServerDirectoryEntry.extend({
  official: z.boolean(),
  verified: z.boolean(),
  owner: z.object({ id: Id, displayName: z.string() }),
  /** o admin participa sem aparecer para os membros */
  hidden: z.boolean().optional(),
});
export type AdminServerEntry = z.infer<typeof AdminServerEntry>;
/** POST /admin/servers/:id/join: `hidden` entra sem aparecer para os membros (registro só na auditoria global) */
export const AdminJoinRequest = z.object({ hidden: z.boolean().default(false) });
export type AdminJoinRequest = z.input<typeof AdminJoinRequest>;
/** PUT /admin/servers/:id/hidden: alterna a própria participação entre visível e invisível */
export const SetMemberHiddenRequest = z.object({ hidden: z.boolean() });
export type SetMemberHiddenRequest = z.infer<typeof SetMemberHiddenRequest>;

/** Código de convite: 10 caracteres alfanuméricos. Aceita também o link inteiro (o código é o final). */
export const INVITE_CODE = /^[A-Za-z0-9]{10}$/;
export const Invite = z.object({
  code: z.string(),
  serverId: Id,
  /** link para abrir no navegador (`PUBLIC_APP_URL/invite/<código>`); null se a instância não tem interface web */
  url: z.string().nullable(),
});
export type Invite = z.infer<typeof Invite>;
export const InvitePreview = z.object({
  code: z.string(),
  server: z.object({
    id: Id,
    name: z.string(),
    iconKey: z.string().nullable(),
    official: z.boolean(),
    verified: z.boolean().optional(),
  }),
  memberCount: z.number().int(),
  joined: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

// ---------- Embeds, componentes e modais (ADR-0034) ----------
/** emoji unicode ou nome curto (reações, botões, menus) */
export const Emoji = z.string().min(1).max(64);
/** URL http(s) curta o bastante para caber num cartão */
export const HttpUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\/\S+$/i, 'URL http(s)');
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  /** soma de título, descrição, campos, rodapé e autor */
  total: 6000,
  perMessage: 10,
} as const;
export const EmbedField = z.object({
  name: z.string().trim().min(1).max(EMBED_LIMITS.fieldName),
  value: z.string().trim().min(1).max(EMBED_LIMITS.fieldValue),
  inline: z.boolean().default(false),
});
export type EmbedField = z.infer<typeof EmbedField>;
/** Cartão rico numa mensagem (só bots e webhooks enviam; o app renderiza com barra colorida, campos, imagem…). */
export const Embed = z
  .object({
    title: z.string().trim().max(EMBED_LIMITS.title).optional(),
    description: z.string().trim().max(EMBED_LIMITS.description).optional(),
    url: HttpUrl.optional(),
    /** cor da barra lateral, `#rrggbb` */
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, 'cor #rrggbb')
      .optional(),
    fields: z.array(EmbedField).max(EMBED_LIMITS.fields).default([]),
    footer: z
      .object({ text: z.string().trim().min(1).max(EMBED_LIMITS.footer), iconUrl: HttpUrl.optional() })
      .optional(),
    image: z.object({ url: HttpUrl }).optional(),
    thumbnail: z.object({ url: HttpUrl }).optional(),
    author: z
      .object({
        name: z.string().trim().min(1).max(EMBED_LIMITS.author),
        url: HttpUrl.optional(),
        iconUrl: HttpUrl.optional(),
      })
      .optional(),
    timestamp: IsoDate.optional(),
  })
  .refine(
    (e) => Boolean(e.title || e.description || e.fields.length || e.image || e.thumbnail || e.author),
    'embed vazio',
  )
  .refine(
    (e) =>
      (e.title?.length ?? 0) +
        (e.description?.length ?? 0) +
        (e.footer?.text.length ?? 0) +
        (e.author?.name.length ?? 0) +
        e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0) <=
      EMBED_LIMITS.total,
    `embed com mais de ${EMBED_LIMITS.total} caracteres`,
  );
export type Embed = z.infer<typeof Embed>;
export type EmbedInput = z.input<typeof Embed>;

/** id que o bot escolhe para reconhecer o clique */
export const CustomId = z.string().min(1).max(100);
export const ButtonStyle = z.enum(['primary', 'secondary', 'success', 'danger', 'link']);
export type ButtonStyle = z.infer<typeof ButtonStyle>;
export const Button = z
  .object({
    type: z.literal('button'),
    style: ButtonStyle.default('secondary'),
    label: z.string().trim().max(80).optional(),
    emoji: Emoji.optional(),
    /** botões de link não têm customId; os outros precisam */
    customId: CustomId.optional(),
    url: HttpUrl.optional(),
    disabled: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.label || b.emoji), 'botão precisa de label ou emoji')
  .refine((b) => (b.style === 'link' ? Boolean(b.url) && !b.customId : Boolean(b.customId) && !b.url), {
    message: 'botão de link usa url; os outros usam customId',
  });
export type Button = z.infer<typeof Button>;
export const SelectOption = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().min(1).max(100),
  description: z.string().trim().max(100).optional(),
  emoji: Emoji.optional(),
  default: z.boolean().default(false),
});
export type SelectOption = z.infer<typeof SelectOption>;
/** `kind` string: opções fixas; user/role/channel: o app lista os do servidor */
export const SelectMenu = z
  .object({
    type: z.literal('select'),
    customId: CustomId,
    kind: z.enum(['string', 'user', 'role', 'channel']).default('string'),
    placeholder: z.string().trim().max(150).optional(),
    minValues: z.number().int().min(0).max(25).default(1),
    maxValues: z.number().int().min(1).max(25).default(1),
    options: z.array(SelectOption).max(25).default([]),
    disabled: z.boolean().default(false),
  })
  .refine((m) => m.minValues <= m.maxValues, 'minValues > maxValues')
  .refine((m) => (m.kind === 'string' ? m.options.length > 0 : m.options.length === 0), {
    message: 'menu de texto precisa de opções; menus de usuário/cargo/canal não têm',
  })
  .refine((m) => new Set(m.options.map((o) => o.value)).size === m.options.length, 'opção repetida');
export type SelectMenu = z.infer<typeof SelectMenu>;
export const ActionRowComponent = z.discriminatedUnion('type', [Button, SelectMenu]);
export const ActionRow = z
  .object({ type: z.literal('row'), components: z.array(ActionRowComponent).min(1).max(5) })
  .refine((r) => r.components.every((c) => c.type === 'button') || r.components.length === 1, {
    message: 'linha com até 5 botões ou 1 menu',
  });
export type ActionRow = z.infer<typeof ActionRow>;
export const MAX_COMPONENT_ROWS = 5;
export const MessageComponents = z
  .array(ActionRow)
  .max(MAX_COMPONENT_ROWS)
  .refine((rows) => {
    const ids = rows.flatMap((r) => r.components.map((c) => ('customId' in c ? c.customId : null))).filter(Boolean);
    return new Set(ids).size === ids.length;
  }, 'customId repetido');
export type MessageComponents = z.infer<typeof MessageComponents>;
export type MessageComponentsInput = z.input<typeof MessageComponents>;
export const TextInput = z
  .object({
    type: z.literal('text'),
    customId: CustomId,
    label: z.string().trim().min(1).max(45),
    style: z.enum(['short', 'paragraph']).default('short'),
    placeholder: z.string().trim().max(100).optional(),
    value: z.string().max(4000).optional(),
    required: z.boolean().default(true),
    minLength: z.number().int().min(0).max(4000).optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
  })
  .refine((t) => (t.minLength ?? 0) <= (t.maxLength ?? 4000), 'minLength > maxLength');
export type TextInput = z.infer<typeof TextInput>;
export const Modal = z
  .object({
    customId: CustomId,
    title: z.string().trim().min(1).max(45),
    components: z.array(TextInput).min(1).max(5),
  })
  .refine((m) => new Set(m.components.map((c) => c.customId)).size === m.components.length, 'customId repetido');
export type Modal = z.infer<typeof Modal>;
export type ModalInput = z.input<typeof Modal>;

// ---------- Mensagens ----------
export const Attachment = z.object({
  id: Id,
  originalName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  /** URL assinada e de curta duração. */
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Attachment = z.infer<typeof Attachment>;

export const ReactionSummary = z.object({
  emoji: z.string(),
  count: z.number().int(),
  /** Em eventos broadcast é sempre false; o cliente deriva de `userIds`. */
  me: z.boolean(),
  /** Até 100 usuários que reagiram (para tooltip e cálculo de `me`). */
  userIds: z.array(z.uuid()),
});
export type ReactionSummary = z.infer<typeof ReactionSummary>;

export const MessageReplyRef = z.object({
  id: Id,
  author: UserPublic.nullable(),
  bodyPreview: z.string(),
  deleted: z.boolean(),
});

export const Message = z.object({
  id: Id,
  channelId: Id.nullable(),
  conversationId: Id.nullable(),
  author: UserPublic,
  body: z.string(),
  createdAt: IsoDate,
  editedAt: IsoDate.nullable(),
  deleted: z.boolean(),
  replyTo: MessageReplyRef.nullable(),
  reactions: z.array(ReactionSummary),
  attachments: z.array(Attachment),
  mentions: z.array(Id),
  /** quando foi fixada no canal/conversa (null = não fixada) */
  pinnedAt: IsoDate.nullable(),
  /** enquete presa à mensagem (ADR-0018) */
  poll: z
    .lazy(() => Poll)
    .nullable()
    .default(null),
  /** cargos por reação (ADR-0019): reagir com o emoji dá o cargo */
  reactionRoles: z.array(z.object({ emoji: z.string(), roleId: Id })).default([]),
  /** quantas mensagens respondem a esta (thread leve: GET /messages/:id/replies) */
  replyCount: z.number().int().nonnegative().default(0),
  /** cartões ricos (ADR-0034); só bots e webhooks enviam */
  embeds: z.array(Embed).max(EMBED_LIMITS.perMessage).default([]),
  /** botões e menus (ADR-0034); só bots enviam; clique vira interação `component` */
  components: MessageComponents.default([]),
});
export type Message = z.infer<typeof Message>;

// ---------- Cargos por reação (ADR-0019) ----------
export const MAX_REACTION_ROLES = 20;
/**
 * Bits que um cargo por reação NÃO pode ter: qualquer pessoa ganha o cargo só de reagir, então ele não pode dar
 * poder de moderação. Cargos de cor/identificação e de acesso a canais (ver, falar) podem.
 */
export const REACTION_ROLE_FORBIDDEN =
  Permission.ADMINISTRATOR |
  Permission.MANAGE_SERVER |
  Permission.MANAGE_ROLES |
  Permission.MANAGE_CHANNELS |
  Permission.MANAGE_MESSAGES |
  Permission.KICK_MEMBERS |
  Permission.BAN_MEMBERS |
  Permission.MODERATE_MEMBERS |
  Permission.MUTE_MEMBERS |
  Permission.MOVE_MEMBERS |
  Permission.VIEW_AUDIT_LOG |
  Permission.MENTION_EVERYONE;

export const SetReactionRolesRequest = z.object({
  pairs: z
    .array(z.object({ emoji: z.string().trim().min(1).max(64), roleId: Id }))
    .max(MAX_REACTION_ROLES)
    .refine((p) => new Set(p.map((x) => x.emoji)).size === p.length, 'emoji repetido'),
});
export type SetReactionRolesRequest = z.infer<typeof SetReactionRolesRequest>;

// ---------- Enquetes (ADR-0018) ----------
export const POLL_MAX_OPTIONS = 10;
/** prazos oferecidos ao criar (horas; 0 = sem prazo) */
export const POLL_DURATIONS = [0, 1, 4, 8, 24, 72, 168] as const;

export const PollOption = z.object({ id: Id, text: z.string(), votes: z.number().int().nonnegative() });
export type PollOption = z.infer<typeof PollOption>;

export const Poll = z.object({
  id: Id,
  question: z.string(),
  multiple: z.boolean(),
  endsAt: IsoDate.nullable(),
  /** encerrada (prazo vencido ou encerrada pelo autor/moderação) */
  closed: z.boolean(),
  options: z.array(PollOption),
  /** pessoas que votaram (cada uma conta uma vez, mesmo com várias opções) */
  voters: z.number().int().nonnegative(),
  /** opções em que eu votei (vazio nos eventos em tempo real: cada app guarda o próprio voto) */
  mine: z.array(Id),
});
export type Poll = z.infer<typeof Poll>;

export const CreatePollRequest = z.object({
  requestId: z.uuid(),
  question: z.string().trim().min(1).max(300),
  options: z
    .array(z.string().trim().min(1).max(80))
    .min(2)
    .max(POLL_MAX_OPTIONS)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'opções repetidas'),
  multiple: z.boolean().default(false),
  durationHours: z
    .number()
    .int()
    .refine((h) => (POLL_DURATIONS as readonly number[]).includes(h), 'prazo inválido')
    .default(24),
});
export type CreatePollRequest = z.input<typeof CreatePollRequest>;

/** substitui o meu voto (vazio = retira) */
export const VotePollRequest = z.object({ optionIds: z.array(Id).max(POLL_MAX_OPTIONS) });
export type VotePollRequest = z.infer<typeof VotePollRequest>;
/** limite de mensagens fixadas por canal ou conversa */
export const MAX_PINS = 50;

export const MessageBody = z.string().max(4000);

/** Moderação por IA (ADR-0036): veredito da IA e o que os moderadores decidiram. */
export const MODERATION_VERDICTS = ['block', 'review'] as const;
export const MODERATION_CASE_STATUSES = ['pending', 'approved', 'rejected', 'blocked'] as const;
export const ModerationCase = z.object({
  id: Id,
  serverId: Id.nullable(),
  server: z.object({ id: Id, name: z.string() }).nullable(),
  channelId: Id.nullable(),
  channelName: z.string().nullable(),
  conversationId: Id.nullable(),
  author: UserPublic,
  body: z.string(),
  attachments: z.array(Attachment),
  verdict: z.enum(MODERATION_VERDICTS),
  /** categoria curta da IA (ex.: assédio, nudez, spam, violência, ilegal, outro) */
  category: z.string().nullable(),
  /** explicação da IA, para quem modera */
  reason: z.string(),
  status: z.enum(MODERATION_CASE_STATUSES),
  reviewedBy: UserPublic.nullable(),
  reviewedAt: IsoDate.nullable(),
  reviewNote: z.string().nullable(),
  publishedMessageId: Id.nullable(),
  /** ação automática aplicada ao autor (bloqueio por conteúdo grave) */
  autoAction: z.enum(['suspended', 'suspended+device']).nullable(),
  createdAt: IsoDate,
});
export type ModerationCase = z.infer<typeof ModerationCase>;
export const ModerationCasesQuery = z.object({
  status: z.enum(MODERATION_CASE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const ModerationCasePunishment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeout'), durationMs: z.number().int().min(60_000).max(MAX_TIMEOUT_MS) }),
  z.object({
    kind: z.literal('ban'),
    deleteMessageSeconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 3600)
      .default(0),
  }),
  z.object({ kind: z.literal('kick') }),
]);
export const ReviewModerationCaseRequest = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
  /** só em reprovação, em canal de servidor */
  punishment: ModerationCasePunishment.nullable().optional(),
});
export type ReviewModerationCaseRequest = z.input<typeof ReviewModerationCaseRequest>;

export const CreateMessageRequest = z
  .object({
    requestId: z.uuid(),
    body: MessageBody.default(''),
    replyToId: Id.optional(),
    attachmentIds: z.array(Id).max(10).optional(),
    /** só bots e webhooks (ADR-0034) */
    embeds: z.array(Embed).max(EMBED_LIMITS.perMessage).optional(),
    /** só bots (ADR-0034) */
    components: MessageComponents.optional(),
  })
  .refine((m) => m.body.trim().length > 0 || (m.attachmentIds?.length ?? 0) > 0 || (m.embeds?.length ?? 0) > 0, {
    message: 'mensagem vazia',
    path: ['body'],
  });
export type CreateMessageRequest = z.input<typeof CreateMessageRequest>;

/** Só o que veio muda; `components: []` tira os botões. Texto vazio só com embeds. */
export const EditMessageRequest = z
  .object({
    body: MessageBody.optional(),
    embeds: z.array(Embed).max(EMBED_LIMITS.perMessage).optional(),
    components: MessageComponents.optional(),
  })
  .refine((m) => m.body !== undefined || m.embeds !== undefined || m.components !== undefined, 'nada para editar')
  .refine((m) => m.body === undefined || m.body.trim().length > 0 || (m.embeds?.length ?? 0) > 0, {
    message: 'mensagem vazia',
    path: ['body'],
  });
export type EditMessageRequest = z.input<typeof EditMessageRequest>;
/** apagar várias de uma vez (MANAGE_MESSAGES, ou só as próprias) */
export const BulkDeleteMessagesRequest = z.object({ messageIds: z.array(Id).min(1).max(100) });
export type BulkDeleteMessagesRequest = z.infer<typeof BulkDeleteMessagesRequest>;
export const ListMessagesQuery = z.object({
  before: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.input<typeof ListMessagesQuery>;

export const MessagePage = z.object({
  messages: z.array(Message),
  /** Cursor para página mais antiga (`before`); null quando não há mais. */
  nextBefore: z.string().nullable(),
});
export type MessagePage = z.infer<typeof MessagePage>;

/** Busca de mensagens num servidor (todos os canais que eu vejo) ou numa conversa. Palavras separadas: todas precisam aparecer. */
export const SearchMessagesQuery = z.object({
  q: z.string().trim().min(1).max(200),
  /** só neste canal (busca no servidor) */
  channelId: Id.optional(),
  authorId: Id.optional(),
  /** só mensagens com link, com arquivo ou com imagem */
  has: z.enum(['link', 'file', 'image']).optional(),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type SearchMessagesQuery = z.input<typeof SearchMessagesQuery>;
export const SearchMessagesResponse = z.object({
  messages: z.array(Message),
  /** total de resultados (para "mais resultados") */
  total: z.number().int().nonnegative(),
});
export type SearchMessagesResponse = z.infer<typeof SearchMessagesResponse>;

// ---------- Webhooks de entrada (ADR-0030) ----------
export const Webhook = z.object({
  id: Id,
  serverId: Id,
  channelId: Id,
  name: z.string(),
  createdBy: UserPublic,
  createdAt: IsoDate,
  /** link secreto para o POST */
  url: z.string(),
});
export type Webhook = z.infer<typeof Webhook>;
export const CreateWebhookRequest = z.object({ name: z.string().trim().min(1).max(64), channelId: Id });
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;
/** corpo aceito no POST do webhook: `content` (estilo Discord) ou `text` (estilo Slack) */
export const WebhookPostRequest = z
  .object({
    content: z.string().max(4000).optional(),
    text: z.string().max(4000).optional(),
  })
  .passthrough();
export const MAX_WEBHOOKS_PER_SERVER = 20;

// ---------- Bots e aplicativos (ADR-0032; comandos e interações v2 na ADR-0034) ----------
/** prefixo do token de bot (`Authorization: Bearer ocb_…`); o token em claro só aparece ao criar/regenerar */
export const BOT_TOKEN_PREFIX = 'ocb_';
export const MAX_BOTS_PER_USER = 10;
export const MAX_BOT_COMMANDS = 100;
export const MAX_COMMAND_OPTIONS = 25;
/** quanto tempo uma interação espera resposta do bot (segundos); adiada (`defer`) vale 15 min */
export const INTERACTION_TTL_S = 180;
export const INTERACTION_DEFERRED_TTL_S = 900;
/** autocompletar: o app espera o bot por até 3 s */
export const AUTOCOMPLETE_TIMEOUT_MS = 3000;
/** quanto tempo um modal aberto ou um cartão efêmero com botões aceita cliques (segundos) */
export const INTERACTION_FOLLOWUP_TTL_S = 900;
/** nome de comando/opção: minúsculas, dígitos, `_` e `-` (como os comandos de barra que a comunidade já conhece) */
export const CommandName = z
  .string()
  .regex(/^[a-z0-9_-]{1,32}$/, 'use minúsculas, dígitos, _ ou - (até 32)')
  .describe('nome de comando');
/** comando de menu de contexto (usuário/mensagem): nome livre, como "Reportar mensagem" */
export const ContextCommandName = z.string().trim().min(1).max(32);
export const BotCommandType = z.enum(['chat', 'user', 'message']);
export type BotCommandType = z.infer<typeof BotCommandType>;
export const BotCommandOptionType = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'user',
  'channel',
  'role',
  'mentionable',
]);
export type BotCommandOptionType = z.infer<typeof BotCommandOptionType>;
export const BotCommandChoice = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.union([z.string().max(100), z.number()]),
});
export type BotCommandChoice = z.infer<typeof BotCommandChoice>;
export const BotCommandOption = z
  .object({
    name: CommandName,
    description: z.string().trim().min(1).max(100),
    type: BotCommandOptionType,
    required: z.boolean().default(false),
    choices: z.array(BotCommandChoice).max(25).default([]),
    /** o bot sugere valores enquanto a pessoa digita (interação `autocomplete`); não combina com `choices` */
    autocomplete: z.boolean().default(false),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    minLength: z.number().int().min(0).max(2000).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
    /** opção `channel`: só canais destes tipos */
    channelTypes: z.array(ChannelKind).optional(),
  })
  .refine((o) => !(o.autocomplete && o.choices.length), 'autocomplete não combina com choices')
  .refine((o) => (o.minValue ?? -Infinity) <= (o.maxValue ?? Infinity), 'minValue > maxValue')
  .refine((o) => (o.minLength ?? 0) <= (o.maxLength ?? 2000), 'minLength > maxLength');
export type BotCommandOption = z.infer<typeof BotCommandOption>;
const uniqueNames = (o: { name: string }[]) => new Set(o.map((x) => x.name)).size === o.length;
/** obrigatórias primeiro: a forma posicional `/cmd a b` só funciona assim */
const requiredFirst = (o: { required: boolean }[]) =>
  o.every((x, i) => !x.required || o.slice(0, i).every((y) => y.required));
const LeafOptions = z
  .array(BotCommandOption)
  .max(MAX_COMMAND_OPTIONS)
  .default([])
  .refine(uniqueNames, 'opção repetida')
  .refine(requiredFirst, 'obrigatórias antes');
export const BotSubcommand = z.object({
  type: z.literal('subcommand'),
  name: CommandName,
  description: z.string().trim().min(1).max(100),
  options: LeafOptions,
});
export type BotSubcommand = z.infer<typeof BotSubcommand>;
export const BotSubcommandGroup = z.object({
  type: z.literal('subcommand_group'),
  name: CommandName,
  description: z.string().trim().min(1).max(100),
  options: z.array(BotSubcommand).min(1).max(MAX_COMMAND_OPTIONS).refine(uniqueNames, 'subcomando repetido'),
});
export type BotSubcommandGroup = z.infer<typeof BotSubcommandGroup>;
/** opções de um comando: ou só folhas, ou só subcomandos/grupos */
export const BotCommandOptions = z
  .array(z.union([BotSubcommandGroup, BotSubcommand, BotCommandOption]))
  .max(MAX_COMMAND_OPTIONS)
  .default([])
  .refine(uniqueNames, 'opção repetida')
  .refine((o) => {
    const subs = o.filter((x) => 'type' in x && (x.type === 'subcommand' || x.type === 'subcommand_group'));
    return subs.length === 0 || subs.length === o.length;
  }, 'não misture subcomandos com opções soltas')
  .refine(
    (o) =>
      requiredFirst(o.filter((x): x is BotCommandOption => !('type' in x) || !String(x.type).startsWith('subcommand'))),
    'obrigatórias antes',
  );
export const BotCommand = z
  .object({
    /** chat = `/comando`; user/message = menu de contexto "Apps" numa pessoa ou mensagem */
    type: BotCommandType.default('chat'),
    name: ContextCommandName,
    description: z.string().trim().max(100).default(''),
    options: BotCommandOptions,
    /** bits de `Permission` que quem usa precisa ter no servidor (null = qualquer membro que fale no canal) */
    defaultMemberPermissions: z.number().int().nonnegative().nullable().default(null),
    /** só nestes servidores (vazio = em todos em que o bot é membro) */
    guildIds: z.array(Id).max(50).default([]),
  })
  .refine((c) => c.type !== 'chat' || CommandName.safeParse(c.name).success, {
    message: 'comando de barra: use minúsculas, dígitos, _ ou - (até 32)',
    path: ['name'],
  })
  .refine((c) => c.type !== 'chat' || c.description.length > 0, {
    message: 'descrição obrigatória',
    path: ['description'],
  })
  .refine((c) => c.type === 'chat' || c.options.length === 0, {
    message: 'comandos de contexto não têm opções',
    path: ['options'],
  });
export type BotCommand = z.infer<typeof BotCommand>;
export type BotCommandInput = z.input<typeof BotCommand>;
export const Bot = z.object({
  id: Id,
  /** o usuário do bot (`bot: true`): é ele que aparece como autor, membro e presença */
  user: UserPublic,
  ownerId: Id,
  description: z.string(),
  /** aparece na lista "Adicionar bot" de qualquer servidor; privado = só pelo id */
  public: z.boolean(),
  createdAt: IsoDate,
  /** última requisição autenticada com o token (null = nunca conectou) */
  lastSeenAt: IsoDate.nullable(),
  commands: z.array(BotCommand),
});
export type Bot = z.infer<typeof Bot>;
/** devolvido só ao criar ou regenerar o token */
export const BotWithToken = Bot.extend({ token: z.string() });
export type BotWithToken = z.infer<typeof BotWithToken>;
export const CreateBotRequest = z.object({
  name: z.string().trim().min(1).max(32),
  description: z.string().trim().max(200).default(''),
  public: z.boolean().default(false),
});
export type CreateBotRequest = z.infer<typeof CreateBotRequest>;
export const UpdateBotRequest = CreateBotRequest.partial();
export type UpdateBotRequest = z.infer<typeof UpdateBotRequest>;
/** Bots oficiais (ADR-0037): o container dos bots pede o próprio token com o segredo compartilhado com a API. */
export const OfficialBotClaimRequest = z.object({
  key: z.string().regex(/^[A-Z0-9_]{2,32}$/),
  name: z.string().trim().min(1).max(32),
  description: z.string().trim().max(200).default(''),
  secret: z.string().min(16).max(256),
});
export type OfficialBotClaimRequest = z.input<typeof OfficialBotClaimRequest>;

export const SetBotCommandsRequest = z.object({
  commands: z
    .array(BotCommand)
    .max(MAX_BOT_COMMANDS)
    .refine((c) => new Set(c.map((x) => `${x.type}:${x.name}`)).size === c.length, 'comando repetido'),
});
export type SetBotCommandsRequest = z.input<typeof SetBotCommandsRequest>;
export const AddBotToServerRequest = z.object({ botId: Id });
/** comandos disponíveis num servidor (GET /servers/:id/commands): por bot membro, já filtrados por `guildIds` */
export const ServerCommands = z.object({ botId: Id, bot: UserPublic, commands: z.array(BotCommand) });
export type ServerCommands = z.infer<typeof ServerCommands>;
export const InteractionOptionValue = z.union([z.string().max(2000), z.number(), z.boolean()]);
export type InteractionOptionValue = z.infer<typeof InteractionOptionValue>;
export const InteractionType = z.enum([
  'command',
  'user_command',
  'message_command',
  'component',
  'modal',
  'autocomplete',
]);
export type InteractionType = z.infer<typeof InteractionType>;
const CommandPath = {
  command: ContextCommandName,
  subcommandGroup: CommandName.optional(),
  subcommand: CommandName.optional(),
  options: z.record(CommandName, InteractionOptionValue).default({}),
};
/**
 * Uma pessoa interage com um bot: comando de barra, comando de contexto, clique em botão/menu, envio de modal ou
 * autocompletar. `type` ausente = `command` (compatível com a v1).
 */
export const CreateInteractionRequest = z.preprocess(
  (v) => (typeof v === 'object' && v !== null && !('type' in v) ? { type: 'command', ...v } : v),
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('command'), channelId: Id, botId: Id, ...CommandPath }),
    z.object({
      type: z.literal('user_command'),
      channelId: Id,
      botId: Id,
      command: ContextCommandName,
      targetUserId: Id,
    }),
    z.object({ type: z.literal('message_command'), botId: Id, command: ContextCommandName, messageId: Id }),
    z
      .object({
        type: z.literal('component'),
        customId: CustomId,
        values: z.array(z.string().max(100)).max(25).default([]),
        /** mensagem com os componentes… */
        messageId: Id.optional(),
        /** …ou cartão efêmero (id da interação que o gerou) */
        ephemeralOf: Id.optional(),
      })
      .refine((c) => Boolean(c.messageId) !== Boolean(c.ephemeralOf), 'informe messageId ou ephemeralOf'),
    z.object({ type: z.literal('modal'), modalId: Id, fields: z.record(CustomId, z.string().max(4000)) }),
    z.object({ type: z.literal('autocomplete'), channelId: Id, botId: Id, ...CommandPath, focused: CommandName }),
  ]),
);
export type CreateInteractionRequest = z.input<typeof CreateInteractionRequest>;
/** POST /interactions: id da interação; autocompletar devolve as sugestões do bot (vazio se ele não respondeu) */
export const CreateInteractionResponse = z.object({ id: Id, choices: z.array(BotCommandChoice).max(25).optional() });
export type CreateInteractionResponse = z.infer<typeof CreateInteractionResponse>;
/** o que o bot recebe no evento `interaction:created` */
export const Interaction = z.object({
  id: Id,
  type: InteractionType,
  serverId: Id,
  channelId: Id,
  botId: Id,
  user: UserPublic,
  createdAt: IsoDate,
  /** comandos (chat/contexto) e autocompletar */
  command: ContextCommandName.optional(),
  subcommandGroup: CommandName.optional(),
  subcommand: CommandName.optional(),
  options: z.record(CommandName, InteractionOptionValue).default({}),
  /** autocompletar: opção que a pessoa está digitando (o valor parcial está em `options`) */
  focused: CommandName.optional(),
  /** user_command */
  targetUser: UserPublic.optional(),
  /** message_command e component: a mensagem alvo / com os componentes */
  targetMessage: z.lazy(() => Message).optional(),
  /** component e modal */
  customId: CustomId.optional(),
  componentType: z.enum(['button', 'select']).optional(),
  /** valores escolhidos num menu */
  values: z.array(z.string()).optional(),
  /** modal: campo → texto */
  fields: z.record(CustomId, z.string()).optional(),
  /** component vindo de um cartão efêmero: id da interação original */
  ephemeralOf: Id.optional(),
});
export type Interaction = z.infer<typeof Interaction>;
export const InteractionReplyRequest = z
  .object({
    content: z.string().trim().max(4000).default(''),
    embeds: z.array(Embed).max(EMBED_LIMITS.perMessage).optional(),
    components: MessageComponents.optional(),
    attachmentIds: z.array(Id).max(10).optional(),
    /** só quem usou o comando vê (não vira mensagem no canal) */
    ephemeral: z.boolean().default(false),
  })
  .refine((r) => r.content.length > 0 || (r.embeds?.length ?? 0) > 0 || (r.attachmentIds?.length ?? 0) > 0, {
    message: 'resposta vazia',
    path: ['content'],
  });
export type InteractionReplyRequest = z.input<typeof InteractionReplyRequest>;
/** resposta de `POST /interactions/:id/reply`: id da mensagem criada (null quando efêmera) */
export const InteractionReplyResponse = z.object({ messageId: Id.nullable() });
export type InteractionReplyResponse = z.infer<typeof InteractionReplyResponse>;
/** "pensando…"; `update: true` (componentes) só acusa o clique sem mostrar nada */
export const InteractionDeferRequest = z.object({
  ephemeral: z.boolean().default(false),
  update: z.boolean().default(false),
});
export type InteractionDeferRequest = z.input<typeof InteractionDeferRequest>;
/** POST /interactions/:id/update (component/modal vindo de componente): edita a mensagem ou o cartão efêmero de origem */
export const InteractionUpdateRequest = z
  .object({
    content: z.string().trim().max(4000).optional(),
    embeds: z.array(Embed).max(EMBED_LIMITS.perMessage).optional(),
    components: MessageComponents.optional(),
  })
  .refine(
    (u) => u.content !== undefined || u.embeds !== undefined || u.components !== undefined,
    'nada para atualizar',
  );
export type InteractionUpdateRequest = z.input<typeof InteractionUpdateRequest>;
/** POST /interactions/:id/modal: abre um formulário para quem interagiu (consome a interação) */
export const InteractionModalRequest = z.object({ modal: Modal });
export type InteractionModalRequest = z.input<typeof InteractionModalRequest>;
/** POST /interactions/:id/autocomplete: sugestões para a opção em foco */
export const InteractionAutocompleteRequest = z.object({ choices: z.array(BotCommandChoice).max(25) });
export type InteractionAutocompleteRequest = z.infer<typeof InteractionAutocompleteRequest>;

// ---------- Ponte com o Slack (ADR-0033) ----------
/** a instância tem um app do Slack configurado? (`team` = nome do workspace) */
export const SlackStatus = z.object({ configured: z.boolean(), team: z.string().nullable() });
export type SlackStatus = z.infer<typeof SlackStatus>;
export const SlackChannel = z.object({ id: z.string(), name: z.string() });
export type SlackChannel = z.infer<typeof SlackChannel>;
export const SlackLink = z.object({
  id: Id,
  serverId: Id,
  channelId: Id,
  slackChannelId: z.string(),
  slackChannelName: z.string(),
  createdAt: IsoDate,
});
export type SlackLink = z.infer<typeof SlackLink>;
export const CreateSlackLinkRequest = z.object({
  channelId: Id,
  slackChannelId: z.string().regex(/^[A-Z0-9]{5,24}$/, 'id de canal do Slack'),
});
export type CreateSlackLinkRequest = z.infer<typeof CreateSlackLinkRequest>;

// ---------- Eventos do servidor (ADR-0028) ----------
export const RsvpStatus = z.enum(['going', 'maybe']);
export type RsvpStatus = z.infer<typeof RsvpStatus>;
export const ServerEvent = z.object({
  id: Id,
  serverId: Id,
  /** canal de voz onde acontece (null = sem canal) */
  channelId: Id.nullable(),
  createdBy: UserPublic,
  title: z.string(),
  description: z.string(),
  startsAt: IsoDate,
  endsAt: IsoDate.nullable(),
  /** quem confirmou (ids) */
  going: z.array(Id),
  maybe: z.array(Id),
  /** minha resposta */
  me: RsvpStatus.nullable(),
});
export type ServerEvent = z.infer<typeof ServerEvent>;
export const CreateEventRequest = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(''),
  channelId: Id.nullable().default(null),
  startsAt: IsoDate,
  endsAt: IsoDate.nullable().default(null),
});
export type CreateEventRequest = z.input<typeof CreateEventRequest>;
export const UpdateEventRequest = CreateEventRequest.partial();
export type UpdateEventRequest = z.input<typeof UpdateEventRequest>;
export const RsvpRequest = z.object({ status: RsvpStatus.nullable() });
export type RsvpRequest = z.infer<typeof RsvpRequest>;

/** Melhores momentos: vídeos compartilhados no servidor, ranqueados pelas reações do período. */
export const HighlightsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type HighlightsQuery = z.input<typeof HighlightsQuery>;
export const Highlight = z.object({
  message: Message,
  /** pessoas distintas que reagiram (qualquer emoji) */
  score: z.number().int().nonnegative(),
  channelName: z.string(),
});
export type Highlight = z.infer<typeof Highlight>;

export const AckReadRequest = z.object({ messageId: Id });

export const UnreadState = z.object({
  channelId: Id.nullable(),
  conversationId: Id.nullable(),
  lastReadMessageId: Id.nullable(),
  lastMessageId: Id.nullable(),
  unreadCount: z.number().int(),
  mentionCount: z.number().int(),
});
export type UnreadState = z.infer<typeof UnreadState>;

// ---------- Amigos, bloqueios, DMs ----------
export const FriendshipStatus = z.enum(['pending_outgoing', 'pending_incoming', 'accepted']);
export const Friend = z.object({ user: UserPublic, status: FriendshipStatus, since: IsoDate });
export type Friend = z.infer<typeof Friend>;
/** Busca por apelido (preferido) ou nome de usuário. */
export const FriendRequestCreate = z.object({ username: z.string().trim().min(2).max(32) });

export const ConversationKind = z.enum(['dm', 'group']);
/** Perfil visto por outra pessoa (painel da DM): só para quem tem conversa, servidor ou amizade em comum. */
export const UserProfile = z.object({
  user: UserPublic,
  createdAt: IsoDate,
  /** quando a amizade foi aceita (null se não são amigos) */
  friendSince: IsoDate.nullable(),
  mutualServers: z.array(z.object({ id: Id, name: z.string(), iconKey: z.string().nullable(), official: z.boolean() })),
  mutualFriends: z.array(UserPublic),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const Conversation = z.object({
  id: Id,
  kind: ConversationKind,
  name: z.string().nullable(),
  members: z.array(UserPublic),
  lastMessageId: Id.nullable(),
});
export type Conversation = z.infer<typeof Conversation>;
export const CreateConversationRequest = z.object({
  userIds: z.array(Id).min(1).max(9),
  name: z.string().trim().min(1).max(100).optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequest>;

// ---------- Presença ----------
export const PresenceStatus = z.enum(['online', 'idle', 'dnd', 'invisible', 'offline']);
export type PresenceStatus = z.infer<typeof PresenceStatus>;
export const SetPresenceRequest = z.object({ status: PresenceStatus.exclude(['offline']) });
/** Status personalizado ("estudando, volto 22h"): texto curto que os outros veem embaixo do nome; null limpa. */
export const StatusText = z.string().trim().min(1).max(80);
export const SetStatusTextRequest = z.object({ text: StatusText.nullable() });
export type SetStatusTextRequest = z.infer<typeof SetStatusTextRequest>;
/**
 * Jogo que a pessoa está jogando (ADR-0021), detectado pelo app desktop. Só o nome e quando começou; some quando
 * ela fica offline ou invisível. `steamAppId` quando o jogo veio da Steam (abre a página da loja).
 */
export const PlayingGame = z.object({
  name: z.string().trim().min(1).max(64),
  startedAt: z.number().int().positive(),
  steamAppId: z.number().int().positive().optional(),
  /** ícone do executável do jogo, lido no computador de quem joga (PNG 32×32 em data URL) */
  icon: z
    .string()
    .max(16 * 1024)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
    .optional(),
});
export type PlayingGame = z.infer<typeof PlayingGame>;

// ---------- Voz / mídia ----------
export const VoiceJoinResponse = z.object({
  url: z.string(),
  token: z.string(),
  roomName: z.string(),
  expiresAt: IsoDate,
  channelId: Id,
  /** chamada privada (ADR-0038) */
  conversationId: Id.nullable().optional(),
  canSpeak: z.boolean(),
  canVideo: z.boolean(),
  canStream: z.boolean(),
});
export type VoiceJoinResponse = z.infer<typeof VoiceJoinResponse>;

export const VoiceMemberState = z.object({
  userId: Id,
  /** canal de voz, ou o id da conversa numa chamada privada (ADR-0038) */
  channelId: Id,
  /** null em chamada privada (conversa direta/grupo) */
  serverId: Id.nullable(),
  /** chamada privada (ADR-0038): id da conversa; null em canal de servidor */
  conversationId: Id.nullable().optional(),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
  serverMute: z.boolean(),
  video: z.boolean(),
  streaming: z.boolean(),
  /** quando a prévia da live foi atualizada (GET /voice/members/:userId/stream-preview); null sem prévia */
  previewAt: IsoDate.nullable().optional(),
  joinedAt: IsoDate,
});
export type VoiceMemberState = z.infer<typeof VoiceMemberState>;

export const UpdateVoiceStateRequest = z.object({
  selfMute: z.boolean().optional(),
  selfDeaf: z.boolean().optional(),
  video: z.boolean().optional(),
  streaming: z.boolean().optional(),
});
export type UpdateVoiceStateRequest = z.infer<typeof UpdateVoiceStateRequest>;

// ---------- Configurações do usuário (versionadas) ----------
/** Pasta de servidores na barra (criada arrastando um servidor sobre outro). */
export const ServerFolder = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().max(32).default(''),
  /** cor da pasta (#rrggbb); null = cor de destaque */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  serverIds: z.array(z.string().max(64)).max(200),
  open: z.boolean().default(false),
});
export type ServerFolder = z.infer<typeof ServerFolder>;
export type ServerLayoutItem = string | ServerFolder;
export const UserSettingsV1 = z.object({
  version: z.literal(1),
  audio: z
    .object({
      inputDeviceId: z.string().nullable().default(null),
      outputDeviceId: z.string().nullable().default(null),
      inputVolume: z.number().min(0).max(2).default(1),
      outputVolume: z.number().min(0).max(2).default(1),
      inputMode: z.enum(['vad', 'ptt']).default('vad'),
      vadThreshold: z.number().min(-100).max(0).default(-50),
      noiseSuppression: z.boolean().default(true),
      echoCancellation: z.boolean().default(true),
      autoGainControl: z.boolean().default(true),
      pttReleaseDelayMs: z.number().int().min(0).max(2000).default(200),
    })
    .prefault({}),
  video: z
    .object({
      cameraDeviceId: z.string().nullable().default(null),
      streamProfile: z.enum(['720p30', '1080p60', '1440p60']).default('1080p60'),
      streamBitrate: z.enum(['low', 'medium', 'high']).default('medium'),
      preferredCodec: z.enum(['h264', 'vp8', 'vp9', 'av1']).default('h264'),
    })
    .prefault({}),
  keybinds: z
    .object({
      pushToTalk: z.string().max(64).nullable().default(null),
      toggleMute: z.string().max(64).nullable().default('CommandOrControl+Shift+M'),
      toggleDeafen: z.string().max(64).nullable().default('CommandOrControl+Shift+D'),
      /** salva os últimos 60 s do jogo como clipe (ADR-0022) */
      saveClip: z.string().max(64).nullable().default('Shift+F10'),
    })
    .prefault({}),
  appearance: z
    .object({
      theme: z.enum(['dark', 'light']).default('dark'),
      compact: z.boolean().default(true),
      reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
      fontScale: z.number().min(0.8).max(1.5).default(1),
      /** cor de destaque (#rrggbb); variações de hover/texto são derivadas no cliente com contraste AA */
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default('#4d56fd'),
      /** tom das superfícies do tema escuro */
      surface: z.enum(['default', 'midnight', 'oled', 'slate']).default('default'),
      /** tema completo da galeria (Aparência → Tema); 'default' = só tema + tom */
      palette: z
        .enum([
          'default',
          'artico',
          'floresta',
          'brasa',
          'oceano',
          'lavanda',
          'rose',
          'neon',
          'cafe',
          'papel',
          'nevoa',
          'menta',
        ])
        .default('default'),
      /** multiplicador dos cantos arredondados (0 = retos) */
      radiusScale: z.number().min(0).max(2).default(1),
      /** família de fonte instalada no sistema; vazio = fonte padrão do app */
      fontFamily: z
        .string()
        .max(64)
        .regex(/^[\p{L}\p{N} ._-]*$/u)
        .default(''),
    })
    .prefault({}),
  notifications: z
    .object({
      desktop: z.boolean().default(true),
      sounds: z.boolean().default(true),
      /** volume dos efeitos sonoros (0–1); padrão 100 % */
      soundVolume: z.number().min(0).max(1).default(1),
      /** conjunto de sons (padrao, classico, suave, retro, madeira, telefone, discreto) */
      soundPack: z.string().max(32).default('padrao'),
      dnd: z.boolean().default(false),
    })
    .prefault({}),
  perUserVolume: z.record(z.string(), z.number().min(0).max(2)).default({}),
  /** apelido que EU dei a alguém (só eu vejo; vale em todo lugar, inclusive acima do apelido do servidor) */
  friendNicknames: z.record(z.string(), z.string().trim().min(1).max(32)).default({}),
  /** conversas diretas fixadas no topo da lista, na ordem em que foram fixadas */
  pinnedConversations: z.array(z.string()).max(50).default([]),
  /** Jogo que estou jogando (ADR-0021): mostrar para os outros e jogos que eu mesmo cadastrei (executável → nome). */
  games: z
    .object({
      showPlaying: z.boolean().default(true),
      /** clipes (ADR-0022): com um jogo aberto, guarda os últimos 60 s da tela na memória para salvar pelo atalho */
      clips: z.boolean().default(true),
      /** duração de cada clipe (segundos guardados na memória) */
      clipSeconds: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).default(60),
      clipFps: z.union([z.literal(30), z.literal(60)]).default(60),
      /** resolução máxima: a da tela (source) ou reduzida */
      clipResolution: z.enum(['source', '1080p', '720p']).default('1080p'),
      /** qualidade (porcentagem do bitrate de referência): mais alta = arquivo maior */
      clipQuality: z.number().int().min(10).max(100).default(75),
      /** saídas de áudio do Windows que NÃO entram nos clipes (pelo nome; as outras entram, ADR-0024) */
      clipOutputsOff: z.array(z.string().max(256)).max(32).default([]),
      custom: z
        .array(z.object({ exe: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(64) }))
        .max(50)
        .default([]),
    })
    .prefault({}),
  /**
   * Ordem da barra de servidores: id de servidor solto ou pasta com vários servidores (só eu vejo).
   * Servidor fora da lista aparece no fim; id de servidor que saí é ignorado no cliente.
   */
  serverLayout: z
    .array(z.union([z.string().max(64), ServerFolder]))
    .max(500)
    .default([]),
  sidebarWidth: z.number().int().min(200).max(480).default(240),
});
export type UserSettingsV1 = z.infer<typeof UserSettingsV1>;
export const UserSettings = UserSettingsV1;
export type UserSettings = UserSettingsV1;
export const defaultUserSettings = (): UserSettings => UserSettingsV1.parse({ version: 1 });

// ---------- Auditoria ----------
export const AuditEntry = z.object({
  id: Id,
  actorId: Id,
  serverId: Id.nullable(),
  action: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDate,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

// ---------- Painel do super admin (ADR-0020) ----------
export const AdminStats = z.object({
  users: z.number().int(),
  newUsers7d: z.number().int(),
  suspended: z.number().int(),
  admins: z.number().int(),
  onlineNow: z.number().int(),
  inVoice: z.number().int(),
  servers: z.number().int(),
  messages24h: z.number().int(),
});
export type AdminStats = z.infer<typeof AdminStats>;

export const AdminUser = UserPublic.extend({
  email: z.string().nullable(),
  hasAccount: z.boolean(),
  isInstanceAdmin: z.boolean(),
  /** selo de verificado no perfil */
  verified: z.boolean(),
  /** dono do servidor oficial: não pode ser suspenso nem perder o admin */
  isCreator: z.boolean(),
  createdAt: IsoDate,
  disabledAt: IsoDate.nullable(),
  serverCount: z.number().int(),
  activeSessions: z.number().int(),
  lastSeenAt: IsoDate.nullable(),
  online: z.boolean(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const ADMIN_USER_FILTERS = ['all', 'admins', 'suspended'] as const;
export const AdminUsersQuery = z.object({
  q: z.string().trim().max(64).optional(),
  filter: z.enum(ADMIN_USER_FILTERS).default('all'),
  cursor: Id.optional(),
});
export const AdminUserPage = z.object({ users: z.array(AdminUser), nextCursor: Id.nullable() });
export type AdminUserPage = z.infer<typeof AdminUserPage>;

export const SuspendUserRequest = z.object({ reason: z.string().trim().max(200).optional() });
export const SetInstanceAdminRequest = z.object({ admin: z.boolean() });
export const SetUserVerifiedRequest = z.object({ verified: z.boolean() });

/** Só o que veio; `announcement: null` tira o aviso, `uploadMaxBytes: null` volta ao limite do ambiente. */
export const UpdateInstanceConfigRequest = z
  .object({
    registrationOpen: z.boolean(),
    announcement: InstanceAnnouncement.nullable(),
    uploadMaxBytes: z
      .number()
      .int()
      .min(1024 * 1024)
      .nullable(),
    aiModeration: z.boolean(),
    aiModerationDms: z.boolean(),
    aiAutoBlock: z.boolean(),
    aiAutoBlockDevice: z.boolean(),
    privacyContact: z.string().trim().max(254).nullable(),
  })
  .partial();

/** Bloqueio de dispositivo (ADR-0036): aparelho/IP recusado em qualquer entrada. */
export const DEVICE_BAN_KINDS = ['hardware', 'device', 'ip'] as const;
export const DeviceBan = z.object({
  id: Id,
  kind: z.enum(DEVICE_BAN_KINDS),
  /** valor mascarado (hash abreviado ou IP) */
  value: z.string(),
  user: UserPublic.nullable(),
  reason: z.string().nullable(),
  createdAt: IsoDate,
});
export type DeviceBan = z.infer<typeof DeviceBan>;
export type UpdateInstanceConfigRequest = z.infer<typeof UpdateInstanceConfigRequest>;

export const AdminInstanceConfig = InstanceInfo.extend({
  uploadMaxBytes: z.number().int(),
  /** moderação por IA (ADR-0036): chave presente no ambiente, chave ligada pelo painel, e se vale em DMs */
  aiModerationAvailable: z.boolean(),
  aiModerationEnabled: z.boolean(),
  aiModerationDms: z.boolean(),
  aiModerationModel: z.string().nullable(),
  /** bloqueio automático em conteúdo grave (suspende a conta) e também do dispositivo */
  aiAutoBlock: z.boolean(),
  aiAutoBlockDevice: z.boolean(),
  /** teto do ambiente (UPLOAD_MAX_BYTES); o painel só reduz */
  uploadEnvMaxBytes: z.number().int(),
  /** override salvo (null = o do ambiente) */
  uploadOverrideBytes: z.number().int().nullable(),
  updatedAt: IsoDate.nullable(),
});
export type AdminInstanceConfig = z.infer<typeof AdminInstanceConfig>;

export const ADMIN_AUDIT_SCOPES = ['admin', 'all'] as const;
export const AdminAuditQuery = z.object({
  scope: z.enum(ADMIN_AUDIT_SCOPES).default('admin'),
  before: Id.optional(),
});
export const AdminAuditEntry = AuditEntry.extend({
  actor: z.object({ id: Id, displayName: z.string() }),
  server: z.object({ id: Id, name: z.string() }).nullable(),
  /** nome do usuário-alvo quando a ação é sobre uma pessoa */
  targetName: z.string().nullable(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;
export const AdminAuditPage = z.object({ entries: z.array(AdminAuditEntry), nextBefore: Id.nullable() });
export type AdminAuditPage = z.infer<typeof AdminAuditPage>;

// ---------- Uploads ----------
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** vídeo compartilhado em partes (clipes): até 1 GB, independente do limite de anexos comuns */
export const LARGE_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  /** mensagens de voz gravadas no app (WebM/Opus) */
  'audio/webm',
  'application/pdf',
  'application/zip',
  'text/plain',
] as const;
export const UploadResponse = z.object({ attachment: Attachment });

// ---------- Efeitos sonoros (ADR-0016) ----------
/** sem limite de duração: o app envia o trecho em Opus (64 kb/s), então 8 MB são uns 17 min */
export const SOUND_MAX_BYTES = 8 * 1024 * 1024;
export const SOUNDS_PER_SERVER = 48;
export const SoundEffect = z.object({
  id: Id,
  serverId: Id,
  name: z.string(),
  emoji: z.string().nullable(),
  volume: z.number().min(0).max(1),
  durationMs: z.number().int(),
  createdBy: UserPublic,
  createdAt: IsoDate,
});
export type SoundEffect = z.infer<typeof SoundEffect>;
/** Campos do envio (multipart, junto com o arquivo). */
export const SoundEffectUpload = z.object({
  name: z.string().trim().min(1).max(32),
  emoji: z.string().trim().max(16).optional(),
  volume: z.coerce.number().min(0).max(1).default(1),
  durationMs: z.coerce.number().int().min(100),
});

// ---------- Gravação de chamada (ADR-0023) ----------
/** cada parte enviada durante a gravação (o arquivo vai subindo enquanto a chamada acontece) */
export const RECORDING_PART_BYTES = 8 * 1024 * 1024;
/** 1080p30 a 8 Mb/s ≈ 3,6 GB por hora: cabe o limite de 4 h */
export const RECORDING_MAX_BYTES = 16 * 1024 * 1024 * 1024;
export const RECORDING_MAX_MS = 4 * 60 * 60 * 1000;
/** por quanto tempo a gravação pronta pode ser baixada */
export const RECORDING_TTL_MS = 24 * 60 * 60 * 1000;
export const ActiveRecording = z.object({
  id: Id,
  channelId: Id,
  userId: Id,
  startedAt: IsoDate,
});
export type ActiveRecording = z.infer<typeof ActiveRecording>;
export const CallRecording = z.object({
  id: Id,
  channelId: Id,
  createdBy: UserPublic,
  startedAt: IsoDate,
  endedAt: IsoDate,
  expiresAt: IsoDate,
  durationMs: z.number().int(),
  sizeBytes: z.number().int(),
});
export type CallRecording = z.infer<typeof CallRecording>;
export const ChannelRecordings = z.object({ active: ActiveRecording.nullable(), ready: z.array(CallRecording) });
export type ChannelRecordings = z.infer<typeof ChannelRecordings>;
export const CompleteRecordingRequest = z.object({
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(RECORDING_MAX_MS + 60_000),
});

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
  /** quem criou o OpenCord (dono do servidor oficial): selo de verificado em qualquer servidor */
  creatorId: z.string().uuid().nullable().default(null),
});
export type InstanceInfo = z.infer<typeof InstanceInfo>;

export const GuestJoinRequest = z.object({
  nickname: Nickname,
  accessCode: z.string().max(128).optional(),
  deviceId: z.string().min(1).max(128).optional(),
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
});
export type RegisterRequest = z.input<typeof RegisterRequest>;

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
});
export type UserPublic = z.infer<typeof UserPublic>;

/** `email` é null para quem entrou só com apelido (sem login por senha). */
/** `hasAccount=false`: entrou só com apelido (identidade presa ao dispositivo). */
export const Me = UserPublic.extend({
  email: z.email().nullable(),
  hasAccount: z.boolean(),
  createdAt: IsoDate,
  /** super admin da instância (ADR-0013) */
  isInstanceAdmin: z.boolean().optional(),
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

export const UpdateServerRequest = z.object({ name: z.string().trim().min(1).max(100).optional() });
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
});
export type AdminServerEntry = z.infer<typeof AdminServerEntry>;

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
export const Emoji = z.string().min(1).max(64);

export const CreateMessageRequest = z
  .object({
    requestId: z.uuid(),
    body: MessageBody,
    replyToId: Id.optional(),
    attachmentIds: z.array(Id).max(10).optional(),
  })
  .refine((m) => m.body.trim().length > 0 || (m.attachmentIds?.length ?? 0) > 0, {
    message: 'mensagem vazia',
    path: ['body'],
  });
export type CreateMessageRequest = z.infer<typeof CreateMessageRequest>;

export const EditMessageRequest = z.object({ body: MessageBody.refine((b) => b.trim().length > 0, 'mensagem vazia') });
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
/**
 * Jogo que a pessoa está jogando (ADR-0021), detectado pelo app desktop. Só o nome e quando começou; some quando
 * ela fica offline ou invisível. `steamAppId` quando o jogo veio da Steam (abre a página da loja).
 */
export const PlayingGame = z.object({
  name: z.string().trim().min(1).max(64),
  startedAt: z.number().int().positive(),
  steamAppId: z.number().int().positive().optional(),
});
export type PlayingGame = z.infer<typeof PlayingGame>;

// ---------- Voz / mídia ----------
export const VoiceJoinResponse = z.object({
  url: z.string(),
  token: z.string(),
  roomName: z.string(),
  expiresAt: IsoDate,
  channelId: Id,
  canSpeak: z.boolean(),
  canVideo: z.boolean(),
  canStream: z.boolean(),
});
export type VoiceJoinResponse = z.infer<typeof VoiceJoinResponse>;

export const VoiceMemberState = z.object({
  userId: Id,
  channelId: Id,
  serverId: Id,
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
      /** volume dos efeitos sonoros (0–1) */
      soundVolume: z.number().min(0).max(1).default(0.5),
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
      custom: z
        .array(z.object({ exe: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(64) }))
        .max(50)
        .default([]),
    })
    .default({ showPlaying: true, clips: true, custom: [] }),
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
  })
  .partial();
export type UpdateInstanceConfigRequest = z.infer<typeof UpdateInstanceConfigRequest>;

export const AdminInstanceConfig = InstanceInfo.extend({
  uploadMaxBytes: z.number().int(),
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
export const UPLOAD_ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'application/pdf',
  'application/zip',
  'text/plain',
] as const;
export const UploadResponse = z.object({ attachment: Attachment });

// ---------- Efeitos sonoros (ADR-0016) ----------
export const SOUND_MAX_BYTES = 1024 * 1024;
export const SOUND_MAX_MS = 10_000;
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
  durationMs: z.coerce.number().int().min(100).max(SOUND_MAX_MS),
});

// ---------- Gravação de chamada (ADR-0023) ----------
/** cada parte enviada durante a gravação (o arquivo vai subindo enquanto a chamada acontece) */
export const RECORDING_PART_BYTES = 8 * 1024 * 1024;
export const RECORDING_MAX_BYTES = 4 * 1024 * 1024 * 1024;
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
export const CompleteRecordingRequest = z.object({ durationMs: z.number().int().min(0).max(RECORDING_MAX_MS + 60_000) });

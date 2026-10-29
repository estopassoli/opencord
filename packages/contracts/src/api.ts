import { z } from 'zod';

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

export const InstanceInfo = z.object({
  name: z.string(),
  guestJoin: z.boolean(),
  requiresAccessCode: z.boolean(),
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
export const Me = UserPublic.extend({ email: z.email().nullable(), hasAccount: z.boolean(), createdAt: IsoDate });
export type Me = z.infer<typeof Me>;

export const AuthResponse = z.object({ user: Me, tokens: TokenPair });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const UpdateProfileRequest = z.object({ displayName: Nickname.optional() });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ---------- Servidores, cargos, canais ----------
export const ChannelKind = z.enum(['text', 'voice']);
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
});
export type Channel = z.infer<typeof Channel>;

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

// ---------- Servidores abertos (sem convites, ADR-0007) ----------
export const ServerDirectoryEntry = z.object({
  id: Id,
  name: z.string(),
  iconKey: z.string().nullable(),
  memberCount: z.number().int(),
  joined: z.boolean(),
});
export type ServerDirectoryEntry = z.infer<typeof ServerDirectoryEntry>;

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
});
export type Message = z.infer<typeof Message>;

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
      preferredCodec: z.enum(['h264', 'vp8', 'vp9', 'av1']).default('h264'),
    })
    .prefault({}),
  keybinds: z
    .object({
      pushToTalk: z.string().max(64).nullable().default(null),
      toggleMute: z.string().max(64).nullable().default('CommandOrControl+Shift+M'),
      toggleDeafen: z.string().max(64).nullable().default('CommandOrControl+Shift+D'),
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
      dnd: z.boolean().default(false),
    })
    .prefault({}),
  perUserVolume: z.record(z.string(), z.number().min(0).max(2)).default({}),
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

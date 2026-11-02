/**
 * Nomes de eventos do `Client`. Os valores são os nomes que a comunidade de bots já conhece; o que chega do
 * OpenCord (`chat:message:created`, `interaction:created`…) é traduzido pelo `Client`.
 */
export const Events = {
  ClientReady: 'ready',
  Resume: 'resume',
  MessageCreate: 'messageCreate',
  MessageUpdate: 'messageUpdate',
  MessageDelete: 'messageDelete',
  MessageDeleteBulk: 'messageDeleteBulk',
  MessageReactionAdd: 'messageReactionAdd',
  MessageReactionRemove: 'messageReactionRemove',
  MessageReactionRemoveAll: 'messageReactionRemoveAll',
  InteractionCreate: 'interactionCreate',
  TypingStart: 'typingStart',
  PresenceUpdate: 'presenceUpdate',
  PollUpdate: 'pollUpdate',
  ChannelPinsUpdate: 'channelPinsUpdate',
  GuildMemberAdd: 'guildMemberAdd',
  GuildMemberRemove: 'guildMemberRemove',
  GuildMemberUpdate: 'guildMemberUpdate',
  GuildBanAdd: 'guildBanAdd',
  GuildBanRemove: 'guildBanRemove',
  GuildCreate: 'guildCreate',
  GuildUpdate: 'guildUpdate',
  GuildDelete: 'guildDelete',
  GuildRoleCreate: 'roleCreate',
  GuildRoleUpdate: 'roleUpdate',
  GuildRoleDelete: 'roleDelete',
  RoleCreate: 'roleCreate',
  RoleUpdate: 'roleUpdate',
  RoleDelete: 'roleDelete',
  GuildScheduledEventCreate: 'guildScheduledEventCreate',
  GuildScheduledEventUpdate: 'guildScheduledEventUpdate',
  GuildScheduledEventDelete: 'guildScheduledEventDelete',
  ChannelCreate: 'channelCreate',
  ChannelUpdate: 'channelUpdate',
  ChannelDelete: 'channelDelete',
  CategoryCreate: 'categoryCreate',
  CategoryUpdate: 'categoryUpdate',
  CategoryDelete: 'categoryDelete',
  UserUpdate: 'userUpdate',
  Error: 'error',
  Warn: 'warn',
  RateLimited: 'rateLimited',
  Disconnect: 'disconnect',
  Debug: 'debug',
} as const;
export type EventName = (typeof Events)[keyof typeof Events];

/**
 * Intents não existem no OpenCord: o bot recebe os eventos dos servidores em que é membro, conforme as permissões
 * dos cargos dele. O objeto existe só para o código portado continuar compilando; os valores são ignorados.
 */
export const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildEmojisAndStickers: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  GuildMessagePolls: 1 << 24,
  DirectMessagePolls: 1 << 25,
} as const;

/** Mesma ideia: aceito e ignorado (toda estrutura aqui já chega completa). */
export const Partials = {
  User: 0,
  Channel: 1,
  GuildMember: 2,
  Message: 3,
  Reaction: 4,
  GuildScheduledEvent: 5,
  ThreadMember: 6,
  Poll: 7,
  PollAnswer: 8,
} as const;

/** Tipos de interação (`interaction.type`), com os números que a comunidade conhece. */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

/** Tipos de comando: barra (`chat`) ou menu de contexto numa pessoa/mensagem. Os valores são os do contrato. */
export const ApplicationCommandType = {
  ChatInput: 'chat',
  User: 'user',
  Message: 'message',
} as const;

/** Tipos de opção de comando, com os nomes usuais; o contrato do OpenCord usa os nomes em minúsculas. */
export const ApplicationCommandOptionType = {
  Subcommand: 'subcommand',
  SubcommandGroup: 'subcommand_group',
  String: 'string',
  Integer: 'integer',
  Number: 'number',
  Boolean: 'boolean',
  User: 'user',
  Channel: 'channel',
  Role: 'role',
  Mentionable: 'mentionable',
} as const;

/** Estilos de botão (valores do contrato). */
export const ButtonStyle = {
  Primary: 'primary',
  Secondary: 'secondary',
  Success: 'success',
  Danger: 'danger',
  Link: 'link',
} as const;

/** Tipos de componente (`interaction.componentType`, filtro dos coletores). */
export const ComponentType = {
  ActionRow: 'row',
  Button: 'button',
  StringSelect: 'string_select',
  TextInput: 'text',
  UserSelect: 'user_select',
  RoleSelect: 'role_select',
  ChannelSelect: 'channel_select',
} as const;
export type ComponentTypeValue = (typeof ComponentType)[keyof typeof ComponentType];

export const TextInputStyle = {
  Short: 'short',
  Paragraph: 'paragraph',
} as const;

/**
 * Tipos de canal (`channel.type`). Os valores são os `kind` do contrato (`text`, `voice`, `board`), mais `category`
 * e `dm` para as estruturas do SDK.
 */
export const ChannelType = {
  GuildText: 'text',
  DM: 'dm',
  GuildVoice: 'voice',
  GuildCategory: 'category',
  GuildBoard: 'board',
  GroupDM: 'dm',
} as const;

/** `flags: MessageFlags.Ephemeral` em `reply()` é sinônimo de `ephemeral: true`. */
export const MessageFlags = {
  SuppressEmbeds: 1 << 2,
  Ephemeral: 1 << 6,
  SuppressNotifications: 1 << 12,
} as const;

/** Tipos de atividade da presença: o OpenCord mostra "jogando" (`presence:game`). */
export const ActivityType = {
  Playing: 0,
  Streaming: 1,
  Listening: 2,
  Watching: 3,
  Custom: 4,
  Competing: 5,
} as const;

/** Estado da conexão com o gateway (`client.ws.status`). */
export const Status = {
  Idle: 'idle',
  Connecting: 'connecting',
  Ready: 'ready',
  Disconnected: 'disconnected',
} as const;
export type StatusValue = (typeof Status)[keyof typeof Status];

/** Nomes de cor aceitos por `EmbedBuilder.setColor` (`#rrggbb`). */
export const Colors = {
  Default: '#000000',
  White: '#ffffff',
  Aqua: '#1abc9c',
  Green: '#57f287',
  Blue: '#3498db',
  Yellow: '#fee75c',
  Purple: '#9b59b6',
  LuminousVividPink: '#e91e63',
  Fuchsia: '#eb459e',
  Gold: '#f1c40f',
  Orange: '#e67e22',
  Red: '#ed4245',
  Grey: '#95a5a6',
  Gray: '#95a5a6',
  Navy: '#34495e',
  DarkAqua: '#11806a',
  DarkGreen: '#1f8b4c',
  DarkBlue: '#206694',
  DarkPurple: '#71368a',
  DarkVividPink: '#ad1457',
  DarkGold: '#c27c0e',
  DarkOrange: '#a84300',
  DarkRed: '#992d22',
  DarkGrey: '#979c9f',
  DarkerGrey: '#7f8c8d',
  LightGrey: '#bcc0c0',
  DarkNavy: '#2c3e50',
  Blurple: '#4d56fd',
  Greyple: '#99aab5',
  DarkButNotBlack: '#2c2f33',
  NotQuiteBlack: '#23272a',
} as const;
export type ColorName = keyof typeof Colors;

/** Limites do contrato (ADR-0034), redeclarados aqui para validar antes de chamar a API. */
export const Limits = {
  embed: {
    title: 256,
    description: 4096,
    fields: 25,
    fieldName: 256,
    fieldValue: 1024,
    footer: 2048,
    author: 256,
    total: 6000,
    perMessage: 10,
  },
  componentRows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  customId: 100,
  buttonLabel: 80,
  modalTitle: 45,
  modalInputs: 5,
  textInputLabel: 45,
  textInputValue: 4000,
  commands: 100,
  commandOptions: 25,
  choices: 25,
  guildIds: 50,
  messageBody: 4000,
  attachments: 10,
  bulkDelete: 100,
  pollOptions: 10,
  pollDurations: [0, 1, 4, 8, 24, 72, 168],
  timeoutMs: 28 * 24 * 60 * 60 * 1000,
  banDeleteSeconds: 7 * 24 * 3600,
} as const;

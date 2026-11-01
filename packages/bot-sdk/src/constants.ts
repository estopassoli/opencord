/**
 * Nomes de eventos do `Client`. Os valores são os nomes que a comunidade de bots já conhece; o que chega do
 * OpenCord (`chat:message:created`, `interaction:created`…) é traduzido pelo `Client`.
 */
export const Events = {
  ClientReady: 'ready',
  MessageCreate: 'messageCreate',
  MessageUpdate: 'messageUpdate',
  MessageDelete: 'messageDelete',
  MessageReactionAdd: 'messageReactionAdd',
  MessageReactionRemove: 'messageReactionRemove',
  InteractionCreate: 'interactionCreate',
  GuildMemberAdd: 'guildMemberAdd',
  GuildMemberRemove: 'guildMemberRemove',
  GuildCreate: 'guildCreate',
  GuildDelete: 'guildDelete',
  ChannelCreate: 'channelCreate',
  ChannelUpdate: 'channelUpdate',
  ChannelDelete: 'channelDelete',
  Error: 'error',
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
} as const;

/** Tipos de interação (só comandos de barra nesta fase). */
export const InteractionType = { ApplicationCommand: 2 } as const;

/** Tipos de opção de comando, com os nomes usuais; o contrato do OpenCord usa os nomes em minúsculas. */
export const ApplicationCommandOptionType = {
  String: 'string',
  Integer: 'integer',
  Number: 'number',
  Boolean: 'boolean',
  User: 'user',
  Channel: 'channel',
} as const;

import type {
  BotCommand,
  BotCommandInput,
  BotCommandOptionType,
  BotSubcommand,
  BotSubcommandGroup,
  ChannelKind,
} from '@opencord/contracts';
import { ApplicationCommandType, ChannelType, Limits } from '../constants.js';
import { PermissionsBitField, type PermissionResolvable } from '../permissions.js';

// mesmas regras do contrato (CommandName), validadas aqui para o erro aparecer antes de chamar a API
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_OPTIONS = Limits.commandOptions;
const MAX_CHOICES = Limits.choices;

type Choice = { name: string; value: string | number };

/** JSON de uma opção (formato de entrada do contrato: só o que foi definido) */
export interface CommandOptionJSON {
  name: string;
  description: string;
  type: BotCommandOptionType;
  required: boolean;
  choices: Choice[];
  autocomplete?: boolean;
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
  channelTypes?: ChannelKind[];
}

function checkName(kind: string, name: string | undefined): string {
  if (!name || !NAME_RE.test(name))
    throw new Error(`${kind}: nome "${name ?? ''}" inválido (minúsculas, dígitos, _ ou -, até 32 caracteres)`);
  return name;
}
function checkDescription(kind: string, name: string, d: string | undefined): string {
  const t = d?.trim() ?? '';
  if (!t || t.length > 100) throw new Error(`${kind} "${name}": descrição obrigatória (até 100 caracteres)`);
  return t;
}

/** `ChannelType.GuildText`, `'text'`, ou os números que a comunidade usa (0 = texto, 2 = voz) */
export type ChannelTypeResolvable = ChannelKind | (typeof ChannelType)[keyof typeof ChannelType] | 0 | 2;
function resolveChannelKind(t: ChannelTypeResolvable): ChannelKind {
  if (t === 0 || t === ChannelType.GuildText) return 'text';
  if (t === 2 || t === ChannelType.GuildVoice) return 'voice';
  if (t === ChannelType.GuildBoard) return 'board';
  throw new RangeError(
    `tipo de canal "${String(t)}" não vale como filtro de opção (use GuildText, GuildVoice ou GuildBoard)`,
  );
}

/** Uma opção do comando (`addStringOption((o) => o.setName('nome').setDescription('…'))`). */
export class SlashCommandOptionBuilder {
  private name?: string;
  private description?: string;
  private required = false;
  private autocomplete = false;
  private minValue?: number;
  private maxValue?: number;
  private minLength?: number;
  private maxLength?: number;
  private channelTypes?: ChannelKind[];
  private readonly choices: Choice[] = [];

  constructor(readonly type: BotCommandOptionType) {}

  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  setRequired(required = true) {
    this.required = required;
    return this;
  }
  addChoices(...choices: (Choice | Choice[])[]) {
    if (this.type !== 'string' && this.type !== 'integer' && this.type !== 'number')
      throw new Error(`opção "${this.name ?? ''}": escolhas só em string, integer ou number`);
    for (const c of choices.flat()) {
      if (!c.name?.trim() || c.name.length > 100) throw new Error('escolha precisa de name (até 100 caracteres)');
      if (typeof c.value === 'string' && c.value.length > 100) throw new Error('escolha: value até 100 caracteres');
      this.choices.push({ name: c.name, value: c.value });
    }
    if (this.choices.length > MAX_CHOICES) throw new Error(`opção "${this.name ?? ''}": até ${MAX_CHOICES} escolhas`);
    return this;
  }
  setChoices(...choices: (Choice | Choice[])[]) {
    this.choices.length = 0;
    return this.addChoices(...choices);
  }
  /** o bot sugere valores enquanto a pessoa digita (interação `autocomplete`); não combina com `addChoices` */
  setAutocomplete(on = true) {
    if (this.type !== 'string' && this.type !== 'integer' && this.type !== 'number')
      throw new Error(`opção "${this.name ?? ''}": autocompletar só em string, integer ou number`);
    this.autocomplete = on;
    return this;
  }
  setMinValue(n: number) {
    if (this.type !== 'integer' && this.type !== 'number')
      throw new Error(`opção "${this.name ?? ''}": minValue só em integer ou number`);
    this.minValue = n;
    return this;
  }
  setMaxValue(n: number) {
    if (this.type !== 'integer' && this.type !== 'number')
      throw new Error(`opção "${this.name ?? ''}": maxValue só em integer ou number`);
    this.maxValue = n;
    return this;
  }
  setMinLength(n: number) {
    if (this.type !== 'string') throw new Error(`opção "${this.name ?? ''}": minLength só em string`);
    this.minLength = n;
    return this;
  }
  setMaxLength(n: number) {
    if (this.type !== 'string') throw new Error(`opção "${this.name ?? ''}": maxLength só em string`);
    this.maxLength = n;
    return this;
  }
  /** opção `channel`: só canais destes tipos (`ChannelType.GuildText`, `ChannelType.GuildVoice`) */
  addChannelTypes(...types: (ChannelTypeResolvable | ChannelTypeResolvable[])[]) {
    if (this.type !== 'channel') throw new Error(`opção "${this.name ?? ''}": channelTypes só em channel`);
    this.channelTypes = [...new Set([...(this.channelTypes ?? []), ...types.flat().map(resolveChannelKind)])];
    return this;
  }

  toJSON(): CommandOptionJSON {
    const name = checkName('opção', this.name);
    if (this.autocomplete && this.choices.length)
      throw new Error(`opção "${name}": autocompletar não combina com escolhas`);
    if (this.minValue !== undefined && this.maxValue !== undefined && this.minValue > this.maxValue)
      throw new Error(`opção "${name}": minValue > maxValue`);
    if ((this.minLength ?? 0) > (this.maxLength ?? 2000)) throw new Error(`opção "${name}": minLength > maxLength`);
    const out: CommandOptionJSON = {
      name,
      description: checkDescription('opção', name, this.description),
      type: this.type,
      required: this.required,
      choices: this.choices.map((c) => ({ name: c.name, value: c.value })),
    };
    if (this.autocomplete) out.autocomplete = true;
    if (this.minValue !== undefined) out.minValue = this.minValue;
    if (this.maxValue !== undefined) out.maxValue = this.maxValue;
    if (this.minLength !== undefined) out.minLength = this.minLength;
    if (this.maxLength !== undefined) out.maxLength = this.maxLength;
    if (this.channelTypes?.length) out.channelTypes = [...this.channelTypes];
    return out;
  }
}
/** Os mesmos builders com os nomes por tipo que a comunidade usa em `addStringOption(new SlashCommandStringOption()…)`. */
export class SlashCommandStringOption extends SlashCommandOptionBuilder {
  constructor() {
    super('string');
  }
}
export class SlashCommandIntegerOption extends SlashCommandOptionBuilder {
  constructor() {
    super('integer');
  }
}
export class SlashCommandNumberOption extends SlashCommandOptionBuilder {
  constructor() {
    super('number');
  }
}
export class SlashCommandBooleanOption extends SlashCommandOptionBuilder {
  constructor() {
    super('boolean');
  }
}
export class SlashCommandUserOption extends SlashCommandOptionBuilder {
  constructor() {
    super('user');
  }
}
export class SlashCommandChannelOption extends SlashCommandOptionBuilder {
  constructor() {
    super('channel');
  }
}
export class SlashCommandRoleOption extends SlashCommandOptionBuilder {
  constructor() {
    super('role');
  }
}
export class SlashCommandMentionableOption extends SlashCommandOptionBuilder {
  constructor() {
    super('mentionable');
  }
}

type OptionFn = (option: SlashCommandOptionBuilder) => SlashCommandOptionBuilder;
type OptionInput = OptionFn | SlashCommandOptionBuilder;

function checkOptions(kind: string, name: string, options: CommandOptionJSON[]) {
  const names = new Set(options.map((o) => o.name));
  if (names.size !== options.length) throw new Error(`${kind} "${name}": opção repetida`);
  let optionalSeen = false;
  for (const o of options) {
    if (!o.required) optionalSeen = true;
    else if (optionalSeen)
      throw new Error(`${kind} "${name}": a opção obrigatória "${o.name}" precisa vir antes das opcionais`);
  }
}

/** Métodos `add*Option` compartilhados entre o comando e os subcomandos. */
abstract class SharedSlashCommandOptions {
  protected name?: string;
  protected description?: string;
  readonly options: SlashCommandOptionBuilder[] = [];
  protected abstract readonly kind: string;

  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  protected add(type: BotCommandOptionType, input: OptionInput) {
    const b = typeof input === 'function' ? input(new SlashCommandOptionBuilder(type)) : input;
    if (!(b instanceof SlashCommandOptionBuilder)) throw new Error('o callback da opção precisa devolver o builder');
    if (b.type !== type)
      throw new Error(`opção do tipo ${b.type} passada a add${type[0]!.toUpperCase()}${type.slice(1)}Option`);
    this.options.push(b);
    if (this.options.length > MAX_OPTIONS)
      throw new Error(`${this.kind} "${this.name ?? ''}": até ${MAX_OPTIONS} opções`);
    return this;
  }
  addStringOption(input: OptionInput) {
    return this.add('string', input);
  }
  addIntegerOption(input: OptionInput) {
    return this.add('integer', input);
  }
  addNumberOption(input: OptionInput) {
    return this.add('number', input);
  }
  addBooleanOption(input: OptionInput) {
    return this.add('boolean', input);
  }
  addUserOption(input: OptionInput) {
    return this.add('user', input);
  }
  addChannelOption(input: OptionInput) {
    return this.add('channel', input);
  }
  addRoleOption(input: OptionInput) {
    return this.add('role', input);
  }
  addMentionableOption(input: OptionInput) {
    return this.add('mentionable', input);
  }
  /** não há opção de anexo no OpenCord (ADR-0034): peça o arquivo numa mensagem */
  addAttachmentOption(_input: OptionInput): never {
    throw new Error('opções de anexo não existem no OpenCord: peça o arquivo numa mensagem (message.attachments)');
  }
  protected leafOptions(name: string): CommandOptionJSON[] {
    const options = this.options.map((o) => o.toJSON());
    checkOptions(this.kind, name, options);
    return options;
  }
}

/** Subcomando (`/config idioma`): nome, descrição e opções simples. */
export class SlashCommandSubcommandBuilder extends SharedSlashCommandOptions {
  protected readonly kind = 'subcomando';
  toJSON(): BotSubcommand {
    const name = checkName('subcomando', this.name);
    return {
      type: 'subcommand',
      name,
      description: checkDescription('subcomando', name, this.description),
      options: this.leafOptions(name) as BotSubcommand['options'],
    };
  }
}
type SubcommandFn = (sub: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder;
type SubcommandInput = SubcommandFn | SlashCommandSubcommandBuilder;

/** Grupo de subcomandos (`/config canal definir`). */
export class SlashCommandSubcommandGroupBuilder {
  private name?: string;
  private description?: string;
  readonly options: SlashCommandSubcommandBuilder[] = [];

  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  addSubcommand(input: SubcommandInput) {
    const b = typeof input === 'function' ? input(new SlashCommandSubcommandBuilder()) : input;
    if (!(b instanceof SlashCommandSubcommandBuilder))
      throw new Error('o callback do subcomando precisa devolver o builder');
    this.options.push(b);
    if (this.options.length > MAX_OPTIONS)
      throw new Error(`grupo "${this.name ?? ''}": até ${MAX_OPTIONS} subcomandos`);
    return this;
  }
  toJSON(): BotSubcommandGroup {
    const name = checkName('grupo', this.name);
    if (!this.options.length) throw new Error(`grupo "${name}": ao menos um subcomando`);
    const options = this.options.map((s) => s.toJSON());
    if (new Set(options.map((o) => o.name)).size !== options.length)
      throw new Error(`grupo "${name}": subcomando repetido`);
    return { type: 'subcommand_group', name, description: checkDescription('grupo', name, this.description), options };
  }
}
type GroupFn = (group: SlashCommandSubcommandGroupBuilder) => SlashCommandSubcommandGroupBuilder;
type GroupInput = GroupFn | SlashCommandSubcommandGroupBuilder;

/** bits de `Permission`, `PermissionFlagsBits`, nomes, bigint/string (como a comunidade passa) ou null */
export type DefaultMemberPermissionsResolvable = PermissionResolvable | string | null | undefined;
function resolveDefaultPermissions(p: DefaultMemberPermissionsResolvable): number | null {
  if (p === null || p === undefined) return null;
  if (typeof p === 'string' && /^\d+$/.test(p)) return Number(p);
  return PermissionsBitField.resolve(p as PermissionResolvable);
}

/** Comum a comandos de barra e de contexto: permissões exigidas, servidores e flags aceitas/ignoradas. */
class CommandScope {
  protected defaultMemberPermissions: number | null = null;
  protected guildIds: string[] = [];

  /** bits de `Permission` que quem usa precisa ter no servidor (dono/ADMINISTRATOR passam); `null` = qualquer membro */
  setDefaultMemberPermissions(permissions: DefaultMemberPermissionsResolvable) {
    this.defaultMemberPermissions = resolveDefaultPermissions(permissions);
    return this;
  }
  /** só nestes servidores (vazio = em todos em que o bot é membro) */
  setGuildIds(...ids: (string | string[])[]) {
    this.guildIds = [...new Set(ids.flat())];
    if (this.guildIds.length > Limits.guildIds) throw new Error(`até ${Limits.guildIds} servidores em guildIds`);
    return this;
  }
  /** aceitos e ignorados: comandos valem nos servidores em que o bot é membro (não há DM nem instalação por pessoa) */
  setContexts(..._contexts: unknown[]) {
    return this;
  }
  setIntegrationTypes(..._types: unknown[]) {
    return this;
  }
  setDMPermission(_on: boolean) {
    return this;
  }
  setNSFW(_on: boolean) {
    return this;
  }
  setNameLocalizations(_l: unknown) {
    return this;
  }
  setDescriptionLocalizations(_l: unknown) {
    return this;
  }
  /** acrescenta `defaultMemberPermissions`/`guildIds` ao JSON (só quando definidos) */
  apply(out: BotCommandInput) {
    if (this.defaultMemberPermissions !== null) out.defaultMemberPermissions = this.defaultMemberPermissions;
    if (this.guildIds.length) out.guildIds = [...this.guildIds];
    return out;
  }
}

/**
 * Monta a definição de um comando de barra; `toJSON()` devolve o formato que `PUT /bots/@me/commands` aceita.
 * Com `addSubcommand`/`addSubcommandGroup` o comando vira `/nome sub …` (não mistura com opções soltas).
 */
export class SlashCommandBuilder extends SharedSlashCommandOptions {
  protected readonly kind = 'comando';
  readonly subcommands: (SlashCommandSubcommandBuilder | SlashCommandSubcommandGroupBuilder)[] = [];
  private readonly scopeData = new CommandScope();

  /** bits de `Permission` que quem usa precisa ter no servidor (dono/ADMINISTRATOR passam); `null` = qualquer membro */
  setDefaultMemberPermissions(permissions: DefaultMemberPermissionsResolvable) {
    this.scopeData.setDefaultMemberPermissions(permissions);
    return this;
  }
  /** só nestes servidores (vazio = em todos em que o bot é membro) */
  setGuildIds(...ids: (string | string[])[]) {
    this.scopeData.setGuildIds(...ids);
    return this;
  }
  /** aceitos e ignorados: comandos valem nos servidores em que o bot é membro (não há DM nem instalação por pessoa) */
  setContexts(..._contexts: unknown[]) {
    return this;
  }
  setIntegrationTypes(..._types: unknown[]) {
    return this;
  }
  setDMPermission(_on: boolean) {
    return this;
  }
  setNSFW(_on: boolean) {
    return this;
  }
  setNameLocalizations(_l: unknown) {
    return this;
  }
  setDescriptionLocalizations(_l: unknown) {
    return this;
  }

  addSubcommand(input: SubcommandInput) {
    const b = typeof input === 'function' ? input(new SlashCommandSubcommandBuilder()) : input;
    if (!(b instanceof SlashCommandSubcommandBuilder))
      throw new Error('o callback do subcomando precisa devolver o builder');
    this.subcommands.push(b);
    if (this.subcommands.length > MAX_OPTIONS)
      throw new Error(`comando "${this.name ?? ''}": até ${MAX_OPTIONS} subcomandos`);
    return this;
  }
  addSubcommandGroup(input: GroupInput) {
    const b = typeof input === 'function' ? input(new SlashCommandSubcommandGroupBuilder()) : input;
    if (!(b instanceof SlashCommandSubcommandGroupBuilder))
      throw new Error('o callback do grupo precisa devolver o builder');
    this.subcommands.push(b);
    if (this.subcommands.length > MAX_OPTIONS)
      throw new Error(`comando "${this.name ?? ''}": até ${MAX_OPTIONS} subcomandos`);
    return this;
  }

  toJSON(): BotCommandInput {
    const name = checkName('comando', this.name);
    const description = checkDescription('comando', name, this.description);
    if (this.subcommands.length && this.options.length)
      throw new Error(`comando "${name}": não misture subcomandos com opções soltas`);
    let options: BotCommandInput['options'];
    if (this.subcommands.length) {
      options = this.subcommands.map((s) => s.toJSON());
      if (new Set(options.map((o) => o.name)).size !== options.length)
        throw new Error(`comando "${name}": subcomando repetido`);
    } else options = this.leafOptions(name);
    return this.scopeData.apply({ name, description, options });
  }
}

/** `ApplicationCommandType.User`/`Message`, as strings do contrato ou os números 2/3 que a comunidade usa */
export type ContextMenuCommandType = 'user' | 'message' | 2 | 3;

/** Comando de menu de contexto ("Apps" numa pessoa ou mensagem): nome livre, sem opções. */
export class ContextMenuCommandBuilder extends CommandScope {
  private name?: string;
  private type: 'user' | 'message' = 'user';

  setName(name: string) {
    this.name = name;
    return this;
  }
  setType(type: ContextMenuCommandType) {
    if (type === 2 || type === ApplicationCommandType.User) this.type = 'user';
    else if (type === 3 || type === ApplicationCommandType.Message) this.type = 'message';
    else throw new RangeError(`tipo de comando de contexto inválido: ${String(type)}`);
    return this;
  }
  toJSON(): BotCommandInput {
    const name = this.name?.trim() ?? '';
    if (!name || name.length > 32) throw new Error(`comando de contexto: nome "${name}" inválido (1 a 32 caracteres)`);
    return this.apply({ type: this.type, name, description: '', options: [] });
  }
}

export type CommandDefinition = BotCommandInput | BotCommand | { toJSON(): BotCommandInput };

/** Normaliza builders ou objetos crus para o contrato. */
export function toCommandJSON(c: CommandDefinition): BotCommandInput {
  return 'toJSON' in c && typeof c.toJSON === 'function' ? c.toJSON() : (c as BotCommandInput);
}

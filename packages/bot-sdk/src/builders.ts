import type { BotCommand, BotCommandOption, BotCommandOptionType } from '@opencord/contracts';

// mesmas regras do contrato (CommandName), validadas aqui para o erro aparecer antes de chamar a API
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_OPTIONS = 10;
const MAX_CHOICES = 25;

type Choice = { name: string; value: string | number };

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

/** Uma opção do comando (`addStringOption((o) => o.setName('nome').setDescription('…'))`). */
export class SlashCommandOptionBuilder {
  private name?: string;
  private description?: string;
  private required = false;
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
  addChoices(...choices: Choice[]) {
    if (this.type !== 'string' && this.type !== 'integer' && this.type !== 'number')
      throw new Error(`opção "${this.name ?? ''}": escolhas só em string, integer ou number`);
    for (const c of choices) {
      if (!c.name?.trim() || c.name.length > 100) throw new Error('escolha precisa de name (até 100 caracteres)');
      if (typeof c.value === 'string' && c.value.length > 100) throw new Error('escolha: value até 100 caracteres');
      this.choices.push({ name: c.name, value: c.value });
    }
    if (this.choices.length > MAX_CHOICES) throw new Error(`opção "${this.name ?? ''}": até ${MAX_CHOICES} escolhas`);
    return this;
  }
  /** aceito e ignorado (nesta fase não há autocompletar vindo do bot) */
  setAutocomplete(_on: boolean) {
    return this;
  }
  setMinValue(_n: number) {
    return this;
  }
  setMaxValue(_n: number) {
    return this;
  }
  setMinLength(_n: number) {
    return this;
  }
  setMaxLength(_n: number) {
    return this;
  }

  toJSON(): BotCommandOption {
    const name = checkName('opção', this.name);
    const choices = this.choices.map((c) => ({ name: c.name, value: c.value }));
    return {
      name,
      description: checkDescription('opção', name, this.description),
      type: this.type,
      required: this.required,
      choices,
    };
  }
}

type OptionFn = (option: SlashCommandOptionBuilder) => SlashCommandOptionBuilder;

/** Monta a definição de um comando de barra; `toJSON()` devolve o formato que `PUT /bots/@me/commands` aceita. */
export class SlashCommandBuilder {
  private name?: string;
  private description?: string;
  readonly options: SlashCommandOptionBuilder[] = [];

  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  /** aceitos e ignorados: no OpenCord as permissões são as dos cargos do bot e de quem usa */
  setDefaultMemberPermissions(_p: unknown) {
    return this;
  }
  setDMPermission(_on: boolean) {
    return this;
  }
  setNSFW(_on: boolean) {
    return this;
  }

  private add(type: BotCommandOptionType, fn: OptionFn) {
    const b = fn(new SlashCommandOptionBuilder(type));
    if (!(b instanceof SlashCommandOptionBuilder)) throw new Error('o callback da opção precisa devolver o builder');
    this.options.push(b);
    if (this.options.length > MAX_OPTIONS) throw new Error(`comando "${this.name ?? ''}": até ${MAX_OPTIONS} opções`);
    return this;
  }
  addStringOption(fn: OptionFn) {
    return this.add('string', fn);
  }
  addIntegerOption(fn: OptionFn) {
    return this.add('integer', fn);
  }
  addNumberOption(fn: OptionFn) {
    return this.add('number', fn);
  }
  addBooleanOption(fn: OptionFn) {
    return this.add('boolean', fn);
  }
  addUserOption(fn: OptionFn) {
    return this.add('user', fn);
  }
  addChannelOption(fn: OptionFn) {
    return this.add('channel', fn);
  }

  toJSON(): BotCommand {
    const name = checkName('comando', this.name);
    const options = this.options.map((o) => o.toJSON());
    const names = new Set(options.map((o) => o.name));
    if (names.size !== options.length) throw new Error(`comando "${name}": opção repetida`);
    let optionalSeen = false;
    for (const o of options) {
      if (!o.required) optionalSeen = true;
      else if (optionalSeen)
        throw new Error(`comando "${name}": a opção obrigatória "${o.name}" precisa vir antes das opcionais`);
    }
    return { name, description: checkDescription('comando', name, this.description), options };
  }
}

export type CommandDefinition = BotCommand | { toJSON(): BotCommand };

/** Normaliza builders ou objetos crus para o contrato. */
export function toCommandJSON(c: CommandDefinition): BotCommand {
  return 'toJSON' in c && typeof c.toJSON === 'function' ? c.toJSON() : (c as BotCommand);
}

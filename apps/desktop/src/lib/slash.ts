/**
 * Comandos de barra (ADR-0032, v2 na ADR-0034): casar o texto do composer com um comando de bot e transformar o
 * que a pessoa digitou nas opções tipadas que `POST /interactions` espera. Funções puras (testadas em
 * test/slash.test.ts).
 *
 * Formas aceitas: `/clima cidade:Lisboa dias:3`, `/clima Lisboa 3` (posicional, na ordem das opções) e misto.
 * Aspas agrupam (`/clima "São Paulo"`); a última opção de texto recebe o resto da linha sem precisar de aspas.
 * Subcomandos e grupos vêm antes das opções: `/cfg canal definir onde:#geral`.
 */
import type {
  BotCommand,
  BotCommandChoice,
  BotCommandOption,
  BotCommandType,
  BotSubcommand,
  BotSubcommandGroup,
  ChannelKind,
  InteractionOptionValue,
  ServerCommands,
} from '@opencord/contracts';
import { hasPermission, MENTION_RE, Permission } from '@opencord/contracts';

export interface SlashCommandRef {
  botId: string;
  bot: ServerCommands['bot'];
  command: BotCommand;
}

export interface SlashContext {
  members?:
    readonly { user: { id: string; username: string; displayName: string }; nickname: string | null }[] | undefined;
  channels?: readonly { id: string; name: string; kind?: ChannelKind }[] | undefined;
  roles?: readonly { id: string; name: string; color?: string | null; isEveryone?: boolean }[] | undefined;
  /** sugestões que o bot já mandou (autocompletar): o nome escolhido vira o valor na hora de enviar */
  autocompleteChoices?: Readonly<Record<string, readonly BotCommandChoice[]>> | undefined;
}

export type SlashResult =
  | {
      options: Record<string, InteractionOptionValue>;
      subcommandGroup?: string;
      subcommand?: string;
      error?: undefined;
    }
  | { error: string; options?: undefined; subcommandGroup?: undefined; subcommand?: undefined };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYED_RE = /^([a-z0-9_-]{1,32}):([\s\S]*)$/i;

type CommandNode = BotCommand['options'][number];
const isGroup = (o: CommandNode): o is BotSubcommandGroup => 'type' in o && o.type === 'subcommand_group';
const isSub = (o: CommandNode): o is BotSubcommand => 'type' in o && o.type === 'subcommand';
const isLeaf = (o: CommandNode): o is BotCommandOption => !isGroup(o) && !isSub(o);

/** tipo do comando (API antiga sem `type` = barra) */
export const commandType = (cmd: Pick<BotCommand, 'type'>): BotCommandType => cmd.type ?? 'chat';

/**
 * Quem usa precisa ter os bits de `defaultMemberPermissions` no servidor; dono e ADMINISTRATOR sempre passam.
 * A API confere de novo: aqui é só para não oferecer o que vai dar 403.
 */
export function canUseCommand(
  cmd: Pick<BotCommand, 'defaultMemberPermissions'>,
  myPermissions: number | undefined,
  owner = false,
): boolean {
  const need = cmd.defaultMemberPermissions ?? null;
  if (need === null || need === 0 || owner) return true;
  if (myPermissions === undefined) return false;
  return hasPermission(myPermissions, Permission.ADMINISTRATOR) || hasPermission(myPermissions, need);
}

export interface CommandFilter {
  type?: BotCommandType;
  myPermissions?: number | undefined;
  owner?: boolean;
}

/** todos os comandos do servidor numa lista só (nome do bot junto, para o popover), opcionalmente filtrados */
export function flattenCommands(
  list: readonly ServerCommands[] | undefined,
  filter?: CommandFilter,
): SlashCommandRef[] {
  if (!list) return [];
  return list.flatMap((s) =>
    s.commands
      .filter((c) => !filter?.type || commandType(c) === filter.type)
      .filter((c) => !filter || canUseCommand(c, filter.myPermissions, filter.owner))
      .map((command) => ({ botId: s.botId, bot: s.bot, command })),
  );
}

/** nome do comando digitado (`/clima x` → `clima`), ou null se o texto não é um comando */
export function commandWord(text: string): string | null {
  const m = /^\/([a-z0-9_-]{1,32})(?=\s|$)/i.exec(text);
  return m?.[1]?.toLowerCase() ?? null;
}

/** comandos de barra cujo nome começa com o que está sendo digitado depois da barra (para o autocompletar) */
export function filterCommands(text: string, all: readonly SlashCommandRef[], limit = 8): SlashCommandRef[] {
  if (!text.startsWith('/')) return [];
  const q = (text.slice(1).split(/\s/)[0] ?? '').toLowerCase();
  if (!/^[a-z0-9_-]*$/.test(q)) return [];
  return all.filter((c) => commandType(c.command) === 'chat' && c.command.name.startsWith(q)).slice(0, limit);
}

/** o comando de barra que o texto enviado invoca, se houver (`/clima …` casa com `clima`) */
export function matchCommand(text: string, all: readonly SlashCommandRef[]): SlashCommandRef | null {
  const name = commandWord(text);
  if (!name) return null;
  return all.find((c) => commandType(c.command) === 'chat' && c.command.name === name) ?? null;
}

const TYPE_LABEL: Record<BotCommandOption['type'], string> = {
  string: 'texto',
  integer: 'inteiro',
  number: 'número',
  boolean: 'sim/não',
  user: '@pessoa',
  channel: '#canal',
  role: '@cargo',
  mentionable: '@pessoa|@cargo',
};

const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = { text: 'texto', voice: 'voz', board: 'quadro' };

/** limites de uma opção em forma curta: `1–7`, `≥ 1`, `≤ 200` (vazio sem limites) */
export function limitHint(o: BotCommandOption): string {
  const num = o.type === 'integer' || o.type === 'number';
  const lo = num ? o.minValue : o.minLength;
  const hi = num ? o.maxValue : o.maxLength;
  if (lo !== undefined && hi !== undefined) return `${lo}–${hi}`;
  if (lo !== undefined) return `≥ ${lo}`;
  if (hi !== undefined) return `≤ ${hi}`;
  return '';
}

function optionLabel(o: BotCommandOption): string {
  if (o.choices.length) return o.choices.map((c) => c.name).join('|');
  let v = TYPE_LABEL[o.type];
  if (o.type === 'channel' && o.channelTypes?.length)
    v = `#${o.channelTypes.map((k) => CHANNEL_KIND_LABEL[k]).join('|')}`;
  const lim = limitHint(o);
  if (lim) v += ` ${lim}`;
  return v;
}

function hintFor(name: string, prefix: string[], leaf: readonly BotCommandOption[]): string {
  const parts = leaf.map((o) => {
    const p = `${o.name}:<${optionLabel(o)}>`;
    return o.required ? p : `[${p}]`;
  });
  return [`/${name}`, ...prefix, ...parts].join(' ');
}

export interface SlashPath {
  group?: BotSubcommandGroup;
  sub?: BotSubcommand;
  /** opções folha do nível já escolhido (vazio enquanto falta escolher o subcomando) */
  options: readonly BotCommandOption[];
  /** o que vem a seguir: escolher grupo/subcomando, subcomando do grupo, ou já as opções */
  expect: 'group-or-sub' | 'sub' | 'options';
  /** quantos tokens o caminho consumiu (as opções começam depois deles) */
  consumed: number;
  error?: string;
}

/** o comando tem subcomandos/grupos (em vez de opções soltas)? */
export const hasSubcommands = (cmd: BotCommand): boolean => cmd.options.some((o) => !isLeaf(o));

/** resolve `grupo sub` a partir dos primeiros tokens; comandos sem subcomandos vão direto às opções */
export function resolvePath(cmd: BotCommand, words: readonly string[]): SlashPath {
  if (!hasSubcommands(cmd)) return { options: cmd.options.filter(isLeaf), expect: 'options', consumed: 0 };
  const first = words[0]?.toLowerCase();
  if (first === undefined) return { options: [], expect: 'group-or-sub', consumed: 0 };
  const node = cmd.options.find((o) => !isLeaf(o) && o.name === first);
  if (!node || isLeaf(node)) {
    const names = cmd.options.filter((o) => !isLeaf(o)).map((o) => o.name);
    return { options: [], expect: 'group-or-sub', consumed: 0, error: `/${cmd.name}: use ${names.join(', ')}.` };
  }
  if (isSub(node)) return { sub: node, options: node.options, expect: 'options', consumed: 1 };
  const second = words[1]?.toLowerCase();
  if (second === undefined) return { group: node, options: [], expect: 'sub', consumed: 1 };
  const sub = node.options.find((s) => s.name === second);
  if (!sub) {
    const names = node.options.map((s) => s.name);
    return {
      group: node,
      options: [],
      expect: 'sub',
      consumed: 1,
      error: `/${cmd.name} ${node.name}: use ${names.join(', ')}.`,
    };
  }
  return { group: node, sub, options: sub.options, expect: 'options', consumed: 2 };
}

/**
 * dica mostrada enquanto se digita: `/clima cidade:<texto> [dias:<inteiro>]`; com subcomandos, mostra o próximo
 * nível (`/cfg <canal|cargo>`) e, escolhido, as opções dele (`/cfg canal definir onde:<#canal>`)
 */
export function commandHint(cmd: BotCommand, text?: string): string {
  if (!hasSubcommands(cmd)) return hintFor(cmd.name, [], cmd.options.filter(isLeaf));
  const words = text ? tokenize(text.slice(1 + (commandWord(text)?.length ?? 0))).map((t) => t.text) : [];
  const path = resolvePath(cmd, words);
  if (path.error || path.expect === 'group-or-sub') {
    const names = cmd.options.filter((o) => !isLeaf(o)).map((o) => o.name);
    return `/${cmd.name} <${names.join('|')}>`;
  }
  if (path.expect === 'sub' && path.group)
    return `/${cmd.name} ${path.group.name} <${path.group.options.map((s) => s.name).join('|')}>`;
  const prefix = [path.group?.name, path.sub?.name].filter((x): x is string => Boolean(x));
  return hintFor(cmd.name, prefix, path.options);
}

interface Token {
  text: string;
  start: number;
  end: number;
  quoted: boolean;
}

/** separa por espaços; aspas (duplas ou simples) agrupam e são removidas */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i] as string)) i++;
    if (i >= src.length) break;
    const start = i;
    let text = '';
    let quoted = false;
    let quote: string | null = null;
    while (i < src.length) {
      const ch = src[i] as string;
      if (quote) {
        if (ch === quote) quote = null;
        else text += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        // só conta como "entre aspas" quando o token começa com elas (`cidade:"São Paulo"` continua chave:valor)
        if (i === start) quoted = true;
      } else if (/\s/.test(ch)) break;
      else text += ch;
      i++;
    }
    out.push({ text, start, end: i, quoted });
  }
  return out;
}

function fail(msg: string): SlashResult {
  return { error: msg };
}

/** confere minValue/maxValue (números) e minLength/maxLength (texto); null quando está dentro dos limites */
export function limitError(o: BotCommandOption, value: InteractionOptionValue): string | null {
  if (typeof value === 'number') {
    if (o.minValue !== undefined && o.maxValue !== undefined && (value < o.minValue || value > o.maxValue))
      return `"${o.name}" precisa estar entre ${o.minValue} e ${o.maxValue}.`;
    if (o.minValue !== undefined && value < o.minValue) return `"${o.name}" precisa ser no mínimo ${o.minValue}.`;
    if (o.maxValue !== undefined && value > o.maxValue) return `"${o.name}" precisa ser no máximo ${o.maxValue}.`;
  } else if (typeof value === 'string' && o.type === 'string') {
    const n = value.length;
    if (o.minLength !== undefined && o.maxLength !== undefined && (n < o.minLength || n > o.maxLength))
      return `"${o.name}" precisa ter entre ${o.minLength} e ${o.maxLength} caracteres.`;
    if (o.minLength !== undefined && n < o.minLength)
      return `"${o.name}" precisa ter pelo menos ${o.minLength} caracteres.`;
    if (o.maxLength !== undefined && n > o.maxLength)
      return `"${o.name}" precisa ter no máximo ${o.maxLength} caracteres.`;
  }
  return null;
}

function findMember(v: string, ctx: SlashContext): string | null {
  const m = new RegExp(MENTION_RE.source, 'i').exec(v);
  if (m?.[1]) return m[1].toLowerCase();
  if (UUID_RE.test(v)) return v.toLowerCase();
  const name = v.replace(/^@/, '').toLowerCase();
  const hit = ctx.members?.find(
    (mb) =>
      mb.user.username.toLowerCase() === name ||
      mb.user.displayName.toLowerCase() === name ||
      mb.nickname?.toLowerCase() === name,
  );
  return hit?.user.id ?? null;
}

function findRole(v: string, ctx: SlashContext): string | null {
  if (UUID_RE.test(v)) return v.toLowerCase();
  const name = v.replace(/^@/, '').toLowerCase();
  const hit = ctx.roles?.find((r) => !r.isEveryone && r.name.toLowerCase() === name);
  return hit?.id ?? null;
}

function convert(o: BotCommandOption, raw: string, ctx: SlashContext): InteractionOptionValue | SlashResult {
  const v = raw.trim();
  if (!v) return fail(`Falta o valor de "${o.name}".`);
  // sugestão do bot escolhida pelo nome: vai o valor
  const picked = ctx.autocompleteChoices?.[o.name]?.find((c) => c.name.toLowerCase() === v.toLowerCase());
  if (picked) return picked.value;
  let value: InteractionOptionValue;
  switch (o.type) {
    case 'integer': {
      if (!/^-?\d+$/.test(v)) return fail(`"${o.name}" precisa ser um número inteiro.`);
      value = Number(v);
      break;
    }
    case 'number': {
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n)) return fail(`"${o.name}" precisa ser um número.`);
      value = n;
      break;
    }
    case 'boolean': {
      const low = v.toLowerCase();
      if (['sim', 's', 'true', 'yes', '1', 'on'].includes(low)) value = true;
      else if (['não', 'nao', 'n', 'false', 'no', '0', 'off'].includes(low)) value = false;
      else return fail(`"${o.name}" aceita sim ou não.`);
      break;
    }
    case 'user': {
      const id = findMember(v, ctx);
      if (!id) return fail(`Não achei @${v.replace(/^@/, '')} neste servidor.`);
      value = id;
      break;
    }
    case 'role': {
      const id = findRole(v, ctx);
      if (!id) return fail(`Não achei o cargo @${v.replace(/^@/, '')} neste servidor.`);
      value = id;
      break;
    }
    case 'mentionable': {
      const id = findMember(v, ctx) ?? findRole(v, ctx);
      if (!id) return fail(`Não achei @${v.replace(/^@/, '')} (pessoa ou cargo) neste servidor.`);
      value = id;
      break;
    }
    case 'channel': {
      const kinds = o.channelTypes?.length ? o.channelTypes : null;
      let hit: { id: string; name: string; kind?: ChannelKind } | undefined;
      if (UUID_RE.test(v)) {
        hit = ctx.channels?.find((c) => c.id.toLowerCase() === v.toLowerCase()) ?? { id: v.toLowerCase(), name: v };
      } else {
        const name = v.replace(/^#/, '').toLowerCase();
        hit = ctx.channels?.find((c) => c.name.toLowerCase() === name);
        if (!hit) return fail(`Não achei #${name} neste servidor.`);
      }
      if (kinds && hit.kind && !kinds.includes(hit.kind))
        return fail(`"${o.name}" aceita só canal de ${kinds.map((k) => CHANNEL_KIND_LABEL[k]).join(' ou ')}.`);
      value = hit.id;
      break;
    }
    default:
      value = v;
  }
  if (o.choices.length) {
    const low = String(value).toLowerCase();
    const choice = o.choices.find((c) => String(c.value).toLowerCase() === low || c.name.toLowerCase() === low);
    if (!choice) return fail(`"${o.name}": use ${o.choices.map((c) => c.name).join(', ')}.`);
    value = choice.value;
  }
  const lim = limitError(o, value);
  if (lim) return fail(lim);
  return value;
}

const isResult = (x: InteractionOptionValue | SlashResult): x is SlashResult => typeof x === 'object';

interface Collected {
  raw: Map<string, string>;
  /** próxima opção posicional ainda sem valor */
  next: BotCommandOption | undefined;
  error?: string;
}

/**
 * junta `chave:valor` e posicionais num mapa opção → texto cru. `tail` liga a regra "a última opção de texto
 * recebe o resto da linha" (desligada durante as sugestões, para não engolir o que está sendo digitado).
 */
function collect(
  name: string,
  rest: string,
  tokens: readonly Token[],
  options: readonly BotCommandOption[],
  tail: boolean,
): Collected {
  const raw = new Map<string, string>();
  const byName = new Map(options.map((o) => [o.name, o]));
  let positional = 0;
  const nextPositional = () => {
    while (positional < options.length && raw.has((options[positional] as BotCommandOption).name)) positional++;
    return options[positional];
  };
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t] as Token;
    const keyed = !tok.quoted ? KEYED_RE.exec(tok.text) : null;
    const key = keyed?.[1]?.toLowerCase();
    if (keyed && key && byName.has(key)) {
      let value = keyed[2] ?? '';
      // `cidade: Lisboa` (espaço depois dos dois-pontos): o valor é o token seguinte
      if (!value && tokens[t + 1]) value = (tokens[++t] as Token).text;
      raw.set(key, value);
      continue;
    }
    // posicional: a próxima opção ainda sem valor, na ordem declarada
    const opt = nextPositional();
    if (!opt) return { raw, next: undefined, error: `/${name} não aceita "${tok.text}".` };
    const last = positional === options.length - 1;
    if (tail && last && opt.type === 'string' && !tok.quoted) {
      // a última opção de texto recebe o resto da linha ("/lembrar 10 comprar pão e leite")
      raw.set(opt.name, rest.slice(tok.start).trim());
      break;
    }
    raw.set(opt.name, tok.text);
    positional++;
  }
  return { raw, next: nextPositional() };
}

/** transforma `/cmd …` nas opções do comando (e subcomando/grupo); erro curto em pt-BR quando algo não bate */
export function parseSlash(text: string, cmd: BotCommand, ctx: SlashContext = {}): SlashResult {
  const name = commandWord(text);
  if (name !== cmd.name) return fail('Comando não reconhecido.');
  const rest = text.slice(1 + name.length);
  const tokens = tokenize(rest);
  const path = resolvePath(
    cmd,
    tokens.slice(0, 2).map((t) => t.text),
  );
  if (path.error) return fail(path.error);
  if (path.expect !== 'options') return fail(`Falta o subcomando. Ex.: ${commandHint(cmd, text)}`);
  const col = collect(cmd.name, rest, tokens.slice(path.consumed), path.options, true);
  if (col.error) return fail(col.error);

  const options: Record<string, InteractionOptionValue> = {};
  for (const o of path.options) {
    const v = col.raw.get(o.name);
    if (v === undefined) {
      if (o.required) return fail(`Falta "${o.name}". Ex.: ${commandHint(cmd, text)}`);
      continue;
    }
    const c = convert(o, v, ctx);
    if (isResult(c)) return c;
    options[o.name] = c;
  }
  return {
    options,
    ...(path.group ? { subcommandGroup: path.group.name } : {}),
    ...(path.sub ? { subcommand: path.sub.name } : {}),
  };
}

/** `POST /interactions` de um comando de barra (forma `command` do `CreateInteractionRequest`) */
export interface CommandInteractionBody {
  type: 'command';
  channelId: string;
  botId: string;
  command: string;
  subcommandGroup?: string;
  subcommand?: string;
  options: Record<string, InteractionOptionValue>;
}

/** corpo de `POST /interactions` para um comando de barra já interpretado */
export function interactionBody(
  ref: SlashCommandRef,
  channelId: string,
  parsed: Extract<SlashResult, { error?: undefined }>,
): CommandInteractionBody {
  return {
    type: 'command',
    channelId,
    botId: ref.botId,
    command: ref.command.name,
    ...(parsed.subcommandGroup ? { subcommandGroup: parsed.subcommandGroup } : {}),
    ...(parsed.subcommand ? { subcommand: parsed.subcommand } : {}),
    options: parsed.options,
  };
}

// ---------------------------------------------------------------------------
// Sugestões enquanto digita (depois do nome do comando)
// ---------------------------------------------------------------------------

export interface SlashSuggestion {
  /** texto que entra no lugar do trecho em edição */
  insert: string;
  label: string;
  detail?: string;
  /** bolinha de cor (cargo) */
  color?: string | null;
  kind: 'group' | 'subcommand' | 'option' | 'value';
}

export interface SlashAutocomplete {
  /** opção em foco (tem `autocomplete: true`) e o que já foi digitado nela */
  option: BotCommandOption;
  typed: string;
  subcommandGroup?: string;
  subcommand?: string;
  /** as outras opções já preenchidas (as que deram para converter) + a em foco com o texto atual */
  options: Record<string, InteractionOptionValue>;
}

export interface SlashSuggestState {
  /** trecho do texto (índices absolutos no composer) que a escolha substitui */
  start: number;
  end: number;
  /** o que foi digitado nesse trecho (até o cursor) */
  typed: string;
  items: SlashSuggestion[];
  /** a opção em foco pede sugestões ao bot */
  autocomplete?: SlashAutocomplete;
}

const quote = (v: string) => (/\s/.test(v) ? `"${v.replace(/"/g, '')}"` : v);
const starts = (s: string, q: string) => s.toLowerCase().startsWith(q);
const MAX_SUGGESTIONS = 8;

/** sugestões de valor para uma opção, pelo tipo (escolhas, pessoas, cargos, canais, sim/não) */
export function valueSuggestions(o: BotCommandOption, typed: string, ctx: SlashContext): SlashSuggestion[] {
  const q = typed.trim().replace(/^[@#]/, '').toLowerCase();
  const out: SlashSuggestion[] = [];
  const keyed = (v: string) => `${o.name}:${quote(v)} `;
  if (o.choices.length) {
    for (const c of o.choices)
      if (!q || starts(c.name, q) || starts(String(c.value), q))
        out.push({ kind: 'value', insert: keyed(c.name), label: c.name, detail: String(c.value) });
    return out.slice(0, MAX_SUGGESTIONS);
  }
  if (o.type === 'boolean') {
    for (const v of ['sim', 'não']) if (!q || starts(v, q)) out.push({ kind: 'value', insert: keyed(v), label: v });
    return out;
  }
  if (o.type === 'user' || o.type === 'mentionable') {
    for (const m of ctx.members ?? []) {
      const shown = m.nickname ?? m.user.displayName;
      if (!q || starts(m.user.username, q) || starts(shown, q) || starts(m.user.displayName, q))
        out.push({ kind: 'value', insert: keyed(`@${m.user.username}`), label: shown, detail: `@${m.user.username}` });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
  }
  if (o.type === 'role' || o.type === 'mentionable') {
    for (const r of ctx.roles ?? []) {
      if (r.isEveryone) continue;
      if (!q || starts(r.name, q))
        out.push({ kind: 'value', insert: keyed(`@${r.name}`), label: `@${r.name}`, detail: 'cargo', color: r.color });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
  }
  if (o.type === 'channel') {
    const kinds = o.channelTypes?.length ? o.channelTypes : null;
    for (const c of ctx.channels ?? []) {
      if (kinds && c.kind && !kinds.includes(c.kind)) continue;
      if (!q || starts(c.name, q))
        out.push({
          kind: 'value',
          insert: keyed(`#${c.name}`),
          label: `#${c.name}`,
          detail: c.kind ? CHANNEL_KIND_LABEL[c.kind] : undefined,
        });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/** sugestões vindas do bot (autocompletar) no formato do popover */
export function choiceSuggestions(o: BotCommandOption, choices: readonly BotCommandChoice[]): SlashSuggestion[] {
  return choices.map((c) => ({
    kind: 'value',
    insert: `${o.name}:${quote(c.name)} `,
    label: c.name,
    detail: String(c.value) !== c.name ? String(c.value) : undefined,
  }));
}

/**
 * O que sugerir para o trecho onde está o cursor: grupo/subcomando, nomes de opção (`dias:`) ou valores da opção
 * em foco. null quando não há o que sugerir (ou o cursor ainda está no nome do comando).
 */
export function suggestSlash(
  text: string,
  caret: number,
  ref: SlashCommandRef,
  ctx: SlashContext = {},
): SlashSuggestState | null {
  const cmd = ref.command;
  const name = commandWord(text);
  if (name !== cmd.name) return null;
  const head = 1 + name.length;
  if (caret <= head) return null;
  const rest = text.slice(head);
  const rel = caret - head;
  const tokens = tokenize(rest);
  let idx = tokens.findIndex((t) => t.start <= rel && rel <= t.end);
  let cur: Token;
  if (idx < 0) {
    idx = tokens.findIndex((t) => t.start > rel);
    if (idx < 0) idx = tokens.length;
    cur = { text: '', start: rel, end: rel, quoted: false };
  } else cur = tokens[idx] as Token;
  const typedRaw = rest.slice(cur.start, rel);
  const typed = typedRaw.replace(/^["']/, '');
  const before = tokens.slice(0, idx);
  const base = { start: head + cur.start, end: head + cur.end, typed };
  const q = typed.toLowerCase();

  if (hasSubcommands(cmd)) {
    const words = before.slice(0, 2).map((t) => t.text);
    const path = resolvePath(cmd, words);
    if (path.error) return null;
    if (path.expect === 'group-or-sub') {
      const items: SlashSuggestion[] = cmd.options
        .filter((o): o is BotSubcommand | BotSubcommandGroup => !isLeaf(o))
        .filter((o) => starts(o.name, q))
        .map((o) => ({
          kind: isGroup(o) ? 'group' : 'subcommand',
          insert: `${o.name} `,
          label: o.name,
          detail: o.description,
        }));
      return { ...base, items };
    }
    if (path.expect === 'sub' && path.group) {
      const items: SlashSuggestion[] = path.group.options
        .filter((s) => starts(s.name, q))
        .map((s) => ({ kind: 'subcommand', insert: `${s.name} `, label: s.name, detail: s.description }));
      return { ...base, items };
    }
    return leafSuggestions(cmd, rest, before.slice(path.consumed), path, cur, typed, ctx, base);
  }
  return leafSuggestions(cmd, rest, before, resolvePath(cmd, []), cur, typed, ctx, base);
}

function leafSuggestions(
  cmd: BotCommand,
  rest: string,
  before: readonly Token[],
  path: SlashPath,
  cur: Token,
  typed: string,
  ctx: SlashContext,
  base: { start: number; end: number; typed: string },
): SlashSuggestState | null {
  const col = collect(cmd.name, rest, before, path.options, false);
  if (col.error) return null;
  const keyed = !cur.quoted ? KEYED_RE.exec(typed) : null;
  const key = keyed?.[1]?.toLowerCase();
  const keyedOpt = key ? path.options.find((o) => o.name === key) : undefined;
  // `dias:3|` → valores de "dias"; `Lis|` → nomes de opção que começam assim + valores da próxima posicional
  const focus = keyedOpt ?? col.next;
  const valueTyped = (keyedOpt ? (keyed?.[2] ?? '') : typed).replace(/^["']/, '');
  const items: SlashSuggestion[] = [];
  if (!keyedOpt) {
    const q = typed.toLowerCase();
    for (const o of path.options) {
      if (col.raw.has(o.name) || !starts(o.name, q)) continue;
      items.push({ kind: 'option', insert: `${o.name}:`, label: `${o.name}:`, detail: o.description });
    }
  }
  let autocomplete: SlashAutocomplete | undefined;
  if (focus) {
    if (focus.autocomplete) {
      const options: Record<string, InteractionOptionValue> = {};
      for (const o of path.options) {
        const v = col.raw.get(o.name);
        if (v === undefined || o.name === focus.name) continue;
        const c = convert(o, v, ctx);
        if (!isResult(c)) options[o.name] = c;
      }
      options[focus.name] = valueTyped;
      autocomplete = {
        option: focus,
        typed: valueTyped,
        options,
        ...(path.group ? { subcommandGroup: path.group.name } : {}),
        ...(path.sub ? { subcommand: path.sub.name } : {}),
      };
    } else items.push(...valueSuggestions(focus, valueTyped, ctx));
  }
  return { ...base, items: items.slice(0, MAX_SUGGESTIONS), ...(autocomplete ? { autocomplete } : {}) };
}

export interface AutocompleteInteractionBody extends Omit<CommandInteractionBody, 'type'> {
  type: 'autocomplete';
  focused: string;
}

/** corpo de `POST /interactions { type: 'autocomplete' }` para a opção em foco */
export function autocompleteBody(
  ref: SlashCommandRef,
  channelId: string,
  a: SlashAutocomplete,
): AutocompleteInteractionBody {
  return {
    type: 'autocomplete',
    channelId,
    botId: ref.botId,
    command: ref.command.name,
    ...(a.subcommandGroup ? { subcommandGroup: a.subcommandGroup } : {}),
    ...(a.subcommand ? { subcommand: a.subcommand } : {}),
    options: a.options,
    focused: a.option.name,
  };
}

/**
 * aviso curto enquanto digita: valor fora de `minValue/maxValue` ou `minLength/maxLength` (só isso; tipo errado e
 * opção faltando esperam o envio, para não gritar a cada tecla)
 */
export function liveLimitError(text: string, cmd: BotCommand): string | null {
  const name = commandWord(text);
  if (name !== cmd.name) return null;
  const rest = text.slice(1 + name.length);
  const tokens = tokenize(rest);
  const path = resolvePath(
    cmd,
    tokens.slice(0, 2).map((t) => t.text),
  );
  if (path.error || path.expect !== 'options') return null;
  const col = collect(cmd.name, rest, tokens.slice(path.consumed), path.options, true);
  for (const o of path.options) {
    const v = col.raw.get(o.name);
    if (v === undefined || !v.trim()) continue;
    if (o.type === 'integer' || o.type === 'number') {
      const n = Number(v.replace(',', '.'));
      if (Number.isFinite(n)) {
        const e = limitError(o, n);
        if (e) return e;
      }
    } else if (o.type === 'string') {
      const e = limitError(o, v);
      if (e) return e;
    }
  }
  return null;
}

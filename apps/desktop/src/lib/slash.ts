/**
 * Comandos de barra (ADR-0032): casar o texto do composer com um comando de bot e transformar o que a pessoa
 * digitou nas opções tipadas que `POST /interactions` espera. Funções puras (testadas em test/slash.test.ts).
 *
 * Formas aceitas: `/clima cidade:Lisboa dias:3`, `/clima Lisboa 3` (posicional, na ordem das opções) e misto.
 * Aspas agrupam (`/clima "São Paulo"`); a última opção de texto recebe o resto da linha sem precisar de aspas.
 */
import type { BotCommand, BotCommandOption, InteractionOptionValue, ServerCommands } from '@opencord/contracts';
import { MENTION_RE } from '@opencord/contracts';

export interface SlashCommandRef {
  botId: string;
  bot: ServerCommands['bot'];
  command: BotCommand;
}

export interface SlashContext {
  members?:
    readonly { user: { id: string; username: string; displayName: string }; nickname: string | null }[] | undefined;
  channels?: readonly { id: string; name: string }[] | undefined;
}

export type SlashResult =
  { options: Record<string, InteractionOptionValue>; error?: undefined } | { error: string; options?: undefined };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** todos os comandos do servidor numa lista só (nome do bot junto, para o popover) */
export function flattenCommands(list: readonly ServerCommands[] | undefined): SlashCommandRef[] {
  if (!list) return [];
  return list.flatMap((s) => s.commands.map((command) => ({ botId: s.botId, bot: s.bot, command })));
}

/** nome do comando digitado (`/clima x` → `clima`), ou null se o texto não é um comando */
export function commandWord(text: string): string | null {
  const m = /^\/([a-z0-9_-]{1,32})(?=\s|$)/i.exec(text);
  return m?.[1]?.toLowerCase() ?? null;
}

/** comandos cujo nome começa com o que está sendo digitado depois da barra (para o autocompletar) */
export function filterCommands(text: string, all: readonly SlashCommandRef[], limit = 8): SlashCommandRef[] {
  if (!text.startsWith('/')) return [];
  const q = (text.slice(1).split(/\s/)[0] ?? '').toLowerCase();
  if (!/^[a-z0-9_-]*$/.test(q)) return [];
  return all.filter((c) => c.command.name.startsWith(q)).slice(0, limit);
}

/** o comando que o texto enviado invoca, se houver (`/clima …` casa com `clima`) */
export function matchCommand(text: string, all: readonly SlashCommandRef[]): SlashCommandRef | null {
  const name = commandWord(text);
  if (!name) return null;
  return all.find((c) => c.command.name === name) ?? null;
}

const TYPE_LABEL: Record<BotCommandOption['type'], string> = {
  string: 'texto',
  integer: 'inteiro',
  number: 'número',
  boolean: 'sim/não',
  user: '@pessoa',
  channel: '#canal',
};

/** dica mostrada enquanto se digita: `/clima cidade:<texto> [dias:<inteiro>]` */
export function commandHint(cmd: BotCommand): string {
  const parts = cmd.options.map((o) => {
    const v = o.choices.length ? o.choices.map((c) => c.name).join('|') : TYPE_LABEL[o.type];
    const p = `${o.name}:<${v}>`;
    return o.required ? p : `[${p}]`;
  });
  return [`/${cmd.name}`, ...parts].join(' ');
}

interface Token {
  text: string;
  start: number;
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
    out.push({ text, start, quoted });
  }
  return out;
}

function fail(msg: string): SlashResult {
  return { error: msg };
}

function convert(o: BotCommandOption, raw: string, ctx: SlashContext): InteractionOptionValue | SlashResult {
  const v = raw.trim();
  if (!v) return fail(`Falta o valor de "${o.name}".`);
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
      const m = new RegExp(MENTION_RE.source, 'i').exec(v);
      if (m?.[1]) value = m[1].toLowerCase();
      else if (UUID_RE.test(v)) value = v.toLowerCase();
      else {
        const name = v.replace(/^@/, '').toLowerCase();
        const hit = ctx.members?.find(
          (mb) =>
            mb.user.username.toLowerCase() === name ||
            mb.user.displayName.toLowerCase() === name ||
            mb.nickname?.toLowerCase() === name,
        );
        if (!hit) return fail(`Não achei @${name} neste servidor.`);
        value = hit.user.id;
      }
      break;
    }
    case 'channel': {
      if (UUID_RE.test(v)) value = v.toLowerCase();
      else {
        const name = v.replace(/^#/, '').toLowerCase();
        const hit = ctx.channels?.find((c) => c.name.toLowerCase() === name);
        if (!hit) return fail(`Não achei #${name} neste servidor.`);
        value = hit.id;
      }
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
  return value;
}

const isResult = (x: InteractionOptionValue | SlashResult): x is SlashResult => typeof x === 'object';

/** transforma `/cmd …` nas opções do comando; erro curto em pt-BR quando algo não bate */
export function parseSlash(text: string, cmd: BotCommand, ctx: SlashContext = {}): SlashResult {
  const name = commandWord(text);
  if (name !== cmd.name) return fail('Comando não reconhecido.');
  const rest = text.slice(1 + name.length);
  const tokens = tokenize(rest);
  const raw = new Map<string, string>();
  const byName = new Map(cmd.options.map((o) => [o.name, o]));
  let positional = 0;

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t] as Token;
    const keyed = !tok.quoted ? /^([a-z0-9_-]{1,32}):([\s\S]*)$/i.exec(tok.text) : null;
    const key = keyed?.[1]?.toLowerCase();
    if (keyed && key && byName.has(key)) {
      let value = keyed[2] ?? '';
      // `cidade: Lisboa` (espaço depois dos dois-pontos): o valor é o token seguinte
      if (!value && tokens[t + 1]) value = (tokens[++t] as Token).text;
      raw.set(key, value);
      continue;
    }
    // posicional: a próxima opção ainda sem valor, na ordem declarada
    while (positional < cmd.options.length && raw.has((cmd.options[positional] as BotCommandOption).name)) positional++;
    const opt = cmd.options[positional];
    if (!opt) return fail(`/${cmd.name} não aceita "${tok.text}".`);
    const last = positional === cmd.options.length - 1;
    if (last && opt.type === 'string' && !tok.quoted) {
      // a última opção de texto recebe o resto da linha ("/lembrar 10 comprar pão e leite")
      raw.set(opt.name, rest.slice(tok.start).trim());
      break;
    }
    raw.set(opt.name, tok.text);
    positional++;
  }

  const options: Record<string, InteractionOptionValue> = {};
  for (const o of cmd.options) {
    const v = raw.get(o.name);
    if (v === undefined) {
      if (o.required) return fail(`Falta "${o.name}". Ex.: ${commandHint(cmd)}`);
      continue;
    }
    const c = convert(o, v, ctx);
    if (isResult(c)) return c;
    options[o.name] = c;
  }
  return { options };
}

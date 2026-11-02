import { Permission, type BotCommand, type BotCommandOption, type ServerCommands } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import {
  autocompleteBody,
  canUseCommand,
  choiceSuggestions,
  commandHint,
  filterCommands,
  flattenCommands,
  interactionBody,
  limitHint,
  liveLimitError,
  matchCommand,
  parseSlash,
  suggestSlash,
  valueSuggestions,
} from '../src/lib/slash';

const bot = { id: 'b1', username: 'clima_bot', displayName: 'Clima', avatarKey: null, bot: true };
const opt = (o: Partial<BotCommandOption> & Pick<BotCommandOption, 'name' | 'type'>): BotCommandOption => ({
  description: o.name,
  required: false,
  choices: [],
  autocomplete: false,
  ...o,
});
const cmd = (c: Partial<BotCommand> & Pick<BotCommand, 'name'>): BotCommand => ({
  type: 'chat',
  description: c.name,
  options: [],
  defaultMemberPermissions: null,
  guildIds: [],
  ...c,
});
const clima = cmd({
  name: 'clima',
  description: 'Previsão do tempo',
  options: [opt({ name: 'cidade', type: 'string', required: true }), opt({ name: 'dias', type: 'integer' })],
});
const lembrar = cmd({
  name: 'lembrar',
  description: 'Lembrete',
  options: [
    opt({ name: 'minutos', description: 'Em quantos minutos', type: 'integer', required: true }),
    opt({ name: 'texto', description: 'O que lembrar', type: 'string', required: true }),
  ],
});
const tipos = cmd({
  name: 'tipos',
  description: 'Todos os tipos',
  options: [
    opt({ name: 'n', type: 'number' }),
    opt({ name: 'ok', type: 'boolean' }),
    opt({ name: 'quem', type: 'user' }),
    opt({ name: 'onde', type: 'channel' }),
    opt({
      name: 'modo',
      type: 'string',
      choices: [
        { name: 'Rápido', value: 'fast' },
        { name: 'Lento', value: 'slow' },
      ],
    }),
  ],
});
/** v2: cargo, mencionável, canal filtrado por tipo e limites */
const v2 = cmd({
  name: 'v2',
  options: [
    opt({ name: 'cargo', type: 'role' }),
    opt({ name: 'alvo', type: 'mentionable' }),
    opt({ name: 'voz', type: 'channel', channelTypes: ['voice'] }),
    opt({ name: 'nota', type: 'integer', minValue: 1, maxValue: 5 }),
    opt({ name: 'apelido', type: 'string', minLength: 2, maxLength: 5 }),
  ],
});
/** v2: grupos e subcomandos */
const cfg = cmd({
  name: 'cfg',
  options: [
    {
      type: 'subcommand_group',
      name: 'canal',
      description: 'Canais',
      options: [
        {
          type: 'subcommand',
          name: 'definir',
          description: 'Define o canal',
          options: [opt({ name: 'onde', type: 'channel', required: true }), opt({ name: 'dias', type: 'integer' })],
        },
        { type: 'subcommand', name: 'limpar', description: 'Limpa', options: [] },
      ],
    },
    { type: 'subcommand', name: 'ver', description: 'Mostra a configuração', options: [] },
  ],
});
/** v2: autocompletar */
const busca = cmd({
  name: 'busca',
  options: [
    opt({ name: 'termo', type: 'string', required: true, autocomplete: true }),
    opt({ name: 'limite', type: 'integer' }),
  ],
});
const soMods = cmd({ name: 'so-mods', defaultMemberPermissions: Permission.KICK_MEMBERS | Permission.BAN_MEMBERS });
const reportar = cmd({ name: 'Reportar', type: 'message' });
const server: ServerCommands[] = [
  { botId: 'b1', bot, commands: [clima, lembrar, tipos, v2, cfg, busca, soMods, reportar] },
];
const all = flattenCommands(server);
const ref = (c: BotCommand) => ({ botId: 'b1', bot, command: c });
const uid = '11111111-2222-4333-8444-555555555555';
const cid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const vid = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const rid = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ctx = {
  members: [{ user: { id: uid, username: 'ana', displayName: 'Ana Souza' }, nickname: 'Aninha' }],
  channels: [
    { id: cid, name: 'geral', kind: 'text' as const },
    { id: vid, name: 'sala', kind: 'voice' as const },
  ],
  roles: [
    { id: 'everyone', name: '@everyone', isEveryone: true },
    { id: rid, name: 'Mod Team', color: '#ff0000' },
  ],
};

describe('slash: casar comandos', () => {
  it('lista os de barra que começam com o que foi digitado (nunca os de contexto)', () => {
    expect(filterCommands('/', all).map((c) => c.command.name)).toEqual([
      'clima',
      'lembrar',
      'tipos',
      'v2',
      'cfg',
      'busca',
      'so-mods',
    ]);
    expect(filterCommands('/le', all).map((c) => c.command.name)).toEqual(['lembrar']);
    expect(filterCommands('/x', all)).toEqual([]);
    expect(filterCommands('oi /clima', all)).toEqual([]);
  });
  it('casa só o nome inteiro seguido de espaço ou fim', () => {
    expect(matchCommand('/clima Lisboa', all)?.command.name).toBe('clima');
    expect(matchCommand('/clima', all)?.command.name).toBe('clima');
    expect(matchCommand('/climax', all)).toBeNull();
    expect(matchCommand('/ clima', all)).toBeNull();
    expect(matchCommand('texto normal', all)).toBeNull();
  });
  it('dica mostra as opções e marca as opcionais', () => {
    expect(commandHint(clima)).toBe('/clima cidade:<texto> [dias:<inteiro>]');
    expect(commandHint(tipos)).toContain('[modo:<Rápido|Lento>]');
  });
  it('dica v2: cargos, limites, tipos de canal e o próximo nível dos subcomandos', () => {
    expect(commandHint(v2)).toBe(
      '/v2 [cargo:<@cargo>] [alvo:<@pessoa|@cargo>] [voz:<#voz>] [nota:<inteiro 1–5>] [apelido:<texto 2–5>]',
    );
    expect(commandHint(cfg)).toBe('/cfg <canal|ver>');
    expect(commandHint(cfg, '/cfg canal')).toBe('/cfg canal <definir|limpar>');
    expect(commandHint(cfg, '/cfg canal definir ')).toBe('/cfg canal definir onde:<#canal> [dias:<inteiro>]');
    expect(commandHint(cfg, '/cfg ver')).toBe('/cfg ver');
    expect(limitHint(opt({ name: 'x', type: 'integer', minValue: 3 }))).toBe('≥ 3');
    expect(limitHint(opt({ name: 'x', type: 'string', maxLength: 9 }))).toBe('≤ 9');
  });
});

describe('slash: permissões e tipos de comando', () => {
  it('defaultMemberPermissions esconde o comando de quem não tem os bits; dono e ADMINISTRATOR veem', () => {
    expect(canUseCommand(soMods, Permission.KICK_MEMBERS)).toBe(false);
    expect(canUseCommand(soMods, Permission.KICK_MEMBERS | Permission.BAN_MEMBERS)).toBe(true);
    expect(canUseCommand(soMods, Permission.ADMINISTRATOR)).toBe(true);
    expect(canUseCommand(soMods, 0, true)).toBe(true);
    expect(canUseCommand(soMods, undefined)).toBe(false);
    expect(canUseCommand(clima, 0)).toBe(true);
  });
  it('flattenCommands filtra por tipo e permissão', () => {
    const chat = flattenCommands(server, { type: 'chat', myPermissions: Permission.SEND_MESSAGES });
    expect(chat.map((c) => c.command.name)).not.toContain('so-mods');
    expect(chat.map((c) => c.command.name)).not.toContain('Reportar');
    expect(flattenCommands(server, { type: 'message' }).map((c) => c.command.name)).toEqual(['Reportar']);
    expect(flattenCommands(server, { type: 'chat', owner: true }).map((c) => c.command.name)).toContain('so-mods');
  });
});

describe('slash: opções', () => {
  it('aceita chave:valor em qualquer ordem', () => {
    expect(parseSlash('/clima dias:3 cidade:Lisboa', clima)).toEqual({ options: { cidade: 'Lisboa', dias: 3 } });
  });
  it('aceita posicional na ordem das opções', () => {
    expect(parseSlash('/clima Lisboa 3', clima)).toEqual({ options: { cidade: 'Lisboa', dias: 3 } });
  });
  it('aspas agrupam, com e sem chave', () => {
    expect(parseSlash('/clima "São Paulo" 2', clima)).toEqual({ options: { cidade: 'São Paulo', dias: 2 } });
    expect(parseSlash("/clima cidade:'Rio de Janeiro'", clima)).toEqual({ options: { cidade: 'Rio de Janeiro' } });
    expect(parseSlash('/clima cidade: Porto', clima)).toEqual({ options: { cidade: 'Porto' } });
  });
  it('a última opção de texto recebe o resto da linha', () => {
    expect(parseSlash('/lembrar 10 comprar pão e leite', lembrar)).toEqual({
      options: { minutos: 10, texto: 'comprar pão e leite' },
    });
    // a cidade é a última opção de texto só quando nada vem depois dela na lista
    expect(parseSlash('/clima Lisboa', clima)).toEqual({ options: { cidade: 'Lisboa' } });
  });
  it('converte número, booleano, pessoa, canal e escolhas', () => {
    expect(parseSlash('/tipos n:2,5 ok:sim', tipos, ctx)).toEqual({ options: { n: 2.5, ok: true } });
    expect(parseSlash('/tipos ok:não', tipos, ctx)).toEqual({ options: { ok: false } });
    expect(parseSlash(`/tipos quem:<@${uid}>`, tipos, ctx)).toEqual({ options: { quem: uid } });
    expect(parseSlash('/tipos quem:@ana', tipos, ctx)).toEqual({ options: { quem: uid } });
    expect(parseSlash('/tipos quem:Aninha', tipos, ctx)).toEqual({ options: { quem: uid } });
    expect(parseSlash('/tipos onde:#geral', tipos, ctx)).toEqual({ options: { onde: cid } });
    expect(parseSlash(`/tipos onde:${cid}`, tipos, ctx)).toEqual({ options: { onde: cid } });
    expect(parseSlash('/tipos modo:rápido', tipos, ctx)).toEqual({ options: { modo: 'fast' } });
    expect(parseSlash('/tipos modo:slow', tipos, ctx)).toEqual({ options: { modo: 'slow' } });
  });
  it('erros curtos: obrigatória faltando, tipo errado, escolha inválida, pessoa desconhecida, sobra', () => {
    expect(parseSlash('/clima', clima).error).toMatch(/Falta "cidade"/);
    expect(parseSlash('/clima Lisboa x', clima).error).toMatch(/inteiro/);
    expect(parseSlash('/tipos modo:médio', tipos, ctx).error).toMatch(/Rápido, Lento/);
    expect(parseSlash('/tipos quem:@zé', tipos, ctx).error).toMatch(/Não achei @zé/);
    expect(parseSlash('/tipos onde:#nada', tipos, ctx).error).toMatch(/Não achei #nada/);
    expect(parseSlash('/tipos ok:talvez', tipos).error).toMatch(/sim ou não/);
    expect(parseSlash('/clima Lisboa 3 extra', clima).error).toMatch(/não aceita "extra"/);
    expect(parseSlash('/outro', clima).error).toBe('Comando não reconhecido.');
  });
});

describe('slash v2: cargo, mencionável, tipos de canal e limites', () => {
  it('cargo por nome (com ou sem @, com aspas) ou id; @everyone não conta', () => {
    expect(parseSlash('/v2 cargo:"@Mod Team"', v2, ctx)).toEqual({ options: { cargo: rid } });
    expect(parseSlash("/v2 cargo:'mod team'", v2, ctx)).toEqual({ options: { cargo: rid } });
    expect(parseSlash(`/v2 cargo:${rid}`, v2, ctx)).toEqual({ options: { cargo: rid } });
    expect(parseSlash('/v2 cargo:@everyone', v2, ctx).error).toMatch(/Não achei o cargo @everyone/);
  });
  it('mencionável aceita pessoa ou cargo', () => {
    expect(parseSlash('/v2 alvo:@ana', v2, ctx)).toEqual({ options: { alvo: uid } });
    expect(parseSlash('/v2 alvo:"Mod Team"', v2, ctx)).toEqual({ options: { alvo: rid } });
    expect(parseSlash('/v2 alvo:ninguém', v2, ctx).error).toMatch(/pessoa ou cargo/);
  });
  it('channelTypes recusa canal de outro tipo', () => {
    expect(parseSlash('/v2 voz:#sala', v2, ctx)).toEqual({ options: { voz: vid } });
    expect(parseSlash('/v2 voz:#geral', v2, ctx).error).toMatch(/só canal de voz/);
  });
  it('minValue/maxValue e minLength/maxLength', () => {
    expect(parseSlash('/v2 nota:3', v2, ctx)).toEqual({ options: { nota: 3 } });
    expect(parseSlash('/v2 nota:9', v2, ctx).error).toMatch(/entre 1 e 5/);
    expect(parseSlash('/v2 apelido:a', v2, ctx).error).toMatch(/entre 2 e 5 caracteres/);
    expect(parseSlash('/v2 apelido:abcdef', v2, ctx).error).toMatch(/entre 2 e 5/);
    expect(liveLimitError('/v2 nota:9', v2)).toMatch(/entre 1 e 5/);
    expect(liveLimitError('/v2 nota:', v2)).toBeNull();
    expect(liveLimitError('/v2 apelido:abc', v2)).toBeNull();
    // tipo errado e obrigatória faltando não gritam enquanto digita
    expect(liveLimitError('/v2 nota:x', v2)).toBeNull();
  });
});

describe('slash v2: subcomandos e grupos', () => {
  it('monta grupo + subcomando + opções', () => {
    expect(parseSlash('/cfg canal definir onde:#geral dias:2', cfg, ctx)).toEqual({
      subcommandGroup: 'canal',
      subcommand: 'definir',
      options: { onde: cid, dias: 2 },
    });
    expect(parseSlash('/cfg canal definir #geral', cfg, ctx)).toEqual({
      subcommandGroup: 'canal',
      subcommand: 'definir',
      options: { onde: cid },
    });
    expect(parseSlash('/cfg ver', cfg, ctx)).toEqual({ subcommand: 'ver', options: {} });
    expect(parseSlash('/cfg canal limpar', cfg, ctx)).toEqual({
      subcommandGroup: 'canal',
      subcommand: 'limpar',
      options: {},
    });
  });
  it('erros: nível faltando ou desconhecido', () => {
    expect(parseSlash('/cfg', cfg, ctx).error).toMatch(/Falta o subcomando/);
    expect(parseSlash('/cfg canal', cfg, ctx).error).toMatch(/Falta o subcomando/);
    expect(parseSlash('/cfg nada', cfg, ctx).error).toMatch(/use canal, ver/);
    expect(parseSlash('/cfg canal nada', cfg, ctx).error).toMatch(/use definir, limpar/);
    expect(parseSlash('/cfg canal definir', cfg, ctx).error).toMatch(/Falta "onde"/);
  });
  it('corpo da interação leva o caminho', () => {
    const parsed = parseSlash('/cfg canal definir #geral', cfg, ctx);
    expect(parsed.error).toBeUndefined();
    expect(interactionBody(ref(cfg), cid, parsed as Extract<typeof parsed, { error?: undefined }>)).toEqual({
      type: 'command',
      channelId: cid,
      botId: 'b1',
      command: 'cfg',
      subcommandGroup: 'canal',
      subcommand: 'definir',
      options: { onde: cid },
    });
    const simple = parseSlash('/clima Lisboa', clima);
    expect(interactionBody(ref(clima), cid, simple as Extract<typeof simple, { error?: undefined }>)).toEqual({
      type: 'command',
      channelId: cid,
      botId: 'b1',
      command: 'clima',
      options: { cidade: 'Lisboa' },
    });
  });
});

describe('slash v2: sugestões enquanto digita', () => {
  const at = (text: string, c: BotCommand) => suggestSlash(text, text.length, ref(c), ctx);
  it('nada enquanto o cursor está no nome do comando', () => {
    expect(suggestSlash('/cfg', 4, ref(cfg), ctx)).toBeNull();
  });
  it('subcomandos e grupos, depois os subcomandos do grupo', () => {
    expect(at('/cfg ', cfg)?.items.map((s) => [s.kind, s.insert])).toEqual([
      ['group', 'canal '],
      ['subcommand', 'ver '],
    ]);
    expect(at('/cfg c', cfg)?.items.map((s) => s.label)).toEqual(['canal']);
    expect(at('/cfg canal ', cfg)?.items.map((s) => s.insert)).toEqual(['definir ', 'limpar ']);
    expect(at('/cfg canal li', cfg)?.items.map((s) => s.label)).toEqual(['limpar']);
    expect(at('/cfg nada ', cfg)).toBeNull();
  });
  it('trecho substituído é o token em edição', () => {
    const s = at('/cfg can', cfg);
    expect(s).toMatchObject({ start: 5, end: 8, typed: 'can' });
  });
  it('depois do subcomando: nomes de opção ainda não usados + valores da próxima posicional', () => {
    const s = at('/cfg canal definir ', cfg);
    expect(s?.items.map((x) => [x.kind, x.insert])).toEqual([
      ['option', 'onde:'],
      ['option', 'dias:'],
      ['value', 'onde:#geral '],
      ['value', 'onde:#sala '],
    ]);
    expect(at('/cfg canal definir onde:#geral ', cfg)?.items.map((x) => x.insert)).toEqual(['dias:']);
  });
  it('opção em foco (chave:) sugere os valores dela: escolhas, cargos, pessoas, canais por tipo, sim/não', () => {
    expect(at('/tipos modo:', tipos)?.items.map((x) => x.label)).toEqual(['Rápido', 'Lento']);
    expect(at('/tipos modo:le', tipos)?.items.map((x) => x.insert)).toEqual(['modo:Lento ']);
    expect(at('/tipos ok:', tipos)?.items.map((x) => x.insert)).toEqual(['ok:sim ', 'ok:não ']);
    expect(at('/v2 cargo:', v2)?.items).toEqual([
      { kind: 'value', insert: 'cargo:"@Mod Team" ', label: '@Mod Team', detail: 'cargo', color: '#ff0000' },
    ]);
    expect(at('/v2 alvo:', v2)?.items.map((x) => x.label)).toEqual(['Aninha', '@Mod Team']);
    expect(at('/v2 alvo:an', v2)?.items.map((x) => x.label)).toEqual(['Aninha']);
    expect(at('/v2 voz:', v2)?.items.map((x) => x.label)).toEqual(['#sala']);
    expect(at('/tipos quem:@an', tipos)?.items.map((x) => x.insert)).toEqual(['quem:@ana ']);
  });
  it('posicional: filtra nomes de opção e valores pelo que foi digitado', () => {
    expect(at('/tipos rá', tipos)?.items.map((x) => x.insert)).toEqual([]);
    expect(at('/tipos n:1 ok:sim @an', tipos)?.items.map((x) => x.insert)).toEqual(['quem:@ana ']);
  });
  it('autocompletar: a opção com autocomplete pede ao bot, com as outras opções parciais', () => {
    const s = at('/busca limite:3 termo:lis', busca);
    expect(s?.items).toEqual([]);
    expect(s?.autocomplete).toMatchObject({ typed: 'lis', options: { limite: 3, termo: 'lis' } });
    expect(autocompleteBody(ref(busca), cid, s!.autocomplete!)).toEqual({
      type: 'autocomplete',
      channelId: cid,
      botId: 'b1',
      command: 'busca',
      options: { limite: 3, termo: 'lis' },
      focused: 'termo',
    });
    // posicional também: o primeiro token cai em "termo"
    expect(at('/busca li', busca)?.autocomplete?.typed).toBe('li');
    // sem foco numa opção com autocomplete, não pergunta ao bot
    expect(at('/busca termo:x limite:', busca)?.autocomplete).toBeUndefined();
  });
  it('sugestões do bot viram itens e, escolhidas pelo nome, enviam o valor', () => {
    const termo = busca.options[0] as BotCommandOption;
    const choices = [
      { name: 'Lisboa', value: 'lis-pt' },
      { name: 'Lima', value: 'lim-pe' },
    ];
    expect(choiceSuggestions(termo, choices).map((x) => x.insert)).toEqual(['termo:Lisboa ', 'termo:Lima ']);
    expect(parseSlash('/busca termo:Lisboa', busca, { autocompleteChoices: { termo: choices } })).toEqual({
      options: { termo: 'lis-pt' },
    });
    expect(parseSlash('/busca termo:outra', busca, { autocompleteChoices: { termo: choices } })).toEqual({
      options: { termo: 'outra' },
    });
  });
  it('valueSuggestions limita a 8', () => {
    const many = {
      members: Array.from({ length: 20 }, (_, i) => ({
        user: { id: `u${i}`, username: `user${i}`, displayName: `User ${i}` },
        nickname: null,
      })),
    };
    expect(valueSuggestions(opt({ name: 'quem', type: 'user' }), '', many)).toHaveLength(8);
  });
});

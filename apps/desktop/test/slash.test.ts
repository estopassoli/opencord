import type { BotCommand, ServerCommands } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { commandHint, filterCommands, flattenCommands, matchCommand, parseSlash } from '../src/lib/slash';

const bot = { id: 'b1', username: 'clima_bot', displayName: 'Clima', avatarKey: null, bot: true };
const clima: BotCommand = {
  name: 'clima',
  description: 'Previsão do tempo',
  options: [
    { name: 'cidade', description: 'Cidade', type: 'string', required: true, choices: [] },
    { name: 'dias', description: 'Quantos dias', type: 'integer', required: false, choices: [] },
  ],
};
const lembrar: BotCommand = {
  name: 'lembrar',
  description: 'Lembrete',
  options: [
    { name: 'minutos', description: 'Em quantos minutos', type: 'integer', required: true, choices: [] },
    { name: 'texto', description: 'O que lembrar', type: 'string', required: true, choices: [] },
  ],
};
const tipos: BotCommand = {
  name: 'tipos',
  description: 'Todos os tipos',
  options: [
    { name: 'n', description: 'número', type: 'number', required: false, choices: [] },
    { name: 'ok', description: 'booleano', type: 'boolean', required: false, choices: [] },
    { name: 'quem', description: 'pessoa', type: 'user', required: false, choices: [] },
    { name: 'onde', description: 'canal', type: 'channel', required: false, choices: [] },
    {
      name: 'modo',
      description: 'escolha',
      type: 'string',
      required: false,
      choices: [
        { name: 'Rápido', value: 'fast' },
        { name: 'Lento', value: 'slow' },
      ],
    },
  ],
};
const server: ServerCommands[] = [{ botId: 'b1', bot, commands: [clima, lembrar, tipos] }];
const all = flattenCommands(server);
const uid = '11111111-2222-4333-8444-555555555555';
const cid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ctx = {
  members: [{ user: { id: uid, username: 'ana', displayName: 'Ana Souza' }, nickname: 'Aninha' }],
  channels: [{ id: cid, name: 'geral' }],
};

describe('slash: casar comandos', () => {
  it('lista os que começam com o que foi digitado', () => {
    expect(filterCommands('/', all).map((c) => c.command.name)).toEqual(['clima', 'lembrar', 'tipos']);
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

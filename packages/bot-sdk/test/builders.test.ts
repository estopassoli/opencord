import { describe, expect, it } from 'vitest';
import { EmbedBuilder, SlashCommandBuilder, composeContent } from '../src/index.js';

describe('SlashCommandBuilder', () => {
  it('toJSON devolve o formato do contrato', () => {
    const cmd = new SlashCommandBuilder()
      .setName('ola')
      .setDescription('Diz olá')
      .addStringOption((o) => o.setName('nome').setDescription('Quem cumprimentar').setRequired(true))
      .addIntegerOption((o) =>
        o
          .setName('vezes')
          .setDescription('Quantas vezes')
          .addChoices({ name: 'uma', value: 1 }, { name: 'duas', value: 2 }),
      )
      .toJSON();
    expect(cmd).toEqual({
      name: 'ola',
      description: 'Diz olá',
      options: [
        { name: 'nome', description: 'Quem cumprimentar', type: 'string', required: true, choices: [] },
        {
          name: 'vezes',
          description: 'Quantas vezes',
          type: 'integer',
          required: false,
          choices: [
            { name: 'uma', value: 1 },
            { name: 'duas', value: 2 },
          ],
        },
      ],
    });
  });

  it('rejeita nome fora do padrão, descrição vazia e obrigatória depois de opcional', () => {
    expect(() => new SlashCommandBuilder().setName('Olá').setDescription('x').toJSON()).toThrow(/nome "Olá" inválido/);
    expect(() => new SlashCommandBuilder().setName('ola').toJSON()).toThrow(/descrição obrigatória/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('ola')
        .setDescription('x')
        .addStringOption((o) => o.setName('a').setDescription('a'))
        .addStringOption((o) => o.setName('b').setDescription('b').setRequired(true))
        .toJSON(),
    ).toThrow(/obrigatória "b" precisa vir antes/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('ola')
        .setDescription('x')
        .addStringOption((o) => o.setName('a').setDescription('a'))
        .addStringOption((o) => o.setName('a').setDescription('a'))
        .toJSON(),
    ).toThrow(/opção repetida/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('ola')
        .setDescription('x')
        .addBooleanOption((o) => o.setName('a').setDescription('a').addChoices({ name: 'x', value: 1 })),
    ).toThrow(/escolhas só em string/);
  });

  it('limita a 25 opções (limite da ADR-0034; era 10 na 0.1)', () => {
    const b = new SlashCommandBuilder().setName('c').setDescription('c');
    for (let i = 0; i < 25; i++) b.addStringOption((o) => o.setName(`o${i}`).setDescription('x'));
    expect(() => b.addStringOption((o) => o.setName('o25').setDescription('x'))).toThrow(/até 25 opções/);
  });
});

describe('EmbedBuilder', () => {
  it('toMarkdown usa só sintaxe que o app renderiza', () => {
    const md = new EmbedBuilder()
      .setAuthor({ name: 'Bot' })
      .setTitle('Título')
      .setURL('https://exemplo.dev')
      .setDescription('Descrição')
      .setColor(0xff0000)
      .addFields({ name: 'Campo', value: 'Valor' }, { name: 'Outro', value: '2', inline: true })
      .setImage('https://exemplo.dev/i.png')
      .setFooter({ text: 'rodapé' })
      .toMarkdown();
    expect(md).toBe(
      [
        'Bot',
        '**[Título](https://exemplo.dev)**',
        'Descrição',
        '**Campo**: Valor',
        '**Outro**: 2',
        'https://exemplo.dev/i.png',
        '_rodapé_',
      ].join('\n'),
    );
  });

  it('composeContent junta conteúdo e embeds e recusa vazio', () => {
    const e = new EmbedBuilder().setTitle('T');
    expect(composeContent('oi', [e])).toBe('oi\n\n**T**');
    expect(composeContent(undefined, [{ description: 'd' }])).toBe('d');
    expect(() => composeContent('  ', [])).toThrow(/mensagem vazia/);
  });
});

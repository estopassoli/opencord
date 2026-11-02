import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ActionRowBuilder,
  ApplicationCommandType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  resolveColor,
} from '../src/index.js';

describe('EmbedBuilder (embed de verdade)', () => {
  it('toJSON devolve o Embed do contrato; setColor aceita número, #hex e nome', () => {
    const e = new EmbedBuilder()
      .setTitle('Leitura do mês')
      .setURL('https://exemplo.dev/livro')
      .setDescription('Vamos ler.')
      .setColor(0xff0000)
      .addFields({ name: 'Livro', value: 'Dom Casmurro' }, { name: 'Páginas', value: '256', inline: true })
      .setFooter({ text: 'Clube', iconURL: 'https://exemplo.dev/i.png' })
      .setAuthor({ name: 'Bot', url: 'https://exemplo.dev', iconURL: 'https://exemplo.dev/a.png' })
      .setImage('https://exemplo.dev/img.png')
      .setThumbnail('https://exemplo.dev/t.png')
      .setTimestamp(new Date('2026-11-02T13:00:00Z'));
    expect(e.toJSON()).toEqual({
      title: 'Leitura do mês',
      url: 'https://exemplo.dev/livro',
      description: 'Vamos ler.',
      color: '#ff0000',
      fields: [
        { name: 'Livro', value: 'Dom Casmurro', inline: false },
        { name: 'Páginas', value: '256', inline: true },
      ],
      footer: { text: 'Clube', iconUrl: 'https://exemplo.dev/i.png' },
      author: { name: 'Bot', url: 'https://exemplo.dev', iconUrl: 'https://exemplo.dev/a.png' },
      image: { url: 'https://exemplo.dev/img.png' },
      thumbnail: { url: 'https://exemplo.dev/t.png' },
      timestamp: '2026-11-02T13:00:00.000Z',
    });
    expect(new EmbedBuilder().setTitle('x').setColor('#ABCDEF').toJSON().color).toBe('#abcdef');
    expect(new EmbedBuilder().setTitle('x').setColor('Red').toJSON().color).toBe('#ed4245');
    expect(new EmbedBuilder().setTitle('x').setColor([0, 255, 0]).toJSON().color).toBe('#00ff00');
    expect(new EmbedBuilder().setTitle('x').setColor(null).toJSON().color).toBeUndefined();
    expect(resolveColor('Random')).toMatch(/^#[0-9a-f]{6}$/);
    expect(() => resolveColor('roxo-neon')).toThrow(/cor desconhecida/);
    expect(() => resolveColor(0x1000000)).toThrow(/fora de/);
  });

  it('valida limites (vazio, 25 campos, 6000 caracteres) e mantém toMarkdown', () => {
    expect(() => new EmbedBuilder().toJSON()).toThrow(/embed vazio/);
    const many = new EmbedBuilder();
    for (let i = 0; i < 25; i++) many.addFields({ name: `c${i}`, value: 'v' });
    expect(() => many.addFields({ name: 'c25', value: 'v' })).toThrow(/até 25 campos/);
    expect(() => new EmbedBuilder().setDescription('x'.repeat(4097)).toJSON()).toThrow(/descrição com mais de 4096/);
    const big = new EmbedBuilder().setTitle('t'.repeat(256)).setDescription('d'.repeat(4096));
    for (let i = 0; i < 2; i++) big.addFields({ name: 'n'.repeat(256), value: 'v'.repeat(1024) });
    expect(() => big.toJSON()).toThrow(/mais de 6000/);
    expect(new EmbedBuilder().setTitle('T').setDescription('d').toMarkdown()).toBe('**T**\nd');
    expect(EmbedBuilder.from({ title: 'c', color: 'Blue' }).toJSON()).toMatchObject({ title: 'c', color: '#3498db' });
  });
});

describe('componentes', () => {
  it('ButtonBuilder: customId com estilo, URL com Link, erros claros', () => {
    const b = new ButtonBuilder().setCustomId('ok').setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji('✅');
    expect(b.toJSON()).toEqual({
      type: 'button',
      style: 'success',
      label: 'Confirmar',
      emoji: '✅',
      customId: 'ok',
      disabled: false,
    });
    expect(
      new ButtonBuilder().setLabel('Site').setStyle(ButtonStyle.Link).setURL('https://exemplo.dev').toJSON(),
    ).toEqual({
      type: 'button',
      style: 'link',
      label: 'Site',
      url: 'https://exemplo.dev',
      disabled: false,
    });
    // números que a comunidade usa (1 = Primary … 5 = Link)
    expect(new ButtonBuilder().setCustomId('a').setLabel('a').setStyle(1).toJSON().style).toBe('primary');
    expect(() => new ButtonBuilder().setCustomId('a').toJSON()).toThrow(/label ou emoji/);
    expect(() => new ButtonBuilder().setLabel('a').toJSON()).toThrow(/customId obrigatório/);
    expect(() => new ButtonBuilder().setLabel('a').setStyle(ButtonStyle.Link).toJSON()).toThrow(/URL http/);
    expect(() => new ButtonBuilder().setLabel('a').setCustomId('x').setURL('https://x.y').toJSON()).toThrow(
      /só botões de link/,
    );
    expect(() =>
      new ButtonBuilder()
        .setLabel('a')
        .setCustomId('x')
        .setStyle('rosa' as never),
    ).toThrow(/estilo de botão/);
  });

  it('menus: string com opções, user/role/channel sem opções, validações', () => {
    const s = new StringSelectMenuBuilder()
      .setCustomId('cor')
      .setPlaceholder('Escolha')
      .setMinValues(1)
      .setMaxValues(2)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Azul').setValue('azul').setDescription('frio').setDefault(true),
        { label: 'Vermelho', value: 'vermelho', emoji: '🔴' },
      );
    expect(s.toJSON()).toEqual({
      type: 'select',
      customId: 'cor',
      kind: 'string',
      placeholder: 'Escolha',
      minValues: 1,
      maxValues: 2,
      options: [
        { label: 'Azul', value: 'azul', description: 'frio', default: true },
        { label: 'Vermelho', value: 'vermelho', emoji: '🔴', default: false },
      ],
      disabled: false,
    });
    expect(new UserSelectMenuBuilder().setCustomId('u').toJSON()).toMatchObject({ kind: 'user', options: [] });
    expect(new RoleSelectMenuBuilder().setCustomId('r').toJSON()).toMatchObject({ kind: 'role' });
    expect(
      new ChannelSelectMenuBuilder().setCustomId('c').addChannelTypes(ChannelType.GuildText).toJSON(),
    ).toMatchObject({ kind: 'channel' });
    expect(() => new StringSelectMenuBuilder().setCustomId('x').toJSON()).toThrow(/ao menos uma opção/);
    expect(() =>
      new StringSelectMenuBuilder()
        .setCustomId('x')
        .addOptions({ label: 'a', value: 'v' }, { label: 'b', value: 'v' })
        .toJSON(),
    ).toThrow(/value repetido/);
    expect(() =>
      new StringSelectMenuBuilder()
        .setCustomId('x')
        .setMinValues(3)
        .setMaxValues(2)
        .addOptions({ label: 'a', value: 'a' })
        .toJSON(),
    ).toThrow(/minValues/);
  });

  it('ActionRowBuilder: até 5 botões ou 1 menu; customId único entre linhas', () => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('a').setLabel('A'),
      new ButtonBuilder().setCustomId('b').setLabel('B'),
    );
    expect(row.toJSON()).toEqual({
      type: 'row',
      components: [
        { type: 'button', style: 'secondary', label: 'A', customId: 'a', disabled: false },
        { type: 'button', style: 'secondary', label: 'B', customId: 'b', disabled: false },
      ],
    });
    const six = new ActionRowBuilder();
    for (let i = 0; i < 6; i++) six.addComponents(new ButtonBuilder().setCustomId(`b${i}`).setLabel('x'));
    expect(() => six.toJSON()).toThrow(/até 5 botões/);
    expect(() =>
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder().setCustomId('s').addOptions({ label: 'a', value: 'a' }),
          new ButtonBuilder().setCustomId('b').setLabel('b'),
        )
        .toJSON(),
    ).toThrow(/1 menu/);
    expect(() => new ActionRowBuilder().toJSON()).toThrow(/vazia/);
  });

  it('ModalBuilder + TextInputBuilder (direto ou dentro de ActionRow)', () => {
    const modal = new ModalBuilder()
      .setCustomId('form')
      .setTitle('Sugestão')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('titulo')
            .setLabel('Título')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80),
        ),
        new TextInputBuilder()
          .setCustomId('texto')
          .setLabel('Texto')
          .setStyle(2)
          .setRequired(false)
          .setPlaceholder('…'),
      );
    expect(modal.toJSON()).toEqual({
      customId: 'form',
      title: 'Sugestão',
      components: [
        { type: 'text', customId: 'titulo', label: 'Título', style: 'short', required: true, maxLength: 80 },
        { type: 'text', customId: 'texto', label: 'Texto', style: 'paragraph', required: false, placeholder: '…' },
      ],
    });
    expect(() => new ModalBuilder().setTitle('t').toJSON()).toThrow(/customId obrigatório/);
    expect(() => new ModalBuilder().setCustomId('m').setTitle('t').toJSON()).toThrow(/ao menos um campo/);
    expect(() =>
      new ActionRowBuilder<TextInputBuilder>()
        .addComponents(new TextInputBuilder().setCustomId('a').setLabel('a'))
        .toJSON(),
    ).toThrow(/só vão em modais/);
  });
});

describe('SlashCommandBuilder v2', () => {
  it('subcomandos, grupos, role/mentionable, autocomplete, min/max, channelTypes, permissões e servidores', () => {
    const cmd = new SlashCommandBuilder()
      .setName('config')
      .setDescription('Configura')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setGuildIds('44444444-4444-4444-8444-444444444444')
      .setContexts(0)
      .addSubcommand((s) =>
        s
          .setName('idioma')
          .setDescription('Define o idioma')
          .addStringOption((o) =>
            o
              .setName('valor')
              .setDescription('Idioma')
              .setAutocomplete(true)
              .setMinLength(2)
              .setMaxLength(5)
              .setRequired(true),
          ),
      )
      .addSubcommandGroup((g) =>
        g
          .setName('canal')
          .setDescription('Canais')
          .addSubcommand(
            new SlashCommandSubcommandBuilder()
              .setName('definir')
              .setDescription('Define o canal')
              .addChannelOption((o) =>
                o.setName('canal').setDescription('Qual').addChannelTypes(ChannelType.GuildText, 2),
              )
              .addRoleOption((o) => o.setName('cargo').setDescription('Cargo'))
              .addMentionableOption((o) => o.setName('alvo').setDescription('Pessoa ou cargo'))
              .addIntegerOption((o) => o.setName('n').setDescription('N').setMinValue(1).setMaxValue(10)),
          ),
      );
    expect(cmd.toJSON()).toEqual({
      name: 'config',
      description: 'Configura',
      defaultMemberPermissions: 1 << 16,
      guildIds: ['44444444-4444-4444-8444-444444444444'],
      options: [
        {
          type: 'subcommand',
          name: 'idioma',
          description: 'Define o idioma',
          options: [
            {
              name: 'valor',
              description: 'Idioma',
              type: 'string',
              required: true,
              choices: [],
              autocomplete: true,
              minLength: 2,
              maxLength: 5,
            },
          ],
        },
        {
          type: 'subcommand_group',
          name: 'canal',
          description: 'Canais',
          options: [
            {
              type: 'subcommand',
              name: 'definir',
              description: 'Define o canal',
              options: [
                {
                  name: 'canal',
                  description: 'Qual',
                  type: 'channel',
                  required: false,
                  choices: [],
                  channelTypes: ['text', 'voice'],
                },
                { name: 'cargo', description: 'Cargo', type: 'role', required: false, choices: [] },
                { name: 'alvo', description: 'Pessoa ou cargo', type: 'mentionable', required: false, choices: [] },
                {
                  name: 'n',
                  description: 'N',
                  type: 'integer',
                  required: false,
                  choices: [],
                  minValue: 1,
                  maxValue: 10,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      new SlashCommandBuilder().setName('a').setDescription('a').setDefaultMemberPermissions('8').toJSON()
        .defaultMemberPermissions,
    ).toBe(8);
    expect(
      new SlashCommandBuilder()
        .setName('a')
        .setDescription('a')
        .setDefaultMemberPermissions(['KickMembers', 'BAN_MEMBERS'])
        .toJSON().defaultMemberPermissions,
    ).toBe((1 << 13) | (1 << 19));
  });

  it('erros: misturar subcomando com opção solta, autocomplete + choices, min > max, tipo errado', () => {
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addSubcommand((s) => s.setName('a').setDescription('a'))
        .addStringOption((o) => o.setName('b').setDescription('b'))
        .toJSON(),
    ).toThrow(/não misture/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addStringOption((o) =>
          o.setName('a').setDescription('a').setAutocomplete(true).addChoices({ name: 'a', value: 'a' }),
        )
        .toJSON(),
    ).toThrow(/não combina/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addIntegerOption((o) => o.setName('a').setDescription('a').setMinValue(5).setMaxValue(1))
        .toJSON(),
    ).toThrow(/minValue > maxValue/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addBooleanOption((o) => o.setName('a').setDescription('a').setMinValue(1)),
    ).toThrow(/só em integer/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addStringOption((o) => o.setName('a').setDescription('a').addChannelTypes(0)),
    ).toThrow(/só em channel/);
    expect(() =>
      new SlashCommandBuilder()
        .setName('x')
        .setDescription('x')
        .addAttachmentOption((o) => o),
    ).toThrow(/anexo/);
  });

  it('ContextMenuCommandBuilder: user/message, nome livre, sem opções', () => {
    expect(
      new ContextMenuCommandBuilder().setName('Reportar mensagem').setType(ApplicationCommandType.Message).toJSON(),
    ).toEqual({
      type: 'message',
      name: 'Reportar mensagem',
      description: '',
      options: [],
    });
    expect(
      new ContextMenuCommandBuilder().setName('Perfil').setType(2).setDefaultMemberPermissions(4).toJSON(),
    ).toEqual({
      type: 'user',
      name: 'Perfil',
      description: '',
      options: [],
      defaultMemberPermissions: 4,
    });
    expect(() => new ContextMenuCommandBuilder().setType(ApplicationCommandType.User).toJSON()).toThrow(/nome ""/);
  });
});

describe('AttachmentBuilder', () => {
  it('Buffer, caminho e stream viram { name, data: Blob } com MIME pela extensão', async () => {
    const a = await new AttachmentBuilder(Buffer.from('oi'), { name: 'oi.txt' }).toFile();
    expect(a.name).toBe('oi.txt');
    expect(a.data.type).toBe('text/plain');
    expect(await a.data.text()).toBe('oi');
    const dir = mkdtempSync(join(tmpdir(), 'ocb-'));
    const path = join(dir, 'img.png');
    writeFileSync(path, Buffer.from([1, 2, 3]));
    const b = await new AttachmentBuilder(path).toFile();
    expect(b.name).toBe('img.png');
    expect(b.data.type).toBe('image/png');
    expect(b.data.size).toBe(3);
    const c = await new AttachmentBuilder(Readable.from([Buffer.from('a'), Buffer.from('b')]), {
      name: 'ab.txt',
    }).toFile();
    expect(await c.data.text()).toBe('ab');
    const d = await new AttachmentBuilder(new Uint8Array([9])).toFile();
    expect(d.name).toBe('file');
  });
});

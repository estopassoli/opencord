import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  InteractionType,
  Message,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  type Interaction,
} from '../src/index.js';
import {
  CHANNEL_ID,
  INTERACTION_ID,
  ROLE_MOD,
  USER2_ID,
  USER_ID,
  VOICE_ID,
  interactionDto,
  json,
  last,
  messageDto,
  person2,
  setup,
} from './helpers.js';

function collect(client: ReturnType<typeof setup>['client']) {
  const got: Interaction[] = [];
  client.on('interactionCreate', (i) => got.push(i));
  return got;
}

describe('interações v2', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('comando de barra com subcomando/grupo e opções role/mentionable/channel', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    s.socket().fire(
      'interaction:created',
      interactionDto({
        command: 'config',
        subcommandGroup: 'canal',
        subcommand: 'definir',
        options: { canal: VOICE_ID, cargo: ROLE_MOD, alvo: USER2_ID, n: 3 },
      }),
    );
    const i = got[0]!;
    expect(i.isChatInputCommand()).toBe(true);
    if (!i.isChatInputCommand()) throw new Error('tipo errado');
    expect(i.type).toBe(InteractionType.ApplicationCommand);
    expect(i.isRepliable()).toBe(true);
    expect(i.options.getSubcommand()).toBe('definir');
    expect(i.options.getSubcommandGroup()).toBe('canal');
    expect(i.options.getChannel('canal')?.name).toBe('Sala');
    expect(() => i.options.getChannel('canal', true, ['text'])).toThrow(/tipo voice/);
    expect(i.options.getRole('cargo')?.name).toBe('Moderação');
    expect(i.options.getMentionable('alvo')?.toString()).toBe(`<@${USER2_ID}>`);
    expect(i.options.getInteger('n')).toBe(3);
    expect(String(i)).toBe(`/config canal definir canal:${VOICE_ID} cargo:${ROLE_MOD} alvo:${USER2_ID} n:3`);
    expect(i.memberPermissions?.has('ManageMessages')).toBe(true); // Ana é dona
    expect(i.member?.displayName).toBe('Ana');
    s.socket().fire('interaction:created', interactionDto({ id: '66666666-6666-4666-8666-666666666667' }));
    const plain = got[1]!;
    if (!plain.isChatInputCommand()) throw new Error('tipo errado');
    expect(() => plain.options.getSubcommand()).toThrow(/não tem subcomando/);
    expect(plain.options.getSubcommand(false)).toBeNull();
  });

  it('reply com embeds, componentes, arquivos (upload multipart) e flags Ephemeral', async () => {
    const s = setup();
    s.routes.push((c) =>
      c.path === '/attachments' && c.method === 'POST'
        ? json(201, {
            attachment: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              originalName: 'x.txt',
              mime: 'text/plain',
              sizeBytes: 2,
              url: 'u',
              width: null,
              height: null,
            },
          })
        : undefined,
    );
    await s.ready();
    const got = collect(s.client);
    s.socket().fire('interaction:created', interactionDto());
    const i = got[0]!;
    if (!i.isChatInputCommand()) throw new Error('tipo errado');
    const res = await i.reply({
      content: 'Oi',
      embeds: [new EmbedBuilder().setTitle('T').setColor('Green')],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ok').setLabel('OK').setStyle(ButtonStyle.Primary),
        ),
      ],
      files: [new AttachmentBuilder(Buffer.from('oi'), { name: 'x.txt' })],
      flags: MessageFlags.Ephemeral,
    });
    const upload = s.calls.find((c) => c.path === '/attachments')!;
    expect(upload.body).toBeInstanceOf(FormData);
    const file = (upload.body as FormData).get('file') as File;
    expect(file.name).toBe('x.txt');
    expect(await file.text()).toBe('oi');
    expect(upload.headers['content-type']).toBeUndefined();
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/reply`,
      body: {
        content: 'Oi',
        ephemeral: true,
        embeds: [{ title: 'T', color: '#57f287', fields: [] }],
        components: [
          {
            type: 'row',
            components: [{ type: 'button', customId: 'ok', label: 'OK', style: 'primary', disabled: false }],
          },
        ],
        attachmentIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      },
    });
    expect(res.messageId).toBeNull();
    expect(i.ephemeral).toBe(true);
    // clique no cartão efêmero: chega com ephemeralOf e sem mensagem; o tipo do componente foi lembrado
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666668',
        type: 'component',
        customId: 'ok',
        componentType: 'button',
        ephemeralOf: INTERACTION_ID,
      }),
    );
    const click = got[1]!;
    expect(click.isButton()).toBe(true);
    if (!click.isButton()) throw new Error('tipo errado');
    expect(click.message).toBeNull();
    expect(click.ephemeralOf).toBe(INTERACTION_ID);
    await click.update({ content: 'Feito', components: [] });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${click.id}/update`,
      body: { content: 'Feito', components: [] },
    });
    expect(click.replied).toBe(true);
  });

  it('botão numa mensagem: message, componentType, update/deferUpdate + editReply', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    const msg = messageDto({
      components: [
        {
          type: 'row',
          components: [
            { type: 'button', style: 'primary', label: 'Sim', customId: 'sim', disabled: false },
            { type: 'select', customId: 'cor', kind: 'user', minValues: 1, maxValues: 1, options: [], disabled: false },
          ],
        },
      ],
    });
    s.socket().fire(
      'interaction:created',
      interactionDto({ type: 'component', customId: 'sim', componentType: 'button', targetMessage: msg }),
    );
    const b = got[0]!;
    if (!b.isButton()) throw new Error('tipo errado');
    expect(b.type).toBe(InteractionType.MessageComponent);
    expect(b.isMessageComponent()).toBe(true);
    expect(b.componentType).toBe(ComponentType.Button);
    expect(b.message).toBeInstanceOf(Message);
    expect(b.message?.components).toHaveLength(1);
    expect(b.component).toMatchObject({ customId: 'sim' });
    await b.deferUpdate();
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/defer`,
      body: { ephemeral: false, update: true },
    });
    await b.editReply({ content: 'Confirmado', components: [] });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/update`,
      body: { content: 'Confirmado', components: [] },
    });
    // menu de usuário na mesma mensagem: o tipo vem da definição do componente
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666669',
        type: 'component',
        customId: 'cor',
        componentType: 'select',
        values: [USER2_ID],
        targetMessage: msg,
      }),
    );
    const sel = got[1]!;
    expect(sel.isUserSelectMenu()).toBe(true);
    expect(sel.isAnySelectMenu()).toBe(true);
    if (!sel.isUserSelectMenu()) throw new Error('tipo errado');
    expect(sel.values).toEqual([USER2_ID]);
    expect(sel.users.first()?.username).toBe('bruno');
    expect(sel.members.first()?.roles.cache.first()?.name).toBe('Moderação');
    await expect(sel.update({})).rejects.toThrow(/nada para atualizar/);
    await sel.reply({ content: 'ok', ephemeral: true });
    expect(last(s.calls)).toMatchObject({
      path: `/interactions/${sel.id}/reply`,
      body: { content: 'ok', ephemeral: true },
    });
  });

  it('menu de texto: values; menus de cargo e canal resolvem pelo cache', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    const row = (kind: 'string' | 'role' | 'channel') => ({
      type: 'row' as const,
      components: [
        {
          type: 'select' as const,
          customId: 'm',
          kind,
          minValues: 1,
          maxValues: 2,
          options: kind === 'string' ? [{ label: 'a', value: 'a', default: false }] : [],
          disabled: false,
        },
      ],
    });
    s.socket().fire(
      'interaction:created',
      interactionDto({
        type: 'component',
        customId: 'm',
        componentType: 'select',
        values: ['a'],
        targetMessage: messageDto({ components: [row('string')] }),
      }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666a',
        type: 'component',
        customId: 'm',
        componentType: 'select',
        values: [ROLE_MOD],
        targetMessage: messageDto({ components: [row('role')] }),
      }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666b',
        type: 'component',
        customId: 'm',
        componentType: 'select',
        values: [CHANNEL_ID],
        targetMessage: messageDto({ components: [row('channel')] }),
      }),
    );
    const [a, b, c] = got;
    expect(a!.isStringSelectMenu() && a!.values).toEqual(['a']);
    expect(b!.isRoleSelectMenu()).toBe(true);
    if (!b!.isRoleSelectMenu()) throw new Error('tipo errado');
    expect(b!.roles.first()?.name).toBe('Moderação');
    expect(c!.isChannelSelectMenu()).toBe(true);
    if (!c!.isChannelSelectMenu()) throw new Error('tipo errado');
    expect(c!.channels.first()?.name).toBe('geral');
    // sem definição conhecida, um componente com values é tratado como menu de texto
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666c',
        type: 'component',
        customId: 'zz',
        componentType: 'select',
        values: ['x'],
        ephemeralOf: 'desconhecida',
      }),
    );
    expect(got[3]!.isStringSelectMenu()).toBe(true);
  });

  it('comandos de contexto: targetUser/targetMember e targetMessage', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    s.socket().fire(
      'interaction:created',
      interactionDto({ type: 'user_command', command: 'Perfil', targetUser: person2 }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666d',
        type: 'message_command',
        command: 'Reportar',
        targetMessage: messageDto({ body: 'spam' }),
      }),
    );
    const u = got[0]!;
    expect(u.isUserContextMenuCommand()).toBe(true);
    expect(u.isContextMenuCommand()).toBe(true);
    expect(u.isCommand()).toBe(true);
    expect(u.isChatInputCommand()).toBe(false);
    if (!u.isUserContextMenuCommand()) throw new Error('tipo errado');
    expect(u.commandName).toBe('Perfil');
    expect(u.commandType).toBe('user');
    expect(u.targetUser.id).toBe(USER2_ID);
    expect(u.targetMember?.displayName).toBe('Bruno');
    const m = got[1]!;
    if (!m.isMessageContextMenuCommand()) throw new Error('tipo errado');
    expect(m.targetMessage.content).toBe('spam');
    expect(m.targetId).toBe(m.targetMessage.id);
    await m.deferReply({ ephemeral: true });
    expect(last(s.calls)).toMatchObject({
      path: `/interactions/${m.id}/defer`,
      body: { ephemeral: true, update: false },
    });
  });

  it('showModal → POST /modal; awaitModalSubmit resolve com o envio (fields) e update quando veio de componente', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    s.socket().fire('interaction:created', interactionDto());
    const i = got[0]!;
    if (!i.isChatInputCommand()) throw new Error('tipo errado');
    const modal = new ModalBuilder()
      .setCustomId('form')
      .setTitle('Sugestão')
      .addComponents(new TextInputBuilder().setCustomId('texto').setLabel('Texto'));
    await i.showModal(modal);
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/modal`,
      body: { modal: { customId: 'form', title: 'Sugestão' } },
    });
    expect(i.replied).toBe(true);
    await expect(i.reply('x')).rejects.toThrow(/já respondida/);
    const waiting = i.awaitModalSubmit({ time: 10_000 });
    // modal de outra pessoa e de outro customId são ignorados
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666e',
        type: 'modal',
        customId: 'form',
        fields: { texto: 'não' },
        user: person2,
      }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-66666666666f',
        type: 'modal',
        customId: 'outro',
        fields: { texto: 'não' },
      }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666670',
        type: 'modal',
        customId: 'form',
        fields: { texto: 'Mais livros' },
      }),
    );
    const submit = await waiting;
    expect(submit.isModalSubmit()).toBe(true);
    expect(submit.type).toBe(InteractionType.ModalSubmit);
    expect(submit.customId).toBe('form');
    expect(submit.fields.getTextInputValue('texto')).toBe('Mais livros');
    expect(submit.fields.getTextInputValue('nada')).toBe('');
    expect(() => submit.fields.getField('nada')).toThrow(/não veio/);
    expect(submit.isFromMessage()).toBe(false);
    await expect(submit.update('x')).rejects.toThrow(/só quando o modal veio/);
    await submit.reply({ content: 'Anotado', ephemeral: true });
    expect(last(s.calls)).toMatchObject({
      path: `/interactions/${submit.id}/reply`,
      body: { content: 'Anotado', ephemeral: true },
    });
    // modal vindo de um botão: update edita a mensagem de origem
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666671',
        type: 'modal',
        customId: 'form',
        fields: { texto: 'x' },
        targetMessage: messageDto(),
      }),
    );
    const fromButton = got.at(-1)!;
    if (!fromButton.isModalSubmit()) throw new Error('tipo errado');
    expect(fromButton.isFromMessage()).toBe(true);
    await fromButton.update({ content: 'Editada' });
    expect(last(s.calls)).toMatchObject({
      path: `/interactions/${fromButton.id}/update`,
      body: { content: 'Editada' },
    });
    // awaitModalSubmit expira
    s.socket().fire('interaction:created', interactionDto({ id: '66666666-6666-4666-8666-666666666672' }));
    const j = got.at(-1)!;
    const expiring = j.awaitModalSubmit({ time: 1000 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await expiring).toMatchObject({ name: 'CollectorError', code: 'time' });
  });

  it('autocompletar: getFocused, respond → POST /autocomplete; reply é recusado', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    s.socket().fire(
      'interaction:created',
      interactionDto({ type: 'autocomplete', command: 'livro', focused: 'titulo', options: { titulo: 'Dom' } }),
    );
    const a = got[0]!;
    expect(a.isAutocomplete()).toBe(true);
    expect(a.isRepliable()).toBe(false);
    if (!a.isAutocomplete()) throw new Error('tipo errado');
    expect(a.type).toBe(InteractionType.ApplicationCommandAutocomplete);
    expect(a.commandName).toBe('livro');
    expect(a.options.getFocused()).toBe('Dom');
    expect(a.options.getFocused(true)).toEqual({ name: 'titulo', value: 'Dom', focused: true });
    await a.respond([{ name: 'Dom Casmurro', value: 'dom-casmurro' }, 'Dom Quixote']);
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/autocomplete`,
      body: {
        choices: [
          { name: 'Dom Casmurro', value: 'dom-casmurro' },
          { name: 'Dom Quixote', value: 'Dom Quixote' },
        ],
      },
    });
    expect(a.responded).toBe(true);
    await expect(a.respond([])).rejects.toThrow(/já respondido/);
    expect(() => a.reply()).toThrow(/respond/);
    const many = Array.from({ length: 26 }, (_, i) => `c${i}`);
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666673',
        type: 'autocomplete',
        command: 'livro',
        focused: 'titulo',
      }),
    );
    const b = got[1]!;
    if (!b.isAutocomplete()) throw new Error('tipo errado');
    await expect(b.respond(many)).rejects.toThrow(/até 25/);
  });

  it('reply normal devolve messageId; fetchReply/editReply/deleteReply usam GET/PATCH/DELETE /messages/:id; followUp efêmero', async () => {
    const s = setup();
    await s.ready();
    const got = collect(s.client);
    s.socket().fire('interaction:created', interactionDto());
    const i = got[0]!;
    if (!i.isChatInputCommand()) throw new Error('tipo errado');
    const res = await i.reply({ content: 'pública', withResponse: true });
    expect(res.messageId).toBe('55555555-5555-4555-8555-555555555556');
    expect(res.resource.message?.content).toBe('buscada');
    const fetched = await i.fetchReply();
    expect(last(s.calls)).toMatchObject({ method: 'GET', path: `/messages/${res.messageId}` });
    expect(fetched?.id).toBe(res.messageId);
    await i.editReply({ embeds: [new EmbedBuilder().setTitle('E')] });
    expect(last(s.calls)).toMatchObject({
      method: 'PATCH',
      path: `/messages/${res.messageId}`,
      body: { embeds: [{ title: 'E', fields: [] }] },
    });
    await i.followUp({ content: 'só você', ephemeral: true });
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/interactions/${INTERACTION_ID}/reply`,
      body: { content: 'só você', ephemeral: true },
    });
    await i.followUp('para todos');
    expect(last(s.calls)).toMatchObject({
      method: 'POST',
      path: `/channels/${CHANNEL_ID}/messages`,
      body: { body: 'para todos' },
    });
    await i.deleteReply();
    expect(last(s.calls)).toMatchObject({ method: 'DELETE', path: `/messages/${res.messageId}` });
    expect(await i.fetchReply()).toBeNull();
    expect(i.user.id).toBe(USER_ID);
  });
});

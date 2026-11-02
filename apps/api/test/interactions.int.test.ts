/**
 * Bots v2 (ADR-0034): comandos com subcomandos/grupos e opções novas, `defaultMemberPermissions` e `guildIds`,
 * comandos de contexto (pessoa/mensagem), botões e menus (em mensagens e em cartões efêmeros), modais,
 * autocompletar (pub/sub com espera curta) e a compatibilidade com a v1.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type BotWithToken,
  type Interaction,
  type Message,
  type MessageComponents,
  type Modal,
  type Role,
  type ServerCommands,
} from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  noEvent,
  outsider,
  prisma,
  register,
  resetDb,
  rid,
  startApp,
  type Client,
} from './helpers.js';

/** autocompletar sem resposta do bot: espera curta para o teste não demorar (produção: AUTOCOMPLETE_TIMEOUT_MS) */
const AUTOCOMPLETE_MS = 400;

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp({ AUTOCOMPLETE_TIMEOUT_MS: String(AUTOCOMPLETE_MS) });
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

const socket = async (token: string) => {
  const s = await connectSocket(token);
  sockets.push(s);
  return s;
};

interface Replied {
  interactionId: string;
  channelId: string;
  command: string;
  content: string | null;
  embeds?: unknown[];
  components?: MessageComponents;
  update?: boolean;
}
interface ModalEvent {
  interactionId: string;
  modalId: string;
  channelId: string;
  serverId: string;
  modal: Modal;
}

const OTHER_SERVER = rid();
const COMMANDS = {
  commands: [
    { name: 'oi', description: 'cumprimenta' },
    { name: 'form', description: 'abre um formulário' },
    {
      name: 'mod',
      description: 'moderação',
      options: [
        {
          type: 'subcommand',
          name: 'cargo',
          description: 'dar cargo',
          options: [
            { name: 'cargo', description: 'qual', type: 'role', required: true },
            { name: 'alvo', description: 'pessoa ou cargo', type: 'mentionable' },
          ],
        },
        {
          type: 'subcommand_group',
          name: 'limite',
          description: 'limites',
          options: [
            {
              type: 'subcommand',
              name: 'definir',
              description: 'define',
              options: [
                { name: 'valor', description: 'n', type: 'integer', required: true, minValue: 1, maxValue: 10 },
                { name: 'nome', description: 'texto', type: 'string', minLength: 2, maxLength: 5 },
                { name: 'canal', description: 'canal de voz', type: 'channel', channelTypes: ['voice'] },
                { name: 'modo', description: 'modo', type: 'string', choices: [{ name: 'A', value: 'a' }] },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'busca',
      description: 'busca',
      options: [
        { name: 'termo', description: 't', type: 'string', required: true, autocomplete: true },
        { name: 'extra', description: 'e', type: 'integer' },
      ],
    },
    { name: 'admin', description: 'só quem gerencia', defaultMemberPermissions: Permission.MANAGE_SERVER },
    { name: 'local', description: 'só noutro servidor', guildIds: [OTHER_SERVER] },
    { type: 'user', name: 'Ver perfil' },
    { type: 'message', name: 'Reportar mensagem' },
  ],
};

/** Bot público já membro do servidor e com os comandos acima registrados. */
async function setupBot(owner: Client, serverId: string): Promise<BotWithToken> {
  const r = await http.req<BotWithToken>('POST', '/me/bots', {
    token: owner.token,
    body: { name: 'V2', description: 'bot de teste', public: true },
  });
  if (r.status !== 201) throw new Error(`criar bot: ${r.status}`);
  const add = await http.req('POST', `/servers/${serverId}/bots`, { token: owner.token, body: { botId: r.body.id } });
  if (add.status !== 201) throw new Error(`adicionar bot: ${add.status}`);
  const set = await http.req('PUT', '/bots/@me/commands', { token: r.body.token, body: COMMANDS });
  if (set.status !== 200) throw new Error(`comandos: ${set.status} ${JSON.stringify(set.body)}`);
  return r.body;
}

const textChannel = (serverId: string) => prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });

describe('comandos v2', () => {
  it('valida o contrato v2 ao registrar; GET /servers/:id/commands filtra por guildIds', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const put = (commands: unknown[]) =>
      http.req('PUT', '/bots/@me/commands', { token: bot.token, body: { commands } });
    // comando de contexto não tem opções; subcomandos não se misturam com opções soltas; autocomplete ≠ choices
    expect(
      (await put([{ type: 'user', name: 'X', options: [{ name: 'a', description: 'a', type: 'string' }] }])).status,
    ).toBe(400);
    expect(
      (
        await put([
          {
            name: 'm',
            description: 'm',
            options: [
              { type: 'subcommand', name: 's', description: 's' },
              { name: 'a', description: 'a', type: 'string' },
            ],
          },
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await put([
          {
            name: 'm',
            description: 'm',
            options: [
              { name: 'a', description: 'a', type: 'string', autocomplete: true, choices: [{ name: 'x', value: 'x' }] },
            ],
          },
        ])
      ).status,
    ).toBe(400);
    // comando antigo (sem `type`) continua válido e ganha os padrões
    const legacy = await http.req<{ commands: { type: string; guildIds: string[] }[] }>('PUT', '/bots/@me/commands', {
      token: bot.token,
      body: { commands: [{ name: 'velho', description: 'v' }] },
    });
    expect(legacy.status).toBe(200);
    expect(legacy.body.commands[0]).toMatchObject({ type: 'chat', guildIds: [], defaultMemberPermissions: null });
    expect((await http.req('PUT', '/bots/@me/commands', { token: bot.token, body: COMMANDS })).status).toBe(200);

    const cmds = await http.req<ServerCommands[]>('GET', `/servers/${serverId}/commands`, { token: alice.token });
    expect(cmds.status).toBe(200);
    const names = cmds.body[0]!.commands.map((c) => `${c.type}:${c.name}`);
    expect(names).toContain('chat:mod');
    expect(names).toContain('user:Ver perfil');
    expect(names).toContain('message:Reportar mensagem');
    expect(names).not.toContain('chat:local');
  });

  it('caminho, opções novas, defaultMemberPermissions e guildIds', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const voice = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'voice' } });
    const staff = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Staff', permissions: 0 },
    });
    const sb = await socket(bot.token);
    const run = (body: Record<string, unknown>, token = alice.token) =>
      http.req<{ id: string }>('POST', '/interactions', {
        token,
        body: { channelId: text.id, botId: bot.id, ...body },
      });

    // guildIds: não vale aqui; defaultMemberPermissions: membro comum 403, dono passa
    expect((await run({ command: 'local' })).status).toBe(400);
    expect((await run({ command: 'admin' })).status).toBe(403);
    const gotAdmin = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.command === 'admin');
    expect((await run({ command: 'admin' }, owner.token)).status).toBe(201);
    expect((await gotAdmin).user.id).toBe(owner.id);
    // com o cargo que tem o bit, a pessoa passa
    const mods = await http.req<Role>('POST', `/servers/${serverId}/roles`, {
      token: owner.token,
      body: { name: 'Mods', permissions: Permission.MANAGE_SERVER },
    });
    await http.req('PUT', `/servers/${serverId}/members/${alice.id}/roles`, {
      token: owner.token,
      body: { roleIds: [mods.body.id] },
    });
    expect((await run({ command: 'admin' })).status).toBe(201);
    await http.req('PUT', `/servers/${serverId}/members/${alice.id}/roles`, {
      token: owner.token,
      body: { roleIds: [] },
    });

    // caminho: falta nível, sobra nível, nível errado
    expect((await run({ command: 'mod' })).status).toBe(400);
    expect((await run({ command: 'mod', subcommandGroup: 'limite' })).status).toBe(400);
    expect((await run({ command: 'mod', subcommandGroup: 'limite', subcommand: 'cargo' })).status).toBe(400);
    expect((await run({ command: 'mod', subcommand: 'limite' })).status).toBe(400);
    expect((await run({ command: 'oi', subcommand: 'x' })).status).toBe(400);

    // opções: role obrigatória; role/mentionable de fora → 400
    expect((await run({ command: 'mod', subcommand: 'cargo', options: {} })).status).toBe(400);
    expect((await run({ command: 'mod', subcommand: 'cargo', options: { cargo: rid() } })).status).toBe(400);
    expect(
      (await run({ command: 'mod', subcommand: 'cargo', options: { cargo: staff.body.id, alvo: rid() } })).status,
    ).toBe(400);
    // limites numéricos, de texto, tipo de canal e escolhas
    const definir = (options: Record<string, unknown>) =>
      run({ command: 'mod', subcommandGroup: 'limite', subcommand: 'definir', options });
    expect((await definir({ valor: 0 })).status).toBe(400);
    expect((await definir({ valor: 11 })).status).toBe(400);
    expect((await definir({ valor: 5, nome: 'a' })).status).toBe(400);
    expect((await definir({ valor: 5, nome: 'abcdef' })).status).toBe(400);
    expect((await definir({ valor: 5, canal: text.id })).status).toBe(400);
    expect((await definir({ valor: 5, modo: 'b' })).status).toBe(400);

    // sucesso: o bot recebe o caminho e as opções
    const got1 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.subcommand === 'cargo');
    expect(
      (await run({ command: 'mod', subcommand: 'cargo', options: { cargo: staff.body.id, alvo: owner.id } })).status,
    ).toBe(201);
    const i1 = await got1;
    expect(i1).toMatchObject({
      type: 'command',
      command: 'mod',
      subcommand: 'cargo',
      options: { cargo: staff.body.id, alvo: owner.id },
    });
    expect(i1.subcommandGroup).toBeUndefined();
    const got2 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.subcommand === 'definir');
    expect((await definir({ valor: 5, nome: 'abc', canal: voice.id, modo: 'a' })).status).toBe(201);
    expect(await got2).toMatchObject({
      command: 'mod',
      subcommandGroup: 'limite',
      subcommand: 'definir',
      options: { valor: 5, nome: 'abc', canal: voice.id, modo: 'a' },
    });
    // mentionable aceita cargo também
    const got3 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.subcommand === 'cargo');
    expect(
      (await run({ command: 'mod', subcommand: 'cargo', options: { cargo: staff.body.id, alvo: staff.body.id } }))
        .status,
    ).toBe(201);
    expect((await got3).options).toEqual({ cargo: staff.body.id, alvo: staff.body.id });
    // `update` não vale para comando
    expect(
      (await http.req('POST', `/interactions/${i1.id}/update`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(400);
  });

  it('comandos de contexto: pessoa e mensagem', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const stranger = await outsider(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const posted = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: owner.token,
      body: { requestId: rid(), body: 'reporte-me' },
    });

    const user = (body: Record<string, unknown>, token = alice.token) =>
      http.req<{ id: string }>('POST', '/interactions', {
        token,
        body: { type: 'user_command', channelId: text.id, botId: bot.id, command: 'Ver perfil', ...body },
      });
    expect((await user({ targetUserId: rid() })).status).toBe(400); // não é membro
    expect((await user({ targetUserId: owner.id, command: 'oi' })).status).toBe(400); // tipo errado
    const gotU = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'user_command');
    expect((await user({ targetUserId: owner.id })).status).toBe(201);
    const iu = await gotU;
    expect(iu.command).toBe('Ver perfil');
    expect(iu.targetUser?.id).toBe(owner.id);
    expect(iu.options).toEqual({});

    const msg = (body: Record<string, unknown>, token = alice.token) =>
      http.req<{ id: string }>('POST', '/interactions', {
        token,
        body: { type: 'message_command', botId: bot.id, command: 'Reportar mensagem', ...body },
      });
    expect((await msg({ messageId: rid() })).status).toBe(404);
    expect((await msg({ messageId: posted.body.id }, stranger.token)).status).toBe(404); // não vê o canal
    const gotM = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'message_command');
    expect((await msg({ messageId: posted.body.id })).status).toBe(201);
    const im = await gotM;
    expect(im.channelId).toBe(text.id);
    expect(im.targetMessage?.id).toBe(posted.body.id);
    expect(im.targetMessage?.body).toBe('reporte-me');
    // responde normalmente no canal
    const rep = await http.req<{ messageId: string | null }>('POST', `/interactions/${im.id}/reply`, {
      token: bot.token,
      body: { content: 'reportado' },
    });
    expect(rep.status).toBe(200);
    expect(rep.body.messageId).not.toBeNull();
  });
});

describe('componentes', () => {
  const ROWS: unknown[] = [
    {
      type: 'row',
      components: [
        { type: 'button', label: 'Ok', customId: 'ok' },
        { type: 'button', label: 'Off', customId: 'off', disabled: true },
        { type: 'button', style: 'link', label: 'Site', url: 'https://example.com' },
      ],
    },
    {
      type: 'row',
      components: [
        {
          type: 'select',
          customId: 'cor',
          options: [
            { label: 'Azul', value: 'azul' },
            { label: 'Verde', value: 'verde' },
          ],
          maxValues: 2,
        },
      ],
    },
    { type: 'row', components: [{ type: 'select', customId: 'quem', kind: 'user' }] },
  ];

  it('botão e menus numa mensagem do bot: validação, deferUpdate e update', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const stranger = await outsider(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const sa = await socket(alice.token);
    const posted = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: bot.token,
      body: { requestId: rid(), body: 'escolha', components: ROWS },
    });
    expect(posted.status).toBe(201);
    expect(posted.body.components).toHaveLength(3);
    const mine = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'sem botões' },
    });
    const click = (body: Record<string, unknown>, token = alice.token) =>
      http.req<{ id: string }>('POST', '/interactions', {
        token,
        body: { type: 'component', messageId: posted.body.id, ...body },
      });

    expect((await click({ customId: 'ok', ephemeralOf: rid() })).status).toBe(400); // messageId OU ephemeralOf
    expect((await click({ customId: 'nada' })).status).toBe(400);
    expect((await click({ customId: 'off' })).status).toBe(400); // desabilitado
    expect((await click({ customId: 'ok', values: ['x'] })).status).toBe(400); // botão sem valores
    expect((await click({ customId: 'cor', values: [] })).status).toBe(400); // minValues 1
    expect((await click({ customId: 'cor', values: ['roxo'] })).status).toBe(400); // fora das opções
    expect((await click({ customId: 'cor', values: ['azul', 'azul'] })).status).toBe(400); // repetido
    expect((await click({ customId: 'cor', values: ['azul', 'verde', 'azul'] })).status).toBe(400); // > maxValues
    expect((await click({ customId: 'quem', values: ['x'] })).status).toBe(400); // não é id
    expect((await click({ customId: 'quem', values: [rid()] })).status).toBe(400); // não é membro
    expect((await click({ customId: 'ok', messageId: mine.body.id })).status).toBe(400); // mensagem de pessoa
    expect((await click({ customId: 'ok' }, stranger.token)).status).toBe(404); // não vê o canal
    expect((await click({ customId: 'ok' }, bot.token)).status).toBe(403); // bot não clica
    // em castigo não clica
    const until = new Date(Date.now() + 60_000).toISOString();
    await http.req('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: until },
    });
    expect((await click({ customId: 'ok' })).status).toBe(403);
    await http.req('PATCH', `/servers/${serverId}/members/${alice.id}`, {
      token: owner.token,
      body: { timeoutUntil: null },
    });

    // menu de usuário: o bot recebe os ids e responde com mensagem nova
    const gotQuem = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.customId === 'quem');
    expect((await click({ customId: 'quem', values: [owner.id] })).status).toBe(201);
    const iq = await gotQuem;
    expect(iq).toMatchObject({ type: 'component', componentType: 'select', values: [owner.id], options: {} });
    expect(iq.targetMessage?.id).toBe(posted.body.id);
    const rep = await http.req<{ messageId: string | null }>('POST', `/interactions/${iq.id}/reply`, {
      token: bot.token,
      body: { content: `escolheu ${owner.id}` },
    });
    expect(rep.status).toBe(200);
    expect(rep.body.messageId).not.toBeNull();

    // menu de texto: deferUpdate não mostra "pensando…"; update edita a mensagem de origem
    const gotCor = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.customId === 'cor');
    expect((await click({ customId: 'cor', values: ['azul', 'verde'] })).status).toBe(201);
    const ic = await gotCor;
    expect(ic.values).toEqual(['azul', 'verde']);
    const silent = noEvent(sa, 'interaction:replied');
    expect(
      (await http.req('POST', `/interactions/${ic.id}/defer`, { token: bot.token, body: { update: true } })).status,
    ).toBe(204);
    await silent;
    const edited = nextEvent<Message>(sa, 'chat:message:updated', (m) => m.id === posted.body.id);
    const upd = await http.req<{ messageId: string | null }>('POST', `/interactions/${ic.id}/update`, {
      token: bot.token,
      body: { content: 'você escolheu azul e verde', components: [] },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.messageId).toBe(posted.body.id);
    const m = await edited;
    expect(m.body).toBe('você escolheu azul e verde');
    expect(m.components).toEqual([]);
    expect(m.editedAt).not.toBeNull();
    // consumida: segunda resposta → 404
    expect(
      (await http.req('POST', `/interactions/${ic.id}/reply`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(404);
    // sem componentes, o clique deixa de valer
    expect((await click({ customId: 'ok' })).status).toBe(400);
  });

  it('cartão efêmero com botões: clique com ephemeralOf e update substitui o cartão', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const sa = await socket(alice.token);

    const got = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.command === 'oi');
    const r = await http.req<{ id: string }>('POST', '/interactions', {
      token: alice.token,
      body: { channelId: text.id, botId: bot.id, command: 'oi' },
    });
    expect(r.status).toBe(201);
    const inter = await got;
    const card = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.interactionId === inter.id);
    const rep = await http.req<{ messageId: string | null }>('POST', `/interactions/${inter.id}/reply`, {
      token: bot.token,
      body: {
        content: 'confirma?',
        ephemeral: true,
        embeds: [{ title: 'Confirmação' }],
        components: [
          {
            type: 'row',
            components: [
              { type: 'button', label: 'Sim', customId: 'sim', style: 'success' },
              { type: 'button', label: 'Não', customId: 'nao', style: 'danger' },
            ],
          },
        ],
      },
    });
    expect(rep.status).toBe(200);
    expect(rep.body.messageId).toBeNull();
    const c = await card;
    expect(c.content).toBe('confirma?');
    expect(c.embeds).toHaveLength(1);
    expect(c.components?.[0]?.components.map((x) => ('customId' in x ? x.customId : null))).toEqual(['sim', 'nao']);
    expect(c.update).toBeUndefined();

    const click = (body: Record<string, unknown>, token = alice.token) =>
      http.req<{ id: string }>('POST', '/interactions', {
        token,
        body: { type: 'component', ephemeralOf: inter.id, ...body },
      });
    expect((await click({ customId: 'sim' }, owner.token)).status).toBe(404); // cartão não é dele
    expect((await click({ customId: 'talvez' })).status).toBe(400);
    expect((await click({ customId: 'sim', ephemeralOf: rid() })).status).toBe(404);

    const gotClick = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'component');
    expect((await click({ customId: 'sim' })).status).toBe(201);
    const ic = await gotClick;
    expect(ic).toMatchObject({ customId: 'sim', componentType: 'button', values: [], ephemeralOf: inter.id });
    expect(ic.targetMessage).toBeUndefined();
    expect(ic.channelId).toBe(text.id);

    // update: evento para a pessoa com update: true e o id do cartão original; botões novos passam a valer
    const upd = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.update === true);
    const u = await http.req<{ messageId: string | null }>('POST', `/interactions/${ic.id}/update`, {
      token: bot.token,
      body: {
        content: 'confirmado',
        components: [{ type: 'row', components: [{ type: 'button', label: 'Desfazer', customId: 'desfazer' }] }],
      },
    });
    expect(u.status).toBe(200);
    expect(u.body.messageId).toBeNull();
    const e = await upd;
    expect(e.interactionId).toBe(inter.id);
    expect(e.content).toBe('confirmado');
    expect(e.embeds).toBeUndefined();
    expect((await click({ customId: 'sim' })).status).toBe(400); // botão antigo sumiu
    const gotUndo = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.customId === 'desfazer');
    expect((await click({ customId: 'desfazer' })).status).toBe(201);
    const iu = await gotUndo;
    // update sem componentes: o cartão deixa de aceitar cliques
    const upd2 = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.update === true);
    expect(
      (await http.req('POST', `/interactions/${iu.id}/update`, { token: bot.token, body: { components: [] } })).status,
    ).toBe(200);
    expect((await upd2).content).toBeNull();
    expect((await click({ customId: 'desfazer' })).status).toBe(404);
  });
});

describe('modais', () => {
  const MODAL = {
    customId: 'feedback',
    title: 'Feedback',
    components: [
      { type: 'text', customId: 'titulo', label: 'Título', minLength: 3 },
      { type: 'text', customId: 'detalhes', label: 'Detalhes', style: 'paragraph', required: false, maxLength: 10 },
    ],
  };

  it('abrir a partir de comando, validar o envio, bot recebe fields; de componente, update edita a mensagem', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const sa = await socket(alice.token);
    const so = await socket(owner.token);

    const got = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.command === 'form');
    expect(
      (
        await http.req('POST', '/interactions', {
          token: alice.token,
          body: { channelId: text.id, botId: bot.id, command: 'form' },
        })
      ).status,
    ).toBe(201);
    const inter = await got;
    const modalEv = nextEvent<ModalEvent>(sa, 'interaction:modal');
    const ownerSilent = noEvent(so, 'interaction:modal');
    expect(
      (await http.req('POST', `/interactions/${inter.id}/modal`, { token: alice.token, body: { modal: MODAL } }))
        .status,
    ).toBe(403);
    expect(
      (await http.req('POST', `/interactions/${inter.id}/modal`, { token: bot.token, body: { modal: MODAL } })).status,
    ).toBe(204);
    const m = await modalEv;
    await ownerSilent;
    expect(m.interactionId).toBe(inter.id);
    expect(m.channelId).toBe(text.id);
    expect(m.modal.customId).toBe('feedback');
    expect(m.modal.components).toHaveLength(2);
    // abrir o modal consumiu a interação
    expect(
      (await http.req('POST', `/interactions/${inter.id}/reply`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(404);

    const send = (fields: Record<string, string>, token = alice.token, modalId = m.modalId) =>
      http.req<{ id: string }>('POST', '/interactions', { token, body: { type: 'modal', modalId, fields } });
    expect((await send({})).status).toBe(400); // obrigatório
    expect((await send({ titulo: 'ab' })).status).toBe(400); // min 3
    expect((await send({ titulo: 'abc', detalhes: 'x'.repeat(11) })).status).toBe(400); // max 10
    expect((await send({ titulo: 'abc', outro: 'x' })).status).toBe(400); // desconhecido
    expect((await send({ titulo: 'abc' }, owner.token)).status).toBe(404); // não é dele
    expect((await send({ titulo: 'abc' }, alice.token, rid())).status).toBe(404);
    const gotModal = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'modal');
    expect((await send({ titulo: 'abc', detalhes: '' })).status).toBe(201);
    const im = await gotModal;
    expect(im).toMatchObject({ customId: 'feedback', fields: { titulo: 'abc', detalhes: '' }, channelId: text.id });
    expect((await send({ titulo: 'abc' })).status).toBe(404); // consumido
    // modal de comando não tem origem para `update`; modal não abre outro modal; reply efêmera funciona
    expect(
      (await http.req('POST', `/interactions/${im.id}/update`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(400);
    expect(
      (await http.req('POST', `/interactions/${im.id}/modal`, { token: bot.token, body: { modal: MODAL } })).status,
    ).toBe(400);
    const thanks = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.interactionId === im.id);
    expect(
      (
        await http.req('POST', `/interactions/${im.id}/reply`, {
          token: bot.token,
          body: { content: 'obrigado', ephemeral: true },
        })
      ).status,
    ).toBe(200);
    expect((await thanks).content).toBe('obrigado');

    // modal aberto por um botão: o envio herda a mensagem de origem e `update` a edita
    const posted = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: bot.token,
      body: {
        requestId: rid(),
        body: 'editar?',
        components: [{ type: 'row', components: [{ type: 'button', label: 'Editar', customId: 'editar' }] }],
      },
    });
    const gotClick = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.customId === 'editar');
    expect(
      (
        await http.req('POST', '/interactions', {
          token: alice.token,
          body: { type: 'component', messageId: posted.body.id, customId: 'editar' },
        })
      ).status,
    ).toBe(201);
    const ic = await gotClick;
    // adiada não abre modal
    const modalEv2 = nextEvent<ModalEvent>(sa, 'interaction:modal');
    expect(
      (await http.req('POST', `/interactions/${ic.id}/modal`, { token: bot.token, body: { modal: MODAL } })).status,
    ).toBe(204);
    const m2 = await modalEv2;
    const gotModal2 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'modal');
    expect((await send({ titulo: 'novo' }, alice.token, m2.modalId)).status).toBe(201);
    const im2 = await gotModal2;
    const edited = nextEvent<Message>(sa, 'chat:message:updated', (x) => x.id === posted.body.id);
    const upd = await http.req<{ messageId: string | null }>('POST', `/interactions/${im2.id}/update`, {
      token: bot.token,
      body: { content: 'novo', components: [] },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.messageId).toBe(posted.body.id);
    expect((await edited).body).toBe('novo');
  });

  it('interação adiada não abre modal', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const got = nextEvent<Interaction>(sb, 'interaction:created');
    await http.req('POST', '/interactions', {
      token: alice.token,
      body: { channelId: text.id, botId: bot.id, command: 'form' },
    });
    const inter = await got;
    expect((await http.req('POST', `/interactions/${inter.id}/defer`, { token: bot.token })).status).toBe(204);
    expect(
      (await http.req('POST', `/interactions/${inter.id}/modal`, { token: bot.token, body: { modal: MODAL } })).status,
    ).toBe(400);
  });
});

describe('autocompletar', () => {
  it('bot responde a tempo → choices; sem resposta → vazio dentro do prazo; validações', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const ask = (body: Record<string, unknown>) =>
      http.req<{ id: string; choices?: { name: string; value: string | number }[] }>('POST', '/interactions', {
        token: alice.token,
        body: { type: 'autocomplete', channelId: text.id, botId: bot.id, command: 'busca', focused: 'termo', ...body },
      });
    // bot offline → 409 (depois das validações)
    expect((await ask({ options: { termo: 'a' } })).status).toBe(409);
    const sb = await socket(bot.token);
    expect((await ask({ focused: 'extra', options: { termo: 'a' } })).status).toBe(400); // sem autocomplete
    expect((await ask({ focused: 'nada', options: {} })).status).toBe(400);
    expect((await ask({ options: { termo: 'a', extra: 'x' } })).status).toBe(400); // tipo errado nas outras
    expect((await ask({ options: { termo: 'a', outra: 1 } })).status).toBe(400); // desconhecida

    // bot responde a tempo: a requisição devolve as sugestões
    const got = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'autocomplete');
    const pending = ask({ options: { termo: 'ab', extra: 3 } });
    const inter = await got;
    expect(inter).toMatchObject({ command: 'busca', focused: 'termo', options: { termo: 'ab', extra: 3 } });
    // reply/update não valem para autocompletar
    expect(
      (await http.req('POST', `/interactions/${inter.id}/reply`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(400);
    const choices = [
      { name: 'abacate', value: 'abacate' },
      { name: 'abóbora', value: 'abobora' },
    ];
    expect(
      (await http.req('POST', `/interactions/${inter.id}/autocomplete`, { token: bot.token, body: { choices } }))
        .status,
    ).toBe(204);
    const r = await pending;
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(inter.id);
    expect(r.body.choices).toEqual(choices);
    // consumida
    expect(
      (await http.req('POST', `/interactions/${inter.id}/autocomplete`, { token: bot.token, body: { choices } }))
        .status,
    ).toBe(404);

    // o texto em foco pode estar vazio ainda; sem resposta do bot, lista vazia dentro do prazo configurado
    const got2 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'autocomplete');
    const t0 = Date.now();
    const r2 = await ask({ options: {} });
    expect(r2.status).toBe(201);
    expect(r2.body.choices).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(AUTOCOMPLETE_MS + 1500);
    expect((await got2).options).toEqual({ termo: '' });
    // `/autocomplete` numa interação de comando → 404
    const got3 = nextEvent<Interaction>(sb, 'interaction:created', (p) => p.type === 'command');
    await http.req('POST', '/interactions', {
      token: alice.token,
      body: { channelId: text.id, botId: bot.id, command: 'busca', options: { termo: 'abacate' } },
    });
    const ic = await got3;
    expect(
      (await http.req('POST', `/interactions/${ic.id}/autocomplete`, { token: bot.token, body: { choices } })).status,
    ).toBe(404);
  });
});

describe('compatibilidade v1', () => {
  it('POST /interactions sem type é comando; defer sem corpo mostra "pensando…"; reply efêmera simples', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await setupBot(owner, serverId);
    const text = await textChannel(serverId);
    const sb = await socket(bot.token);
    const sa = await socket(alice.token);
    const got = nextEvent<Interaction>(sb, 'interaction:created');
    const r = await http.req<{ id: string; choices?: unknown }>('POST', '/interactions', {
      token: alice.token,
      body: { channelId: text.id, botId: bot.id, command: 'busca', options: { termo: 'x' } },
    });
    expect(r.status).toBe(201);
    expect(r.body.choices).toBeUndefined();
    const inter = await got;
    expect(inter.type).toBe('command');
    const thinking = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.content === null);
    expect((await http.req('POST', `/interactions/${inter.id}/defer`, { token: bot.token })).status).toBe(204);
    expect(await thinking).toMatchObject({ interactionId: inter.id, command: 'busca', content: null });
    const answer = nextEvent<Replied>(sa, 'interaction:replied', (p) => p.content !== null);
    expect(
      (
        await http.req('POST', `/interactions/${inter.id}/reply`, {
          token: bot.token,
          body: { content: 'achei', ephemeral: true },
        })
      ).status,
    ).toBe(200);
    const a = await answer;
    expect(a.content).toBe('achei');
    expect(a.components).toBeUndefined();
    // efêmera não leva anexos
    const got2 = nextEvent<Interaction>(sb, 'interaction:created');
    await http.req('POST', '/interactions', {
      token: alice.token,
      body: { channelId: text.id, botId: bot.id, command: 'oi' },
    });
    const i2 = await got2;
    expect(
      (
        await http.req('POST', `/interactions/${i2.id}/reply`, {
          token: bot.token,
          body: { content: 'x', ephemeral: true, attachmentIds: [rid()] },
        })
      ).status,
    ).toBe(400);
  });
});

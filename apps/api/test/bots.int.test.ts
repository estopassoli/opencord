/**
 * Bots e aplicativos (ADR-0032): criar bot e token, autenticar REST e socket com `ocb_…`, entrar/sair de servidores,
 * mensagens com selo APP, comandos de barra e o ciclo completo de uma interação (efêmera e normal).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Bot, BotWithToken, Interaction, Message, ServerCommands } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  connectSocket,
  Http,
  nextEvent,
  noEvent,
  prisma,
  register,
  resetDb,
  rid,
  startApp,
  type Client,
} from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp();
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

async function createBot(owner: Client, name: string, isPublic = false): Promise<BotWithToken> {
  const r = await http.req<BotWithToken>('POST', '/me/bots', {
    token: owner.token,
    body: { name, description: 'bot de teste', public: isPublic },
  });
  if (r.status !== 201) throw new Error(`criar bot: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const PING = {
  commands: [
    {
      name: 'ping',
      description: 'responde pong',
      options: [
        { name: 'texto', description: 'o que ecoar', type: 'string', required: true },
        {
          name: 'vezes',
          description: 'quantas',
          type: 'integer',
          required: false,
          choices: [{ name: 'uma', value: 1 }],
        },
        { name: 'quem', description: 'alguém', type: 'user' },
      ],
    },
  ],
};

describe('bots: criar, token, autenticação', () => {
  it('cria com token que só aparece uma vez; o token autentica REST e socket; dono lista e edita, outros não', async () => {
    const alice = await register(http);
    const bob = await register(http);
    const created = await createBot(alice, 'Ajudante');
    expect(created.token).toMatch(/^ocb_[A-Za-z0-9_-]{43}$/);
    expect(created.user.bot).toBe(true);
    expect(created.user.displayName).toBe('Ajudante');
    expect(created.ownerId).toBe(alice.id);
    const stored = await prisma.bot.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.tokenHash).not.toContain('ocb_');

    // lista do dono não traz o token
    const mine = await http.req<Bot[]>('GET', '/me/bots', { token: alice.token });
    expect(mine.body).toHaveLength(1);
    expect('token' in (mine.body[0] as object)).toBe(false);

    // o token do bot vale no REST…
    const me = await http.req<Bot>('GET', '/bots/@me', { token: created.token });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(created.id);
    // …e pessoa não usa a rota do bot
    expect((await http.req('GET', '/bots/@me', { token: alice.token })).status).toBe(403);
    // …e no socket (evento ready)
    const sb = await socket(created.token);
    expect(sb.connected).toBe(true);
    // token inventado com o prefixo → 401
    expect((await http.req('GET', '/bots/@me', { token: `ocb_${'x'.repeat(43)}` })).status).toBe(401);

    // privado: outro usuário não vê nem edita (404)
    expect((await http.req('GET', `/bots/${created.id}`, { token: bob.token })).status).toBe(404);
    expect(
      (await http.req('PATCH', `/bots/${created.id}`, { token: bob.token, body: { name: 'Invasor' } })).status,
    ).toBe(404);
    const renamed = await http.req<Bot>('PATCH', `/bots/${created.id}`, {
      token: alice.token,
      body: { name: 'Ajudante 2', public: true },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.displayName).toBe('Ajudante 2');
    expect(renamed.body.public).toBe(true);
    // público: aparece no diretório e qualquer um lê pelo id
    expect((await http.req<Bot[]>('GET', '/bots/directory', { token: bob.token })).body.map((b) => b.id)).toEqual([
      created.id,
    ]);
    expect((await http.req('GET', `/bots/${created.id}`, { token: bob.token })).status).toBe(200);

    // logout e troca de senha com token de bot não quebram (403, nunca 500)
    expect((await http.req('POST', '/auth/logout', { token: created.token })).status).toBe(403);
    expect(
      (
        await http.req('POST', '/auth/password', {
          token: created.token,
          body: { currentPassword: 'password-123456', newPassword: 'password-654321' },
        })
      ).status,
    ).toBe(403);
    // um bot não cria bots
    expect((await http.req('POST', '/me/bots', { token: created.token, body: { name: 'Filho' } })).status).toBe(403);
  });

  it('regenerar o token invalida o antigo na hora; excluir tira o bot dos servidores', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const bot = await createBot(owner, 'Temporário');
    expect(
      (await http.req('POST', `/servers/${serverId}/bots`, { token: owner.token, body: { botId: bot.id } })).status,
    ).toBe(201);
    const bob = await register(http);
    expect((await http.req('POST', `/bots/${bot.id}/token`, { token: bob.token })).status).toBe(404);
    const regen = await http.req<BotWithToken>('POST', `/bots/${bot.id}/token`, { token: owner.token });
    expect(regen.status).toBe(201);
    expect(regen.body.token).not.toBe(bot.token);
    expect((await http.req('GET', '/bots/@me', { token: bot.token })).status).toBe(401);
    expect((await http.req('GET', '/bots/@me', { token: regen.body.token })).status).toBe(200);

    const so = await socket(owner.token);
    const left = nextEvent<{ userId: string }>(so, 'server:member:left', (p) => p.userId === bot.user.id);
    expect((await http.req('DELETE', `/bots/${bot.id}`, { token: bob.token })).status).toBe(404);
    expect((await http.req('DELETE', `/bots/${bot.id}`, { token: owner.token })).status).toBe(204);
    await left;
    expect((await http.req('GET', '/bots/@me', { token: regen.body.token })).status).toBe(401);
    expect(await prisma.serverMember.findFirst({ where: { userId: bot.user.id } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bot.user.id } })).disabledAt).not.toBeNull();
    expect((await http.req<Bot[]>('GET', `/servers/${serverId}/bots`, { token: owner.token })).body).toEqual([]);
  });
});

describe('bots num servidor', () => {
  it('só MANAGE_SERVER adiciona; privado só do próprio dono; o bot recebe mensagens e posta com selo APP', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const publicBot = await createBot(alice, 'Público', true);
    const privateOfAlice = await createBot(alice, 'Privado da Alice');
    const privateOfOwner = await createBot(owner, 'Privado do dono');

    // membro comum: 403 (tem acesso ao servidor, mas sem MANAGE_SERVER)
    expect(
      (await http.req('POST', `/servers/${serverId}/bots`, { token: alice.token, body: { botId: publicBot.id } }))
        .status,
    ).toBe(403);
    // dono adiciona público e o próprio privado; privado de outra pessoa → 404
    const so = await socket(owner.token);
    const changed = nextEvent<{ serverId: string }>(so, 'bot:commands:changed', (p) => p.serverId === serverId);
    const added = await http.req<Bot>('POST', `/servers/${serverId}/bots`, {
      token: owner.token,
      body: { botId: publicBot.id },
    });
    expect(added.status).toBe(201);
    expect(added.body.id).toBe(publicBot.id);
    await changed;
    expect(
      (
        await http.req('POST', `/servers/${serverId}/bots`, {
          token: owner.token,
          body: { botId: privateOfOwner.id },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await http.req('POST', `/servers/${serverId}/bots`, {
          token: owner.token,
          body: { botId: privateOfAlice.id },
        })
      ).status,
    ).toBe(404);
    const list = await http.req<Bot[]>('GET', `/servers/${serverId}/bots`, { token: alice.token });
    expect(list.body.map((b) => b.id).sort()).toEqual([publicBot.id, privateOfOwner.id].sort());
    const audit = await prisma.auditLog.findMany({ where: { serverId, action: 'bot.add' } });
    expect(audit).toHaveLength(2);

    // o bot está nas rooms de membro: recebe a mensagem da pessoa e responde pelo REST
    const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
    const sb = await socket(publicBot.token);
    const incoming = nextEvent<Message>(sb, 'chat:message:created', (m) => m.channelId === text.id);
    await http.req('POST', `/channels/${text.id}/messages`, {
      token: alice.token,
      body: { requestId: rid(), body: 'olá bot' },
    });
    expect((await incoming).body).toBe('olá bot');
    const sa = await socket(alice.token);
    const fromBot = nextEvent<Message>(sa, 'chat:message:created', (m) => m.author.id === publicBot.user.id);
    const posted = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: publicBot.token,
      body: { requestId: rid(), body: 'olá pessoa' },
    });
    expect(posted.status).toBe(201);
    expect(posted.body.author.bot).toBe(true);
    expect((await fromBot).body).toBe('olá pessoa');

    // remover: só MANAGE_SERVER; o bot sai das rooms
    expect((await http.req('DELETE', `/servers/${serverId}/bots/${publicBot.id}`, { token: alice.token })).status).toBe(
      403,
    );
    const removed = nextEvent<{ serverId: string }>(sb, 'server:removed', (p) => p.serverId === serverId);
    expect((await http.req('DELETE', `/servers/${serverId}/bots/${publicBot.id}`, { token: owner.token })).status).toBe(
      204,
    );
    await removed;
    expect(
      (
        await http.req('POST', `/channels/${text.id}/messages`, {
          token: publicBot.token,
          body: { requestId: rid(), body: 'ainda aqui?' },
        })
      ).status,
    ).toBe(404);
    expect(await prisma.auditLog.count({ where: { serverId, action: 'bot.remove' } })).toBe(1);
  });
});

describe('comandos e interações', () => {
  it('registra comandos, lista por servidor e avisa; interação efêmera e normal; offline e opções inválidas', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const bot = await createBot(owner, 'Comandos', true);
    await http.req('POST', `/servers/${serverId}/bots`, { token: owner.token, body: { botId: bot.id } });
    const text = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });

    // registrar: só pelo token do bot; validação do contrato
    expect((await http.req('PUT', '/bots/@me/commands', { token: owner.token, body: PING })).status).toBe(403);
    expect(
      (
        await http.req('PUT', '/bots/@me/commands', {
          token: bot.token,
          body: { commands: [{ name: 'Maiúsculo', description: 'x' }] },
        })
      ).status,
    ).toBe(400);
    const sa = await socket(alice.token);
    const changed = nextEvent<{ serverId: string }>(sa, 'bot:commands:changed', (p) => p.serverId === serverId);
    const set = await http.req<Bot>('PUT', '/bots/@me/commands', { token: bot.token, body: PING });
    expect(set.status).toBe(200);
    expect(set.body.commands.map((c) => c.name)).toEqual(['ping']);
    await changed;
    const cmds = await http.req<ServerCommands[]>('GET', `/servers/${serverId}/commands`, { token: alice.token });
    expect(cmds.status).toBe(200);
    expect(cmds.body).toHaveLength(1);
    expect(cmds.body[0]!.botId).toBe(bot.id);
    expect(cmds.body[0]!.bot.bot).toBe(true);
    expect(cmds.body[0]!.commands[0]!.options.map((o) => o.name)).toEqual(['texto', 'vezes', 'quem']);

    // bot offline → 409
    const interact = (options: Record<string, unknown>, cmd = 'ping') =>
      http.req<{ id: string }>('POST', '/interactions', {
        token: alice.token,
        body: { channelId: text.id, botId: bot.id, command: cmd, options },
      });
    expect((await interact({ texto: 'oi' })).status).toBe(409);

    const sb = await socket(bot.token);
    // opções inválidas → 400 (antes de checar se o bot está online)
    expect((await interact({})).status).toBe(400); // obrigatória ausente
    expect((await interact({ texto: 7 })).status).toBe(400); // tipo errado
    expect((await interact({ texto: 'oi', vezes: 2 })).status).toBe(400); // fora das escolhas
    expect((await interact({ texto: 'oi', vezes: 1.5 })).status).toBe(400); // não inteiro
    expect((await interact({ texto: 'oi', extra: 1 })).status).toBe(400); // desconhecida
    expect((await interact({ texto: 'oi', quem: 'não-uuid' })).status).toBe(400);
    expect((await interact({ texto: 'oi', quem: rid() })).status).toBe(400); // não é membro
    expect((await interact({ texto: 'oi' }, 'nada')).status).toBe(400); // comando inexistente
    // bot não usa comandos
    expect(
      (
        await http.req('POST', '/interactions', {
          token: bot.token,
          body: { channelId: text.id, botId: bot.id, command: 'ping', options: { texto: 'x' } },
        })
      ).status,
    ).toBe(403);

    // interação completa: pessoa → bot recebe → defer → resposta efêmera só para a pessoa
    const so = await socket(owner.token);
    const got = nextEvent<Interaction>(sb, 'interaction:created');
    const r1 = await interact({ texto: 'oi', vezes: 1, quem: owner.id });
    expect(r1.status).toBe(201);
    const inter = await got;
    expect(inter.id).toBe(r1.body.id);
    expect(inter.command).toBe('ping');
    expect(inter.options).toEqual({ texto: 'oi', vezes: 1, quem: owner.id });
    expect(inter.user.id).toBe(alice.id);
    expect(inter.channelId).toBe(text.id);
    expect(inter.serverId).toBe(serverId);

    const thinking = nextEvent<{ interactionId: string; content: string | null }>(sa, 'interaction:replied');
    expect((await http.req('POST', `/interactions/${inter.id}/defer`, { token: bot.token })).status).toBe(204);
    expect(await thinking).toMatchObject({ interactionId: inter.id, content: null, command: 'ping' });

    const ephemeral = nextEvent<{ interactionId: string; content: string | null }>(
      sa,
      'interaction:replied',
      (p) => p.content !== null,
    );
    const ownerSilent = noEvent(so, 'interaction:replied');
    // pessoa não responde interação; outra interação inexistente → 404
    expect(
      (await http.req('POST', `/interactions/${inter.id}/reply`, { token: alice.token, body: { content: 'x' } }))
        .status,
    ).toBe(403);
    expect(
      (await http.req('POST', `/interactions/${rid()}/reply`, { token: bot.token, body: { content: 'x' } })).status,
    ).toBe(404);
    const rep = await http.req<{ messageId: string | null }>('POST', `/interactions/${inter.id}/reply`, {
      token: bot.token,
      body: { content: 'pong (só você vê)', ephemeral: true },
    });
    expect(rep.status).toBe(200);
    expect(rep.body.messageId).toBeNull();
    expect((await ephemeral).content).toBe('pong (só você vê)');
    await ownerSilent;
    // segunda resposta → 404
    expect(
      (await http.req('POST', `/interactions/${inter.id}/reply`, { token: bot.token, body: { content: 'de novo' } }))
        .status,
    ).toBe(404);

    // resposta normal vira mensagem do bot no canal, visível a todos
    const got2 = nextEvent<Interaction>(sb, 'interaction:created');
    const r2 = await interact({ texto: 'oi' });
    expect(r2.status).toBe(201);
    const inter2 = await got2;
    const msg = nextEvent<Message>(so, 'chat:message:created', (m) => m.author.id === bot.user.id);
    const rep2 = await http.req<{ messageId: string | null }>('POST', `/interactions/${inter2.id}/reply`, {
      token: bot.token,
      body: { content: 'pong' },
    });
    expect(rep2.status).toBe(200);
    const m = await msg;
    expect(m.id).toBe(rep2.body.messageId);
    expect(m.body).toBe('pong');
    expect(m.author.bot).toBe(true);
  });
});

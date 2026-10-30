/** Enquetes (ADR-0018): criar, votar (uma ou várias), tempo real, encerrar e permissões. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, type Message, type Poll, type Role, type ServerDetail } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, rid, startApp } from './helpers.js';

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

async function setup() {
  const { owner, serverId } = await bootstrapOwner(http);
  const alice = await register(http);
  const bob = await register(http);
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId, kind: 'text' } });
  return { owner, alice, bob, serverId, channelId: channel.id };
}

const createPoll = (token: string, channelId: string, body: Record<string, unknown>) =>
  http.req<Message>('POST', `/channels/${channelId}/polls`, { token, body: { requestId: rid(), ...body } });

describe('enquetes', () => {
  it('cria, vota (uma opção), troca o voto e o tempo real leva a contagem', async () => {
    const { alice, bob, channelId } = await setup();
    const created = await createPoll(alice.token, channelId, {
      question: 'Qual jogo hoje?',
      options: ['Valorant', 'LoL', 'CS2'],
      durationHours: 24,
    });
    expect(created.status).toBe(201);
    const poll = created.body.poll as Poll;
    expect(created.body.body).toBe('Qual jogo hoje?');
    expect(poll).toMatchObject({ question: 'Qual jogo hoje?', multiple: false, closed: false, voters: 0, mine: [] });
    expect(poll.options.map((o) => o.text)).toEqual(['Valorant', 'LoL', 'CS2']);

    const sb = await connectSocket(bob.token);
    sockets.push(sb);
    const updated = nextEvent<{ messageId: string; poll: Poll }>(sb, 'poll:updated');
    const [val, lol] = poll.options;
    const v1 = await http.req<Poll>('PUT', `/polls/${poll.id}/vote`, {
      token: alice.token,
      body: { optionIds: [val!.id] },
    });
    expect(v1.body.mine).toEqual([val!.id]);
    const ev = await updated;
    expect(ev.messageId).toBe(created.body.id);
    expect(ev.poll.options[0]!.votes).toBe(1);
    expect(ev.poll.mine).toEqual([]); // cada app guarda o próprio voto

    // uma opção só: duas de uma vez é recusado; trocar substitui
    expect(
      (await http.req('PUT', `/polls/${poll.id}/vote`, { token: bob.token, body: { optionIds: [val!.id, lol!.id] } }))
        .status,
    ).toBe(400);
    const v2 = await http.req<Poll>('PUT', `/polls/${poll.id}/vote`, {
      token: alice.token,
      body: { optionIds: [lol!.id] },
    });
    expect(v2.body.options.map((o) => o.votes)).toEqual([0, 1, 0]);
    expect(v2.body.voters).toBe(1);

    // a lista de mensagens traz o meu voto
    const page = await http.req<{ messages: Message[] }>('GET', `/channels/${channelId}/messages`, {
      token: alice.token,
    });
    expect(page.body.messages.find((m) => m.id === created.body.id)?.poll?.mine).toEqual([lol!.id]);
  });

  it('várias opções, encerrar só autor ou moderação, encerrada não aceita voto; não dá para editar', async () => {
    const { owner, alice, bob, channelId } = await setup();
    const created = await createPoll(alice.token, channelId, {
      question: 'Que dias você pode?',
      options: ['Sex', 'Sáb', 'Dom'],
      multiple: true,
      durationHours: 0,
    });
    const poll = created.body.poll as Poll;
    expect(poll.endsAt).toBeNull();
    const all = poll.options.map((o) => o.id);
    const v = await http.req<Poll>('PUT', `/polls/${poll.id}/vote`, { token: bob.token, body: { optionIds: all } });
    expect(v.body.options.map((o) => o.votes)).toEqual([1, 1, 1]);
    expect(v.body.voters).toBe(1);

    expect((await http.req('POST', `/polls/${poll.id}/close`, { token: bob.token })).status).toBe(403);
    const closed = await http.req<Poll>('POST', `/polls/${poll.id}/close`, { token: alice.token });
    expect(closed.body.closed).toBe(true);
    expect(
      (await http.req('PUT', `/polls/${poll.id}/vote`, { token: bob.token, body: { optionIds: [] } })).status,
    ).toBe(400);
    expect(
      (await http.req('PATCH', `/messages/${created.body.id}`, { token: alice.token, body: { body: 'outra' } })).status,
    ).toBe(400);

    // moderação (dono) encerra a enquete de outra pessoa
    const other = await createPoll(alice.token, channelId, { question: 'Pizza?', options: ['Sim', 'Não'] });
    expect((await http.req('POST', `/polls/${other.body.poll!.id}/close`, { token: owner.token })).status).toBe(200);
  });

  it('opções repetidas ou fora do limite são recusadas; canal só leitura ainda aceita voto', async () => {
    const { owner, alice, serverId, channelId } = await setup();
    expect((await createPoll(alice.token, channelId, { question: 'x', options: ['a', 'A'] })).status).toBe(400);
    expect((await createPoll(alice.token, channelId, { question: 'x', options: ['só uma'] })).status).toBe(400);
    expect(
      (await createPoll(alice.token, channelId, { question: 'x', options: ['a', 'b'], durationHours: 5 })).status,
    ).toBe(400);

    // equipe posta em canal só leitura; todo mundo vota (votar não é escrever)
    const created = await createPoll(owner.token, channelId, { question: 'Novo canal?', options: ['Sim', 'Não'] });
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    const everyone = d.body.roles.find((r) => r.isEveryone) as Role;
    await http.req('PATCH', `/channels/${channelId}`, {
      token: owner.token,
      body: { overrides: [{ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.SEND_MESSAGES }] },
    });
    const poll = created.body.poll as Poll;
    expect(
      (
        await http.req('PUT', `/polls/${poll.id}/vote`, {
          token: alice.token,
          body: { optionIds: [poll.options[0]!.id] },
        })
      ).status,
    ).toBe(200);
  });
});

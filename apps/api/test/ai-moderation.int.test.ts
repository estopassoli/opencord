/**
 * Moderação por IA (ADR-0036) contra um stub da API da Anthropic: libera, bloqueia, retém para revisão (fila,
 * aviso aos moderadores, aprovar publica com anexo, reprovar pune), imagem chega como bloco de imagem, IA fora do
 * ar libera (fail-open), DMs ficam de fora por padrão, super admin não passa pela IA.
 */
import http from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Attachment, Member, Message, ModerationCase, ServerSummary } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { InstanceService } from '../src/admin/instance.service.js';
import { TEST_API_PORT, testConfig } from './env.js';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, rid } from './helpers.js';

const AI_PORT = 3198;
const base = `http://127.0.0.1:${TEST_API_PORT}`;
let app: NestFastifyApplication;
let httpc: Http;
let stub: http.Server;
/** corpos recebidos pelo stub (para inspecionar contexto e imagens) */
const seen: Record<string, unknown>[] = [];
/** quantas próximas chamadas falham com 500 (o SDK tenta de novo uma vez: use 2 para derrubar de vez) */
let failNext = 0;
const sockets: Socket[] = [];

type Block = { type: string; text?: string };
function lastUserText(body: Record<string, unknown>): string {
  const msgs = body.messages as { role: string; content: Block[] | string }[];
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  return typeof last.content === 'string'
    ? last.content
    : last.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n');
}

/** Decide pelo texto do envio: "xingamento-pesado" bloqueia, "suspeito" retém, o resto libera. */
function stubAnthropic(): http.Server {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push(body);
      if (failNext > 0) {
        failNext -= 1;
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }));
        return;
      }
      const text = lastUserText(body);
      const verdict = text.includes('pornografia')
        ? { decision: 'block', category: 'sexual', confidence: 0.96, reason: 'Nudez explícita nos quadros.' }
        : text.includes('xingamento-pesado')
          ? { decision: 'block', category: 'odio', confidence: 0.97, reason: 'Ataque direto a um grupo.' }
          : text.includes('suspeito')
            ? {
                decision: 'review',
                category: 'assedio',
                confidence: 0.55,
                reason: 'Pode ser assédio; contexto ambíguo.',
              }
            : { decision: 'allow', category: 'nenhuma', confidence: 0.99, reason: 'Conversa normal.' };
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_stub',
          type: 'message',
          role: 'assistant',
          model: String(body.model),
          content: [{ type: 'text', text: JSON.stringify(verdict) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
  });
}

async function upload(token: string, name: string, mime: string, data: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([data]), name);
  const res = await fetch(`${base}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as { attachment: Attachment } };
}

// PNG 3x2 válido
const PNG_3x2 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000001249444154789c63f8cfc0f01f8481e1ff7f0018f603fd5f2e5b9e0000000049454e44ae426082',
  'hex',
);

beforeAll(async () => {
  stub = stubAnthropic();
  await new Promise<void>((r) => stub.listen(AI_PORT, '127.0.0.1', r));
  app = await createApp(
    testConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test-0123456789',
      MODERATION_AI_BASE_URL: `http://127.0.0.1:${AI_PORT}`,
      MODERATION_AI_MODEL: 'claude-haiku-5-5',
    }),
    { logger: false },
  );
  await app.listen(TEST_API_PORT, '127.0.0.1');
  httpc = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => stub.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  // a configuração da instância fica em cache por alguns segundos: o teste anterior pode tê-la desligado
  app.get(InstanceService).invalidate();
  seen.length = 0;
  failNext = 0;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function setup() {
  const b = await bootstrapOwner(httpc);
  // o dono do oficial vira super admin (painel da instância e isenção da IA)
  await prisma.user.update({ where: { id: b.owner.id }, data: { isInstanceAdmin: true } });
  const bruno = await register(httpc, 'Bruno');
  const channel = await prisma.channel.findFirstOrThrow({ where: { serverId: b.serverId, kind: 'text' } });
  return { ...b, bruno, channelId: channel.id };
}
const send = (token: string, channelId: string, body: string, attachmentIds?: string[]) =>
  httpc.req<Message & { message?: string; code?: string; caseId?: string }>('POST', `/channels/${channelId}/messages`, {
    token,
    body: { requestId: rid(), body, ...(attachmentIds ? { attachmentIds } : {}) },
  });

describe('moderação por IA', () => {
  it('mensagem normal passa pela IA com o contexto do canal e é publicada', async () => {
    const { bruno, channelId, serverId } = await setup();
    await send(bruno.token, channelId, 'bom dia galera');
    const r = await send(bruno.token, channelId, 'alguém viu o jogo?');
    expect(r.status).toBe(201);
    expect(seen.length).toBe(2);
    const last = seen[1]!;
    expect(last.model).toBe('claude-haiku-5-5');
    const text = lastUserText(last);
    expect(text).toContain('Servidor: Teste');
    expect(text).toContain('Bruno: bom dia galera'); // última mensagem vira contexto
    expect(text).toContain('Texto: alguém viu o jogo?');
    expect((last.output_config as { format?: unknown }).format).toBeTruthy();
    // sem caso registrado
    const cases = await prisma.moderationCase.count({ where: { serverId } });
    expect(cases).toBe(0);
  });

  it('bloqueio: 422 com motivo, nada publicado, caso "blocked" visível aos moderadores', async () => {
    const { owner, bruno, channelId, serverId } = await setup();
    const r = await send(bruno.token, channelId, 'xingamento-pesado contra todo mundo');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('moderation_blocked');
    expect(r.body.message).toContain('Ataque direto');
    expect(await prisma.message.count({ where: { channelId } })).toBe(0);
    const list = await httpc.req<ModerationCase[]>('GET', `/servers/${serverId}/moderation/cases`, {
      token: owner.token,
    });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]!.status).toBe('blocked');
    expect(list.body[0]!.verdict).toBe('block');
    expect(list.body[0]!.author.displayName).toBe('Bruno');
    // quem não modera não vê a fila
    const denied = await httpc.req('GET', `/servers/${serverId}/moderation/cases`, { token: bruno.token });
    expect(denied.status).toBe(403);
  });

  it('em dúvida: retém com anexo, avisa o dono, aprovar publica a mensagem original com o anexo', async () => {
    const { owner, bruno, channelId } = await setup();
    const ownerSock = await connectSocket(owner.token);
    sockets.push(ownerSock);
    const held = nextEvent<ModerationCase>(ownerSock, 'moderation:case:created');
    const up = await upload(bruno.token, 'foto.png', 'image/png', PNG_3x2);
    expect(up.status).toBe(201);
    const r = await send(bruno.token, channelId, 'olha isso suspeito', [up.body.attachment.id]);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('moderation_review');
    const c = await held;
    expect(c.status).toBe('pending');
    expect(c.attachments).toHaveLength(1);
    expect(c.channelName).toBeTruthy();
    // a imagem foi para a IA como bloco de imagem
    const req = seen[seen.length - 1]!;
    const content = (req.messages as { content: Block[] }[])[0]!.content;
    expect(content.some((b) => b.type === 'image')).toBe(true);
    // anexo preso ao caso: não é órfão
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: up.body.attachment.id } });
    expect(att.caseId).toBe(c.id);

    const brunoSock = await connectSocket(bruno.token);
    sockets.push(brunoSock);
    const published = nextEvent<Message>(brunoSock, 'chat:message:created');
    const review = await httpc.req<ModerationCase>('POST', `/moderation/cases/${c.id}/review`, {
      token: owner.token,
      body: { decision: 'approve', note: 'é brincadeira entre eles' },
    });
    expect(review.status).toBe(201);
    expect(review.body.status).toBe('approved');
    expect(review.body.reviewedBy?.id).toBe(owner.id);
    const msg = await published;
    expect(msg.body).toBe('olha isso suspeito');
    expect(msg.author.id).toBe(bruno.id);
    expect(msg.attachments).toHaveLength(1);
    expect(review.body.publishedMessageId).toBe(msg.id);
    // a publicação não voltou para a IA (sem nova chamada)
    expect(seen.length).toBe(1);
    // decidir duas vezes não dá
    const again = await httpc.req('POST', `/moderation/cases/${c.id}/review`, {
      token: owner.token,
      body: { decision: 'reject' },
    });
    expect(again.status).toBe(400);
  });

  it('reprovar com castigo: anexo apagado, membro em castigo, autor avisado', async () => {
    const { owner, bruno, channelId, serverId } = await setup();
    const up = await upload(bruno.token, 'foto.png', 'image/png', PNG_3x2);
    await send(bruno.token, channelId, 'suspeito mesmo', [up.body.attachment.id]);
    const c = (await prisma.moderationCase.findFirstOrThrow({ where: { serverId } })).id;
    const brunoSock = await connectSocket(bruno.token);
    sockets.push(brunoSock);
    const notified = nextEvent<{ kind: string; title: string }>(brunoSock, 'notification:created');
    const review = await httpc.req<ModerationCase>('POST', `/moderation/cases/${c}/review`, {
      token: owner.token,
      body: { decision: 'reject', note: 'não cola', punishment: { kind: 'timeout', durationMs: 10 * 60_000 } },
    });
    expect(review.status).toBe(201);
    expect(review.body.status).toBe('rejected');
    expect(await prisma.attachment.count({ where: { id: up.body.attachment.id } })).toBe(0);
    const n = await notified;
    expect(n.kind).toBe('moderation');
    expect(n.title).toContain('reprovado');
    const m = await prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: bruno.id } },
    });
    expect(m.timeoutUntil && m.timeoutUntil.getTime() > Date.now()).toBe(true);
    // super admin vê a fila da instância
    const all = await httpc.req<ModerationCase[]>('GET', '/admin/moderation/cases?status=rejected', {
      token: owner.token,
    });
    expect(all.status).toBe(200);
    expect(all.body.map((x) => x.id)).toContain(c);
  });

  it('IA fora do ar libera a mensagem (fail-open) e registra; super admin não passa pela IA; DM fica de fora', async () => {
    const { owner, bruno, channelId } = await setup();
    failNext = 2;
    const r = await send(bruno.token, channelId, 'xingamento-pesado mas a IA caiu');
    expect(r.status).toBe(201);
    // dono do oficial é super admin (bootstrap): nem chama a IA
    const before = seen.length;
    const r2 = await send(owner.token, channelId, 'xingamento-pesado do admin');
    expect(r2.status).toBe(201);
    expect(seen.length).toBe(before);
    // DM: desligada por padrão
    const conv = await httpc.req<{ id: string }>('POST', '/conversations', {
      token: bruno.token,
      body: { userIds: [owner.id] },
    });
    expect(conv.status).toBe(201);
    const dm = await httpc.req<Message>('POST', `/conversations/${conv.body.id}/messages`, {
      token: bruno.token,
      body: { requestId: rid(), body: 'xingamento-pesado na dm' },
    });
    expect(dm.status).toBe(201);
    expect(seen.length).toBe(before);
  });

  it('regras do servidor entram no contexto e o dono as edita; painel liga/desliga a moderação', async () => {
    const { owner, bruno, channelId, serverId } = await setup();
    const upd = await httpc.req<ServerSummary>('PATCH', `/servers/${serverId}`, {
      token: owner.token,
      body: { aiRules: 'Proibido spoiler de série sem aviso.' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.aiRules).toBe('Proibido spoiler de série sem aviso.');
    await send(bruno.token, channelId, 'oi');
    expect(lastUserText(seen[seen.length - 1]!)).toContain('Proibido spoiler');
    // desliga na instância: nada passa pela IA
    const off = await httpc.req<{ aiModerationEnabled: boolean }>('PATCH', '/admin/instance', {
      token: owner.token,
      body: { aiModeration: false },
    });
    expect(off.status).toBe(200);
    expect(off.body.aiModerationEnabled).toBe(false);
    const n = seen.length;
    const r = await send(bruno.token, channelId, 'xingamento-pesado sem IA');
    expect(r.status).toBe(201);
    expect(seen.length).toBe(n);
  });

  it('edição passa pela IA; retida vira bloqueio e o texto original fica', async () => {
    const { bruno, channelId } = await setup();
    const m = await send(bruno.token, channelId, 'texto ok');
    const e = await httpc.req<{ message?: string }>('PATCH', `/messages/${m.body.id}`, {
      token: bruno.token,
      body: { body: 'agora suspeito' },
    });
    expect(e.status).toBe(422);
    const row = await prisma.message.findUniqueOrThrow({ where: { id: m.body.id } });
    expect(row.body).toBe('texto ok');
  });
});

// tipos usados só para leitura
void (null as unknown as Member);

describe('bloqueio automático e de dispositivo', () => {
  it('desligado: conteúdo grave só bloqueia a mensagem', async () => {
    const { bruno, channelId } = await setup();
    const r = await send(bruno.token, channelId, 'pornografia aqui');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('moderation_blocked');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: bruno.id } });
    expect(u.disabledAt).toBeNull();
  });

  it('ligado com dispositivo: suspende a conta, bane do servidor, derruba a sessão e bloqueia aparelho/IP', async () => {
    const { owner, bruno, channelId, serverId } = await setup();
    await httpc.req('PATCH', '/admin/instance', {
      token: owner.token,
      body: { aiAutoBlock: true, aiAutoBlockDevice: true },
    });
    app.get(InstanceService).invalidate();
    // sessão do Bruno com impressão digital do aparelho
    const hw = 'a'.repeat(64);
    const login = await httpc.req<{ tokens: { accessToken: string } }>('POST', '/auth/login', {
      body: { login: 'Bruno', password: 'password-123456', deviceId: 'dev-bruno' },
      headers: { 'x-hardware-id': hw },
    });
    expect(login.status).toBe(200);
    const token = login.body.tokens.accessToken;
    const r = await send(token, channelId, 'pornografia aqui');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('moderation_autoblock');
    expect(r.body.message).toContain('suspensa');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: bruno.id } });
    expect(u.disabledAt).not.toBeNull();
    expect(await prisma.serverBan.count({ where: { serverId, userId: bruno.id } })).toBe(1);
    expect(await prisma.serverMember.count({ where: { serverId, userId: bruno.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: bruno.id, revokedAt: null } })).toBe(0);
    const bans = await prisma.deviceBan.findMany({ where: { userId: bruno.id } });
    expect(bans.map((b) => b.kind).sort()).toEqual(['device', 'hardware']); // IP local não entra
    const c = await prisma.moderationCase.findFirstOrThrow({ where: { authorId: bruno.id } });
    expect(c.autoAction).toBe('suspended+device');
    // o token antigo morreu
    const dead = await send(token, channelId, 'oi');
    expect(dead.status).toBe(401);
    // mesmo aparelho, apelido novo: recusado; outro aparelho: entra
    const again = await httpc.req<{ message?: string }>('POST', '/auth/guest', {
      body: { nickname: 'Bruno2', deviceId: 'dev-outro', acceptTerms: true },
      headers: { 'x-hardware-id': hw },
    });
    expect(again.status).toBe(403);
    expect(again.body.message).toContain('dispositivo');
    const sameDevice = await httpc.req('POST', '/auth/guest', {
      body: { nickname: 'Bruno3', deviceId: 'dev-bruno', acceptTerms: true },
    });
    expect(sameDevice.status).toBe(403);
    const other = await httpc.req('POST', '/auth/guest', {
      body: { nickname: 'Carla', deviceId: 'dev-carla', acceptTerms: true },
    });
    expect(other.status).toBe(201);
    // painel lista e reativar a conta libera o aparelho
    const list = await httpc.req<{ id: string; kind: string }[]>('GET', '/admin/device-bans', { token: owner.token });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const un = await httpc.req('POST', `/admin/users/${bruno.id}/unsuspend`, { token: owner.token });
    expect([200, 201]).toContain(un.status);
    expect(await prisma.deviceBan.count({ where: { userId: bruno.id } })).toBe(0);
    const back = await httpc.req('POST', '/auth/guest', {
      body: { nickname: 'Bruno4', deviceId: 'dev-bruno', acceptTerms: true },
      headers: { 'x-hardware-id': hw },
    });
    expect(back.status).toBe(201);
  });

  it('super admin nunca é bloqueado automaticamente', async () => {
    const { owner, channelId } = await setup();
    await httpc.req('PATCH', '/admin/instance', { token: owner.token, body: { aiAutoBlock: true } });
    app.get(InstanceService).invalidate();
    // super admin nem passa pela IA
    const r = await send(owner.token, channelId, 'pornografia');
    expect(r.status).toBe(201);
  });
});

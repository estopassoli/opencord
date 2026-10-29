import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { nickKeyOf, type AuthResponse } from '@opencord/contracts';
import { createServerWithDefaults, PrismaClient } from '@opencord/db';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/bootstrap.js';
import { TEST_API_PORT, TEST_ENV, testConfig } from './env.js';

export const prisma = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_URL });

export async function startApp(): Promise<NestFastifyApplication> {
  const app = await createApp(testConfig(), { logger: false });
  await app.listen({ host: '127.0.0.1', port: TEST_API_PORT });
  return app;
}

/** Limpa todas as tabelas (mantém o schema). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
}

export interface Client {
  id: string;
  token: string;
  refresh: string;
  auth: AuthResponse;
  nickname: string;
}

type Json = Record<string, unknown> | unknown[] | undefined;

export class Http {
  constructor(private readonly app: NestFastifyApplication) {}
  async req<T = unknown>(
    method: string,
    url: string,
    opts: { token?: string; body?: Json } = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: method as 'GET',
        url,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body ? { payload: JSON.stringify(opts.body) } : {}),
      });
    const text = res.body;
    return { status: res.statusCode, body: (text ? JSON.parse(text) : null) as T };
  }
}

/**
 * Cria o proprietário (conta com senha) direto no banco com um servidor aberto.
 * Servidores são abertos (ADR-0007): todo usuário existente também vira membro.
 */
export async function bootstrapOwner(http: Http) {
  const tag = randomUUID().slice(0, 8);
  const nickname = `Owner ${tag}`;
  const owner = await prisma.user.create({
    data: {
      email: `owner-${tag}@test.local`,
      username: `owner_${tag}`,
      displayName: nickname,
      nickKey: nickKeyOf(nickname),
      passwordHash: await (await import('@node-rs/argon2')).hash('owner-password-123', { algorithm: 2 }),
    },
  });
  const server = await prisma.$transaction((tx) => createServerWithDefaults(tx, owner.id, 'Teste'));
  const login = await http.req<AuthResponse>('POST', '/auth/login', {
    body: { login: nickname, password: 'owner-password-123' },
  });
  if (login.status !== 200) throw new Error(`login owner falhou: ${login.status}`);
  const ownerClient: Client = {
    id: owner.id,
    token: login.body.tokens.accessToken,
    refresh: login.body.tokens.refreshToken,
    auth: login.body,
    nickname,
  };
  return { owner: ownerClient, serverId: server.id };
}

let seq = 0;
/** Cria conta pelo cadastro aberto (apelido + senha). Entra automaticamente em todos os servidores. */
export async function register(http: Http, name?: string): Promise<Client> {
  seq++;
  const nickname = name ?? `user_${seq}_${randomUUID().slice(0, 6)}`;
  const r = await http.req<AuthResponse>('POST', '/auth/register', { body: { nickname, password: 'password-123456' } });
  if (r.status !== 201) throw new Error(`register falhou: ${r.status} ${JSON.stringify(r.body)}`);
  return {
    id: r.body.user.id,
    token: r.body.tokens.accessToken,
    refresh: r.body.tokens.refreshToken,
    auth: r.body,
    nickname,
  };
}

/** Usuário que NÃO é membro de nenhum servidor (saiu de todos): para testar acesso negado. */
export async function outsider(http: Http): Promise<Client> {
  const c = await register(http);
  const servers = await http.req<{ id: string }[]>('GET', '/servers', { token: c.token });
  for (const s of servers.body) await http.req('POST', `/servers/${s.id}/leave`, { token: c.token });
  return c;
}

export function connectSocket(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${TEST_API_PORT}`, {
      path: '/realtime',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    s.once('ready', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

/** Aguarda um evento (payload desembrulhado do envelope) que satisfaça o predicado. */
export function nextEvent<T = unknown>(
  s: Socket,
  name: string,
  pred: (p: T) => boolean = () => true,
  ms = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off(name, h);
      reject(new Error(`timeout esperando ${name}`));
    }, ms);
    const h = (env: { payload: T }) => {
      if (!pred(env.payload)) return;
      clearTimeout(t);
      s.off(name, h);
      resolve(env.payload);
    };
    s.on(name, h);
  });
}

/** Garante que um evento NÃO chega dentro da janela. */
export function noEvent(s: Socket, name: string, pred: (p: unknown) => boolean = () => true, ms = 800): Promise<void> {
  return new Promise((resolve, reject) => {
    const h = (env: { payload: unknown }) => {
      if (pred(env.payload)) {
        s.off(name, h);
        reject(new Error(`evento inesperado ${name}: ${JSON.stringify(env.payload)}`));
      }
    };
    s.on(name, h);
    setTimeout(() => {
      s.off(name, h);
      resolve();
    }, ms);
  });
}

export function command<T = unknown>(
  s: Socket,
  name: string,
  payload: unknown,
): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  return s.timeout(5000).emitWithAck(name, payload);
}

export const rid = () => randomUUID();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

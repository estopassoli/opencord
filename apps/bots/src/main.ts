/**
 * Bots públicos oficiais do OpenCord (ADR-0037). Um processo roda todos; cada bot entra com o próprio token.
 *
 * Tokens: ou BOT_TOKEN_<KEY> no ambiente, ou (na infra) OFFICIAL_BOTS_SECRET, com o qual o processo pede à API
 * (`POST /bots/official/claim`) o bot pronto — criado como público, do criador da instância, se ainda não existir.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carlos } from './bots/carlos.js';
import { dankMineiro } from './bots/dankmineiro.js';
import { dinamo } from './bots/dinamo.js';
import { oraculo } from './bots/oraculo.js';
import { tiquete } from './bots/tiquete.js';
import { you6 } from './bots/you6.js';
import { ensureAvatar, makeClient, type BotDefinition } from './shared.js';
import { Store } from './store.js';

export const BOTS: BotDefinition[] = [you6, dinamo, carlos, dankMineiro, tiquete, oraculo];

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.OPENCORD_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data');
const only = (process.env.BOTS ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

async function claimToken(def: BotDefinition): Promise<string | null> {
  const fromEnv = process.env[`BOT_TOKEN_${def.key}`];
  if (fromEnv) return fromEnv;
  const secret = process.env.OFFICIAL_BOTS_SECRET;
  if (!secret) return null;
  const r = await fetch(`${baseUrl}/bots/official/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: def.key, name: def.name, description: def.description, secret }),
  });
  if (!r.ok) {
    console.error(`[${def.key}] claim falhou: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return null;
  }
  return ((await r.json()) as { token: string }).token;
}

async function avatarOf(key: string): Promise<Buffer | null> {
  return readFile(join(here, '..', 'avatars', `${key.toLowerCase()}.png`)).catch(() => null);
}

async function main() {
  const store = new Store(join(dataDir, 'bots.db'));
  let started = 0;
  for (const def of BOTS) {
    if (only.length && !only.includes(def.key)) continue;
    const log = (m: string) => console.warn(`[${def.name}] ${m}`);
    const token = await claimToken(def).catch((e: unknown) => {
      log(`sem token: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!token) {
      log('pulado (defina BOT_TOKEN_' + def.key + ' ou OFFICIAL_BOTS_SECRET)');
      continue;
    }
    const client = makeClient({ baseUrl, activity: def.activity, log });
    const ctx = { client, store, token, baseUrl, log };
    await def.start(ctx);
    await client.login(token);
    await ensureAvatar(ctx, await avatarOf(def.key));
    started++;
  }
  if (!started) {
    console.error('nenhum bot iniciado');
    process.exit(1);
  }
  const stop = () => {
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

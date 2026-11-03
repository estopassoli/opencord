/** Utilidades comuns aos bots (ADR-0037). */
import {
  Client,
  Events,
  PermissionsBitField,
  type BaseInteraction,
  type ClientOptions,
  type InteractionReplyPayload,
} from '@opencord-chat/bot';
import type { Store } from './store.js';

export interface BotContext {
  client: Client;
  store: Store;
  /** token do bot (para chamadas fora do SDK, ex.: foto de perfil) */
  token: string;
  baseUrl: string;
  log: (msg: string) => void;
}

export interface BotDefinition {
  /** chave da variável BOT_TOKEN_<KEY> e do arquivo de avatar */
  key: string;
  name: string;
  description: string;
  activity: string;
  start(ctx: BotContext): Promise<void>;
}

/** "10m", "2h", "1d", "90s" → ms; null se inválido. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+)\s*(s|m|h|d)$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  const ms = n * mult;
  return ms > 0 && ms <= 30 * 86_400_000 ? ms : null;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export const fmt = new Intl.NumberFormat('pt-BR');

/** sorteio sem repetição */
export function pickRandom<T>(items: readonly T[], n: number, rnd: () => number = Math.random): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length && out.length < n) {
    const i = Math.floor(rnd() * pool.length);
    out.push(pool.splice(i, 1)[0] as T);
  }
  return out;
}

export function makeClient(opts: { baseUrl: string; activity: string; log: (m: string) => void }): Client {
  const client = new Client({ baseUrl: opts.baseUrl } as ClientOptions);
  client.on(Events.Error, (e) => opts.log(`erro: ${e instanceof Error ? e.message : String(e)}`));
  client.on(Events.Disconnect, (r) => opts.log(`desconectado: ${String(r)}`));
  client.once(Events.ClientReady, (c) => {
    void c.user?.setActivity(opts.activity).catch(() => undefined);
  });
  return client;
}

/** Envia a foto de perfil (PNG gerado por nós) se o bot ainda não tem uma. */
export async function ensureAvatar(ctx: BotContext, png: Buffer | null) {
  if (!png || !ctx.client.user || ctx.client.user.avatarKey) return;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'avatar.png');
  const r = await fetch(`${ctx.baseUrl}/me/avatar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ctx.token}` },
    body: form,
  }).catch(() => null);
  if (r?.ok) ctx.log('foto de perfil enviada');
}

/**
 * Resposta de comando que vira mensagem no canal; se o bot não pode escrever ali (sem cargo), responde só para
 * quem chamou (efêmera) em vez de falhar com 403.
 */
export function reply(i: BaseInteraction, payload: string | InteractionReplyPayload) {
  const p: InteractionReplyPayload = typeof payload === 'string' ? { content: payload } : payload;
  const canSend = i.appPermissions.has(PermissionsBitField.Flags.SendMessages);
  return i.reply(canSend ? p : { ...p, ephemeral: true });
}

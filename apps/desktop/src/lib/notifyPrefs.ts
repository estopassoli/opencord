/**
 * Notificações por servidor e por canal (só eu vejo, nas configurações da conta): silenciar por um tempo ou até
 * reativar e escolher o nível (todas, só menções, nada). O canal vale por cima do servidor; sem escolha, vale o
 * padrão do servidor. Também as palavras-chave, que avisam como uma menção.
 */
import type { NotifyOverride, UserSettings } from '@opencord/contracts';
import { updateSettings } from '../store/settings';
import { useData } from '../store/data';

export type NotifyLevel = 'all' | 'mentions' | 'none';

const EMPTY: NotifyOverride = { level: null, mutedUntil: null };

export const isMutedOverride = (o: NotifyOverride | undefined, now = Date.now()) =>
  o?.mutedUntil != null && (o.mutedUntil === 0 || o.mutedUntil > now);

/** silenciado (o canal ou o servidor inteiro) */
export function isMuted(s: UserSettings | null, serverId: string | null, channelId: string | null, now = Date.now()) {
  if (!s) return false;
  const n = s.notifications;
  return (
    (channelId != null && isMutedOverride(n.channels[channelId], now)) ||
    (serverId != null && isMutedOverride(n.servers[serverId], now))
  );
}

/** nível que vale para o canal: o do canal, senão o do servidor, senão o padrão do servidor */
export function effectiveLevel(
  s: UserSettings | null,
  serverId: string | null,
  channelId: string | null,
  serverDefault: 'all' | 'mentions' = 'mentions',
  now = Date.now(),
): NotifyLevel {
  if (isMuted(s, serverId, channelId, now)) return 'none';
  const n = s?.notifications;
  return (
    (channelId ? n?.channels[channelId]?.level : null) ??
    (serverId ? n?.servers[serverId]?.level : null) ??
    serverDefault
  );
}

/** padrão do servidor (Configurações do servidor → Engajamento) */
export const serverDefaultOf = (serverId: string | null): 'all' | 'mentions' =>
  (serverId ? useData.getState().details[serverId]?.defaultNotify : undefined) ?? 'mentions';

type Scope = 'servers' | 'channels';

function setOverride(scope: Scope, id: string, patch: Partial<NotifyOverride>) {
  updateSettings((s) => {
    const map = { ...s.notifications[scope] };
    const next = { ...EMPTY, ...map[id], ...patch };
    // sem nada escolhido: tira da lista (não acumula entradas vazias)
    if (next.level == null && next.mutedUntil == null) delete map[id];
    else map[id] = next;
    return { ...s, notifications: { ...s.notifications, [scope]: map } };
  });
}

/** silenciar: `ms` null = até eu reativar */
export const mute = (scope: Scope, id: string, ms: number | null) =>
  setOverride(scope, id, { mutedUntil: ms == null ? 0 : Date.now() + ms });
export const unmute = (scope: Scope, id: string) => setOverride(scope, id, { mutedUntil: null });
export const setLevel = (scope: Scope, id: string, level: NotifyLevel | null) => setOverride(scope, id, { level });

/** "silenciado até 14:30" / "silenciado" (para dicas e menus) */
export function mutedLabel(o: NotifyOverride | undefined, now = Date.now()) {
  if (!isMutedOverride(o, now)) return null;
  if (o!.mutedUntil === 0) return 'Silenciado';
  const d = new Date(o!.mutedUntil!);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Silenciado até ${time}` : `Silenciado até ${d.toLocaleDateString('pt-BR')} ${time}`;
}

export const MUTE_DURATIONS: { label: string; ms: number | null }[] = [
  { label: 'Por 15 minutos', ms: 15 * 60_000 },
  { label: 'Por 1 hora', ms: 60 * 60_000 },
  { label: 'Por 8 horas', ms: 8 * 60 * 60_000 },
  { label: 'Por 24 horas', ms: 24 * 60 * 60_000 },
  { label: 'Até eu reativar', ms: null },
];

// ---------- palavras-chave ----------

/** sem acento e minúsculo (a busca não liga para "Raid" × "raid" nem "reunião" × "reuniao") */
export const fold = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** primeira palavra-chave que aparece como palavra inteira no texto (ou null) */
export function matchKeyword(body: string, keywords: readonly string[]): string | null {
  if (!keywords.length || !body) return null;
  const text = fold(body);
  for (const k of keywords) {
    const w = fold(k.trim());
    if (w.length < 2) continue;
    // palavra inteira: "raid" avisa em "bora raid?" mas não em "raider"
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, 'u').test(text)) return k;
  }
  return null;
}

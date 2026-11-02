import type { Embed, MessageComponents, ServerCommands, ServerEvents } from '@opencord/contracts';
import { create } from 'zustand';
import { api } from './session';

/**
 * Bots (ADR-0032) no app: comandos de barra de cada servidor (para o autocompletar do composer) e as respostas
 * efêmeras dos bots ("só você vê"), por canal. Carregado sob demanda; o evento `bot:commands:changed` recarrega.
 */
export interface EphemeralReply {
  /** id da interação (a mesma pode primeiro "pensar" e depois responder) */
  id: string;
  bot: ServerCommands['bot'];
  command: string;
  /** null = "pensando…" */
  content: string | null;
  /** cartão rico e botões/menus (ADR-0034); o clique manda `component` com `ephemeralOf` = id */
  embeds: Embed[];
  components: MessageComponents;
  at: number;
}

/** uma resposta efêmera some sozinha depois disso */
export const EPHEMERAL_TTL_MS = 10 * 60_000;

interface BotsStore {
  /** comandos por servidor (undefined = ainda não carregado) */
  commands: Record<string, ServerCommands[]>;
  loadCommands(serverId: string): Promise<void>;
  /** carrega só se ainda não tem (menus "Apps" e popover de barra precisam da lista pronta) */
  ensureCommands(serverId: string): Promise<void>;
  /** respostas efêmeras por canal (mais antiga primeiro) */
  ephemeral: Record<string, EphemeralReply[]>;
  replied(e: ServerEvents['interaction:replied']): void;
  dismiss(channelId: string, id: string): void;
  reset(): void;
}

const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useBots = create<BotsStore>()((set, get) => ({
  commands: {},
  loadCommands: (serverId) => {
    const cur = inflight.get(serverId);
    if (cur) return cur;
    const p = api()
      .request<ServerCommands[]>('GET', `/servers/${serverId}/commands`)
      .then((list) => set((s) => ({ commands: { ...s.commands, [serverId]: list } })))
      .finally(() => inflight.delete(serverId));
    inflight.set(serverId, p);
    return p;
  },
  ensureCommands: (serverId) => (get().commands[serverId] ? Promise.resolve() : get().loadCommands(serverId)),
  ephemeral: {},
  replied: (e) => {
    set((s) => {
      const list = s.ephemeral[e.channelId] ?? [];
      const prev = list.find((x) => x.id === e.interactionId);
      // `update`: o bot editou o cartão (clique num botão dele) — mantém o que ele não mandou de novo;
      // sem `update`, "pensando…" → resposta substitui o cartão inteiro
      const entry: EphemeralReply =
        e.update && prev
          ? {
              ...prev,
              content: e.content ?? prev.content,
              embeds: e.embeds ?? prev.embeds,
              components: e.components ?? prev.components,
              at: Date.now(),
            }
          : {
              id: e.interactionId,
              bot: e.bot,
              command: e.command,
              content: e.content,
              embeds: e.embeds ?? [],
              components: e.components ?? [],
              at: Date.now(),
            };
      const next = prev ? list.map((x) => (x.id === entry.id ? entry : x)) : [...list, entry];
      return { ephemeral: { ...s.ephemeral, [e.channelId]: next } };
    });
    const key = `${e.channelId}:${e.interactionId}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => get().dismiss(e.channelId, e.interactionId), EPHEMERAL_TTL_MS),
    );
  },
  dismiss: (channelId, id) => {
    const key = `${channelId}:${id}`;
    clearTimeout(timers.get(key));
    timers.delete(key);
    set((s) => {
      const list = s.ephemeral[channelId];
      if (!list?.some((x) => x.id === id)) return {};
      const next = list.filter((x) => x.id !== id);
      const ephemeral = { ...s.ephemeral };
      if (next.length) ephemeral[channelId] = next;
      else delete ephemeral[channelId];
      return { ephemeral };
    });
  },
  reset: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    inflight.clear();
    set({ commands: {}, ephemeral: {} });
  },
}));

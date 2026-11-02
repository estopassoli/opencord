/**
 * Submenu "Apps" (ADR-0034): comandos de contexto dos bots do servidor no menu de uma pessoa (`type: 'user'`) ou de
 * uma mensagem (`type: 'message'`). Só aparece com um canal de texto aberto e se há comandos que a pessoa pode usar.
 */
import type { MenuEntry } from '../../components/ContextMenu';
import { ApiError } from '../../lib/api';
import { contextCommands, messageCommandBody, userCommandBody } from '../../lib/apps';
import type { SlashCommandRef } from '../../lib/slash';
import { useBots } from '../../store/bots';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

/** canal de texto aberto agora no servidor (null em DM, voz ou quadro) */
export function currentTextChannelId(serverId: string): string | null {
  const v = useUi.getState().view;
  if (v.kind !== 'server' || v.serverId !== serverId || !v.channelId) return null;
  const ch = useData.getState().details[serverId]?.channels.find((c) => c.id === v.channelId);
  return ch?.kind === 'text' ? ch.id : null;
}

function available(serverId: string, type: 'user' | 'message'): SlashCommandRef[] {
  const d = useData.getState();
  const detail = d.details[serverId];
  if (!detail) return [];
  const list = useBots.getState().commands[serverId];
  if (!list) {
    // ainda não carregou: pede agora para o próximo menu já vir com os apps
    void useBots
      .getState()
      .ensureCommands(serverId)
      .catch(() => undefined);
    return [];
  }
  return contextCommands(list, type, detail.myPermissions, detail.ownerId === d.me?.id);
}

export function runInteraction(body: unknown): Promise<void> {
  return api()
    .request('POST', '/interactions', body)
    .then(
      () => undefined,
      (e: unknown) =>
        useUi.getState().toast('error', e instanceof ApiError && e.status === 409 ? 'Bot offline.' : describeError(e)),
    );
}

function submenu(items: SlashCommandRef[], run: (ref: SlashCommandRef) => void): MenuEntry[] {
  if (!items.length) return [];
  return [
    {
      kind: 'submenu',
      label: 'Apps',
      icon: 'activities',
      items: items.map((ref) => ({
        label: ref.command.name,
        hint: ref.bot.displayName,
        onSelect: () => run(ref),
      })),
    },
  ];
}

/** entradas "Apps ›" do menu de uma pessoa (vazio sem canal de texto aberto ou sem comandos) */
export function userAppsMenu(serverId: string | undefined, userId: string): MenuEntry[] {
  if (!serverId) return [];
  const channelId = currentTextChannelId(serverId);
  if (!channelId) return [];
  return submenu(available(serverId, 'user'), (ref) => void runInteraction(userCommandBody(ref, channelId, userId)));
}

/** entradas "Apps ›" do menu de uma mensagem de canal (vazio em DM ou sem comandos) */
export function messageAppsMenu(serverId: string | undefined, messageId: string): MenuEntry[] {
  if (!serverId || !currentTextChannelId(serverId)) return [];
  return submenu(available(serverId, 'message'), (ref) => void runInteraction(messageCommandBody(ref, messageId)));
}

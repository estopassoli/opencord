import { useData } from '../store/data';
import { updateSettings } from '../store/settings';

/**
 * Nome que EU vejo para alguém: o apelido que dei (só eu vejo, vale em todo lugar), senão o apelido no servidor,
 * senão o nome de exibição. Use em tudo que mostra o nome de outra pessoa.
 */
export function nameFor(userId: string, fallback: string, serverNickname?: string | null): string {
  return useData.getState().settings?.friendNicknames[userId] ?? serverNickname ?? fallback;
}

/** Versão reativa: re-renderiza quando o apelido muda. */
export function useNameFor(userId: string | undefined, fallback: string, serverNickname?: string | null): string {
  const alias = useData((s) => (userId ? s.settings?.friendNicknames[userId] : undefined));
  return alias ?? serverNickname ?? fallback;
}

/** Só o apelido que dei (undefined = nenhum): para mostrar o nome real junto, em perfis. */
export const useNameAlias = (userId: string | undefined) =>
  useData((s) => (userId ? s.settings?.friendNicknames[userId] : undefined));

/** Apelidos que dei (para listas: um seletor só, em vez de um por item). */
export const useAliases = () => useData((s) => s.settings?.friendNicknames);

export function setFriendNickname(userId: string, nickname: string) {
  const v = nickname.trim().slice(0, 32);
  updateSettings((s) => {
    const { [userId]: _old, ...rest } = s.friendNicknames;
    return { ...s, friendNicknames: v ? { ...rest, [userId]: v } : rest };
  });
}

export function togglePinnedConversation(conversationId: string) {
  updateSettings((s) => {
    const pinned = s.pinnedConversations.includes(conversationId)
      ? s.pinnedConversations.filter((id) => id !== conversationId)
      : [...s.pinnedConversations, conversationId].slice(-50);
    return { ...s, pinnedConversations: pinned };
  });
}

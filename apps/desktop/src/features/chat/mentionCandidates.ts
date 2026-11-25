import { hasPermission, Permission } from '@opencord/contracts';
import type { MentionCandidate } from '../../lib/mentions';
import { useData, useMessages, type TargetKey } from '../../store/data';

/**
 * Quem pode ser mencionado aqui: membros do servidor (com apelido) ou da conversa. Quem escreveu por último neste
 * canal vem primeiro (é quem a pessoa mais costuma marcar) e entra mesmo se a lista de membros ainda não carregou.
 * Lê o estado na hora (sem assinar): chamado ao digitar `@`, ao enviar e ao abrir a edição.
 */
export function mentionCandidates(
  where: { serverId?: string | undefined; conversationId?: string | null | undefined },
  targetKey?: TargetKey,
): MentionCandidate[] {
  const st = useData.getState();
  const out: MentionCandidate[] = [];
  const members = where.serverId ? st.details[where.serverId]?.members : undefined;
  const nick = new Map(members?.map((m) => [m.user.id, m.nickname]));
  if (targetKey) {
    const msgs = useMessages.getState().get(targetKey).messages;
    for (let i = msgs.length - 1; i >= 0 && out.length < 50; i--) {
      const a = msgs[i]!.author;
      if (a.bot && !members?.some((m) => m.user.id === a.id)) continue;
      out.push({ id: a.id, username: a.username, displayName: a.displayName, nickname: nick.get(a.id) ?? null });
    }
  }
  if (members)
    for (const m of members)
      out.push({ id: m.user.id, username: m.user.username, displayName: m.user.displayName, nickname: m.nickname });
  else if (where.conversationId)
    for (const u of st.conversations.find((c) => c.id === where.conversationId)?.members ?? [])
      out.push({ id: u.id, username: u.username, displayName: u.displayName });
  return out;
}

/** `@everyone` só em canal de servidor, para quem tem a permissão */
export function canMentionEveryone(serverId: string | undefined): boolean {
  if (!serverId) return false;
  const d = useData.getState().details[serverId];
  return Boolean(d && hasPermission(d.myPermissions, Permission.MENTION_EVERYONE));
}

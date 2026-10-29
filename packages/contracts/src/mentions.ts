/** Menções no corpo da mensagem: `<@uuid>` para usuários e `@everyone`. */
export const MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

export function extractMentions(body: string): { userIds: string[]; everyone: boolean } {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) if (m[1]) ids.add(m[1].toLowerCase());
  return { userIds: [...ids], everyone: /(^|\s)@everyone\b/.test(body) };
}

export function mentionToken(userId: string): string {
  return `<@${userId}>`;
}

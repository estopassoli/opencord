import type { Conversation, UnreadState } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { isClosed, latestMessageId } from '../src/lib/closedConversations';

const conv = (lastMessageId: string | null): Conversation => ({
  id: 'c1',
  kind: 'dm',
  name: null,
  members: [],
  lastMessageId,
});
const unread = (lastMessageId: string | null) => ({ lastMessageId }) as UnreadState;
// uuid v7: mais novo = maior
const OLD = '0190a000-0000-7000-8000-000000000001';
const NEW = '0190a001-0000-7000-8000-000000000001';

describe('fechar conversa', () => {
  it('fica fechada enquanto não chega mensagem mais nova que a do fechamento', () => {
    expect(isClosed({ c1: OLD }, conv(OLD), undefined)).toBe(true);
    expect(isClosed({ c1: OLD }, conv(OLD), unread(NEW))).toBe(false);
    expect(isClosed({ c1: OLD }, conv(NEW), undefined)).toBe(false);
    expect(isClosed({}, conv(OLD), undefined)).toBe(false);
  });

  it('conversa sem mensagens fechada volta com a primeira', () => {
    expect(isClosed({ c1: '' }, conv(null), undefined)).toBe(true);
    expect(isClosed({ c1: '' }, conv(null), unread(OLD))).toBe(false);
    expect(latestMessageId(conv(NEW), unread(OLD))).toBe(NEW);
  });
});

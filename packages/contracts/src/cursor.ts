/** Cursor composto `(createdAt, id)` codificado em base64url, opaco para o cliente. */
export interface MessageCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function encodeCursor(c: MessageCursor): string {
  return toBase64Url(`${c.createdAt.toISOString()}|${c.id}`);
}

export function decodeCursor(raw: string): MessageCursor | null {
  try {
    const [iso, id, ...rest] = fromBase64Url(raw).split('|');
    if (rest.length || !iso || !id || !UUID.test(id)) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

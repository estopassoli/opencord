/** Extrai o código de um convite colado (o código puro ou um link que termina nele). */
export function parseInviteCode(text: string): string | null {
  const m = /([A-Za-z0-9]{10})\/?\s*$/.exec(text.trim());
  return m ? m[1]! : null;
}

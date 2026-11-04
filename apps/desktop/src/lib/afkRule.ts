/** Regra do canal de ausentes (ADR-0049), sem dependências: testável sem o motor de voz. */

/** decide se move: em chamada de servidor com canal de ausentes, parado e calado pelo limite, sem transmitir */
export function afkTarget(o: {
  idleSeconds: number;
  sinceSpokeMs: number;
  inCall: boolean;
  channelId: string | null;
  streaming: boolean;
  afkChannelId: string | null;
  afkTimeoutSec: number;
  afkChannelExists: boolean;
}): string | null {
  if (!o.inCall || o.streaming || !o.afkChannelId || !o.afkChannelExists) return null;
  if (o.channelId === o.afkChannelId) return null;
  if (o.idleSeconds < o.afkTimeoutSec || o.sinceSpokeMs < o.afkTimeoutSec * 1000) return null;
  return o.afkChannelId;
}

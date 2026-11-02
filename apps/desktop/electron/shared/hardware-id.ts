/**
 * Impressão digital do aparelho para o bloqueio de dispositivo (ADR-0036): SHA-256 dos endereços MAC das
 * interfaces de rede físicas, ordenados. Só o hash sai do computador; o servidor nunca vê os MACs. Sem interface
 * com MAC válido não há impressão (o servidor cai no identificador do app e no IP).
 */
import { createHash } from 'node:crypto';

export interface IfaceLike {
  mac: string;
  internal: boolean;
}

const ZERO = /^(00:){5}00$/;

export function hardwareIdOf(interfaces: Record<string, IfaceLike[] | undefined>): string | null {
  const macs = new Set<string>();
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const mac = i.mac.toLowerCase();
      if (i.internal || !mac || ZERO.test(mac)) continue;
      macs.add(mac);
    }
  }
  if (!macs.size) return null;
  return createHash('sha256')
    .update([...macs].sort().join('|'))
    .digest('hex');
}

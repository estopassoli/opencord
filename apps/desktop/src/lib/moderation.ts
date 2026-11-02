/**
 * Moderação (ADR-0034): castigo (`timeoutUntil`) e banimento. Helpers puros (test/moderation.test.ts) e um hook
 * que acompanha o fim do castigo.
 */
import { MAX_TIMEOUT_MS } from '@opencord/contracts';
import { useEffect, useState } from 'react';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** durações do submenu "Castigo" (todas ≤ MAX_TIMEOUT_MS) */
export const TIMEOUT_CHOICES: readonly { label: string; ms: number }[] = [
  { label: '1 minuto', ms: MIN },
  { label: '5 minutos', ms: 5 * MIN },
  { label: '10 minutos', ms: 10 * MIN },
  { label: '1 hora', ms: HOUR },
  { label: '1 dia', ms: DAY },
  { label: '1 semana', ms: 7 * DAY },
].filter((c) => c.ms <= MAX_TIMEOUT_MS);

/** "Apagar mensagens recentes" do diálogo de banir: janela em segundos */
export const BAN_DELETE_WINDOWS: readonly { id: 'none' | '1h' | '24h' | '7d'; label: string; seconds: number }[] = [
  { id: 'none', label: 'Nada', seconds: 0 },
  { id: '1h', label: 'Última hora', seconds: 3600 },
  { id: '24h', label: 'Últimas 24 h', seconds: 24 * 3600 },
  { id: '7d', label: 'Últimos 7 dias', seconds: 7 * 24 * 3600 },
];

/** ISO de `agora + ms` para `PATCH /servers/:id/members/:userId { timeoutUntil }` */
export function timeoutUntilIso(ms: number, now = Date.now()): string {
  return new Date(now + Math.min(ms, MAX_TIMEOUT_MS)).toISOString();
}

/** o castigo ainda vale? (null/passado = não) */
export function isTimedOut(timeoutUntil: string | null | undefined, now = Date.now()): boolean {
  if (!timeoutUntil) return false;
  const t = new Date(timeoutUntil).getTime();
  return Number.isFinite(t) && t > now;
}

/** "até 14:30" hoje, "até 03/11 14:30" em outro dia (pt-BR) */
export function fmtTimeoutUntil(timeoutUntil: string, now = Date.now()): string {
  const d = new Date(timeoutUntil);
  if (Number.isNaN(d.getTime())) return timeoutUntil;
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${day} ${time}`;
}

/** true enquanto o castigo vale; vira false sozinho quando expira (timer interno) */
export function useTimedOut(timeoutUntil: string | null | undefined): boolean {
  const [active, setActive] = useState(() => isTimedOut(timeoutUntil));
  useEffect(() => {
    const on = isTimedOut(timeoutUntil);
    setActive(on);
    if (!on || !timeoutUntil) return;
    const left = new Date(timeoutUntil).getTime() - Date.now();
    // setTimeout não aceita mais que ~24,8 dias: acima disso, reavalia por partes
    const t = setTimeout(() => setActive(isTimedOut(timeoutUntil)), Math.min(left + 50, 2_000_000_000));
    return () => clearTimeout(t);
  }, [timeoutUntil, active]);
  return active;
}

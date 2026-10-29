/** Backoff exponencial com jitter total (AWS "full jitter"), limitado por `maxMs`. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 15_000, random = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * cap);
}

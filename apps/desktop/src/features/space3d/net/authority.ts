/**
 * Troca de autoridade (ADR-0056): quem simula a bola ou a mesa de sinuca e manda o estado para os outros.
 * Função pura, igual em todos os apps, sem servidor: se o dono sair da zona ou ficar calado por mais de
 * `AUTHORITY_SILENCE_MS`, assume o **menor id** vivo na zona (todos chegam ao mesmo nome sem combinar nada).
 * Quem assume continua do último estado que recebeu.
 */

/** silêncio máximo do dono (ms). O dono manda estado pelo menos 1x/s mesmo com tudo parado. */
export const AUTHORITY_SILENCE_MS = 1500;

/**
 * Quem deve ser a autoridade agora.
 * @param alive ids vivos na zona (incluindo eu), em qualquer ordem
 * @param authority dono atual (null = ninguém ainda: nada a fazer)
 * @param lastStateMs quando chegou o último estado do dono (relógio local)
 * @param now agora (mesmo relógio)
 * @returns o dono atual, quem assume no lugar dele, ou null se não sobrou ninguém
 */
export function nextAuthority(
  alive: readonly string[],
  authority: string | null,
  lastStateMs: number,
  now: number,
  silenceMs = AUTHORITY_SILENCE_MS,
): string | null {
  if (authority === null) return null;
  const present = alive.includes(authority);
  if (present && now - lastStateMs <= silenceMs) return authority;
  let best: string | null = null;
  for (const id of alive) if (id !== authority && (best === null || id < best)) best = id;
  // ninguém para assumir: fica com quem estava (se ainda está na zona)
  return best ?? (present ? authority : null);
}

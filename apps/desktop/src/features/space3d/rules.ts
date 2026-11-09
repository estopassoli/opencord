/**
 * Regras dos minigames do Espaço 3D (P2 da rodada de 2026-11-09), puras e sem three.js: quem pode roubar a bola, em
 * qual cesta cada time ataca, o tamanho da faixa verde do arremesso, de quem é a vez na sinuca e em que metade cada
 * time joga nos jogos de rede. O alvo e o vencedor da partida ficam em `@opencord/contracts` (`matchWinner`), porque o
 * servidor usa a mesma regra.
 */

export type Team = 'a' | 'b';

// ---------- basquete: roubo ----------
/** quem acabou de pegar a bola fica protegido por este tempo (ninguém rouba de volta na hora) */
export const STEAL_GUARD_MS = 1000;
/** meio ângulo (rad) do cone na frente de quem tem a bola: só dá para roubar de frente */
export const STEAL_CONE = 1.2;

/**
 * Dá para roubar a bola agora? Só depois da proteção de `STEAL_GUARD_MS` e só de frente para quem está com ela
 * (`holder.ry` é para onde a pessoa olha; com ry = 0 a frente aponta para +z).
 */
export function canSteal(
  holder: { x: number; z: number; ry: number },
  holdSince: number,
  thief: { x: number; z: number },
  now: number,
): boolean {
  if (now - holdSince < STEAL_GUARD_MS) return false;
  const dx = thief.x - holder.x;
  const dz = thief.z - holder.z;
  if (Math.hypot(dx, dz) < 1e-6) return true;
  let diff = Math.atan2(dx, dz) - holder.ry;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= STEAL_CONE;
}

// ---------- basquete: cesta de ataque ----------
/** lado (+1 = +x, −1 = −x) da cesta em que o time ataca: azul ataca +x, vermelho ataca −x (como o resto das arenas) */
export function attackHoop(team: Team): 1 | -1 {
  return team === 'a' ? 1 : -1;
}

// ---------- basquete: faixa verde do arremesso ----------
/**
 * A faixa verde da barra de força (0–1): centrada em `center`; larga de perto, estreita de longe e mais estreita com
 * marcador colado. Constante única: a barra (SpaceView), o arremesso (sports.ts) e a partida (sportplay.ts) usam esta.
 */
export const GOOD_BAND = {
  center: 0.675,
  /** largura até `nearD` metros da cesta */
  near: 0.3,
  /** largura a partir de `farD` metros (meia quadra) */
  far: 0.08,
  nearD: 2,
  farD: 12.6,
  /** com marcador perto, a largura vira esta fração */
  contested: 0.6,
  /** marcador a menos disto (m) conta como "contestado" */
  contestR: 1.5,
} as const;

/** Faixa boa da força ({lo, hi} em 0–1) a `dist` metros da cesta, com ou sem marcador perto. */
export function goodBand(dist: number, contested = false): { lo: number; hi: number } {
  const b = GOOD_BAND;
  const t = Math.max(0, Math.min(1, (dist - b.nearD) / (b.farD - b.nearD)));
  const w = (b.near + (b.far - b.near) * t) * (contested ? b.contested : 1);
  return { lo: b.center - w / 2, hi: b.center + w / 2 };
}

// ---------- sinuca: vez por pessoa ----------
export interface PoolSeat {
  id: string;
  team: Team;
}

/** de quem é a vez e quem jogou por último em cada time (para o rodízio dentro do time) */
export interface PoolRota {
  turn: string | null;
  last: Partial<Record<Team, string>>;
}

const byId = (a: PoolSeat, b: PoolSeat) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** o próximo do time depois de `after` (em ordem de id, voltando ao começo); null se o time está vazio */
function nextOf(seats: readonly PoolSeat[], team: Team, after: string | undefined): string | null {
  const list = seats.filter((s) => s.team === team).sort(byId);
  if (!list.length) return null;
  const i = after === undefined ? -1 : list.findIndex((s) => s.id === after);
  if (i < 0) {
    // quem jogou por último saiu da mesa: o primeiro do time com id maior que o dele (ou o primeiro)
    const later = after === undefined ? undefined : list.find((s) => s.id > after);
    return (later ?? list[0]!).id;
  }
  return list[(i + 1) % list.length]!.id;
}

/**
 * Vez da sinuca por pessoa, em rodízio que alterna os times (A1, B1, A2, B1…). `result`: 'keep' (encaçapou sem falta:
 * joga de novo), 'pass' (a vez passa) ou 'check' (só confere se quem tem a vez ainda está na mesa).
 * Sozinho na mesa, ou com todo mundo no mesmo time, a vez segue no time (treino: quem está sozinho joga todas).
 */
export function poolTurn(seats: readonly PoolSeat[], rota: PoolRota, result: 'keep' | 'pass' | 'check'): PoolRota {
  if (!seats.length) return { turn: null, last: rota.last };
  const cur = rota.turn ? seats.find((s) => s.id === rota.turn) : undefined;
  if (!cur) {
    // ninguém com a vez (começo) ou quem tinha saiu da mesa: o próximo do azul (ou do vermelho, se o azul está vazio)
    return { turn: nextOf(seats, 'a', rota.last.a) ?? nextOf(seats, 'b', rota.last.b), last: rota.last };
  }
  if (result !== 'pass') return rota;
  const last = { ...rota.last, [cur.team]: cur.id };
  const other: Team = cur.team === 'a' ? 'b' : 'a';
  const turn = nextOf(seats, other, rota.last[other]) ?? nextOf(seats, cur.team, cur.id);
  return { turn, last };
}

// ---------- jogos de rede: lado do time ----------
/** lado da quadra (−1 = x < 0, +1 = x > 0) em que o time joga nos jogos de rede: azul em −x, vermelho em +x */
export function netSideOf(team: Team): 1 | -1 {
  return team === 'a' ? -1 : 1;
}

/** a rede é parede para o jogador: o x fica na metade do time (com a folga do corpo) */
export function clampToHalf(x: number, team: Team, margin: number): number {
  return netSideOf(team) < 0 ? Math.min(x, -margin) : Math.max(x, margin);
}

// ---------- saque ----------
/** ninguém sacou neste tempo: o saque sai sozinho */
export const AUTO_SERVE_MS = 8000;

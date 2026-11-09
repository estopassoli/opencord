/**
 * Sorteio com semente para os bots: a mesma semente dá as mesmas decisões (os testes ficam repetíveis, sem
 * Math.random). Puro, sem three.js.
 */
export type Rng = () => number;

/** gerador pequeno e rápido (mulberry32): números em [0, 1) */
export function seeded(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** número com distribuição normal (média 0, desvio 1), cortado em ±3 para não sair nada absurdo */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-3, Math.min(3, n));
}

/** número entre `a` e `b` */
export function between(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

/** ângulo em (−π, π] */
export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** ângulo de `from` olhando para `to` (como o ry do boneco: ry = 0 olha para +z) */
export function faceTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

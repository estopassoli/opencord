/**
 * Mola amortecida (x'' = −k·x − c·x') para os coices e trancos do gunfight: a câmera, a arma na 1ª pessoa e o boneco.
 * Puro (sem three.js) e testado. Sempre em passos de no máximo 1/120 s: com o passo do quadro, o pico mudava com o
 * fps (a 30 qps o coice saía com a metade do tamanho de 144 qps) e, com passo grande, a mola explodia.
 */

export interface Spring {
  x: number;
  v: number;
}

export const SPRING_STEP = 1 / 120;

export const spring = (): Spring => ({ x: 0, v: 0 });

/** anda `dt` segundos (no máximo 0,25 s de uma vez: aba escondida não vira um salto) */
export function stepSpring(s: Spring, k: number, c: number, dt: number): void {
  let left = Math.max(0, Math.min(0.25, dt));
  while (left > 1e-6) {
    const h = Math.min(SPRING_STEP, left);
    // Euler semi-implícito: a velocidade primeiro, a posição com a velocidade nova (estável com o passo pequeno)
    s.v += (-s.x * k - s.v * c) * h;
    s.x += s.v * h;
    left -= h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) s.x = s.v = 0;
}

/**
 * O pico que a mola alcança para cada 1 de velocidade dada de uma vez (resposta ao impulso, analítica). Assim o coice
 * de cada arma é escrito pelo tamanho que se vê (o pico), não pela velocidade.
 */
export function springPeak(k: number, c: number): number {
  const w = Math.sqrt(Math.max(1e-6, k));
  const z = c / (2 * w);
  if (z >= 1 - 1e-6) {
    if (z <= 1 + 1e-6) return 1 / (w * Math.E);
    // superamortecida: x(t) = (e^{r1 t} − e^{r2 t}) / (r1 − r2), pico onde a derivada zera
    const s = w * Math.sqrt(z * z - 1);
    const r1 = -z * w + s;
    const r2 = -z * w - s;
    const tp = Math.log(r2 / r1) / (r1 - r2);
    return (Math.exp(r1 * tp) - Math.exp(r2 * tp)) / (r1 - r2);
  }
  // subamortecida: x(t) = e^{−ζωt}·sen(ωd·t)/ωd, pico em tan(ωd·t) = ωd/(ζω)
  const wd = w * Math.sqrt(1 - z * z);
  const tp = Math.atan2(wd, z * w) / wd;
  return (Math.exp(-z * w * tp) * Math.sin(wd * tp)) / wd;
}

/**
 * Dá um coice de pico `peak` (no mesmo sinal). Numa rajada os coices se somam, mas com teto macio: perto de `cap`×pico
 * o coice novo vale menos (a arma não fica empurrada para trás de vez nem atravessa a câmera).
 */
export function kickSpring(s: Spring, k: number, c: number, peak: number, cap = 1.5): void {
  if (!peak) return;
  const room = Math.max(0, 1 - Math.max(0, s.x * Math.sign(peak)) / (Math.abs(peak) * cap));
  s.v += (peak / springPeak(k, c)) * room;
}

/**
 * Bot da sinuca: escolhe uma bola e uma caçapa (bola fantasma: onde a branca tem que encostar para mandar a bola na
 * caçapa), mira e dá a força para a bola chegar lá. O nível muda a escolha (o difícil pega a tacada mais fácil; o fácil
 * às vezes pega qualquer uma), o erro da mira e o da força. Puro, sem three.js (a física é a de `pool.ts`).
 */
import { MAX_SHOT, POCKETS, POOL_FRICTION, POOL_R, type PoolBall } from '../pool';
import { BOT_SKILL, type BotLevel } from './level';
import { gauss, type Rng } from './rng';

export interface PoolShot {
  /** direção da tacada (como o ry do boneco) */
  angle: number;
  /** força (0–1, como a barra) */
  charge: number;
  /** bola e caçapa escolhidas (−1 = sem tacada boa: só encosta numa bola) */
  ball: number;
  pocket: number;
}

/**
 * erro da mira (rad, vezes o erro do nível): um erro pequeno no taco vira um erro grande na bola colorida (o corte
 * multiplica pela distância da branca), então é bem menor que nos outros jogos
 */
const AIM_ERR = 0.012;

interface Cand {
  ball: number;
  pocket: number;
  ghost: { x: number; z: number };
  cut: number;
  dCue: number;
  dPocket: number;
  score: number;
}

/** alguma bola (fora `skip`) está no caminho de `a` até `b`? */
function blocked(balls: PoolBall[], a: { x: number; z: number }, b: { x: number; z: number }, skip: number[]): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  return balls.some((o, i) => {
    if (o.in || skip.includes(i)) return false;
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / len2));
    return Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < POOL_R * 2;
  });
}

/** todas as tacadas possíveis (bola × caçapa com caminho livre e corte não muito fino), da melhor para a pior */
export function poolCandidates(balls: PoolBall[]): Cand[] {
  const cue = balls[0]!;
  const out: Cand[] = [];
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i]!;
    if (b.in) continue;
    POCKETS.forEach(([px, pz], p) => {
      const dPocket = Math.hypot(px - b.x, pz - b.z);
      const ux = (px - b.x) / dPocket;
      const uz = (pz - b.z) / dPocket;
      const ghost = { x: b.x - ux * POOL_R * 2, z: b.z - uz * POOL_R * 2 };
      const dCue = Math.hypot(ghost.x - cue.x, ghost.z - cue.z);
      if (dCue < 1e-3) return;
      const cut = ((ghost.x - cue.x) * ux + (ghost.z - cue.z) * uz) / dCue;
      if (cut < 0.3) return;
      if (blocked(balls, cue, ghost, [0, i]) || blocked(balls, b, { x: px, z: pz }, [0, i])) return;
      out.push({
        ball: i,
        pocket: p,
        ghost,
        cut,
        dCue,
        dPocket,
        score: (cut * cut) / (1 + dCue * 0.5 + dPocket * 0.7),
      });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** a força (0–1) para a bola chegar na caçapa com folga, pelo atrito da mesa */
export function shotCharge(dCue: number, dPocket: number, cut: number): number {
  const F = POOL_FRICTION;
  const vObj = Math.sqrt(2 * F * dPocket) + 0.35;
  const vHit = vObj / Math.max(0.3, cut);
  // forte demais a bola bate na boca da caçapa e volta (calibrado na física da mesa)
  const v = Math.min(MAX_SHOT, Math.sqrt(vHit * vHit + 2 * F * dCue) * 0.92);
  return Math.max(0, Math.min(1, (v - 0.3) / (MAX_SHOT - 0.3)));
}

/** a tacada do bot nesta mesa, com o erro do nível */
export function planPoolShot(balls: PoolBall[], level: BotLevel, rng: Rng): PoolShot {
  const s = BOT_SKILL[level];
  const cue = balls[0]!;
  const cands = poolCandidates(balls);
  let pick: Cand | undefined;
  if (cands.length) {
    // o esperto pega a melhor; senão, uma das primeiras (ou qualquer uma)
    if (rng() < s.smart) pick = cands[0];
    else pick = cands[Math.floor(rng() * Math.min(cands.length, 1 + Math.round((1 - s.smart) * 8)))];
  }
  if (!pick) {
    // nenhuma tacada limpa: encosta na bola mais perto, com força média
    let best = -1;
    let bd = Infinity;
    balls.forEach((b, i) => {
      if (i === 0 || b.in) return;
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const t = balls[best] ?? { x: 0, z: 0 };
    return {
      angle: Math.atan2(t.x - cue.x, t.z - cue.z) + gauss(rng) * s.error * AIM_ERR,
      charge: 0.45,
      ball: -1,
      pocket: -1,
    };
  }
  const angle = Math.atan2(pick.ghost.x - cue.x, pick.ghost.z - cue.z) + gauss(rng) * s.error * AIM_ERR;
  const charge = Math.max(
    0.05,
    Math.min(1, shotCharge(pick.dCue, pick.dPocket, pick.cut) * (1 + gauss(rng) * s.error * 0.25)),
  );
  return { angle, charge, ball: pick.ball, pocket: pick.pocket };
}

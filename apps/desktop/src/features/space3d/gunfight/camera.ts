/**
 * Câmera da terceira pessoa do gunfight, pura (testada contra as caixas do mapa): por cima do ombro direito, sem
 * entrar em parede. Primeiro o ombro: um raio do olho para a direita encurta o deslocamento antes da caixa ao lado
 * (senão a câmera nascia dentro do contêiner e, de dentro, as faces somem e dá para ver através). Depois o raio para
 * trás, a partir do ombro, encurta a distância até a primeira caixa (sem mínimo: encostado na parede, a câmera fica
 * no ombro e o meu boneco some para não tampar a tela).
 */
import { rayBox, type Box, type V3 } from './weapons';

/** quanto a câmera fica à direita do olho (m): mais mirando, para o corpo não tampar o meio da tela */
export const SHOULDER_SIDE = { hip: 0.55, ads: 0.6 };
/** distância atrás do ombro (m): no quadril, mirando e morto */
export const CAM_BACK = { hip: 2.3, ads: 1.4, dead: 3.5 };
/** folga da câmera até a parede (m) */
const PAD = 0.18;
/** câmera mais perto do que isso da cabeça: o meu boneco some (tamparia a tela) */
export const HIDE_SELF_AT = 0.9;

export interface ShoulderCam {
  pos: V3;
  /** a câmera está tão perto da cabeça que o meu boneco deve sumir */
  hideSelf: boolean;
}

export function shoulderCam(
  eye: V3,
  yaw: number,
  pitch: number,
  o: { aiming: number; alive: boolean },
  boxes: readonly Box[],
): ShoulderCam {
  const base = { x: eye.x, y: eye.y + 0.15, z: eye.z };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  let side = o.alive ? SHOULDER_SIDE.hip + (SHOULDER_SIDE.ads - SHOULDER_SIDE.hip) * o.aiming : SHOULDER_SIDE.hip;
  for (const b of boxes) {
    const t = rayBox(base, right, b);
    if (t - PAD < side) side = Math.max(0, t - PAD);
  }
  const sh = { x: base.x + right.x * side, y: base.y, z: base.z + right.z * side };
  // para trás da direção da mira (o contrário de para onde a câmera olha)
  const back = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
  let d = o.alive ? CAM_BACK.hip + (CAM_BACK.ads - CAM_BACK.hip) * o.aiming : CAM_BACK.dead;
  for (const b of boxes) {
    const t = rayBox(sh, back, b);
    if (t - PAD < d) d = Math.max(0, t - PAD);
  }
  // nem para baixo do chão (olhando para cima, o raio de trás desce)
  if (back.y < -1e-6) d = Math.min(d, Math.max(0, (sh.y - 0.15) / -back.y));
  const pos = { x: sh.x + back.x * d, y: sh.y + back.y * d, z: sh.z + back.z * d };
  const near = Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z);
  return { pos, hideSelf: near < HIDE_SELF_AT };
}

/** câmera da morte: altura sobre o corpo (m), distância atrás dele e quanto tempo leva para virar para quem matou */
export const DEATH_CAM = { up: 1.5, back: 2.6, top: 2.5, turnMs: 1200, minDist: 0.9, hideAt: 0.6 };

export interface DeathCam {
  pos: V3;
  /** para onde a câmera olha */
  look: V3;
  /** a câmera ficou em cima do corpo: o meu boneco some */
  hideSelf: boolean;
}

/**
 * Morto: a câmera fica atrás e acima do corpo, do lado oposto a quem matou, e nos primeiros 1,2 s vira devagar do corpo
 * para o atirador (mostra de onde veio o tiro). Sem matador conhecido, olha o corpo de trás (pela mira de antes). Se a
 * parede encosta a câmera no corpo (morreu de costas para o contêiner), ela sobe e olha para baixo, sem entrar nele.
 */
export function deathCam(body: V3, killer: V3 | null, since: number, yaw: number, boxes: readonly Box[]): DeathCam {
  const chest = { x: body.x, y: body.y + 0.9, z: body.z };
  // para trás: do matador para o corpo (no chão); sem matador, o contrário da mira
  let bx = Math.sin(yaw);
  let bz = Math.cos(yaw);
  if (killer) {
    const dx = body.x - killer.x;
    const dz = body.z - killer.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.3) {
      bx = dx / l;
      bz = dz / l;
    }
  }
  const want = { x: bx * DEATH_CAM.back, y: DEATH_CAM.up, z: bz * DEATH_CAM.back };
  const len = Math.hypot(want.x, want.y, want.z);
  const dir = { x: want.x / len, y: want.y / len, z: want.z / len };
  let d = len;
  for (const b of boxes) {
    const t = rayBox(chest, dir, b);
    if (t - PAD < d) d = Math.max(0, t - PAD);
  }
  let pos = { x: chest.x + dir.x * d, y: chest.y + dir.y * d, z: chest.z + dir.z * d };
  let top = false;
  if (d < DEATH_CAM.minDist) {
    // encostado na parede: por cima do corpo (um tiquinho para trás, senão o "olhar para baixo" fica sem direção)
    const up = { x: 0, y: 1, z: 0 };
    let h = DEATH_CAM.top - 0.9;
    for (const b of boxes) {
      const t = rayBox(chest, up, b);
      if (t - PAD < h) h = Math.max(0.3, t - PAD);
    }
    pos = { x: chest.x + bx * 0.05, y: chest.y + h, z: chest.z + bz * 0.05 };
    top = true;
  }
  // vira do corpo para quem matou, com calma (suave no começo e no fim)
  // (por cima do corpo também: primeiro o corpo, depois quem matou)
  const u = killer ? Math.min(1, Math.max(0, since / DEATH_CAM.turnMs)) : 0;
  const e = u * u * (3 - 2 * u);
  const aimAt = killer ?? chest;
  const look = {
    x: chest.x + (aimAt.x - chest.x) * e,
    y: chest.y + (aimAt.y - chest.y) * e,
    z: chest.z + (aimAt.z - chest.z) * e,
  };
  const near = Math.hypot(pos.x - chest.x, pos.y - chest.y, pos.z - chest.z);
  return { pos, look, hideSelf: !top && near < DEATH_CAM.hideAt };
}

/**
 * Câmera da terceira pessoa do gunfight, pura (testada contra as caixas do mapa): por cima do ombro direito, sem
 * entrar em parede. Primeiro o ombro: um raio do olho para a direita encurta o deslocamento antes da caixa ao lado
 * (senão a câmera nascia dentro do contêiner e, de dentro, as faces somem e dá para ver através). Depois o raio para
 * trás, a partir do ombro, encurta a distância até a primeira caixa (sem mínimo: encostado na parede, a câmera fica
 * no ombro e o meu boneco some para não tampar a tela).
 */
import { rayBox, type Box, type V3 } from './weapons';

/** quanto a câmera fica à direita do olho (m): mais mirando, para o corpo não tampar o meio da tela */
export const SHOULDER_SIDE = { hip: 0.45, ads: 0.6 };
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

/**
 * A mão esquerda de guarda das facas, a mesma em todas (só o lugar muda de uma faca para outra): um meio punho
 * relaxado, com o pulso reto na linha do antebraço. Cada faca tinha a sua e, na visão do jogador, quase todas liam
 * como garra ou como o sinal de "OK" (a ponta do polegar encostando na do médio, com o vão no meio).
 *
 * - Dedos juntos, fechando em cascata do indicador para o mindinho (o mindinho mais fechado), as pontas dobradas para
 *   dentro da palma, sem apontar para a câmera.
 * - Polegar deitado ao lado do indicador, encostado na falange do meio dele, sem fazer anel.
 * - O pulso segue o antebraço (`knifeGuardQuat`): os dedos na linha dele, com uma extensão leve e natural; o giro em
 *   volta do antebraço deixa o dorso da mão para cima, para fora e para a câmera.
 */
import * as THREE from 'three';

export const KNIFE_GUARD = {
  /**
   * os quatro dedos (1 = em volta de um cabo de 2,5 cm; ~1,6 cerrado): fechados sem cerrar, as pontas encostando na
   * palma. O indicador fica igual aos outros aqui (mais aberto, a pose vira a do dedo no gatilho); a cascata vem do `off`
   */
  curl: 1.43,
  index: 1.43,
  /** polegar: dobrado por cima, deitado ao longo do indicador (mais aberto, a ponta encostava na do médio: o "OK") */
  thumb: 0.75,
  /**
   * o a mais de cada dedo (indicador, médio, anelar, mindinho, polegar e abertura do polegar), medido nas esferas da
   * mão para cada ponta encostar na palma sem entrar: o anelar e o mindinho, mais curtos, chegam lá com menos giro e
   * ficam por baixo dos outros (a cascata do punho); o polegar vem para junto do indicador
   */
  off: [-0.1, 0, -0.15, -0.23, 0, -0.4] as [number, number, number, number, number, number],
  /** extensão do pulso (rad, os dedos para o lado do dorso): o pulso relaxado não fica dobrado para a palma */
  ext: 0.12,
  /**
   * para onde o dorso da mão aponta (espaço da câmera, tirada a parte na linha do antebraço): para cima e para fora,
   * o polegar por cima; da câmera se vê o punho de lado, com os dedos dobrados e o polegar deitado sobre eles
   */
  back: [-0.4, 1, -0.3] as [number, number, number],
};

/**
 * Onde a mão fica parada em cada faca (espaço da câmera): baixa à esquerda, na frente do corpo, como numa base de luta.
 * A Baioneta e a Bowie, com a guarda da direita mais baixa, ficam um pouco mais abaixo e mais longe.
 */
export const KNIFE_GUARD_AT: Record<'bayonet' | 'bowie' | 'other', THREE.Vector3> = {
  bayonet: new THREE.Vector3(-0.17, -0.21, -0.43),
  bowie: new THREE.Vector3(-0.16, -0.19, -0.46),
  other: new THREE.Vector3(-0.17, -0.16, -0.42),
};

const B = new THREE.Vector3();
const F = new THREE.Vector3();
const X = new THREE.Vector3();
const Z = new THREE.Vector3();
const M = new THREE.Matrix4();

/**
 * O giro da mão de guarda (espaço da câmera) com o antebraço em `fore` (do cotovelo ao pulso, unitário): os dedos na
 * linha dele, estendidos `ext` para o lado do dorso, e o dorso o mais perto possível de `back`.
 */
export function knifeGuardQuat(fore: THREE.Vector3, out: THREE.Quaternion, g = KNIFE_GUARD): THREE.Quaternion {
  B.fromArray(g.back);
  B.addScaledVector(fore, -B.dot(fore)).normalize();
  F.copy(fore).multiplyScalar(Math.cos(g.ext)).addScaledVector(B, Math.sin(g.ext)).normalize();
  B.addScaledVector(F, -B.dot(F)).normalize();
  Z.copy(F).negate();
  X.crossVectors(B, Z);
  return out.setFromRotationMatrix(M.makeBasis(X, B, Z));
}

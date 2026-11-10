/**
 * Animações da M200 na primeira pessoa (caminho de código, não clipe), em trilhas de chaves (dados puros; o
 * `viewmodel.ts` soma à pose do quadril e as mãos seguem a arma nas pegadas medidas). A arma tem 1,3 m e a coronha
 * passa perto da câmera: a inspeção e o golpe genéricos (giros grandes em volta do punho) jogavam a coronha atravessada
 * na tela e o pulso direito na frente da câmera; o ferrolho levava a mão para o canto de cima, meio fora da tela.
 *
 * Trilhas (todas opcionais, somadas à pose): posição do `holder` no espaço da câmera (`px`, `py`, `pz`, m) e giro YXZ
 * (`rx` cano para cima, `ry` cano para a esquerda, `rz` anti-horário visto pelo jogador, rad). Chaves como em
 * `karambit.ts`: [fração da ação, valor, curva até a próxima] (0 suave, 1 sai rápido e chega devagar, 2 sai devagar e
 * chega rápido). Escritas à mão e conferidas quadro a quadro no espelho da primeira pessoa.
 */
import { track, type Key } from './karambit';

export type M200Track = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz';
export type M200Tracks = Partial<Record<M200Track, readonly Key[]>>;

/**
 * Ferrolho (~1180 ms no jogo; alavanca sobe em 0,12–0,28, vem para trás até 0,45, volta até 0,66 e desce até 0,8): a
 * arma vem um pouco para o meio e deita para a esquerda (o lado direito sobe e a alavanca aparece em cima da caixa), o
 * cano sobe um pouco; no puxão ela desce um pouco (a mão não sai pelo canto de cima) e vem de leve contra o ombro, o
 * fechamento empurra de volta; assenta passando um pouco do ponto.
 */
// prettier-ignore
export const M200_BOLT: M200Tracks = {
  px: [[0, 0], [0.14, -0.035], [0.8, -0.035], [1, 0]],
  py: [[0, 0], [0.14, 0], [0.3, -0.005], [0.45, -0.02], [0.66, -0.01], [0.8, 0], [1, 0]],
  pz: [[0, 0], [0.14, -0.01], [0.42, -0.01], [0.47, 0.012, 1], [0.6, 0], [0.66, -0.016, 1], [0.74, -0.01], [1, 0]],
  rx: [[0, 0], [0.14, 0.08], [0.8, 0.08], [0.9, 0.095], [1, 0]],
  ry: [[0, 0], [0.14, 0.08], [0.8, 0.08], [1, 0]],
  rz: [[0, 0], [0.16, 0.42], [0.8, 0.42], [0.92, -0.03], [1, 0]],
};

/**
 * Inspeção (2400 ms): recua um pouco (antecipação), sobe e vira o cano para a esquerda, mostrando a lateral direita
 * inteira — luneta, caixa, alavanca do ferrolho, pente e punho com a mão (pausa); a coronha vai para fora da tela, à
 * direita. Depois o cano volta e a arma deita para a direita com o cano um pouco para cima, mostrando a lateral esquerda
 * e o pente por baixo (pausa) — sem virar o cano para a direita, que trazia a coronha atravessada na frente da câmera;
 * volta passando um pouco do ponto. As duas mãos ficam nas pegadas (a esquerda no suporte do bipé).
 */
// prettier-ignore
export const M200_INSPECT: M200Tracks = {
  px: [[0, 0], [0.06, 0.01], [0.22, -0.03, 1], [0.42, -0.035], [0.6, -0.03], [0.8, -0.035], [0.94, 0]],
  py: [[0, 0], [0.06, -0.01], [0.22, 0.04, 1], [0.42, 0.045], [0.6, 0.06], [0.8, 0.065], [0.94, 0]],
  pz: [[0, 0], [0.06, 0.01], [0.22, -0.02, 1], [0.42, -0.02], [0.6, -0.03], [0.8, -0.03], [0.94, 0]],
  rx: [[0, 0], [0.06, -0.04], [0.22, 0.1, 1], [0.42, 0.12], [0.6, 0.25], [0.8, 0.28], [0.94, -0.03], [1, 0]],
  ry: [[0, 0], [0.06, -0.05], [0.22, 0.7, 1], [0.42, 0.75], [0.6, -0.1], [0.8, -0.12], [0.94, 0]],
  rz: [[0, 0], [0.06, -0.05], [0.22, 0.3, 1], [0.42, 0.33], [0.6, -1.0], [0.8, -1.05], [0.94, 0.04], [1, 0]],
};

/**
 * Golpe com a arma (500 ms; o acerto sai em 32%): a arma recua contra o ombro e sobe um pouco, deitando para a
 * esquerda (antecipação, ~70 ms); estoca para a frente e um pouco para a esquerda com a boca à frente, deitando para a
 * direita; tranco no acerto, segue um pouco e volta devagar. (Virando o cano para a esquerda, a coronha vinha para a
 * frente da câmera e tampava metade da tela.)
 */
// prettier-ignore
export const M200_BASH: M200Tracks = {
  px: [[0, 0], [0.14, 0.02, 2], [0.32, -0.06, 1], [0.42, -0.065], [1, 0]],
  py: [[0, 0], [0.14, 0.025, 2], [0.32, -0.01, 1], [0.42, -0.015], [1, 0]],
  pz: [[0, 0], [0.14, 0.035, 2], [0.32, -0.17, 1], [0.42, -0.18], [1, 0]],
  rx: [[0, 0], [0.14, 0.12, 2], [0.32, -0.03, 1], [0.42, -0.04], [1, 0]],
  ry: [[0, 0], [0.14, -0.08, 2], [0.32, 0.12, 1], [0.42, 0.14], [1, 0]],
  rz: [[0, 0], [0.14, 0.15, 2], [0.32, -0.3, 1], [0.42, -0.34], [1, 0]],
};

/** soma a pose das trilhas em `u` (0–1) à posição e ao giro do `holder`; `mo` reduz os giros ("reduzir movimento") */
export function m200Pose(
  t: M200Tracks,
  u: number,
  mo: number,
  pos: { x: number; y: number; z: number },
  rot: { x: number; y: number; z: number },
) {
  pos.x += track(u, t.px);
  pos.y += track(u, t.py);
  pos.z += track(u, t.pz);
  rot.x += track(u, t.rx) * mo;
  rot.y += track(u, t.ry) * mo;
  rot.z += track(u, t.rz) * mo;
}

/**
 * Animações da Bowie na primeira pessoa, em trilhas de chaves (as mesmas de `karambit.ts`: `track`, curvas 0/1/2; o
 * `viewmodel.ts` aplica). Todas partem da guarda (`BOWIE_POSE`: martelo, o punho baixo à direita, a lâmina subindo
 * para a frente e para o meio, o fio para a frente) e voltam para ela. A Bowie é grande e pesada: antecipações mais
 * longas, golpes com arco largo, tranco no fim e volta mais lenta que as facas pequenas. A faca nunca gira na mão: o
 * braço e o pulso levam a lâmina (ela nunca passa pela mão).
 *
 * Trilhas (somadas à guarda): posição do braço no espaço da câmera (`px`, `py`, `pz`, m), giro do braço em volta do
 * punho no espaço da câmera (`ex`, `ey`, `ez`, rad; `ez` gira no plano da tela, positivo no sentido anti-horário),
 * giro do antebraço (`pro`) e a mão esquerda de guarda (`lx`, `ly`, `lz`, m). Escritas à mão (conferidas quadro a
 * quadro no espelho da primeira pessoa), sem copiar animação de jogo nenhum.
 */
import type { KarTracks } from './karambit';

/**
 * Saque (1000 ms; o jogo libera o golpe em 380 ms): a mão sobe de baixo à direita trazendo a faca da bainha do
 * quadril, a lâmina ainda para baixo e para trás; o pulso vira a lâmina para cima num arco largo para a frente, ela
 * passa um pouco do ponto (o peso) e assenta na guarda. A esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const BOWIE_DRAW: KarTracks = {
  px: [[0, 0.06], [0.2, 0.03, 1], [0.48, -0.012], [0.7, 0]],
  py: [[0, -0.24], [0.18, -0.06, 1], [0.46, 0.015], [0.6, -0.008], [0.78, 0]],
  pz: [[0, 0.06], [0.2, 0.03], [0.55, 0]],
  ex: [[0, -0.4], [0.2, -0.3], [0.46, 0.08], [0.62, -0.03], [0.8, 0]],
  ey: [[0, 0], [0.25, 0.2], [0.55, 0]],
  ez: [[0, 2.3], [0.16, 2.2], [0.46, -0.14], [0.62, 0.05], [0.8, 0]],
  ly: [[0, -0.22], [0.3, -0.22], [0.75, 0]],
  lz: [[0, 0.06], [0.3, 0.06], [0.75, 0]],
};

/**
 * Inspeção (3400 ms): o braço traz a faca para mais perto e para o meio; o antebraço deita a lâmina para a esquerda com
 * a face direita toda para a câmera (pausa); gira e levanta a lâmina em pé mostrando a outra face e o recorte da ponta
 * (pausa); vira o fio para a câmera, como quem confere o corte (pausa curta), e volta para a guarda com o peso. A
 * esquerda baixa, fora do caminho.
 */
// prettier-ignore
export const BOWIE_INSPECT: KarTracks = {
  px: [[0, 0], [0.12, -0.11], [0.34, -0.1], [0.42, -0.09], [0.5, -0.08], [0.68, -0.07], [0.82, 0]],
  py: [[0, 0], [0.12, 0.09], [0.34, 0.095], [0.42, 0.08], [0.5, 0.06], [0.68, 0.055], [0.82, 0, 1], [0.87, -0.018], [0.95, 0.004], [1, 0]],
  pz: [[0, 0], [0.12, 0.03], [0.34, 0.03], [0.5, 0.02], [0.68, 0.02], [0.82, 0]],
  ex: [[0, 0], [0.12, 0.48], [0.34, 0.54], [0.42, -0.1], [0.5, -0.86], [0.68, -0.87], [0.82, 0], [0.87, 0.06], [1, 0]],
  ey: [[0, 0], [0.12, -0.15], [0.34, -0.17], [0.42, 0.55], [0.5, 0.33], [0.68, 0.33], [0.82, 0]],
  ez: [[0, 0], [0.12, 0.58], [0.34, 0.55], [0.42, -0.66], [0.5, -1.95], [0.68, -2.04], [0.82, 0]],
  lx: [[0, 0], [0.1, -0.03], [0.86, -0.03], [1, 0]],
  ly: [[0, 0], [0.1, -0.06], [0.86, -0.06], [1, 0]],
};

/**
 * Golpe leve da direita para a esquerda (560 ms; o acerto sai em 30%): o punho recua para a direita e para cima com o
 * pulso armado, a lâmina para trás (antecipação, ~100 ms); corta num arco largo que cruza o meio da tela com a face à
 * vista, segue desacelerando para a esquerda e embaixo e volta.
 */
// prettier-ignore
export const BOWIE_SLASH_R: KarTracks = {
  px: [[0, 0], [0.18, 0.07, 2], [0.2, 0.07, 1], [0.34, -0.14, 1], [0.46, -0.2], [0.82, 0]],
  py: [[0, 0], [0.18, 0.09, 2], [0.2, 0.09, 1], [0.34, 0.05, 1], [0.46, 0.0], [0.82, 0]],
  pz: [[0, 0], [0.18, 0.03, 2], [0.2, 0.03, 1], [0.34, -0.04, 1], [0.46, -0.03], [0.82, 0]],
  ex: [[0, 0], [0.18, -0.2, 2], [0.2, -0.2, 1], [0.34, 0.15, 1], [0.46, 0.3], [0.82, 0]],
  ey: [[0, 0], [0.18, -0.35, 2], [0.2, -0.35, 1], [0.34, 0.2, 1], [0.46, 0.3], [0.82, 0]],
  ez: [[0, 0], [0.18, -0.7, 2], [0.2, -0.7, 1], [0.34, 0.6, 1], [0.46, 0.85], [0.82, 0]],
  lx: [[0, 0], [0.25, -0.05], [0.6, -0.05], [1, 0]],
  ly: [[0, 0], [0.25, -0.06], [0.6, -0.06], [1, 0]],
  lz: [[0, 0], [0.25, 0.05], [0.6, 0.05], [1, 0]],
};

/**
 * Golpe leve, o outro lado (alternando): o revés. O punho cruza para a esquerda e para cima com o antebraço virado (a
 * lâmina deitada para a esquerda, a face à vista; antecipação); corta da esquerda para a direita num arco que passa
 * pelo meio da tela, segue para baixo à direita e volta.
 */
// prettier-ignore
export const BOWIE_SLASH_L: KarTracks = {
  px: [[0, 0], [0.18, -0.1, 2], [0.2, -0.1, 1], [0.34, 0.04, 1], [0.46, 0.08], [0.82, 0]],
  py: [[0, 0], [0.18, 0.06, 2], [0.2, 0.06, 1], [0.34, 0.04, 1], [0.46, 0.01], [0.82, 0]],
  pz: [[0, 0], [0.18, 0.01, 2], [0.2, 0.01, 1], [0.34, -0.05, 1], [0.46, -0.03], [0.82, 0]],
  ex: [[0, 0], [0.18, -0.05, 2], [0.2, -0.05, 1], [0.34, 0.1, 1], [0.46, 0.15], [0.82, 0]],
  ey: [[0, 0], [0.18, 0.35, 2], [0.2, 0.35, 1], [0.34, -0.4, 1], [0.46, -0.55], [0.82, 0]],
  ez: [[0, 0], [0.18, 0.45, 2], [0.2, 0.45, 1], [0.34, -0.25, 1], [0.46, -0.4], [0.82, 0]],
  pro: [[0, 0], [0.18, 0.3, 2], [0.2, 0.3, 1], [0.34, -0.1, 1], [0.46, -0.15], [0.82, 0]],
  lx: [[0, 0], [0.15, -0.04], [0.45, -0.04], [0.8, 0]],
  ly: [[0, 0], [0.15, -0.07], [0.45, -0.06], [0.8, 0]],
  lz: [[0, 0], [0.15, 0.03], [0.45, 0.04], [0.8, 0]],
};

/**
 * Golpe pesado (840 ms; o acerto sai em 45%): antecipação longa e pesada — o braço sobe e recua, a lâmina passa por
 * cima e aponta para trás, segura um instante no alto —, desce num arco forte na diagonal para baixo e para a esquerda,
 * cruzando o meio da tela no acerto, tranco no fim, segue mais um pouco pelo peso e volta devagar. A esquerda sai do
 * caminho.
 */
// prettier-ignore
export const BOWIE_HEAVY: KarTracks = {
  px: [[0, 0], [0.3, -0.035, 2], [0.36, -0.03, 1], [0.48, -0.13, 1], [0.62, -0.16], [1, 0]],
  py: [[0, 0], [0.3, 0.1, 2], [0.36, 0.11, 1], [0.48, 0.04, 1], [0.62, 0.02], [1, 0]],
  pz: [[0, 0], [0.3, 0.03, 2], [0.36, 0.035, 1], [0.48, -0.06, 1], [0.62, -0.04], [1, 0]],
  ex: [[0, 0], [0.3, -0.3, 2], [0.36, -0.33, 1], [0.48, 0.3, 1], [0.62, 0.38], [1, 0]],
  ey: [[0, 0], [0.3, -0.1, 2], [0.36, -0.1, 1], [0.48, 0.3, 1], [0.62, 0.38], [1, 0]],
  ez: [[0, 0], [0.3, -1.15, 2], [0.36, -1.22, 1], [0.48, 0.65, 1], [0.62, 0.85], [1, 0]],
  lx: [[0, 0], [0.35, -0.04], [0.7, -0.05], [1, 0]],
  ly: [[0, 0], [0.35, -0.07], [0.7, -0.07], [1, 0]],
  lz: [[0, 0], [0.5, 0.06], [1, 0]],
};

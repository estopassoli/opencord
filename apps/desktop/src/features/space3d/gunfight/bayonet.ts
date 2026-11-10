/**
 * Baioneta M9 na primeira pessoa: a guarda, a mão esquerda de guarda, a corrida e as animações em trilhas de chaves
 * (dados puros, no formato de `karambit.ts`; o `viewmodel.ts` aplica). A pegada é `BAYONET_ARM` (`handrig.ts`): martelo,
 * o cabo atravessando o punho fechado, o polegar por cima do indicador, o fio para o lado dos nós dos dedos.
 *
 * Trilhas (somadas à guarda): posição do braço no espaço da câmera (`px`, `py`, `pz`, m), giro do braço em volta da faca
 * no espaço da câmera (`ex` levanta a ponta, `ey` vira para a esquerda, `ez` gira no plano da tela, anti-horário), giro
 * do antebraço (`pro`), giro da faca na mão (`spin`, no eixo das faces, pelo meio do cabo), quanto ela sai da mão
 * enquanto gira (`slide`, m, em `BAY_TOSS`), dedos soltos (`open`) e a mão esquerda (`lx`, `ly`, `lz`, m). Escritas à
 * mão e conferidas quadro a quadro no espelho da primeira pessoa, sem copiar animação de jogo nenhum.
 */
import * as THREE from 'three';
import type { KarTracks } from './karambit';

const TURN = Math.PI * 2;

/**
 * Guarda (posição e giro YXZ do `holder`; `fore` = o antebraço no espaço da mão). Medida pela mão, não pela faca: o
 * antebraço entra pelo canto de baixo à direita indo para a frente, o punho fica de pé (polegar em cima, ~10° virado
 * para dentro), o pulso desvia 35° para o lado do mindinho e dobra 20° para a palma (dentro do que um pulso faz); daí a
 * lâmina sai para cima e para a esquerda com a face para a câmera, o fio para baixo e a serra do dorso para cima.
 */
export const BAY_POSE = {
  pos: new THREE.Vector3(0.1652, -0.1862, -0.393),
  rot: [0.7613, 0.8276, -0.0582] as THREE.Vector3Tuple,
  fore: new THREE.Vector3(-0.574, 0.28, -0.77).normalize(),
};

/** para onde a faca sai da mão enquanto gira no floreio (espaço da faca: para longe da palma, rente aos dedos abertos) */
export const BAY_TOSS: readonly [number, number, number] = [-1, 0, 0];
/** os dedos enquanto a faca gira solta: abertos, o polegar afastado */
export const BAY_OPEN = { fingers: 0.08, thumb: 0.15, index: 0.08 } as const;

/**
 * Correndo: o punho desce para perto do quadril, a lâmina deitada para a frente, e bombeia com o passo; na tática, o
 * braço dobra para perto do peito com a lâmina em pé. Giros e deslocamentos somados à guarda (espaço da câmera).
 */
export const BAY_RUN = {
  sprint: { px: 0.02, py: -0.025, pz: 0.02, ex: -0.75, ey: 0.05, ez: -0.25 },
  tac: { px: -0.015, py: 0.035, pz: 0.05, ex: 0.45, ey: -0.2, ez: -0.35 },
};

/**
 * Saque (1000 ms; o jogo libera o golpe antes): a mão sobe de baixo à direita com a lâmina para baixo (saindo da bainha),
 * o pulso vira a ponta para a frente e para cima num arco, passa um pouco do ponto e assenta na guarda (tranco). A
 * esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const BAY_DRAW: KarTracks = {
  px: [[0, 0.06], [0.34, 0.01, 1], [0.6, 0], [1, 0]],
  py: [[0, -0.2], [0.34, 0.015, 1], [0.48, 0.015], [0.62, -0.006], [0.76, 0]],
  pz: [[0, 0.05], [0.34, 0, 1]],
  ex: [[0, -1.9], [0.18, -1.75], [0.5, 0.1, 1], [0.64, -0.04], [0.8, 0]],
  ey: [[0, 0.35], [0.5, 0, 1]],
  ez: [[0, -0.5], [0.5, 0.04, 1], [0.72, 0]],
  ly: [[0, -0.22], [0.3, -0.22], [0.75, 0]],
  lz: [[0, 0.06], [0.3, 0.06], [0.75, 0]],
};

/**
 * Inspeção (3400 ms): o braço traz a faca para mais perto e mais para o meio; o pulso deita a lâmina para a esquerda
 * com a face toda para a câmera (pausa), o braço gira e mostra a outra face com a ponta para cima e o antebraço vindo de
 * baixo (pausa; virar só o antebraço escondia a lâmina atrás do punho ou mostrava só o dorso); volta e
 * joga a faca para fora da mão, ela dá uma volta inteira no ar ao lado da palma aberta e a mão pega de novo (tranco);
 * o braço volta para a guarda. A esquerda baixa, fora do caminho.
 */
// prettier-ignore
export const BAY_INSPECT: KarTracks = {
  px: [[0, 0], [0.1, -0.04], [0.88, -0.04], [1, 0]],
  py: [[0, 0], [0.1, 0.07], [0.6, 0.07], [0.66, 0.1, 1], [0.78, 0.09], [0.84, 0.06], [1, 0]],
  pz: [[0, 0], [0.1, 0.06], [0.88, 0.06], [1, 0]],
  ex: [[0, 0], [0.12, -0.15], [0.3, -0.15], [0.42, -0.5], [0.56, -0.5], [0.64, 0], [1, 0]],
  ey: [[0, 0], [0.3, 0], [0.42, -1.5], [0.56, -1.5], [0.64, 0], [1, 0]],
  ez: [[0, 0], [0.12, 0.6], [0.3, 0.6], [0.42, 1.75], [0.56, 1.75], [0.64, 0], [1, 0]],
  spin: [[0, 0], [0.64, 0], [0.82, -TURN], [1, -TURN]],
  slide: [[0, 0], [0.58, 0], [0.64, 0.045], [0.82, 0.045], [0.86, 0]],
  open: [[0, 0], [0.58, 0], [0.62, 1], [0.83, 1], [0.87, 0]],
  lx: [[0, 0], [0.1, -0.02], [0.88, -0.02], [1, 0]],
  ly: [[0, 0], [0.1, -0.06], [0.88, -0.06], [1, 0]],
};

/**
 * Golpe leve (550 ms; o acerto sai em 30%), o primeiro: corte de cima à direita para baixo à esquerda. O punho recua
 * para cima e para a direita com o pulso armado (antecipação, ~100 ms), corta num arco rápido que cruza o meio da tela
 * com o fio na frente, segue desacelerando e volta.
 */
// prettier-ignore
export const BAY_SLASH_L: KarTracks = {
  px: [[0, 0], [0.18, 0.05, 2], [0.2, 0.05, 1], [0.34, -0.12, 1], [0.52, -0.19], [0.88, 0]],
  py: [[0, 0], [0.18, 0.1, 2], [0.2, 0.1, 1], [0.34, 0.05, 1], [0.52, -0.01], [0.88, 0]],
  pz: [[0, 0], [0.18, 0.02, 2], [0.2, 0.02, 1], [0.34, -0.07, 1], [0.52, -0.05], [0.88, 0]],
  ex: [[0, 0], [0.18, 0.3, 2], [0.2, 0.3, 1], [0.34, -0.15, 1], [0.52, -0.3], [0.88, 0]],
  ey: [[0, 0], [0.18, -0.25, 2], [0.2, -0.25, 1], [0.34, 0.3, 1], [0.52, 0.4], [0.88, 0]],
  ez: [[0, 0], [0.18, -0.4, 2], [0.2, -0.4, 1], [0.34, 0.75, 1], [0.52, 1.0], [0.88, 0]],
  lx: [[0, 0], [0.25, -0.05], [0.6, -0.05], [1, 0]],
  ly: [[0, 0], [0.25, -0.07], [0.6, -0.07], [1, 0]],
  lz: [[0, 0], [0.25, 0.05], [0.6, 0.05], [1, 0]],
};

/**
 * Golpe leve, o outro lado (alternando): corte de volta, da esquerda para a direita. O punho cruza para a esquerda e
 * para cima com a lâmina deitada apontando para a esquerda (antecipação), corta para baixo e para a direita passando
 * pelo meio da tela enquanto a ponta varre da esquerda para a frente, segue e volta.
 */
// prettier-ignore
export const BAY_SLASH_R: KarTracks = {
  px: [[0, 0], [0.18, -0.16, 2], [0.2, -0.16, 1], [0.34, -0.01, 1], [0.52, 0.09], [0.88, 0]],
  py: [[0, 0], [0.18, 0.1, 2], [0.2, 0.1, 1], [0.34, 0.03, 1], [0.52, -0.06], [0.88, 0]],
  pz: [[0, 0], [0.18, 0.02, 2], [0.2, 0.02, 1], [0.34, -0.08, 1], [0.52, -0.04], [0.88, 0]],
  ex: [[0, 0], [0.18, -0.05, 2], [0.2, -0.05, 1], [0.34, -0.15, 1], [0.52, -0.3], [0.88, 0]],
  ey: [[0, 0], [0.18, 0.25, 2], [0.2, 0.25, 1], [0.34, -0.45, 1], [0.52, -0.75], [0.88, 0]],
  ez: [[0, 0], [0.18, 0.95, 2], [0.2, 0.95, 1], [0.34, 0.55, 1], [0.52, 0.35], [0.88, 0]],
  lx: [[0, 0], [0.15, -0.05], [0.45, -0.05], [0.8, 0]],
  ly: [[0, 0], [0.15, -0.08], [0.45, -0.07], [0.8, 0]],
  lz: [[0, 0], [0.15, 0.03], [0.45, 0.04], [0.8, 0]],
};

/**
 * Golpe pesado (825 ms; o acerto sai em 45%): antecipação longa — o punho recua para perto do ombro e sobe, a ponta
 * apontando para a frente —, estocada forte para a frente e para o meio da tela com a lâmina quase deitada, tranco no
 * fim, segura um instante e volta devagar. A esquerda puxa para trás.
 */
// prettier-ignore
export const BAY_HEAVY: KarTracks = {
  px: [[0, 0], [0.34, 0.035, 2], [0.37, 0.035, 1], [0.47, -0.08, 1], [0.62, -0.09], [1, 0]],
  py: [[0, 0], [0.34, 0.03, 2], [0.37, 0.03, 1], [0.47, 0.06, 1], [0.62, 0.055], [1, 0]],
  pz: [[0, 0], [0.34, 0.05, 2], [0.37, 0.05, 1], [0.47, -0.19, 1], [0.62, -0.17], [1, 0]],
  ex: [[0, 0], [0.34, 0.15, 2], [0.37, 0.15, 1], [0.47, -0.5, 1], [0.62, -0.47], [1, 0]],
  ey: [[0, 0], [0.34, 0.15, 2], [0.37, 0.15, 1], [0.47, -0.3, 1], [0.62, -0.28], [1, 0]],
  ez: [[0, 0], [0.34, -0.25, 2], [0.37, -0.25, 1], [0.47, 0.05, 1], [0.62, 0.05], [1, 0]],
  lx: [[0, 0], [0.35, -0.03], [0.7, -0.04], [1, 0]],
  ly: [[0, 0], [0.35, -0.04], [0.7, -0.06], [1, 0]],
  lz: [[0, 0], [0.47, 0.07], [1, 0]],
};

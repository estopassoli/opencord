/**
 * Kukri na primeira pessoa: a guarda, a corrida e as animações em trilhas de chaves (dados puros, como as da karambit;
 * o `viewmodel.ts` só chama `kukriPlay`/`kukriRun`). A pegada é `KUKRI_ARM` (`handrig.ts`): martelo, o fio para a
 * frente, do lado dos nós dos dedos.
 *
 * Trilhas (todas opcionais, somadas à guarda): posição do braço no espaço da câmera (`px`, `py`, `pz`, m), giro do braço
 * no espaço da câmera em volta do cabo (`ex` para trás/para a frente, `ey` para a esquerda, `ez` no plano da tela,
 * anti-horário; rad), giro do antebraço (`pro`), giro da faca no comprimento, a mão junto (`roll`) e a mão esquerda de
 * guarda (`lx`, `ly`, `lz`, m). Chaves como em `karambit.ts`: [fração, valor, curva até a próxima] (0 suave, 1 sai
 * rápido e chega devagar — o golpe —, 2 sai devagar e chega rápido — o fim da antecipação). Escritas à mão e conferidas
 * quadro a quadro no espelho da primeira pessoa, sem copiar jogo nenhum.
 */
import * as THREE from 'three';
import { track, type Key } from './karambit';

export type KukTrack = 'px' | 'py' | 'pz' | 'ex' | 'ey' | 'ez' | 'pro' | 'roll' | 'lx' | 'ly' | 'lz';
export type KukTracks = Partial<Record<KukTrack, readonly Key[]>>;

/**
 * A guarda: o punho baixo à direita com o dorso da mão para cima e para a câmera, o antebraço entrando pelo canto de
 * baixo, e a lâmina subindo para a esquerda, com a face à vista e o fio para a frente (a curva da kukri se lê inteira).
 * Posição e giro YXZ do `holder` e o antebraço (do cotovelo ao pulso) no espaço da mão: o pulso ~26° para o lado do
 * mindinho e um pouco estendido, como quem segura um facão pronto para cortar.
 */
export const KUKRI_POSE = {
  pos: new THREE.Vector3(0.14, -0.12, -0.38),
  rot: [0.4016, 0.9012, 1.7458] as THREE.Vector3Tuple,
  fore: new THREE.Vector3(-0.389, -0.221, -0.894).normalize(),
};

/** a esquerda de guarda (dedos, polegar, indicador): um punho solto, os dedos em cascata */
export const KUK_GUARD_CURL = [0.8, 0.5, 0.7] as const;

/** o que uma animação da kukri pede neste quadro além da posição (o `KD` do `viewmodel.ts`) */
export interface KukOut {
  ex: number;
  ey: number;
  ez: number;
  pro: number;
  roll: number;
  lx: number;
  ly: number;
  lz: number;
}

/** soma ao quadro (`pos` no espaço da câmera, `o` os giros e a esquerda) a animação `t` no momento `u` (0–1) */
export function kukriPlay(t: KukTracks, u: number, pos: THREE.Vector3, o: KukOut) {
  pos.x += track(u, t.px);
  pos.y += track(u, t.py);
  pos.z += track(u, t.pz);
  o.ex += track(u, t.ex);
  o.ey += track(u, t.ey);
  o.ez += track(u, t.ez);
  o.pro += track(u, t.pro);
  o.roll += track(u, t.roll);
  o.lx += track(u, t.lx);
  o.ly += track(u, t.ly);
  o.lz += track(u, t.lz);
}

/**
 * Correndo (`sp`, 0–1) e na corrida tática (`tac`): correndo, o braço baixa e a lâmina deita apontando para a frente e
 * para baixo, balançando com o passo (`bob`); na tática, o punho sobe para perto do peito com a lâmina em pé, para
 * trás, e o balanço fica mais largo. Mexe na posição e no giro do braço no espaço da câmera (`e`).
 */
export function kukriRun(
  pos: THREE.Vector3,
  e: THREE.Vector3,
  sp: number,
  tac: number,
  run: number,
  bob: number,
  mo: number,
) {
  const pump = Math.sin(bob) * mo;
  pos.x += sp * 0.01 + tac * 0.01 + pump * 0.014 * run;
  pos.y += sp * -0.05 + tac * -0.01 + Math.abs(Math.cos(bob)) * -0.014 * run * mo;
  pos.z += sp * 0.02 + tac * 0.04 - pump * 0.015 * run;
  e.set(sp * -0.35 + tac * 0.3 + pump * 0.12 * run, sp * 0.1, sp * 0.5 + tac * -0.25);
}

/**
 * Saque (1000 ms; o jogo libera o golpe em 380 ms): o punho sobe de baixo à direita com a lâmina ainda deitada para
 * trás (saindo da bainha na cintura), o pulso vira a lâmina para cima e para a frente num arco, ela passa um pouco do
 * ponto com o peso e assenta na guarda. A esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const KUK_DRAW: KukTracks = {
  px: [[0, 0.06], [0.35, 0, 1], [1, 0]],
  py: [[0, -0.25], [0.35, 0.015, 1], [0.55, -0.01], [0.75, 0]],
  pz: [[0, 0.04], [0.35, 0, 1], [1, 0]],
  ex: [[0, 0.2], [0.4, 0.1], [0.7, 0]],
  ez: [[0, 1.8], [0.4, -0.25, 1], [0.6, 0.06], [0.78, 0]],
  ly: [[0, -0.22], [0.3, -0.22], [0.75, 0]],
  lz: [[0, 0.06], [0.3, 0.06], [0.75, 0]],
};

/**
 * Inspeção (3400 ms): o braço traz a kukri para o meio, a lâmina deitada mostrando a face inteira com a curva (pausa);
 * o antebraço gira e mostra a outra face, o fio para cima (pausa); volta, e um corte de ensaio no ar, curto e com peso,
 * antes de voltar para a guarda. A esquerda baixa, fora do caminho.
 */
// prettier-ignore
export const KUK_INSPECT: KukTracks = {
  px: [[0, 0], [0.12, -0.05], [0.32, -0.05], [0.44, -0.1], [0.62, -0.1], [0.7, 0.04, 2], [0.78, -0.05, 1], [0.92, 0]],
  py: [[0, 0], [0.12, -0.03], [0.32, -0.03], [0.44, -0.03], [0.62, -0.03], [0.7, 0.08, 2], [0.78, 0.04, 1], [0.92, 0]],
  pz: [[0, 0], [0.12, 0], [0.62, 0], [0.7, 0.01], [0.78, -0.04, 1], [0.92, 0]],
  ex: [[0, 0], [0.12, 1], [0.32, 1], [0.38, 0.7], [0.44, -0.645], [0.62, -0.645], [0.66, 0.7], [0.7, 0.45, 2], [0.78, 0, 1], [0.92, 0]],
  ey: [[0, 0], [0.12, -0.2], [0.32, -0.2], [0.38, 0.673], [0.44, 0.957], [0.62, 0.957], [0.66, 0.673], [0.7, 0, 2], [0.78, 0.45, 1], [0.92, 0]],
  ez: [[0, 0], [0.12, -0.2], [0.32, -0.2], [0.38, -0.694], [0.44, -2.172], [0.62, -2.172], [0.66, -0.694], [0.7, -0.95, 2], [0.78, 0.75, 1], [0.92, 0]],
  lx: [[0, 0], [0.1, -0.02], [0.86, -0.02], [1, 0]],
  ly: [[0, 0], [0.1, -0.05], [0.86, -0.05], [1, 0]],
};

/**
 * Golpe leve, de cima à direita para baixo à esquerda (640 ms; o acerto sai em 30%): o punho sobe e recua com o pulso
 * armado, a lâmina deitando para trás (antecipação); desce num arco que passa pelo meio da tela, segue com o peso e
 * volta. A esquerda sai do caminho.
 */
// prettier-ignore
export const KUK_CHOP_L: KukTracks = {
  px: [[0, 0], [0.2, 0.05, 2], [0.22, 0.05, 1], [0.3, -0.05, 1], [0.44, -0.1], [0.85, 0]],
  py: [[0, 0], [0.2, 0.1, 2], [0.22, 0.1, 1], [0.3, 0.05, 1], [0.44, -0.01], [0.85, 0]],
  pz: [[0, 0], [0.2, 0.01, 2], [0.22, 0.01, 1], [0.3, -0.05, 1], [0.44, -0.03], [0.85, 0]],
  ex: [[0, 0], [0.2, 0.45, 2], [0.22, 0.45, 1], [0.3, 0, 1], [0.44, -0.05], [0.85, 0]],
  ey: [[0, 0], [0.22, 0], [0.3, 0.45, 1], [0.44, 0.45], [0.85, 0]],
  ez: [[0, 0], [0.2, -0.95, 2], [0.22, -0.95, 1], [0.3, 0.75, 1], [0.44, 1.05], [0.85, 0]],
  lx: [[0, 0], [0.22, -0.04], [0.32, -0.09], [0.6, -0.09], [1, 0]],
  ly: [[0, 0], [0.22, -0.06], [0.32, -0.11], [0.6, -0.11], [1, 0]],
  lz: [[0, 0], [0.25, 0.05], [0.6, 0.05], [1, 0]],
};

/** golpe leve, o outro lado (alternando): o corte de cima, quase reto para baixo pelo meio da tela */
// prettier-ignore
export const KUK_CHOP_R: KukTracks = {
  px: [[0, 0], [0.2, -0.01, 2], [0.22, -0.01, 1], [0.3, -0.06, 1], [0.44, -0.08], [0.85, 0]],
  py: [[0, 0], [0.2, 0.14, 2], [0.22, 0.14, 1], [0.3, 0.06, 1], [0.44, -0.02], [0.85, 0]],
  pz: [[0, 0], [0.2, 0.02, 2], [0.22, 0.02, 1], [0.3, -0.06, 1], [0.44, -0.03], [0.85, 0]],
  ex: [[0, 0], [0.2, 0.5, 2], [0.22, 0.5, 1], [0.3, 0, 1], [0.44, -0.05], [0.85, 0]],
  ey: [[0, 0], [0.22, 0], [0.3, 0.35, 1], [0.44, 0.4], [0.85, 0]],
  ez: [[0, 0], [0.2, -1.2, 2], [0.22, -1.2, 1], [0.3, 0.5, 1], [0.44, 0.85], [0.85, 0]],
  lx: [[0, 0], [0.22, -0.04], [0.32, -0.09], [0.6, -0.09], [1, 0]],
  ly: [[0, 0], [0.22, -0.06], [0.32, -0.11], [0.6, -0.11], [1, 0]],
  lz: [[0, 0], [0.25, 0.05], [0.6, 0.05], [1, 0]],
};

/**
 * Golpe pesado (960 ms; o acerto sai em 45%): antecipação longa — o braço sobe por cima do ombro direito com a lâmina
 * deitada para trás —, corte de cima para baixo com o peso do corpo, passando pelo meio da tela no acerto, tranco forte,
 * segue até embaixo e volta devagar. A esquerda sai do caminho.
 */
// prettier-ignore
export const KUK_HEAVY: KukTracks = {
  px: [[0, 0], [0.36, 0.04, 2], [0.4, 0.04, 1], [0.46, -0.05, 1], [0.6, -0.11], [1, 0]],
  py: [[0, 0], [0.36, 0.1, 2], [0.4, 0.1, 1], [0.46, 0.06, 1], [0.6, -0.02], [1, 0]],
  pz: [[0, 0], [0.36, 0.01, 2], [0.4, 0.01, 1], [0.46, -0.07, 1], [0.6, -0.03], [1, 0]],
  ex: [[0, 0], [0.36, 0.65, 2], [0.4, 0.65, 1], [0.46, 0, 1], [0.6, -0.05], [1, 0]],
  ey: [[0, 0], [0.4, 0], [0.46, 0.5, 1], [0.6, 0.5], [1, 0]],
  ez: [[0, 0], [0.36, -1.3, 2], [0.4, -1.3, 1], [0.46, 0.75, 1], [0.6, 1.15], [1, 0]],
  lx: [[0, 0], [0.36, -0.05], [0.48, -0.1], [0.72, -0.1], [1, 0]],
  ly: [[0, 0], [0.36, -0.07], [0.48, -0.12], [0.72, -0.12], [1, 0]],
  lz: [[0, 0], [0.5, 0.06], [1, 0]],
};

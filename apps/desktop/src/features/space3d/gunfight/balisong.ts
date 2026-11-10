/**
 * Animações da balisong na primeira pessoa, em trilhas de chaves (dados puros; o `viewmodel.ts` aplica, como as da
 * karambit em `karambit.ts`). Todas partem da guarda (`KNIFE_POSE.balisong`: punho fechado nos dois cabos no canto de
 * baixo à direita, a lâmina para a frente e para o meio da tela, com a face à vista) e voltam para ela.
 *
 * Trilhas (todas opcionais, somadas à guarda): posição do braço no espaço da câmera (`px`, `py`, `pz`, m), giro do braço
 * em volta da faca no espaço da câmera (`ex`, `ey`, `ez`, rad), giro do antebraço (`pro`), quanto ela está fechada
 * (`shut`: 0 aberta, ½ com o cabo de morder já virado, 1 fechada — ver `setBalisong`), dedos soltos (`open`, 0–1) e a
 * mão esquerda de guarda (`lx`, `ly`, `lz`, m). Chaves e curvas como em `karambit.ts`.
 *
 * A mecânica: o cabo seguro fica na mão; o cabo de morder gira no pino dele (na lâmina) e a lâmina no pino do cabo
 * seguro, sempre no plano dos cabos e para o lado de fora (nunca atravessa o outro cabo; `setBalisong`). Fechada, a
 * pilha (cabos + lâmina dentro) fica 1,7 cm mais para o lado do cabo de morder: a faca escorrega esse tanto na mão
 * (`BAL_SHUT_Y`), para o punho fechado continuar em volta dela. Enquanto gira, os dedos abrem, o polegar fecha e a faca
 * descola da palma (`BAL_LIFT`): medido nas esferas da mão, o cabo e a lâmina passam livres da mão a volta inteira.
 * Escritas à mão (conferidas quadro a quadro no espelho da primeira pessoa), sem copiar animação de jogo nenhum.
 */
import type { Key } from './karambit';

export type BalTrack = 'px' | 'py' | 'pz' | 'ex' | 'ey' | 'ez' | 'pro' | 'shut' | 'open' | 'lx' | 'ly' | 'lz';
export type BalTracks = Partial<Record<BalTrack, readonly Key[]>>;

/** fechada, a pilha dos cabos fica este tanto para o lado do cabo de morder (y da faca, m): a faca desce na mão */
export const BAL_SHUT_Y = -0.0172;
/** girando, a faca descola da palma (x da faca, m; a palma fica do lado +x) e fica entre a base da palma e o polegar */
export const BAL_LIFT = -0.014;
/**
 * Os dedos enquanto a faca gira: meio fechados, sem cruzar o plano dos cabos, o polegar fechado por cima. Quando o cabo
 * de morder passa por baixo do punho, voltando para a mão (`balSpread`), os quatro esticam para ele passar, e fecham
 * de novo antes de ele encostar.
 */
export const BAL_FLIP_CURL = { fingers: 0.4, thumb: 1.4, index: 0.6 } as const;

const smooth = (u: number) => u * u * (3 - 2 * u);
const seg01 = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
/** quanto os dedos esticam (0–1) com a faca em `shut`: o cabo de morder passando por baixo do punho (shut 0,3–0,12) */
export const balSpread = (shut: number) => smooth(seg01(shut, 0.4, 0.3)) * (1 - smooth(seg01(shut, 0.12, 0.04)));

/**
 * De onde os dedos partem no encaixe do `setGun` ([dedos, polegar, indicador]; cada um fecha até encostar). O polegar
 * parte meio fechado: aberto (0,2, o das outras facas) ele já atravessava o topo dos cabos e o encaixe não o tirava.
 */
export const BAL_FIT_START: readonly [number, number, number] = [0.3, 0.5, 0.3];

/** quanto a pilha desce na mão para `shut` (0 aberta, 1 fechada): ela vai para o outro lado com a lâmina (2ª metade) */
export const balShift = (shut: number) => BAL_SHUT_Y * Math.min(1, Math.max(0, 2 * shut));

/**
 * Saque (1000 ms; o jogo libera o golpe antes): o punho sobe de baixo à direita com ela fechada; os dedos soltam, o
 * pulso arma e dá um tranco: o cabo de morder sai girando para fora (meia volta), o pulso volta e a lâmina com o cabo de
 * morder dá a volta pela frente até o cabo bater na mão; os dedos fecham (tranco) e o braço assenta na guarda passando
 * um pouco do ponto. A esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const BAL_DRAW: BalTracks = {
  px: [[0, 0.07], [0.2, 0.01, 1], [0.6, 0.01], [0.8, 0]],
  py: [[0, -0.25], [0.2, 0.01, 1], [0.6, 0.01], [0.72, -0.01], [0.86, 0]],
  pz: [[0, 0.04], [0.2, 0.02, 1], [0.6, 0.02], [0.8, 0]],
  ex: [[0, 0.5], [0.2, 0.05, 1], [0.6, 0.05], [0.8, 0]],
  ez: [[0, -0.4], [0.18, 0.1], [0.24, 0.22, 2], [0.36, -0.22, 1], [0.44, -0.16], [0.56, 0.12, 1], [0.66, 0.02], [0.84, 0]],
  shut: [[0, 1], [0.24, 1], [0.38, 0.5, 1], [0.42, 0.5], [0.56, 0, 2]],
  open: [[0, 0], [0.17, 0], [0.23, 1], [0.56, 1], [0.62, 0]],
  ly: [[0, -0.22], [0.3, -0.22], [0.75, 0]],
  lz: [[0, 0.06], [0.3, 0.06], [0.75, 0]],
};

/**
 * Inspeção (3400 ms): o braço traz a faca para mais perto e mais para o meio com a face toda virada para a câmera
 * (pausa); o antebraço gira e mostra a outra face (pausa); volta e faz o floreio: fecha (a lâmina volta pela frente para
 * dentro dos cabos, depois o cabo de morder) e abre de novo, cada meia volta com um tranco do pulso; os dedos pegam e o
 * braço volta para a guarda. A esquerda baixa, fora do caminho.
 */
// prettier-ignore
export const BAL_INSPECT: BalTracks = {
  px: [[0, 0], [0.1, -0.05], [0.88, -0.05], [1, 0]],
  py: [[0, 0], [0.1, 0.04], [0.88, 0.04], [1, 0]],
  pz: [[0, 0], [0.1, 0.07], [0.88, 0.07], [1, 0]],
  ex: [[0, 0], [0.1, 0.1], [0.26, 0.1], [0.38, 0], [0.46, 0], [0.52, 0], [0.88, 0], [1, 0]],
  ey: [[0, 0], [0.1, 0.25], [0.26, 0.3], [0.38, 0.3], [0.46, 0.3], [0.52, 0], [1, 0]],
  pro: [[0, 0], [0.1, -0.3], [0.26, -0.35], [0.38, 1.55], [0.46, 1.65], [0.53, 0], [1, 0]],
  ez: [[0, 0], [0.26, 0], [0.38, 0.8], [0.46, 0.8], [0.52, 0], [0.56, 0.15, 2], [0.62, -0.2, 1], [0.66, 0.15], [0.72, -0.15, 1], [0.76, 0.1], [0.82, -0.12, 1], [0.86, 0], [1, 0]],
  shut: [[0, 0], [0.56, 0], [0.62, 0.5, 1], [0.66, 0.5], [0.72, 1, 2], [0.76, 1], [0.82, 0.5, 1], [0.84, 0.5], [0.88, 0, 2]],
  open: [[0, 0], [0.53, 0], [0.56, 1], [0.88, 1], [0.92, 0]],
  lx: [[0, 0], [0.1, -0.02], [0.88, -0.02], [1, 0]],
  ly: [[0, 0], [0.1, -0.05], [0.88, -0.05], [1, 0]],
};

/**
 * Golpe leve da direita para a esquerda (400 ms; o acerto sai em 30%): o punho arma para a direita e para cima com a
 * ponta para trás (antecipação, ~60 ms), corta num arco rápido que cruza o meio da tela com o fio na frente, segue
 * desacelerando e volta. A esquerda desce e sai para a esquerda o bastante para o punho passar por cima dela com
 * ~2 cm de folga (antes ele encostava nela, 0,30–0,55).
 */
// prettier-ignore
export const BAL_SLASH_R: BalTracks = {
  px: [[0, 0], [0.16, 0.05, 2], [0.18, 0.05, 1], [0.3, -0.27, 1], [0.48, -0.35], [0.86, 0]],
  py: [[0, 0], [0.16, 0.07, 2], [0.18, 0.07, 1], [0.3, 0.03, 1], [0.48, -0.05], [0.86, 0]],
  pz: [[0, 0], [0.16, 0.04, 2], [0.18, 0.04, 1], [0.3, -0.05, 1], [0.48, -0.02], [0.86, 0]],
  ex: [[0, 0], [0.16, 0.3, 2], [0.18, 0.3, 1], [0.3, 0.1, 1], [0.48, 0.33], [0.86, 0]],
  ey: [[0, 0], [0.16, -0.1, 2], [0.18, -0.1, 1], [0.3, -0.25, 1], [0.48, -0.05], [0.86, 0]],
  ez: [[0, 0], [0.16, -1.19, 2], [0.18, -1.19, 1], [0.3, 0.76, 1], [0.48, 1.27], [0.86, 0]],
  lx: [[0, 0], [0.2, -0.09], [0.6, -0.09], [1, 0]],
  ly: [[0, 0], [0.2, -0.16], [0.6, -0.16], [1, 0]],
  lz: [[0, 0], [0.25, 0.06], [0.6, 0.06], [1, 0]],
};

/**
 * Golpe leve de volta (alternando): o revés. O punho cruza para a esquerda e para cima com a ponta virada para a
 * esquerda (antecipação), corta para a direita e para baixo cruzando o meio da tela no acerto, segue e volta. A
 * esquerda baixa e sai do caminho do braço.
 */
// prettier-ignore
export const BAL_SLASH_L: BalTracks = {
  px: [[0, 0], [0.16, -0.27, 2], [0.18, -0.27, 1], [0.3, -0.13, 1], [0.48, 0.03], [0.86, 0]],
  py: [[0, 0], [0.16, 0.06, 2], [0.18, 0.06, 1], [0.3, 0.01, 1], [0.48, -0.06], [0.86, 0]],
  pz: [[0, 0], [0.16, 0.0, 2], [0.18, 0.0, 1], [0.3, -0.06, 1], [0.48, -0.03], [0.86, 0]],
  ex: [[0, 0], [0.16, 0.63, 2], [0.18, 0.63, 1], [0.3, 0.03, 1], [0.48, -0.38], [0.86, 0]],
  ey: [[0, 0], [0.16, 0.51, 2], [0.18, 0.51, 1], [0.3, 0.07, 1], [0.48, -0.06], [0.86, 0]],
  ez: [[0, 0], [0.16, 0.38, 2], [0.18, 0.38, 1], [0.3, 0.5, 1], [0.48, 0.49], [0.86, 0]],
  lx: [[0, 0], [0.15, -0.04], [0.45, -0.04], [0.8, 0]],
  ly: [[0, 0], [0.15, -0.1], [0.45, -0.09], [0.8, 0]],
  lz: [[0, 0], [0.15, 0.04], [0.45, 0.05], [0.8, 0]],
};

/**
 * Golpe pesado (600 ms; o acerto sai em 45%): antecipação longa — o punho recua e sobe com a ponta erguida —, estocada
 * para a frente e para o meio da tela com a ponta na mira, tranco no fim, segura um instante e volta devagar. A
 * esquerda sai do caminho.
 */
// prettier-ignore
export const BAL_HEAVY: BalTracks = {
  px: [[0, 0], [0.32, 0.02, 2], [0.36, 0.02, 1], [0.48, -0.15, 1], [0.62, -0.16], [1, 0]],
  py: [[0, 0], [0.32, 0.05, 2], [0.36, 0.05, 1], [0.48, 0.06, 1], [0.62, 0.055], [1, 0]],
  pz: [[0, 0], [0.32, 0.06, 2], [0.36, 0.06, 1], [0.48, -0.1, 1], [0.62, -0.09], [1, 0]],
  ex: [[0, 0], [0.32, 0.88, 2], [0.36, 0.88, 1], [0.48, -0.29, 1], [0.62, -0.27], [1, 0]],
  ey: [[0, 0], [0.32, 0.55, 2], [0.36, 0.55, 1], [0.48, -0.2, 1], [0.62, -0.18], [1, 0]],
  ez: [[0, 0], [0.32, -0.26, 2], [0.36, -0.26, 1], [0.48, 0.01, 1], [0.62, 0.01], [1, 0]],
  lx: [[0, 0], [0.35, -0.04], [0.7, -0.05], [1, 0]],
  ly: [[0, 0], [0.35, -0.06], [0.7, -0.06], [1, 0]],
  lz: [[0, 0], [0.5, 0.06], [1, 0]],
};

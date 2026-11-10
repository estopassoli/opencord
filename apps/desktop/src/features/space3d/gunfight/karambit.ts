/**
 * Animações da karambit na primeira pessoa, em trilhas de chaves (dados puros; o `viewmodel.ts` aplica). Todas partem
 * da guarda (`KNIFE_POSE.karambit`: punho em pé à direita, argola em cima no indicador, a garra saindo por baixo e
 * curvando para o meio da tela) e voltam para ela.
 *
 * Trilhas (todas opcionais, somadas à guarda): posição do braço no espaço da câmera (`px`, `py`, `pz`, m), giro do braço
 * no espaço da câmera em volta da faca (`ex`, `ey`, `ez`, rad; `ez` gira no plano da tela, positivo no sentido
 * anti-horário), giro do antebraço (`pro`), giro da faca no indicador (`spin`, rad; negativo = para a frente), quanto a
 * argola escorrega para fora no indicador enquanto gira (`slide`, m, em `KAR_SLIDE`), dedos soltos (`open`, 0–1) e a mão
 * esquerda de guarda (`lx`, `ly`, `lz`, m).
 *
 * Cada chave é [fração da ação, valor, curva até a próxima]: 0 suave nas duas pontas, 1 sai rápido e chega devagar (o
 * golpe), 2 sai devagar e chega rápido (o fim da antecipação). Escritas à mão (conferidas quadro a quadro no espelho da
 * primeira pessoa), sem copiar animação de jogo nenhum.
 */

export type Key = readonly [number, number, (0 | 1 | 2)?];

export type KarTrack = 'px' | 'py' | 'pz' | 'ex' | 'ey' | 'ez' | 'pro' | 'spin' | 'slide' | 'open' | 'lx' | 'ly' | 'lz';
export type KarTracks = Partial<Record<KarTrack, readonly Key[]>>;

const ease = (u: number) => u * u * (3 - 2 * u);

/** o valor de uma trilha no momento `u` (0–1); antes da primeira chave, a primeira; depois da última, a última */
export function track(u: number, k: readonly Key[] | undefined): number {
  if (!k || k.length === 0) return 0;
  const first = k[0]!;
  if (u <= first[0]) return first[1];
  for (let i = 0; i + 1 < k.length; i++) {
    const a = k[i]!;
    const b = k[i + 1]!;
    if (u > b[0]) continue;
    const t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const c = a[2] ?? 0;
    const e = c === 1 ? 1 - (1 - t) ** 3 : c === 2 ? t * t * t : ease(t);
    return a[1] + (b[1] - a[1]) * e;
  }
  return k[k.length - 1]![1];
}

const TURN = Math.PI * 2;

/**
 * Para onde a argola escorrega no indicador (espaço da faca: ao longo da falange do meio, para a ponta do dedo). Girando
 * no lugar, o cabo passava pela palma e pelos dedos; com a argola 3 cm para fora, os outros dedos abertos, o polegar
 * fechado e o indicador mais dobrado segurando a argola, a volta inteira passa livre (medido com as esferas da mão).
 */
export const KAR_SLIDE: readonly [number, number, number] = [-0.73, -0.58, 0.37];
/** os dedos enquanto a faca gira: os três de baixo abertos, o polegar fechado e o indicador mais dobrado na argola */
export const KAR_SPIN_CURL = { fingers: 0.05, thumb: 1, index: 1.2 } as const;

/**
 * Saque (1000 ms; o jogo libera o golpe em 380 ms): o punho sobe de baixo à direita com a garra ainda para trás, para
 * um pouco acima da guarda e a faca dá uma volta inteira no indicador, para a frente, com os outros dedos soltos e a
 * face virada para a câmera; os dedos fecham (tranco) e o braço assenta na guarda passando um pouco do ponto. A
 * esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const KAR_DRAW: KarTracks = {
  px: [[0, 0.09], [0.24, 0, 1], [0.6, -0.01], [0.82, 0]],
  py: [[0, -0.26], [0.24, 0.03, 1], [0.58, 0.03], [0.74, -0.012], [0.86, 0]],
  pz: [[0, 0.05], [0.24, 0, 1], [0.8, 0]],
  ex: [[0, 0.7], [0.26, 0, 1], [0.58, 0], [0.74, 0.06], [0.88, 0]],
  ey: [[0, 0], [0.2, -0.35], [0.56, -0.35], [0.8, 0]],
  ez: [[0, -0.5], [0.26, 0, 1], [0.8, 0]],
  spin: [[0, 0], [0.24, 0], [0.54, -TURN], [1, -TURN]],
  slide: [[0, 0], [0.17, 0], [0.23, 0.03], [0.54, 0.03], [0.6, 0]],
  open: [[0, 0], [0.17, 0], [0.23, 1], [0.54, 1], [0.6, 0]],
  ly: [[0, -0.22], [0.3, -0.22], [0.75, 0]],
  lz: [[0, 0.06], [0.3, 0.06], [0.75, 0]],
};

/**
 * Inspeção (3400 ms): o braço traz a faca para mais perto e mais para o meio; o pulso deita a garra para a esquerda com a
 * face toda virada para a câmera (pausa), depois gira para o outro lado e deixa a garra pendurada, mostrando o dorso e a
 * outra face (pausa); volta ao meio e a faca dá duas voltas no indicador com um impulso para cima, os dedos pegam
 * (tranco) e o braço volta para a guarda. A esquerda baixa, fora do caminho. (Girar o antebraço para a outra face
 * escondia a lâmina atrás do punho.)
 */
// prettier-ignore
export const KAR_INSPECT: KarTracks = {
  px: [[0, 0], [0.1, -0.06], [0.86, -0.06], [1, 0]],
  py: [[0, 0], [0.1, 0.05], [0.6, 0.05], [0.66, 0.075, 1], [0.8, 0.06], [0.86, 0.05], [1, 0]],
  pz: [[0, 0], [0.1, 0.08], [0.86, 0.08], [1, 0]],
  ex: [[0, 0], [0.12, -0.5], [0.3, -0.5], [0.42, 0], [1, 0]],
  ey: [[0, 0], [0.12, 0.3], [0.3, 0.3], [0.42, -0.3], [0.86, -0.3], [1, 0]],
  ez: [[0, 0], [0.12, -0.5], [0.3, -0.5], [0.42, 0.8], [0.54, 0.8], [0.62, 0], [1, 0]],
  spin: [[0, 0], [0.62, 0], [0.82, -2 * TURN], [1, -2 * TURN]],
  slide: [[0, 0], [0.57, 0], [0.62, 0.03], [0.82, 0.03], [0.86, 0]],
  open: [[0, 0], [0.57, 0], [0.62, 1], [0.82, 1], [0.86, 0]],
  lx: [[0, 0], [0.1, -0.02], [0.86, -0.02], [1, 0]],
  ly: [[0, 0], [0.1, -0.05], [0.86, -0.05], [1, 0]],
};

/**
 * Golpe leve, da direita para a esquerda (450 ms; o acerto sai em 30%): o punho recua para a direita e para cima com o
 * pulso armado, a garra apontando para baixo (antecipação, ~80 ms); corta num arco rápido que cruza o meio da tela com
 * a ponta da garra na frente, segue desacelerando e volta.
 */
// prettier-ignore
export const KAR_SLASH_R: KarTracks = {
  px: [[0, 0], [0.18, 0.05, 2], [0.2, 0.05, 1], [0.32, -0.15, 1], [0.5, -0.24], [0.85, 0]],
  py: [[0, 0], [0.18, 0.05, 2], [0.2, 0.05, 1], [0.32, 0, 1], [0.5, -0.03], [0.85, 0]],
  pz: [[0, 0], [0.18, 0.03, 2], [0.2, 0.03, 1], [0.32, -0.05, 1], [0.5, -0.04], [0.85, 0]],
  ex: [[0, 0], [0.18, 0.2, 2], [0.2, 0.2, 1], [0.32, -0.4, 1], [0.5, -0.45], [0.85, 0]],
  ey: [[0, 0], [0.18, -0.2, 2], [0.2, -0.2, 1], [0.32, 0.5, 1], [0.5, 0.6], [0.85, 0]],
  ez: [[0, 0], [0.18, 0.5, 2], [0.2, 0.5, 1], [0.32, -0.45, 1], [0.5, -0.75], [0.85, 0]],
  lx: [[0, 0], [0.25, -0.05], [0.6, -0.05], [1, 0]],
  ly: [[0, 0], [0.25, -0.06], [0.6, -0.06], [1, 0]],
  lz: [[0, 0], [0.25, 0.05], [0.6, 0.05], [1, 0]],
};

/**
 * Golpe leve, o outro lado (alternando): o corte puxado. O punho cruza para cima e para a esquerda com a garra
 * apontando para a frente e a face para a câmera (antecipação); puxa forte para baixo e para a direita, o fio da curva
 * arrastando pelo meio da tela, segue e volta. O antebraço quase não gira (girando, ele deitava de lado na tela).
 */
// prettier-ignore
export const KAR_SLASH_L: KarTracks = {
  px: [[0, 0], [0.18, -0.12, 2], [0.2, -0.12, 1], [0.32, 0.02, 1], [0.5, 0.06], [0.85, 0]],
  py: [[0, 0], [0.18, 0.06, 2], [0.2, 0.06, 1], [0.32, -0.04, 1], [0.5, -0.07], [0.85, 0]],
  pz: [[0, 0], [0.18, 0.01, 2], [0.2, 0.01, 1], [0.32, -0.06, 1], [0.5, -0.04], [0.85, 0]],
  ex: [[0, 0], [0.18, -0.2, 2], [0.2, -0.2, 1], [0.32, 0.2, 1], [0.5, 0.25], [0.85, 0]],
  ey: [[0, 0], [0.18, 0.35, 2], [0.2, 0.35, 1], [0.32, 0.3, 1], [0.5, 0.2], [0.85, 0]],
  ez: [[0, 0], [0.18, -0.35, 2], [0.2, -0.35, 1], [0.32, 0.2, 1], [0.5, 0.3], [0.85, 0]],
  lx: [[0, 0], [0.15, -0.04], [0.45, -0.04], [0.8, 0]],
  ly: [[0, 0], [0.15, -0.06], [0.45, -0.05], [0.8, 0]],
  lz: [[0, 0], [0.15, 0.03], [0.45, 0.04], [0.8, 0]],
};

/**
 * Golpe pesado (675 ms; o acerto sai em 45%): antecipação longa — o punho sobe e recua com a garra virada para trás e
 * para cima —, gancho forte para baixo e para a esquerda passando pelo meio da tela, tranco no fim, segue mais um pouco
 * e volta devagar. A esquerda sai do caminho.
 */
// prettier-ignore
export const KAR_HEAVY: KarTracks = {
  px: [[0, 0], [0.33, -0.04, 2], [0.36, -0.04, 1], [0.5, -0.14, 1], [0.64, -0.16], [1, 0]],
  py: [[0, 0], [0.33, 0.045, 2], [0.36, 0.045, 1], [0.5, -0.03, 1], [0.64, -0.055], [1, 0]],
  pz: [[0, 0], [0.33, 0.01, 2], [0.36, 0.01, 1], [0.5, -0.08, 1], [0.64, -0.06], [1, 0]],
  ex: [[0, 0], [0.33, -0.45, 2], [0.36, -0.45, 1], [0.5, 0.2, 1], [0.64, 0.3], [1, 0]],
  ey: [[0, 0], [0.33, 0, 2], [0.36, 0, 1], [0.5, 0.4, 1], [0.64, 0.45], [1, 0]],
  ez: [[0, 0], [0.33, 0.6, 2], [0.36, 0.6, 1], [0.5, -0.6, 1], [0.64, -0.7], [1, 0]],
  lx: [[0, 0], [0.35, -0.04], [0.7, -0.05], [1, 0]],
  ly: [[0, 0], [0.35, -0.06], [0.7, -0.06], [1, 0]],
  lz: [[0, 0], [0.5, 0.06], [1, 0]],
};

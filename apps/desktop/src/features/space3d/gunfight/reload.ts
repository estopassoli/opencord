/**
 * Coreografia das recargas da primeira pessoa (puro: só números, testado). O viewmodel lê a pose de cada momento
 * `u` (0–1 da recarga) e põe pente, mãos e arma nela.
 *
 * Recarga de verdade (sem pôr o mesmo pente vazio de volta):
 * - tática (sobrou bala, fuzil/submetralhadora/sniper de pente longo): a mão de apoio pega o pente, puxa, guarda no
 *   colete (fora da tela, embaixo à esquerda), volta com um cheio (com os cartuchos à mostra), encaixa e dá o tranco;
 * - vazia: o pente vazio cai sozinho (solta e cai com a gravidade), a mão vai direto no porta-carregador, volta com
 *   um cheio, encaixa; depois o gesto da arma (retém, alavanca ou ferrolho, no `viewmodel`);
 * - pistola (sempre): o pente cai livre, a mão vai no cinto, volta com um cheio e encaixa por baixo do punho; vazia,
 *   o polegar solta o ferrolho;
 * - Kar98k (pente-lâmina): a direita abre o ferrolho, vai na cartucheira, volta com o pente-lâmina, encaixa no guia,
 *   o polegar empurra as balas (duas vezes), e o ferrolho fechando joga a lâmina vazia fora.
 *
 * Os momentos batem com os sons do `game.ts` (pente sai em 0,18, entra em 0,6; na Kar98k, ferrolho abre em 0,22,
 * empurrões em 0,46 e 0,58, fecha em 0,78) e a munição só entra no fim (`finishReload`).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (u: number) => u * u * (3 - 2 * u);
const seg = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
/** sobe em [a,b] e desce em [c,d] */
const hump = (u: number, a: number, b: number, c: number, d: number) => ease(seg(u, a, b)) * (1 - ease(seg(u, c, d)));

/** `tactical`: com bala (o pente velho vai para o colete); `drop`: vazio, ou pistola (o pente velho cai) */
export type ReloadStyle = 'tactical' | 'drop';

/** quando o pente velho sai (e cai, no `drop`) e quando o novo encaixa (u) */
export const MAG_OUT_AT = 0.18;
export const MAG_SEAT_AT = 0.6;

export interface ReloadPose {
  /** a arma inclina para o pente e a mão ficarem na tela (0–1) */
  tilt: number;
  /** a mão esquerda segue o pente (0 no apoio, 1 segurando o pente) */
  hold: number;
  /** o pente desce do poço (0 encaixado, 1 fora, embaixo do poço) */
  out: number;
  /** o pente (com a mão) vai até o colete/cinto, fora da tela (0 embaixo do poço, 1 lá) */
  pouch: number;
  /**
   * onde a mão está em relação ao pente (as mesmas medidas de `out` e `pouch`): igual ao pente quando ela o segura;
   * no vazio ela vai ao colete antes de o pente velho cair (e o novo espera lá)
   */
  handOut: number;
  handPouch: number;
  /** o pente na mão é o novo (cheio) */
  fresh: boolean;
  /** o pente velho já caiu (só no `drop`): o da arma some até a mão voltar com o novo */
  dropped: boolean;
  /** os dedos soltam o pente e a palma empurra a base no fim do encaixe (0–1) */
  palm: number;
}

/** a pose da recarga em `u` (escreve em `out`, sem alocar) */
export function reloadPose(style: ReloadStyle, u: number, out: ReloadPose = blankPose()): ReloadPose {
  out.tilt = hump(u, 0, 0.15, 0.85, 1);
  out.palm = hump(u, 0.54, 0.6, 0.62, 0.7);
  out.dropped = style === 'drop' && u >= MAG_OUT_AT;
  if (style === 'tactical') {
    // pega o pente (0,04–0,16), puxa (0,18–0,28), guarda no colete (0,28–0,4), traz o novo (0,4–0,52), encaixa
    // (0,52–0,6) e volta ao apoio (0,62–0,76)
    out.hold = ease(seg(u, 0.04, 0.16)) * (1 - ease(seg(u, 0.62, 0.76)));
    out.out = ease(seg(u, MAG_OUT_AT, 0.28)) * (1 - ease(seg(u, 0.52, MAG_SEAT_AT)));
    out.pouch = hump(u, 0.28, 0.4, 0.4, 0.52);
    out.fresh = u >= 0.4;
    out.handOut = out.out;
    out.handPouch = out.pouch;
    return out;
  }
  // o pente velho cai em 0,18; a mão já foi para o colete (0,08–0,3) e o novo está lá (fora da tela) até ela
  // chegar; volta (0,34–0,5), encaixa (0,5–0,6) e a mão volta ao apoio (0,62–0,74)
  out.hold = ease(seg(u, 0.08, 0.3)) * (1 - ease(seg(u, 0.62, 0.74)));
  out.out = u < MAG_OUT_AT ? 0 : 1 - ease(seg(u, 0.5, MAG_SEAT_AT));
  out.pouch = u < MAG_OUT_AT ? 0 : 1 - ease(seg(u, 0.34, 0.5));
  out.fresh = u >= MAG_OUT_AT;
  // antes de o velho cair a mão espera o novo embaixo do poço; depois, sobe junto com ele e a palma empurra a base até
  // encaixar (parada embaixo do poço, ela ficava aberta no ar e o pente subia sozinho)
  out.handOut = u < MAG_OUT_AT ? 1 : out.out;
  out.handPouch = u < MAG_OUT_AT ? 1 : out.pouch;
  return out;
}

export function blankPose(): ReloadPose {
  return { tilt: 0, hold: 0, out: 0, pouch: 0, handOut: 0, handPouch: 0, fresh: false, dropped: false, palm: 0 };
}

/** a recarga deste momento: vazia ou pistola → `drop`; com bala → `tactical` */
export function reloadStyle(empty: boolean, pistol: boolean): ReloadStyle {
  return empty || pistol ? 'drop' : 'tactical';
}

/** pente-lâmina (Kar98k), mão direita em tudo */
export interface ClipPose {
  tilt: number;
  /** a direita na alavanca do ferrolho (0 no punho, 1 na alavanca) */
  handle: number;
  /** a alavanca sobe (0–1) e o ferrolho vem para trás (0–1) */
  lift: number;
  back: number;
  /** a direita vai até a cartucheira, fora da tela (0–1) */
  pouch: number;
  /** a direita no pente-lâmina, em cima da janela (0–1) */
  clip: number;
  /** o pente-lâmina na mão (entre a cartucheira e o guia) ou no guia */
  clipShown: boolean;
  /** quantas balas já desceram (0–5) */
  stripped: number;
  /** o polegar empurrando (0–1) */
  press: number;
  /** a lâmina vazia sai voando (o ferrolho fechou e empurrou) */
  tossed: boolean;
}

export const CLIP_ROUNDS = 5;
/** os empurrões do polegar (batem com os sons `magIn` do game.ts) e quando a lâmina sai */
export const CLIP_PRESS = [0.46, 0.58] as const;
export const CLIP_TOSS_AT = 0.72;

export function clipPose(u: number, out: ClipPose = blankClip()): ClipPose {
  out.tilt = hump(u, 0, 0.12, 0.85, 1);
  // a alavanca: pega (0–0,08), sobe (0,08–0,16), vem para trás (0,16–0,24); fecha: vai (0,66–0,72), desce (0,74–0,8)
  out.lift = hump(u, 0.08, 0.16, 0.74, 0.8);
  out.back = hump(u, 0.16, 0.24, 0.66, 0.72);
  // a mão: alavanca → cartucheira (0,24–0,32) → pente-lâmina no guia (0,32–0,42) → empurra → alavanca (0,62–0,66)
  out.pouch = hump(u, 0.24, 0.32, 0.32, 0.42);
  out.clip = hump(u, 0.3, 0.42, 0.6, 0.66);
  out.handle = hump(u, 0, 0.08, 0.84, 0.94);
  // dois empurrões: o primeiro desce 3 balas, o segundo as 2 últimas
  const p1 = hump(u, CLIP_PRESS[0] - 0.04, CLIP_PRESS[0], CLIP_PRESS[0] + 0.01, CLIP_PRESS[0] + 0.04);
  const p2 = hump(u, CLIP_PRESS[1] - 0.04, CLIP_PRESS[1], CLIP_PRESS[1] + 0.01, CLIP_PRESS[1] + 0.04);
  out.press = Math.max(p1, p2);
  out.stripped =
    3 * ease(seg(u, CLIP_PRESS[0] - 0.04, CLIP_PRESS[0])) + 2 * ease(seg(u, CLIP_PRESS[1] - 0.04, CLIP_PRESS[1]));
  out.clipShown = u >= 0.3 && u < CLIP_TOSS_AT;
  out.tossed = u >= CLIP_TOSS_AT;
  return out;
}

export function blankClip(): ClipPose {
  return {
    tilt: 0,
    handle: 0,
    lift: 0,
    back: 0,
    pouch: 0,
    clip: 0,
    clipShown: false,
    stripped: 0,
    press: 0,
    tossed: false,
  };
}

/**
 * Revólver (Rhino, BFR): o tambor abre para a esquerda girando, a mão esquerda segura por baixo dele, vai ao cinto e
 * volta com o carregador rápido, empurra os cartuchos para dentro (a palma), solta, e o tambor fecha com um tranco.
 * Os momentos batem com os sons do `game.ts` (tambor sai em 0,18 — o mesmo do pente — e os cartuchos entram em 0,6).
 */
export interface CylinderPose {
  tilt: number;
  /** o tambor fora da armação (0 fechado, 1 aberto) e o giro dele (rad) */
  out: number;
  spin: number;
  /** a mão esquerda no tambor (0 no apoio, 1 segurando) */
  hold: number;
  /** a mão vai ao cinto e volta com o carregador rápido (0–1) */
  pouch: number;
  /** a palma empurra o carregador rápido (0–1) */
  palm: number;
}

export const CYL_CLOSE_AT = 0.8;

export function cylinderPose(u: number, out: CylinderPose = blankCylinder()): CylinderPose {
  out.tilt = hump(u, 0, 0.14, 0.86, 1);
  // abre (0,1–0,2) e fecha (0,74–0,8)
  out.out = ease(seg(u, 0.1, MAG_OUT_AT + 0.02)) * (1 - ease(seg(u, 0.74, CYL_CLOSE_AT)));
  // gira um pouco ao abrir e de novo ao fechar (a catraca)
  out.spin = 0.9 * ease(seg(u, 0.1, 0.3)) + 0.5 * ease(seg(u, 0.74, 0.86));
  out.hold = ease(seg(u, 0.06, 0.18)) * (1 - ease(seg(u, 0.8, 0.92)));
  out.pouch = hump(u, 0.3, 0.42, 0.44, 0.56);
  out.palm = hump(u, 0.56, MAG_SEAT_AT, 0.62, 0.7);
  return out;
}

export function blankCylinder(): CylinderPose {
  return { tilt: 0, out: 0, spin: 0, hold: 0, pouch: 0, palm: 0 };
}

/** onde a mão esquerda está neste quadro (os pesos do `update`), para saber se ela segura alguma coisa */
export interface LeftWhere {
  /** indo ao pente (0 no apoio, 1 nele) e se o pente está mesmo lá (1) ou a mão só vai para onde ele vai estar (0) */
  hold: number;
  with: number;
  /** o gesto da recarga vazia (0 no apoio, 1 na peça) */
  alt: number;
  /** solta, descendo para fora da tela */
  away: number;
  /** BFR: embaixo do tambor (−1 fora da recarga dela) */
  cradle: number;
  /** com o carregador rápido na mão (BFR, Rhino) */
  carry: number;
}

/**
 * Quanto a mão esquerda está no ar (0–1): o contrário do contato mais forte entre o apoio, o pente, a peça do gesto, o
 * tambor e o carregador rápido. O apoio solta logo que a mão sai dele; nos outros ela só "pega" no fim do caminho. No
 * ar ela fica meio fechada (`LEFT_TRANSIT` do viewmodel): aberta, os dedos espalhados apareciam no meio da tela no caminho ao colete,
 * na volta do encaixe, na troca de lado da inspeção, na chegada do saque e no cinto do revólver.
 */
export function leftFree(w: LeftWhere): number {
  const near = (v: number) => ease(seg(v, 0.8, 1));
  const left = (v: number, span: number) => 1 - ease(seg(v, 0, span));
  const cradle = Math.max(0, w.cradle);
  const support = left(w.hold, 0.25) * left(w.alt, 0.25) * left(w.away, 0.08) * left(cradle, 0.25);
  const mag = near(w.hold) * w.with;
  const part = near(w.alt);
  const drum = near(cradle) * left(w.carry, 0.25);
  return 1 - Math.min(1, Math.max(support, mag, part, drum, w.carry));
}

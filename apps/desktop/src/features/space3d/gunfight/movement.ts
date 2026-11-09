/**
 * Movimento do gunfight (puro, testável): andar, correr, corrida tática (dois toques no correr; dura pouco e recarrega),
 * agachar, deslizar (agachar correndo), cancelar o deslize (agachar de novo ou pular: levanta na hora e a corrida
 * tática volta cheia), pulo e bunny hop (pular no instante em que toca o chão mantém a velocidade, com um pouco de
 * controle no ar). A velocidade de cada arma e a mira mudam o ritmo.
 *
 * Limites (para nada virar velocidade infinita): o deslize tem teto (`slideMax`) e recarga (`slideCooldownMs`), a
 * tática recarrega aos poucos depois de acabar (por qualquer motivo) e o bunny hop não passa de `bhopMax` × arma.
 */
export const MOVE = {
  walk: 3.4,
  sprint: 5.4,
  tactical: 6.7,
  crouch: 1.8,
  /** mirando, a velocidade cai para isto */
  adsK: 0.55,
  accel: 30,
  airAccel: 7,
  gravity: 15,
  jumpV: 5,
  slideMin: 7.4,
  /** teto do deslize (m/s) e o tempo mínimo entre um deslize e o próximo (ms, a contar do começo) */
  slideMax: 7.8,
  slideCooldownMs: 600,
  slideMs: 750,
  slideEnd: 2.4,
  tacMs: 3000,
  /** tempo para encher a tática do zero (depois de `tacDelayMs` sem usar) */
  tacRechargeMs: 4000,
  tacDelayMs: 800,
  /** janela para o segundo toque do correr (ms) e para guardar o pulo antes de tocar o chão */
  doubleTapMs: 320,
  jumpBufferMs: 140,
  /** teto do bunny hop (m/s, vezes a velocidade da arma): um pouco acima da tática */
  bhopMax: 7.1,
  bhopGain: 1.02,
  bhopLoss: 0.94,
} as const;

export interface MoveState {
  vx: number;
  vz: number;
  vy: number;
  y: number;
  grounded: boolean;
  crouch: boolean;
  sprint: boolean;
  tactical: boolean;
  /** deslizando até (ms) e quando começou o último deslize */
  slideUntil: number;
  slideAt: number;
  /** velocidade no começo do deslize (a queda é em linha a partir dela, igual em qualquer FPS) */
  slideV0: number;
  /** corrida tática: quanto resta (ms) e quando acabou (para recarregar) */
  tacLeft: number;
  tacEmptyAt: number;
  /** último toque no correr (dois toques = tática) e último pedido de pulo (guardado) */
  runTapAt: number;
  jumpAt: number;
}

export function newMove(): MoveState {
  return {
    vx: 0,
    vz: 0,
    vy: 0,
    y: 0,
    grounded: true,
    crouch: false,
    sprint: false,
    tactical: false,
    slideUntil: 0,
    slideAt: -1e9,
    slideV0: 0,
    tacLeft: MOVE.tacMs,
    tacEmptyAt: 0,
    runTapAt: -1e9,
    jumpAt: -1e9,
  };
}

export interface MoveInput {
  /** direção desejada no mundo (já girada pela câmera), comprimento 0–1 */
  wx: number;
  wz: number;
  runHeld: boolean;
  /** frente pura (correr só vale andando para a frente) */
  forward: boolean;
  ads: boolean;
  /** multiplicador da arma (GunSpec.move) */
  gunK: number;
  /** atirando agora (corta a corrida) */
  firing: boolean;
}

export const sliding = (s: MoveState, now: number) => now < s.slideUntil;

/**
 * Apertou correr: corre (agachado no chão, levanta); dois toques seguidos (com fôlego) ligam a corrida tática. Segurar
 * já corre sozinho no `stepMove`. Devolve se a tática ligou agora
 */
export function pressRun(s: MoveState, now: number): boolean {
  const was = s.tactical;
  if (s.crouch && s.grounded && !sliding(s, now)) s.crouch = false;
  if (now - s.runTapAt < MOVE.doubleTapMs && s.tacLeft > 300) s.tactical = true;
  s.runTapAt = now;
  s.sprint = true;
  return s.tactical && !was;
}

/** a corrida tática acabou (soltou, parou, atirou, deslizou ou esvaziou): a recarga conta daqui */
function endTactical(s: MoveState, now: number) {
  if (!s.tactical) return;
  s.tactical = false;
  s.tacEmptyAt = now;
}

/** apertou agachar: correndo no chão desliza; deslizando, cancela; senão alterna agachado */
export function pressCrouch(s: MoveState, now: number): 'slide' | 'cancel' | 'crouch' | 'stand' {
  const speed = Math.hypot(s.vx, s.vz);
  if (sliding(s, now)) {
    cancelSlide(s, now);
    return 'cancel';
  }
  if (s.grounded && s.sprint && speed > MOVE.walk && now - s.slideAt >= MOVE.slideCooldownMs) {
    const k = Math.min(MOVE.slideMax, Math.max(MOVE.slideMin, speed + 1.2)) / (speed || 1);
    s.vx *= k;
    s.vz *= k;
    s.slideV0 = Math.hypot(s.vx, s.vz);
    s.slideUntil = now + MOVE.slideMs;
    s.slideAt = now;
    s.crouch = true;
    s.sprint = false;
    endTactical(s, now);
    return 'slide';
  }
  s.crouch = !s.crouch;
  return s.crouch ? 'crouch' : 'stand';
}

/** cancelar o deslize: levanta, volta a correr e a corrida tática recarrega na hora (o "slide cancel") */
export function cancelSlide(s: MoveState, _now: number) {
  s.slideUntil = 0;
  s.crouch = false;
  s.sprint = true;
  s.tacLeft = MOVE.tacMs;
}

/** apertou pular (guardado por um instante: no ar, vale quando tocar o chão — o bunny hop) */
export function pressJump(s: MoveState, now: number): boolean {
  s.jumpAt = now;
  if (sliding(s, now)) cancelSlide(s, now);
  if (!s.grounded) return false;
  doJump(s);
  return true;
}

function doJump(s: MoveState) {
  s.vy = MOVE.jumpV;
  s.grounded = false;
  s.crouch = false;
  s.jumpAt = -1e9;
}

/** um passo: devolve o deslocamento (dx, dz) e se aterrissou neste quadro (e se foi bunny hop) */
export function stepMove(s: MoveState, inp: MoveInput, dt: number, now: number) {
  // o deslize acabou sozinho: segurando o correr, levanta e volta a correr; senão fica agachado
  if (s.slideUntil && now >= s.slideUntil) {
    s.slideUntil = 0;
    if (inp.runHeld) s.crouch = false;
  }
  const slide = sliding(s, now);
  const wl = Math.hypot(inp.wx, inp.wz);
  // correr só andando para a frente, sem mirar nem atirar; segurar o correr liga (inclusive depois de atirar ou
  // mirar, ou apertando o correr antes do W); a tática gasta e recarrega
  const canRun = inp.runHeld && inp.forward && !inp.ads && !inp.firing && !s.crouch;
  if (!slide) s.sprint = canRun && (s.sprint || s.grounded);
  if (!s.sprint) endTactical(s, now);
  if (s.tactical) {
    s.tacLeft -= dt * 1000;
    if (s.tacLeft <= 0) {
      s.tacLeft = 0;
      endTactical(s, now);
    }
  } else if (s.tacLeft < MOVE.tacMs && now - s.tacEmptyAt > MOVE.tacDelayMs)
    s.tacLeft = Math.min(MOVE.tacMs, s.tacLeft + (dt * 1000 * MOVE.tacMs) / MOVE.tacRechargeMs);

  let landed = false;
  let bhop = false;
  if (slide) {
    // deslizando: perde velocidade em linha (da velocidade do começo até o fim, sem depender do FPS)
    const sp = Math.hypot(s.vx, s.vz);
    const left = (s.slideUntil - now) / MOVE.slideMs;
    const want = MOVE.slideEnd + (s.slideV0 - MOVE.slideEnd) * Math.max(0, left);
    const k = sp > 0 ? Math.max(0, Math.min(sp, want)) / sp : 0;
    s.vx *= k;
    s.vz *= k;
  } else if (s.grounded) {
    const top =
      (s.crouch ? MOVE.crouch : s.tactical ? MOVE.tactical : s.sprint ? MOVE.sprint : MOVE.walk) *
      inp.gunK *
      (inp.ads ? MOVE.adsK : 1);
    const tx = wl > 0 ? (inp.wx / wl) * top * Math.min(1, wl) : 0;
    const tz = wl > 0 ? (inp.wz / wl) * top * Math.min(1, wl) : 0;
    // exponencial: o tempo até a velocidade de cima é o mesmo a 30 e a 240 qps
    const a = 1 - Math.exp(-MOVE.accel * 0.25 * Math.max(0, dt));
    s.vx += (tx - s.vx) * a;
    s.vz += (tz - s.vz) * a;
  } else if (wl > 0) {
    // no ar: um pouco de controle, sem frear (e sem passar do teto, que acompanha o peso da arma)
    const before = Math.hypot(s.vx, s.vz);
    s.vx += (inp.wx / wl) * MOVE.airAccel * dt;
    s.vz += (inp.wz / wl) * MOVE.airAccel * dt;
    const sp = Math.hypot(s.vx, s.vz);
    const cap = Math.max(before, MOVE.bhopMax * inp.gunK);
    if (sp > cap) {
      s.vx *= cap / sp;
      s.vz *= cap / sp;
    }
  }
  if (!s.grounded) {
    s.vy -= MOVE.gravity * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
      s.grounded = true;
      landed = true;
      // pulo guardado: sai de novo na hora, sem perder (e ganhando um pouco de) velocidade
      if (now - s.jumpAt < MOVE.jumpBufferMs) {
        const sp = Math.hypot(s.vx, s.vz);
        // abaixo do teto ganha um pouco; acima (vindo de um deslize) perde a cada pulo
        const cap = MOVE.bhopMax * inp.gunK;
        const k = sp <= 0 ? 1 : sp > cap ? MOVE.bhopLoss : Math.min(cap, sp * MOVE.bhopGain) / sp;
        s.vx *= k;
        s.vz *= k;
        doJump(s);
        bhop = true;
      }
    }
  }
  return { dx: s.vx * dt, dz: s.vz * dt, landed, bhop };
}

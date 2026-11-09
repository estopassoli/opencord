/**
 * Movimento do gunfight (puro, testável): andar, correr, corrida tática (dois toques no correr; dura pouco e recarrega),
 * agachar, deslizar (agachar correndo), cancelar o deslize (agachar de novo ou pular: levanta na hora e a corrida
 * tática volta cheia), pulo e bunny hop (pular no instante em que toca o chão mantém a velocidade, com um pouco de
 * controle no ar). A velocidade de cada arma e a mira mudam o ritmo.
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
  slideMs: 750,
  slideEnd: 2.4,
  tacMs: 3000,
  tacRechargeMs: 4000,
  /** janela para o segundo toque do correr (ms) e para guardar o pulo antes de tocar o chão */
  doubleTapMs: 320,
  jumpBufferMs: 140,
  bhopMax: 8.6,
  bhopGain: 1.03,
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
  /** deslizando até (ms) */
  slideUntil: number;
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

/** apertou correr (dois toques rápidos = corrida tática) */
export function pressRun(s: MoveState, now: number) {
  if (now - s.runTapAt < MOVE.doubleTapMs && s.tacLeft > 300) s.tactical = true;
  s.runTapAt = now;
  s.sprint = true;
}

/** apertou agachar: correndo no chão desliza; deslizando, cancela; senão alterna agachado */
export function pressCrouch(s: MoveState, now: number): 'slide' | 'cancel' | 'crouch' | 'stand' {
  const speed = Math.hypot(s.vx, s.vz);
  if (sliding(s, now)) {
    cancelSlide(s, now);
    return 'cancel';
  }
  if (s.grounded && s.sprint && speed > MOVE.walk) {
    const k = Math.max(MOVE.slideMin, speed + 1.2) / (speed || 1);
    s.vx *= k;
    s.vz *= k;
    s.slideUntil = now + MOVE.slideMs;
    s.crouch = true;
    s.sprint = false;
    s.tactical = false;
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
  const slide = sliding(s, now);
  const wl = Math.hypot(inp.wx, inp.wz);
  // correr só andando para a frente, sem mirar nem atirar; a tática gasta e recarrega
  if (!inp.runHeld || !inp.forward || inp.ads || inp.firing || s.crouch) {
    if (!slide) s.sprint = s.sprint && inp.runHeld && inp.forward && !inp.ads && !inp.firing && !s.crouch;
  }
  if (!s.sprint) s.tactical = false;
  if (s.tactical) {
    s.tacLeft -= dt * 1000;
    if (s.tacLeft <= 0) {
      s.tactical = false;
      s.tacEmptyAt = now;
      s.tacLeft = 0;
    }
  } else if (s.tacLeft < MOVE.tacMs && now - s.tacEmptyAt > MOVE.tacRechargeMs) s.tacLeft = MOVE.tacMs;

  let landed = false;
  let bhop = false;
  if (slide) {
    // deslizando: perde velocidade em linha até o fim; dá para virar pouco
    const sp = Math.hypot(s.vx, s.vz);
    const left = (s.slideUntil - now) / MOVE.slideMs;
    const want = MOVE.slideEnd + (sp - MOVE.slideEnd) * Math.max(0, left);
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
    const a = Math.min(1, MOVE.accel * dt * 0.25);
    s.vx += (tx - s.vx) * a;
    s.vz += (tz - s.vz) * a;
  } else if (wl > 0) {
    // no ar: um pouco de controle, sem frear
    s.vx += (inp.wx / wl) * MOVE.airAccel * dt;
    s.vz += (inp.wz / wl) * MOVE.airAccel * dt;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > MOVE.bhopMax) {
      s.vx *= MOVE.bhopMax / sp;
      s.vz *= MOVE.bhopMax / sp;
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
        const k = sp > 0 ? Math.min(MOVE.bhopMax, sp * MOVE.bhopGain) / sp : 1;
        s.vx *= k;
        s.vz *= k;
        doJump(s);
        bhop = true;
      }
    }
  }
  return { dx: s.vx * dt, dz: s.vz * dt, landed, bhop };
}

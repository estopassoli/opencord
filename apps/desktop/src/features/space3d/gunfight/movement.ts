/**
 * Movimento do gunfight (puro, testável): andar, correr (um toque no correr liga, sem segurar), corrida tática (outro
 * toque correndo), vigor, agachar, deslizar (agachar correndo), cancelar o deslize (agachar de novo ou pular: levanta
 * na hora e volta a correr), pulo e bunny hop (pular no instante em que toca o chão mantém a velocidade, com um pouco
 * de controle no ar). A velocidade de cada arma e a mira mudam o ritmo.
 *
 * Correr fica ligado enquanto anda para a frente; parar de andar para a frente, mirar, atirar, agachar ou deslizar
 * desliga (segurar o correr continua valendo, como antes). O vigor (0–1) gasta correndo — rápido na tática, devagar na
 * normal — e volta sozinho depois de um tempo sem correr: a tática acaba em `tacFloor` (cai para a corrida) e a
 * corrida acaba em zero (cai para o andar). Tudo por tempo (dt), igual em qualquer FPS.
 *
 * Limites (para nada virar velocidade infinita): o deslize tem teto (`slideMax`) e recarga (`slideCooldownMs`), o
 * vigor não volta durante o encadeamento deslize → correr (a espera é maior que o deslize) e o bunny hop não passa de
 * `bhopMax` × arma.
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
  /** vigor: tempo (ms) para gastar de cheio a vazio na tática e na corrida normal */
  tacDrainMs: 5000,
  sprintDrainMs: 9000,
  /** a tática acaba neste vigor (cai para a corrida; de cheio, ~3,5 s de tática) e só liga com pelo menos `tacMin` */
  tacFloor: 0.3,
  tacMin: 0.45,
  /** cansado (vigor zerado), só volta a correr com isto */
  runMin: 0.15,
  /** o vigor volta depois de `regenDelayMs` sem correr, de vazio a cheio em `regenMs` */
  regenDelayMs: 1000,
  regenMs: 4500,
  /** apertou correr parado (ou mirando): o pedido vale por este tempo, à espera do W */
  runArmMs: 600,
  /** janela para guardar o pulo antes de tocar o chão */
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
  /** vigor (0–1) e a última vez que gastou (a volta espera `regenDelayMs` a contar daqui) */
  stamina: number;
  tiredAt: number;
  /** correr ligado pelo toque (sem segurar) e quando foi o toque */
  runOn: boolean;
  runArmAt: number;
  /** último pedido de pulo (guardado) */
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
    stamina: 1,
    tiredAt: -1e9,
    runOn: false,
    runArmAt: -1e9,
    jumpAt: -1e9,
  };
}

export interface MoveInput {
  /** direção desejada no mundo (já girada pela câmera), comprimento 0–1 */
  wx: number;
  wz: number;
  /** segurando o correr (também corre; o toque sozinho já liga, ver `pressRun`) */
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
 * Apertou correr (um toque, sem segurar): liga a corrida (agachado no chão, levanta); já correndo, liga a tática (se
 * houver vigor). Devolve se a tática ligou agora
 */
export function pressRun(s: MoveState, now: number): boolean {
  if (s.crouch && s.grounded && !sliding(s, now)) s.crouch = false;
  if (s.sprint && !s.tactical) {
    if (s.stamina < MOVE.tacMin) return false;
    s.tactical = true;
    return true;
  }
  if (!s.sprint) {
    s.runOn = true;
    s.runArmAt = now;
  }
  return false;
}

/** para de correr de vez (atirou): o toque precisa ser dado de novo */
export function stopRun(s: MoveState) {
  s.sprint = false;
  s.tactical = false;
  s.runOn = false;
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
    stopRun(s);
    return 'slide';
  }
  s.crouch = !s.crouch;
  return s.crouch ? 'crouch' : 'stand';
}

/** cancelar o deslize: levanta e volta a correr na hora (o "slide cancel"; o vigor não volta de graça) */
export function cancelSlide(s: MoveState, now: number) {
  s.slideUntil = 0;
  s.crouch = false;
  s.sprint = s.stamina > 0;
  s.runOn = true;
  s.runArmAt = now;
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
  // o deslize acabou sozinho: com o correr ligado (ou segurado), levanta e volta a correr; senão fica agachado
  if (s.slideUntil && now >= s.slideUntil) {
    s.slideUntil = 0;
    if (inp.runHeld || s.runOn) s.crouch = false;
  }
  const slide = sliding(s, now);
  const wl = Math.hypot(inp.wx, inp.wz);
  if (!slide) {
    // correr só andando para a frente, sem mirar nem atirar; ligado pelo toque (ou segurando); cansado, só volta com
    // um pouco de vigor
    const was = s.sprint;
    const ok = (inp.runHeld || s.runOn) && inp.forward && !inp.ads && !inp.firing && !s.crouch && s.stamina > 0;
    s.sprint = ok && (was || (s.grounded && s.stamina >= MOVE.runMin));
    // parou de correr (soltou o W, mirou, atirou, agachou): o toque desliga; o pedido sem correr expira
    if (s.runOn && !s.sprint && (was || now - s.runArmAt > MOVE.runArmMs)) s.runOn = false;
  }
  if (!s.sprint || s.stamina <= MOVE.tacFloor) s.tactical = false;
  if (s.sprint) {
    s.stamina -= (dt * 1000) / (s.tactical ? MOVE.tacDrainMs : MOVE.sprintDrainMs);
    s.tiredAt = now;
    if (s.stamina <= MOVE.tacFloor) s.tactical = false;
    if (s.stamina <= 0) {
      // sem vigor: volta a andar (e o toque precisa ser dado de novo)
      s.stamina = 0;
      stopRun(s);
    }
  } else if (s.stamina < 1 && now - s.tiredAt > MOVE.regenDelayMs)
    s.stamina = Math.min(1, s.stamina + (dt * 1000) / MOVE.regenMs);

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

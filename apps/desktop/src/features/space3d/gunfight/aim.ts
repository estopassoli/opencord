/**
 * Mira do gunfight com o mouse cru: o mouse preso pede `unadjustedMovement` (sem a aceleração e a velocidade do
 * ponteiro do sistema — no Windows, sem o "aumentar a precisão do ponteiro"), e cada contagem do mouse gira sempre o
 * mesmo ângulo (graus por contagem, como nos jogos de tiro), sem depender do FPS nem do tamanho da janela. Mirando, a
 * conta cai com o zoom (pela tangente do campo de visão) e ainda tem o multiplicador "Sensibilidade mirando".
 *
 * Onde o pedido cru não existe (Linux, navegador antigo), a trava normal é usada: o movimento então vem com a
 * aceleração do sistema, como no cursor.
 */

export interface AimSettings {
  /** sensibilidade (na escala dos jogos de tiro: 1 = 0,022° por contagem do mouse) */
  sens: number;
  /** multiplicador mirando (1 = só a queda pelo zoom) */
  adsSens: number;
}

export const AIM_DEFAULT: AimSettings = { sens: 5, adsSens: 1 };
export const SENS_RANGE = { min: 0.5, max: 15, step: 0.1 } as const;
export const ADS_SENS_RANGE = { min: 0.4, max: 1.6, step: 0.05 } as const;
/** graus por contagem com sensibilidade 1 */
export const DEG_PER_COUNT = 0.022;

const AIM_KEY = 'opencord.space3d.aim';

const clampTo = (v: unknown, r: { min: number; max: number }, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : d;

/** ajuste salvo (pode vir estragado ou de outra versão): cada valor volta para dentro da faixa */
export function validAim(raw: unknown): AimSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sens: clampTo(src.sens, SENS_RANGE, AIM_DEFAULT.sens),
    adsSens: clampTo(src.adsSens, ADS_SENS_RANGE, AIM_DEFAULT.adsSens),
  };
}

export function loadAim(): AimSettings {
  try {
    const raw = localStorage.getItem(AIM_KEY);
    if (raw) return validAim(JSON.parse(raw));
  } catch {
    /* sem armazenamento (ou salvo estragado): o padrão */
  }
  return { ...AIM_DEFAULT };
}

export function saveAim(a: AimSettings) {
  try {
    localStorage.setItem(AIM_KEY, JSON.stringify(a));
  } catch {
    /* sem armazenamento */
  }
}

/**
 * Quanto a câmera gira (rad) com um movimento do mouse: `zoomK` é a queda pelo zoom (tangente do campo de visão atual
 * sobre a do campo sem mirar; 1 sem mirar) e `adsFrac` o quanto está mirando (0–1, aplica o multiplicador aos poucos).
 * Horizontal e vertical na mesma conta.
 */
export function lookDelta(mx: number, my: number, zoomK: number, adsFrac: number, a: AimSettings) {
  const ads = 1 + (a.adsSens - 1) * Math.max(0, Math.min(1, adsFrac));
  const k = ((a.sens * DEG_PER_COUNT * Math.PI) / 180) * zoomK * ads;
  return { yaw: -mx * k, pitch: my * k };
}

/** o pedido cru funcionou (true), não existe aqui (false) ou ainda não se sabe (null) */
let raw: boolean | null = null;
export const rawMouse = () => raw;

/**
 * Prende o mouse pedindo o movimento cru; se o sistema não tiver (NotSupportedError), pede a trava normal e não tenta
 * o cru de novo. `onFail` recebe as outras recusas (sem gesto, cedo demais depois do Esc), `onRaw` o resultado do cru.
 */
export function lockPointerRaw(el: HTMLElement, onFail: () => void, onRaw?: (ok: boolean) => void) {
  const plain = () => {
    try {
      void (el.requestPointerLock() as Promise<void> | undefined)?.catch?.(onFail);
    } catch {
      onFail();
    }
  };
  const unsupported = () => {
    raw = false;
    onRaw?.(false);
    plain();
  };
  if (raw === false) return plain();
  let r: Promise<void> | undefined;
  try {
    r = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
  } catch (e) {
    // implementações antigas jogam na hora em vez de recusar a promessa
    if (e instanceof DOMException && e.name === 'NotSupportedError') return unsupported();
    throw e;
  }
  // sem promessa (API antiga, sem o cru): fica a trava que veio
  if (!r || typeof r.then !== 'function') {
    raw = false;
    onRaw?.(false);
    return;
  }
  r.then(
    () => {
      raw = true;
      // a trava chegou depois de a cena ser trocada (ao entrar no espaço, a tela pode ser montada de novo): o mouse
      // ficaria preso num elemento que não está mais na página, sem cursor e com o menu aberto
      if (!el.isConnected && document.pointerLockElement === el) document.exitPointerLock();
      onRaw?.(true);
    },
    (e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotSupportedError') unsupported();
      else onFail();
    },
  );
}

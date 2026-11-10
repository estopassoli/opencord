/**
 * Atalhos globais com nova tentativa. O Windows deixa um atalho com um programa só: se outro já usa (outra cópia do
 * OpenCord, um gravador de tela), o registro falha. Antes ficava assim até reabrir o app, mesmo depois de o outro
 * fechar; agora os que falharam são tentados de novo a cada poucos segundos e voltam sozinhos quando ficam livres.
 *
 * Não depende do Electron (`globalShortcut` entra por `register`), para dar para testar.
 */
export interface ShortcutApi<A extends string> {
  /** registra o atalho; `false` se outro programa já usa */
  register(accel: string, fire: () => void): boolean;
  unregisterAll(): void;
  /** chamado quando a ação dispara */
  fire(action: A): void;
  /** depois de tirar tudo (o atalho de emergência do controle remoto volta por aqui) */
  afterReset?(): void;
  /** um atalho que tinha falhado acabou de ser registrado */
  recovered?(accel: string): void;
}

export const SHORTCUT_RETRY_MS = 5_000;

export class ShortcutRegistry<A extends string> {
  private pending = new Map<string, A>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: ShortcutApi<A>,
    private readonly retryMs = SHORTCUT_RETRY_MS,
  ) {}

  /** troca todos os atalhos; devolve os que entraram e os que já estão em uso */
  set(map: Partial<Record<A, string | null>>): { registered: string[]; failed: string[] } {
    this.stopRetry();
    this.pending.clear();
    this.api.unregisterAll();
    const registered: string[] = [];
    const failed: string[] = [];
    for (const [action, accel] of Object.entries(map) as [A, string | null][]) {
      if (!accel) continue;
      const r = this.tryRegister(accel, action);
      if (r === 'ok') registered.push(accel);
      else {
        failed.push(accel);
        if (r === 'busy') this.pending.set(accel, action);
      }
    }
    this.api.afterReset?.();
    if (this.pending.size) {
      this.timer = setInterval(() => this.retry(), this.retryMs);
      this.timer.unref?.();
    }
    return { registered, failed };
  }

  /** atalhos esperando ficar livres */
  get waiting(): string[] {
    return [...this.pending.keys()];
  }

  /** tenta de novo os que falharam (o intervalo chama sozinho) */
  retry() {
    for (const [accel, action] of this.pending) {
      if (this.tryRegister(accel, action) !== 'ok') continue;
      this.pending.delete(accel);
      this.api.recovered?.(accel);
    }
    if (!this.pending.size) this.stopRetry();
  }

  dispose() {
    this.stopRetry();
    this.pending.clear();
    this.api.unregisterAll();
  }

  private tryRegister(accel: string, action: A): 'ok' | 'busy' | 'invalid' {
    try {
      return this.api.register(accel, () => this.api.fire(action)) ? 'ok' : 'busy';
    } catch {
      // acelerador inválido: não adianta tentar de novo
      return 'invalid';
    }
  }

  private stopRetry() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

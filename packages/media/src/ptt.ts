/**
 * Push-to-talk: mic aberto enquanto a tecla está pressionada, com atraso de soltura configurável
 * (evita cortar o fim das palavras). Teclas repetidas (auto-repeat) não reabrem o timer.
 */
export class PushToTalk {
  private pressed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private open = false;

  constructor(
    private readonly setMicOpen: (open: boolean) => void,
    private releaseDelayMs = 200,
  ) {}

  setReleaseDelay(ms: number) {
    this.releaseDelayMs = Math.max(0, ms);
  }

  down() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pressed) return;
    this.pressed = true;
    if (!this.open) {
      this.open = true;
      this.setMicOpen(true);
    }
  }

  up() {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pressed && this.open) {
        this.open = false;
        this.setMicOpen(false);
      }
    }, this.releaseDelayMs);
  }

  /** Perda de foco/blur: fechar imediatamente para nunca deixar o microfone aberto por engano. */
  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pressed = false;
    if (this.open) {
      this.open = false;
      this.setMicOpen(false);
    }
  }

  get isOpen() {
    return this.open;
  }
}

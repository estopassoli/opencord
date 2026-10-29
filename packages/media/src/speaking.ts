/**
 * Indicador de fala com histerese: liga rápido, desliga após um período de silêncio.
 * Evita flicker (DESIGN_SYSTEM: "indicador de fala com debounce").
 */
export class SpeakingDebouncer {
  private speaking = false;
  private lastLoud = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly onChange: (speaking: boolean) => void,
    private readonly holdMs = 300,
  ) {}

  /** Alimentar com o estado bruto (ex.: ActiveSpeakers do LiveKit ou nível > limiar). */
  update(rawSpeaking: boolean, now = Date.now()) {
    if (rawSpeaking) {
      this.lastLoud = now;
      if (!this.speaking) {
        this.speaking = true;
        this.onChange(true);
      }
      return;
    }
    if (this.speaking && now - this.lastLoud >= this.holdMs) {
      this.speaking = false;
      this.onChange(false);
    }
  }

  get value() {
    return this.speaking;
  }
}

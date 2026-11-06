/**
 * Memória dos clipes (ADR-0022): guarda os últimos N segundos já codificados. O vídeo fica em grupos que começam num
 * quadro-chave (só dá para começar um arquivo num quadro-chave); o áudio, em pedaços soltos.
 */

export interface StoredChunk {
  /** início, em microssegundos (relógio da captura) */
  ts: number;
  /** duração em microssegundos */
  dur: number;
  key: boolean;
  data: Uint8Array;
  /** configuração do decodificador em vigor (vai em todo quadro-chave e no primeiro pedaço de áudio) */
  config?: VideoDecoderConfig | AudioDecoderConfig;
}

/** teto de memória do buffer: acima disso o grupo mais antigo sai mesmo que a janela ainda não tenha passado */
export const RING_MAX_BYTES = 768 * 1024 * 1024;

export class ChunkRing {
  private gops: StoredChunk[][] = [];
  /** áudio por trilha (0 = a mistura; as outras, cada fonte) */
  private audio: StoredChunk[][] = [];
  private total = 0;

  constructor(
    private readonly windowUs: number,
    private readonly maxBytes = RING_MAX_BYTES,
  ) {}

  /** último instante recebido de cada trilha (diagnóstico de relógios) */
  lastVideoTs = 0;
  lastAudioTs = 0;
  audioIn = 0;

  pushVideo(c: StoredChunk) {
    this.lastVideoTs = c.ts;
    // sem quadro-chave no começo não há como decodificar: espera o primeiro
    if (c.key || !this.gops.length) {
      if (!c.key) return;
      this.gops.push([c]);
    } else this.gops[this.gops.length - 1]!.push(c);
    this.total += c.data.byteLength;
    this.trim(c.ts);
  }

  pushAudio(c: StoredChunk, track = 0) {
    if (track === 0) {
      this.lastAudioTs = c.ts;
      this.audioIn++;
    }
    // trilhas podem chegar fora de ordem (a 2 antes da 1): sem buracos no array, senão `trim` lê undefined
    while (this.audio.length <= track) this.audio.push([]);
    this.audio[track]!.push(c);
    this.total += c.data.byteLength;
    this.trim(c.ts);
  }

  /** descarta grupos que terminaram antes da janela (mantém sempre o grupo em andamento) */
  private dropGop() {
    const g = this.gops.shift();
    if (g) for (const c of g) this.total -= c.data.byteLength;
  }

  private trim(now: number) {
    const from = now - this.windowUs;
    while (this.gops.length > 1 && this.gops[1]![0]!.ts <= from) this.dropGop();
    // teto de memória: codificador sem quadros-chave (ou bitrate altíssimo) não pode crescer sem fim
    while (this.total > this.maxBytes && this.gops.length > 1) this.dropGop();
    if (this.total > this.maxBytes && this.gops.length === 1) {
      // um único grupo gigante: descarta e recomeça no próximo quadro-chave
      this.dropGop();
    }
    const start = this.gops[0]?.[0]?.ts ?? from;
    const cut = Math.min(from, start);
    for (const a of this.audio) while (a.length && a[0]!.ts + a[0]!.dur < cut) this.total -= a.shift()!.data.byteLength;
  }

  /** bytes guardados agora (para o limite de memória) */
  get bytes() {
    return this.total;
  }

  /**
   * Fotografia do que há para o clipe: vídeo a partir do quadro-chave mais recente que ainda deixe a janela inteira
   * (ou o mais antigo guardado) e o áudio do mesmo trecho. `base` é o início do clipe.
   */
  snapshot(): { base: number; video: StoredChunk[]; audio: StoredChunk[]; extra: StoredChunk[][] } | null {
    if (!this.gops.length) return null;
    const last = this.gops[this.gops.length - 1]!;
    const end = last[last.length - 1]!.ts;
    let i = 0;
    while (i < this.gops.length - 1 && this.gops[i + 1]![0]!.ts <= end - this.windowUs) i++;
    const video = this.gops.slice(i).flat();
    const base = video[0]!.ts;
    const [mix = [], ...extra] = this.audio.map((a) => a.filter((c) => c.ts >= base));
    return { base, video, audio: mix, extra };
  }

  /** o codificador recomeçou com outra configuração: o vídeo de antes não entra no mesmo arquivo do de depois */
  resetVideo() {
    while (this.gops.length) this.dropGop();
  }

  clear() {
    this.gops = [];
    this.audio = [];
    this.total = 0;
  }
}

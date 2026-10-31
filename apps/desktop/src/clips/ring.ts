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

export class ChunkRing {
  private gops: StoredChunk[][] = [];
  /** áudio por trilha (0 = a mistura; as outras, cada fonte) */
  private audio: StoredChunk[][] = [];

  constructor(private readonly windowUs: number) {}

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
    this.trim(c.ts);
  }

  pushAudio(c: StoredChunk, track = 0) {
    if (track === 0) {
      this.lastAudioTs = c.ts;
      this.audioIn++;
    }
    (this.audio[track] ??= []).push(c);
    this.trim(c.ts);
  }

  /** descarta grupos que terminaram antes da janela (mantém sempre o grupo em andamento) */
  private trim(now: number) {
    const from = now - this.windowUs;
    while (this.gops.length > 1 && this.gops[1]![0]!.ts <= from) this.gops.shift();
    const start = this.gops[0]?.[0]?.ts ?? from;
    const cut = Math.min(from, start);
    for (const a of this.audio) while (a.length && a[0]!.ts + a[0]!.dur < cut) a.shift();
  }

  /** bytes guardados agora (para o limite de memória) */
  get bytes() {
    let n = 0;
    for (const g of this.gops) for (const c of g) n += c.data.byteLength;
    for (const a of this.audio) for (const c of a) n += c.data.byteLength;
    return n;
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

  clear() {
    this.gops = [];
    this.audio = [];
  }
}

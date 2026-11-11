/**
 * H.264 do encoder da placa (Annex B, separado por 00 00 01) → o formato do MP4 ("avc": cada NAL com o tamanho na
 * frente, SPS/PPS no registro `avcC` da configuração do decodificador). Usado pelo replay nativo dos clipes no app em
 * Tauri (ADR-0062): o vídeo vem do oc-live, já codificado, e entra no mesmo buffer e no mesmo MP4 dos clipes do
 * WebCodecs.
 */

/** unidades NAL (sem o código de início) */
export function splitNals(b: Uint8Array): Uint8Array[] {
  const starts: [number, number][] = [];
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      starts.push([i > 0 && b[i - 1] === 0 ? i - 1 : i, i + 3]);
      i += 2;
    }
  }
  return starts.map(([, h], k) => b.subarray(h, k + 1 < starts.length ? starts[k + 1]![0] : b.length));
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

/** registro avcC (ISO 14496-15) com um SPS e um PPS e NAL de 4 bytes de tamanho */
export function avcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 0xff], 0);
  out.set(sps, 8);
  const o = 8 + sps.length;
  out.set([1, pps.length >> 8, pps.length & 0xff], o);
  out.set(pps, o + 3);
  return out;
}

export interface AvcFrame {
  data: Uint8Array;
  /** só nos quadros-chave com SPS/PPS novos ou repetidos (o buffer guarda a configuração em cada quadro-chave) */
  config?: VideoDecoderConfig;
}

/** Converte quadro a quadro, lembrando o último SPS/PPS (quadro-chave sem eles usa a configuração anterior). */
export class AnnexBToAvc {
  private config: VideoDecoderConfig | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  /** null = ainda sem SPS/PPS (nada decodificável até o primeiro quadro-chave completo) */
  push(annexB: Uint8Array, key: boolean): AvcFrame | null {
    const nals = splitNals(annexB);
    let sps: Uint8Array | undefined;
    let pps: Uint8Array | undefined;
    const keep: Uint8Array[] = [];
    for (const n of nals) {
      const type = n[0]! & 0x1f;
      if (type === 7) sps = n;
      else if (type === 8) pps = n;
      // delimitador de unidade de acesso: não vai no MP4
      else if (type !== 9 && n.length) keep.push(n);
    }
    if (sps && pps && sps.length >= 4) {
      this.config = {
        codec: `avc1.${hex(sps[1]!)}${hex(sps[2]!)}${hex(sps[3]!)}`,
        codedWidth: this.width,
        codedHeight: this.height,
        description: avcC(sps, pps),
      };
    }
    if (!this.config) return null;
    const size = keep.reduce((n, k) => n + 4 + k.length, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const k of keep) {
      new DataView(data.buffer).setUint32(o, k.length);
      data.set(k, o + 4);
      o += 4 + k.length;
    }
    return key ? { data, config: this.config } : { data };
  }
}

/** cabeçalho de cada quadro que o oc-live manda: tamanho (u32 LE) · chave (u8) · tempo em µs (i64 LE) */
export function parseNativeChunk(buf: ArrayBuffer): { key: boolean; ts: number; data: Uint8Array } | null {
  if (buf.byteLength < 13) return null;
  const v = new DataView(buf);
  const n = v.getUint32(0, true);
  if (13 + n > buf.byteLength) return null;
  return { key: v.getUint8(4) === 1, ts: Number(v.getBigInt64(5, true)), data: new Uint8Array(buf, 13, n) };
}

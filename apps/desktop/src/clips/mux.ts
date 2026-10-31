/**
 * Junta os pedaços codificados do clipe num MP4 (ADR-0022), com o tempo começando em zero. A primeira trilha de som
 * é a mistura (a que qualquer player toca); as seguintes são cada fonte separada, com nome, para o visualizador do
 * OpenCord ligar e desligar.
 */
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { EncodeSession } from './encode';
import type { StoredChunk } from './ring';

export async function muxClip(
  s: Pick<EncodeSession, 'audioCodec'>,
  fps: number,
  clip: { base: number; video: StoredChunk[]; audio: StoredChunk[]; extra?: StoredChunk[][] },
  /** nome de cada trilha de som, na ordem gravada (a 1ª é a mistura) */
  names: string[] = [],
): Promise<Uint8Array<ArrayBuffer>> {
  const first = clip.video[0];
  if (!first) throw new Error('nada gravado ainda');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(video, { frameRate: fps });
  // o nome vem da posição original (uma trilha vazia não pode trocar os nomes das outras)
  const tracks = [clip.audio, ...(clip.extra ?? [])]
    .map((chunks, i) => ({ chunks, name: names[i] ?? `Áudio ${i + 1}` }))
    .filter((t) => t.chunks.length);
  const audio = s.audioCodec
    ? tracks.map((t, i) => {
        const src = new EncodedAudioPacketSource(s.audioCodec!);
        output.addAudioTrack(src, { name: t.name, disposition: { default: i === 0 } });
        return src;
      })
    : [];
  await output.start();
  const sec = (us: number) => us / 1e6;
  let lastV = -1;
  for (const c of clip.video) {
    const ts = Math.max(c.ts - clip.base, lastV + 1);
    lastV = ts;
    await video.add(
      new EncodedPacket(c.data, c.key ? 'key' : 'delta', sec(ts), sec(c.dur)),
      c === first && c.config ? { decoderConfig: c.config as VideoDecoderConfig } : undefined,
    );
  }
  for (const [i, src] of audio.entries()) {
    let sent = false;
    for (const c of tracks[i]!.chunks) {
      const meta: EncodedAudioChunkMetadata | undefined =
        !sent && c.config ? { decoderConfig: c.config as AudioDecoderConfig } : undefined;
      sent ||= Boolean(meta);
      if (!sent) continue;
      await src.add(new EncodedPacket(c.data, 'key', sec(c.ts - clip.base), sec(c.dur)), meta);
    }
  }
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error('nada foi gerado');
  return new Uint8Array(buf);
}

/** Junta os pedaços codificados num arquivo MP4 (ADR-0022), com o tempo começando em zero. */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { EncodeSession } from './encode';
import type { StoredChunk } from './ring';

export function muxMp4(
  s: Pick<EncodeSession, 'width' | 'height' | 'audioCodec' | 'sampleRate' | 'channels'>,
  fps: number,
  clip: { base: number; video: StoredChunk[]; audio: StoredChunk[] },
): Uint8Array<ArrayBuffer> {
  const first = clip.video[0];
  if (!first) throw new Error('nada gravado ainda');
  const vcfg = first.config as VideoDecoderConfig | undefined;
  const width = vcfg?.codedWidth ?? s.width;
  const height = vcfg?.codedHeight ?? s.height;
  const withAudio = Boolean(s.audioCodec && clip.audio.length);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(withAudio ? { audio: { codec: s.audioCodec!, numberOfChannels: s.channels, sampleRate: s.sampleRate } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });
  let lastV = -1;
  for (const c of clip.video) {
    const ts = Math.max(c.ts - clip.base, lastV + 1);
    lastV = ts;
    muxer.addVideoChunkRaw(
      c.data,
      c.key ? 'key' : 'delta',
      ts,
      c.dur,
      c === first && vcfg ? { decoderConfig: vcfg } : undefined,
    );
  }
  if (withAudio) {
    let sentConfig = false;
    for (const c of clip.audio) {
      const meta: EncodedAudioChunkMetadata | undefined =
        !sentConfig && c.config ? { decoderConfig: c.config as AudioDecoderConfig } : undefined;
      sentConfig ||= Boolean(meta);
      muxer.addAudioChunkRaw(c.data, 'key', c.ts - clip.base, c.dur, meta);
    }
  }
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}

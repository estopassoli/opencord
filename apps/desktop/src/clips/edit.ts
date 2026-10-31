/**
 * Edição de clipes (ADR-0022): corta o trecho escolhido e exporta como vídeo (MP4) ou só o som (M4A), com a
 * mediabunny (MPL-2.0). Copia os dados codificados quando dá e recodifica só o necessário nas bordas.
 */
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';

export async function exportRange(
  file: Blob,
  range: { start: number; end: number },
  kind: 'video' | 'audio',
  onProgress?: (p: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: range.start, end: range.end },
    ...(kind === 'audio' ? { video: { discard: true } } : {}),
    showWarnings: false,
  });
  if (!conversion.isValid) throw new Error('não foi possível converter este clipe');
  if (onProgress) conversion.onProgress = (p) => onProgress(p);
  await conversion.execute();
  const buf = output.target.buffer;
  if (!buf) throw new Error('nada foi gerado');
  return new Uint8Array(buf);
}

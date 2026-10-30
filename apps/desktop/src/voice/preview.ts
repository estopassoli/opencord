/**
 * Prévia das transmissões (ADR-0012): quem transmite envia, a cada 5 minutos (e logo para quem acaba de entrar na
 * sala), uma imagem JPEG da própria tela pela sala do LiveKit (byte stream, tópico `stream-preview`). Quem ainda não clicou em "Assistir" vê a miniatura
 * no card, sem assinar o vídeo. Nada passa pelo Socket.IO.
 */
import { RoomEvent, type ByteStreamReader, type RemoteParticipant, type Room } from 'livekit-client';

export const PREVIEW_TOPIC = 'stream-preview';
/** teto por imagem (640×360 em JPEG 0,8 fica em ~40–120 KB) */
export const PREVIEW_MAX_BYTES = 256 * 1024;
export const PREVIEW_INTERVAL_MS = 5 * 60_000;
const PREVIEW_WIDTH = 640;
/** intervalo mínimo aceito por remetente (protege contra inundação) */
const MIN_GAP_MS = 1000;

/** Começa a enviar miniaturas da trilha capturada. Devolve a função que para. */
export function startPreviewSender(room: Room, track: MediaStreamTrack): () => void {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => undefined);
  const canvas = document.createElement('canvas');
  let busy = false;
  /** sem destino = todos; com destino = só quem acabou de entrar */
  const send = async (to?: string) => {
    if (busy || room.remoteParticipants.size === 0 || video.videoWidth === 0) return;
    busy = true;
    try {
      const w = PREVIEW_WIDTH;
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
      if (!blob || blob.size > PREVIEW_MAX_BYTES) return;
      await room.localParticipant.sendFile(new File([blob], 'preview.jpg', { type: 'image/jpeg' }), {
        topic: PREVIEW_TOPIC,
        mimeType: 'image/jpeg',
        ...(to ? { destinationIdentities: [to] } : {}),
      });
    } catch {
      /* prévia é opcional: falha de envio não afeta a live */
    } finally {
      busy = false;
    }
  };
  // primeira prévia logo que o vídeo tiver quadros; depois, a cada intervalo
  const first = setTimeout(() => void send(), 800);
  const timer = setInterval(() => void send(), PREVIEW_INTERVAL_MS);
  // quem entra na sala não espera os 5 minutos
  const joined = (p: RemoteParticipant) => setTimeout(() => void send(p.identity), 1500);
  room.on(RoomEvent.ParticipantConnected, joined);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    room.off(RoomEvent.ParticipantConnected, joined);
    video.srcObject = null;
  };
}

/** JPEG começa com FF D8 FF. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Recebe miniaturas e guarda a mais recente de cada pessoa como URL de blob.
 * Só aceita de quem está publicando tela, JPEG pelos bytes, até o teto e no máximo uma por segundo.
 */
export class PreviewReceiver {
  private urls = new Map<string, string>();
  private lastAt = new Map<string, number>();

  constructor(
    private readonly isStreaming: (identity: string) => boolean,
    private readonly onChange: () => void,
  ) {}

  attach(room: Room) {
    room.registerByteStreamHandler(PREVIEW_TOPIC, (reader, from) => void this.receive(reader, from.identity));
  }

  get(identity: string): string | undefined {
    return this.urls.get(identity);
  }

  private async receive(reader: ByteStreamReader, identity: string) {
    const now = Date.now();
    const tooSoon = now - (this.lastAt.get(identity) ?? 0) < MIN_GAP_MS;
    const declaredTooBig = (reader.info.size ?? 0) > PREVIEW_MAX_BYTES;
    if (tooSoon || declaredTooBig || reader.info.mimeType !== 'image/jpeg' || !this.isStreaming(identity)) {
      // drena e descarta (o stream precisa ser consumido)
      void reader.readAll().catch(() => undefined);
      return;
    }
    this.lastAt.set(identity, now);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const c of reader) {
        total += c.length;
        if (total > PREVIEW_MAX_BYTES) return;
        chunks.push(c);
      }
    } catch {
      return;
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    if (!isJpeg(bytes) || !this.isStreaming(identity)) return;
    const old = this.urls.get(identity);
    this.urls.set(identity, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    if (old) URL.revokeObjectURL(old);
    this.onChange();
  }

  drop(identity: string) {
    const u = this.urls.get(identity);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(identity);
    this.lastAt.delete(identity);
  }

  clear(room?: Room | null) {
    for (const id of [...this.urls.keys()]) this.drop(id);
    room?.unregisterByteStreamHandler(PREVIEW_TOPIC);
  }
}

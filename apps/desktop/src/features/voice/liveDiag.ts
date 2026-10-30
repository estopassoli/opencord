/**
 * Diagnóstico da live para suporte: mede 5 s e copia as taxas por etapa (captura → composição → codificação → envio;
 * recepção → decodificação → descarte → apresentação). Sem segredos nem conteúdo; quem cola decide com quem compartilha.
 */
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

type Rec = Record<string, unknown> | null | undefined;
const num = (o: unknown, k: string) => {
  const v = (o as Record<string, unknown> | null | undefined)?.[k];
  return typeof v === 'number' ? v : 0;
};

/** Quadros apresentados pelo vídeo da live assistida (requestVideoFrameCallback), durante `ms`. */
function countPresented(ms: number): Promise<number | null> {
  const v = document.querySelector<HTMLVideoElement>('.tile-stream video');
  if (!v || !('requestVideoFrameCallback' in v)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let n = 0;
    let live = true;
    const tick = () => {
      n++;
      if (live) v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
    setTimeout(() => {
      live = false;
      resolve(n);
    }, ms);
  });
}

export async function copyLiveDiagnostics() {
  const engine = useVoice.getState().engine();
  if (!engine) return;
  const ui = useUi.getState();
  ui.toast('info', 'Medindo a live por 5 segundos…');
  const MS = 5000;
  const a = (await engine.pipeline()) as Record<string, Rec>;
  const presented = countPresented(MS);
  await new Promise((r) => setTimeout(r, MS));
  const b = (await engine.pipeline()) as Record<string, Rec>;
  const dt = (num(b, 't') - num(a, 't')) / 1000;
  const rate = (k: 'source' | 'compositor' | 'outbound' | 'inbound', f: string) =>
    a[k] && b[k] ? Math.round(((num(b[k], f) - num(a[k], f)) / dt) * 10) / 10 : null;
  const enc = num(b.outbound, 'framesEncoded') - num(a.outbound, 'framesEncoded');
  const dec = num(b.inbound, 'framesDecoded') - num(a.inbound, 'framesDecoded');
  const p = await presented;
  const report = {
    app: 'OpenCord',
    when: new Date().toISOString(),
    seconds: Math.round(dt * 10) / 10,
    sending: a.outbound
      ? {
          captureSettings: b.captureSettings,
          sender: b.sender,
          codec: b.codec,
          encoder: b.outbound?.encoderImplementation,
          sourceFps: rate('source', 'frames'),
          sceneInFps: rate('compositor', 'screenIn'),
          sceneOutFps: rate('compositor', 'written'),
          encodedFps: rate('outbound', 'framesEncoded'),
          sentFps: rate('outbound', 'framesSent'),
          encodeMsPerFrame: enc
            ? Math.round(((num(b.outbound, 'totalEncodeTime') - num(a.outbound, 'totalEncodeTime')) / enc) * 1e4) / 10
            : null,
          sentMbps: Math.round(((num(b.outbound, 'bytesSent') - num(a.outbound, 'bytesSent')) * 8) / dt / 1e5) / 10,
          targetMbps: Math.round(num(b.outbound, 'targetBitrate') / 1e5) / 10,
          uplinkEstimateMbps: Math.round(num(b.uplink, 'availableOutgoingBitrate') / 1e5) / 10,
          rttMs: Math.round(num(b.uplink, 'currentRoundTripTime') * 1000),
          resolution: `${num(b.outbound, 'frameWidth')}x${num(b.outbound, 'frameHeight')}`,
          limitation: b.outbound?.qualityLimitationReason,
          limitationSeconds: b.outbound?.qualityLimitationDurations,
          retransmittedPackets:
            num(b.outbound, 'retransmittedPacketsSent') - num(a.outbound, 'retransmittedPacketsSent'),
        }
      : null,
    watching: a.inbound
      ? {
          decoder: b.inbound?.decoderImplementation,
          receivedFps: rate('inbound', 'framesReceived'),
          decodedFps: rate('inbound', 'framesDecoded'),
          droppedFps: rate('inbound', 'framesDropped'),
          presentedFps: p !== null ? Math.round((p / (MS / 1000)) * 10) / 10 : null,
          decodeMsPerFrame: dec
            ? Math.round(((num(b.inbound, 'totalDecodeTime') - num(a.inbound, 'totalDecodeTime')) / dec) * 1e4) / 10
            : null,
          resolution: `${num(b.inbound, 'frameWidth')}x${num(b.inbound, 'frameHeight')}`,
          receivedMbps:
            Math.round(((num(b.inbound, 'bytesReceived') - num(a.inbound, 'bytesReceived')) * 8) / dt / 1e5) / 10,
          packetsLost: num(b.inbound, 'packetsLost') - num(a.inbound, 'packetsLost'),
          jitterMs: Math.round(num(b.inbound, 'jitter') * 1000),
          freezes: num(b.inbound, 'freezeCount') - num(a.inbound, 'freezeCount'),
          rttMs: Math.round(num(b.downlink, 'currentRoundTripTime') * 1000),
        }
      : null,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    ui.toast('success', 'Diagnóstico da live copiado. Cole onde quiser compartilhar.');
  } catch {
    ui.toast('error', 'Não foi possível copiar o diagnóstico.');
  }
}

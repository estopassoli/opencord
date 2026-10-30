/**
 * Perfis de Go Live. São TETOS, não garantias (MEDIA_ARCHITECTURE: "nunca garantir perfil por mera seleção na UI").
 * A escolha efetiva é limitada pela capacidade medida (encoder por hardware, monitor, permissões).
 */
export type StreamProfileId = '720p30' | '1080p60' | '1440p60';

export interface StreamProfile {
  id: StreamProfileId;
  width: number;
  height: number;
  fps: 30 | 60;
  /** bitrate máximo de vídeo (bps) */
  maxBitrate: number;
  /** exige encoder por hardware para ser oferecido */
  requiresHardware: boolean;
}

// Tetos de bitrate: cada espectador recebe a live inteira, e a franquia mensal de tráfego dos nós do SFU é
// finita (bitrate × espectadores × horas). 8 Mbps em 1080p60 H.264 por hardware segue nítido em jogos.
export const STREAM_PROFILES: Record<StreamProfileId, StreamProfile> = {
  '720p30': { id: '720p30', width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000, requiresHardware: false },
  '1080p60': { id: '1080p60', width: 1920, height: 1080, fps: 60, maxBitrate: 8_000_000, requiresHardware: false },
  '1440p60': { id: '1440p60', width: 2560, height: 1440, fps: 60, maxBitrate: 12_000_000, requiresHardware: true },
};

export interface EncoderCapability {
  /** Encoder por hardware observado (getStats().encoderImplementation / powerEfficientEncoder). null = desconhecido. */
  hardware: boolean | null;
  /** Maior resolução do monitor/janela de origem. */
  sourceWidth?: number;
  sourceHeight?: number;
}

const ORDER: StreamProfileId[] = ['720p30', '1080p60', '1440p60'];

/** Reduz o perfil pedido até um suportado. Sem hardware confirmado, 1440p60 não é oferecido. */
export function effectiveProfile(requested: StreamProfileId, cap: EncoderCapability): StreamProfile {
  let idx = ORDER.indexOf(requested);
  while (idx > 0) {
    const p = STREAM_PROFILES[ORDER[idx] as StreamProfileId];
    const hwOk = !p.requiresHardware || cap.hardware === true;
    const srcOk = !cap.sourceHeight || cap.sourceHeight >= p.height * 0.9;
    if (hwOk && srcOk) break;
    idx--;
  }
  return STREAM_PROFILES[ORDER[Math.max(0, idx)] as StreamProfileId];
}

export function availableProfiles(cap: EncoderCapability): StreamProfile[] {
  return ORDER.map((id) => STREAM_PROFILES[id]).filter((p) => !p.requiresHardware || cap.hardware === true);
}

/** Heurística sobre a string de encoder do WebRTC (Chromium): MediaFoundation/NVENC/QSV/AMF = hardware. */
export function isHardwareEncoder(impl: string | undefined | null): boolean | null {
  if (!impl) return null;
  if (/MediaFoundation|NVIDIA|NVENC|QuickSync|QSV|AMF|AMD|VideoToolbox|VAAPI|V4L2/i.test(impl)) return true;
  if (/libvpx|libaom|OpenH264|SimulcastEncoderAdapter\s*\((libvpx|OpenH264)/i.test(impl)) return false;
  return null;
}

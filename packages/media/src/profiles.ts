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

// Tetos de bitrate generosos: a live tem de sair exatamente no perfil escolhido (decisão do mantenedor: "algo que
// fique absolutamente da forma que eu coloquei… independente do que custar no servidor"). Com 8 Mbps em 1080p60
// a cena pesada estourava o teto e o encoder descartava quadros (42 fps medidos). Custo: tráfego do SFU maior
// (bitrate × espectadores × horas); ver docs/DECISIONS.md.
export const STREAM_PROFILES: Record<StreamProfileId, StreamProfile> = {
  '720p30': { id: '720p30', width: 1280, height: 720, fps: 30, maxBitrate: 6_000_000, requiresHardware: false },
  '1080p60': { id: '1080p60', width: 1920, height: 1080, fps: 60, maxBitrate: 20_000_000, requiresHardware: false },
  '1440p60': { id: '1440p60', width: 2560, height: 1440, fps: 60, maxBitrate: 30_000_000, requiresHardware: true },
};

/** Bitrate escolhido por quem transmite: o teto do perfil ("máxima") pode não caber no upload de casa. */
export type StreamBitrateLevel = 'low' | 'medium' | 'high';

// 'high' = teto do perfil (decisão do mantenedor). Upload menor que o bitrate perde pacotes e a live engasga para
// todo mundo (medido: 16,8 Mbps de subida contra 20 Mbps de teto); por isso o padrão é 'medium'.
export const STREAM_BITRATES: Record<StreamProfileId, Record<StreamBitrateLevel, number>> = {
  '720p30': { low: 3_000_000, medium: 4_500_000, high: 6_000_000 },
  '1080p60': { low: 8_000_000, medium: 12_000_000, high: 20_000_000 },
  '1440p60': { low: 12_000_000, medium: 18_000_000, high: 30_000_000 },
};

export function streamBitrate(profile: StreamProfileId, level: StreamBitrateLevel): number {
  return STREAM_BITRATES[profile][level];
}

export interface EncoderCapability {
  /** Encoder por hardware observado (getStats().encoderImplementation / powerEfficientEncoder). null = desconhecido. */
  hardware: boolean | null;
  /** Maior resolução do monitor/janela de origem. */
  sourceWidth?: number;
  sourceHeight?: number;
}

const ORDER: StreamProfileId[] = ['720p30', '1080p60', '1440p60'];

/**
 * Para onde cada perfil desce quando não é suportado. Não existe 1080p120: a captura de tela do Chromium entrega no
 * máximo ~60 quadros/s (medido no E2E golive-fps com conteúdo a 120 fps, nos três caminhos de captura do Windows).
 */
const FALLBACK: Record<StreamProfileId, StreamProfileId | null> = {
  '1440p60': '1080p60',
  '1080p60': '720p30',
  '720p30': null,
};

/**
 * Reduz o perfil pedido até um suportado. Com `hardware: false`, 1440p60 não é usado; com `null`
 * (desconhecido antes de publicar) eles são tentados, e quem publica confere o encoder depois (fallbackFor).
 */
export function effectiveProfile(requested: StreamProfileId, cap: EncoderCapability): StreamProfile {
  let id: StreamProfileId = requested in STREAM_PROFILES ? requested : '1080p60';
  for (;;) {
    const p = STREAM_PROFILES[id];
    const hwOk = !p.requiresHardware || cap.hardware !== false;
    const srcOk = !cap.sourceHeight || cap.sourceHeight >= p.height * 0.9;
    const next = FALLBACK[id];
    if ((hwOk && srcOk) || !next) return p;
    id = next;
  }
}

/** Perfil para o qual a live desce se o encoder observado for por software. */
export function fallbackFor(profile: StreamProfileId): StreamProfile {
  return effectiveProfile(profile, { hardware: false });
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

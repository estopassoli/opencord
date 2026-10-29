/** Interface de captura (MEDIA_ARCHITECTURE §API de captura). Implementada pela bridge Electron. */
export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** data URL PNG da miniatura */
  thumbnail?: string;
  /** ícone do app (janelas), data URL */
  appIcon?: string;
  displayId?: string;
}

export interface CaptureOptions {
  sourceId: string;
  width: number;
  height: number;
  fps: 30 | 60;
  systemAudio: boolean;
}

export interface CaptureSession {
  id: string;
  stream: MediaStream;
  /** true se a trilha de áudio do sistema foi obtida */
  hasSystemAudio: boolean;
  stop(): Promise<void>;
}

export interface CaptureProvider {
  listSources(): Promise<CaptureSource[]>;
  start(options: CaptureOptions): Promise<CaptureSession>;
}

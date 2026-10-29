/** Instaladores do app desktop publicados pelo servidor (GET /downloads/desktop). */
export type DesktopPlatform = 'windows' | 'mac' | 'linux';

export interface DesktopFile {
  platform: DesktopPlatform;
  arch: 'x64' | 'arm64';
  format: 'exe' | 'dmg' | 'AppImage' | 'deb';
  url: string;
  fileName: string | null;
  version: string | null;
  sizeBytes: number | null;
}

export interface DesktopDownload {
  windows: DesktopFile | null;
  /** Ausente em servidores antigos (só Windows). */
  files?: DesktopFile[];
}

export const PLATFORM_NAME: Record<DesktopPlatform, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

export function fileLabel(f: DesktopFile): string {
  if (f.platform === 'mac') return f.arch === 'arm64' ? 'macOS (Apple Silicon)' : 'macOS (Intel)';
  if (f.platform === 'linux') return f.format === 'deb' ? 'Linux (.deb)' : 'Linux (AppImage)';
  return 'Windows (64 bits)';
}

interface NavigatorLike {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
}

/** Sistema de quem está no navegador; null em celular/tablet (não há app desktop para eles). */
export function detectPlatform(nav: NavigatorLike): DesktopPlatform | null {
  if (nav.userAgentData?.mobile) return null;
  const p = `${nav.userAgentData?.platform ?? ''} ${nav.userAgent}`;
  if (/android|iphone|ipad|ipod|cros/i.test(p)) return null;
  if (/win/i.test(p)) return 'windows';
  // iPadOS se apresenta como Mac; só ele tem toque
  if (/mac/i.test(p)) return (nav.maxTouchPoints ?? 0) > 1 ? null : 'mac';
  if (/linux|x11/i.test(p)) return 'linux';
  return null;
}

/**
 * Arquivo sugerido para a plataforma. No Mac o navegador não informa o processador de forma confiável;
 * Apple Silicon é a maioria dos Macs atuais, e a opção Intel fica na lista de outras versões.
 */
export function pickFile(files: DesktopFile[], platform: DesktopPlatform | null): DesktopFile | null {
  if (!platform) return null;
  const mine = files.filter((f) => f.platform === platform);
  const pref =
    platform === 'mac'
      ? mine.find((f) => f.arch === 'arm64')
      : platform === 'linux'
        ? mine.find((f) => f.format === 'AppImage')
        : undefined;
  return pref ?? mine[0] ?? null;
}

export function allFiles(dl: DesktopDownload | null): DesktopFile[] {
  if (!dl) return [];
  if (dl.files) return dl.files;
  // servidor antigo: `windows` sem plataforma/arquitetura
  return dl.windows ? [{ ...dl.windows, platform: 'windows', arch: 'x64', format: 'exe' }] : [];
}

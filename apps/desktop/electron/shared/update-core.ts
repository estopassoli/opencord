/**
 * Regras puras da atualização "avisar e baixar" (sem Electron/Node: testadas em test/update-core.test.ts).
 * O main só aceita instaladores do MESMO servidor configurado no app, por https (http só em localhost, dev).
 */

export interface DesktopFileDto {
  platform: 'windows' | 'mac' | 'linux';
  arch: 'x64' | 'arm64';
  format: 'exe' | 'dmg' | 'AppImage' | 'deb';
  url: string;
  fileName: string | null;
  version: string | null;
  sizeBytes: number | null;
}

/** Mesmo padrão de nome que a API serve (downloads.controller.ts). */
export const INSTALLER_NAME = /^[\w .()-]{1,120}\.(exe|dmg|AppImage|deb)$/i;

const parse = (v: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** `candidate` é estritamente mais nova que `current` (x.y.z). Versões inválidas nunca contam como novas. */
export function isNewer(candidate: string | null, current: string): boolean {
  const a = candidate ? parse(candidate) : null;
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export interface Target {
  platform: DesktopFileDto['platform'];
  arch: DesktopFileDto['arch'];
  format: DesktopFileDto['format'];
}

/** Formato instalado nesta máquina: Windows → exe; macOS → dmg; Linux → AppImage se rodando como AppImage, senão deb. */
export function targetFor(platform: string, arch: string, appImage: boolean): Target | null {
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  if (platform === 'win32') return { platform: 'windows', arch: 'x64', format: 'exe' };
  if (platform === 'darwin') return { platform: 'mac', arch: a, format: 'dmg' };
  if (platform === 'linux') return { platform: 'linux', arch: 'x64', format: appImage ? 'AppImage' : 'deb' };
  return null;
}

/** URL do instalador aceitável: mesma origem do servidor, /downloads/files/<nome válido>, https (ou http em localhost). */
export function isTrustedInstallerUrl(url: string, serverUrl: string): boolean {
  let u: URL;
  let s: URL;
  try {
    u = new URL(url);
    s = new URL(serverUrl);
  } catch {
    return false;
  }
  if (u.origin !== s.origin || u.username || u.password) return false;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return false;
  const m = /^\/downloads\/files\/([^/]+)$/.exec(u.pathname);
  return Boolean(m && INSTALLER_NAME.test(decodeURIComponent(m[1]!)));
}

/** Escolhe o instalador desta plataforma se for mais novo que a versão atual e vier de origem confiável. */
export function pickUpdate(
  files: DesktopFileDto[],
  target: Target,
  currentVersion: string,
  serverUrl: string,
): (DesktopFileDto & { version: string; fileName: string }) | null {
  const f = files.find((x) => x.platform === target.platform && x.arch === target.arch && x.format === target.format);
  if (!f?.version || !f.fileName || !INSTALLER_NAME.test(f.fileName)) return null;
  if (!isNewer(f.version, currentVersion) || !isTrustedInstallerUrl(f.url, serverUrl)) return null;
  return { ...f, version: f.version, fileName: f.fileName };
}

/**
 * Regras puras da atualização automática (ADR-0051; sem Electron/Node: testadas em test/update-core.test.ts).
 * O main só aceita instaladores do MESMO servidor configurado no app, por https (http só em localhost, dev), e
 * confere o SHA-256 publicado pela API antes de executar.
 */

export interface DesktopFileDto {
  platform: 'windows' | 'mac' | 'linux';
  arch: 'x64' | 'arm64';
  format: 'exe' | 'dmg' | 'AppImage' | 'deb';
  url: string;
  fileName: string | null;
  version: string | null;
  sizeBytes: number | null;
  /** SHA-256 (hex) do arquivo; ausente em servidores antigos, null em link externo */
  sha256?: string | null;
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

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * O arquivo baixado confere com o hash publicado? Sem hash publicado (servidor antigo) vale só a origem confiável
 * (mesmo servidor, https) e o tamanho; hash publicado mas malformado conta como falha (nada é executado).
 */
export function hashMatches(expected: string | null | undefined, actual: string): boolean {
  if (expected === null || expected === undefined) return true;
  return SHA256_HEX.test(expected) && SHA256_HEX.test(actual) && expected.toLowerCase() === actual.toLowerCase();
}

/**
 * Como o instalador NSIS (um clique, por usuário) é chamado:
 * - manual: "Reiniciar e atualizar agora" — mostra a janela de progresso e reabre o app;
 * - auto: ocioso e sem chamada — silencioso (/S) e reabre o app (--force-run);
 * - quit: a pessoa encerrou o OpenCord — silencioso e NÃO reabre (a próxima abertura já é a versão nova).
 * --updated: o instalador encerra o app que ainda estiver fechando sem perguntar e reabre com `--updated`.
 */
export type InstallMode = 'manual' | 'auto' | 'quit';
export function installerArgs(mode: InstallMode): string[] {
  if (mode === 'manual') return ['--updated', '--force-run'];
  if (mode === 'auto') return ['/S', '--updated', '--force-run'];
  return ['/S', '--updated'];
}

/** Sem mexer no teclado/mouse por este tempo com a janela aberta: a pessoa saiu de perto. */
export const AUTO_INSTALL_IDLE_S = 10 * 60;
/** Com a janela escondida (bandeja/minimizada) basta isto: evita instalar enquanto se usa outro programa ou jogo. */
export const AUTO_INSTALL_HIDDEN_IDLE_S = 2 * 60;

export interface AutoInstallState {
  /** process.platform */
  platform: string;
  /** instalador baixado e conferido */
  ready: boolean;
  /** em chamada de voz (inclui Go Live e gravação da chamada, que só existem dentro dela) */
  inVoice: boolean;
  /** jogo detectado rodando (clipes/overlay ativos) */
  gameRunning: boolean;
  /** janela visível e não minimizada */
  windowVisible: boolean;
  /** segundos sem teclado/mouse no sistema (powerMonitor.getSystemIdleTime) */
  idleSeconds: number;
}

/** Instalar sozinho agora? Só no Windows, nunca em chamada nem com jogo aberto, e só com a pessoa longe do PC. */
export function shouldAutoInstall(s: AutoInstallState): boolean {
  if (s.platform !== 'win32' || !s.ready || s.inVoice || s.gameRunning) return false;
  return s.idleSeconds >= (s.windowVisible ? AUTO_INSTALL_IDLE_S : AUTO_INSTALL_HIDDEN_IDLE_S);
}

/** Marca deixada antes de instalar sozinho com a janela escondida: o app reaberto volta escondido na bandeja. */
export interface RelaunchMarker {
  hidden: boolean;
  at: number;
}
/** a marca só vale logo depois da instalação (e na abertura feita pelo instalador, com --updated) */
export const RELAUNCH_MARKER_MAX_AGE_MS = 10 * 60 * 1000;
export function startHiddenAfterUpdate(raw: unknown, argv: readonly string[], now: number): boolean {
  if (!argv.includes('--updated') || typeof raw !== 'object' || raw === null) return false;
  const m = raw as Partial<RelaunchMarker>;
  if (m.hidden !== true || typeof m.at !== 'number') return false;
  return now - m.at >= 0 && now - m.at <= RELAUNCH_MARKER_MAX_AGE_MS;
}

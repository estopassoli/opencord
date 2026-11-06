import { describe, expect, it } from 'vitest';
import {
  AUTO_INSTALL_HIDDEN_IDLE_S,
  AUTO_INSTALL_IDLE_S,
  hashMatches,
  installerArgs,
  isNewer,
  isTrustedInstallerUrl,
  pickUpdate,
  RELAUNCH_MARKER_MAX_AGE_MS,
  shouldAutoInstall,
  startHiddenAfterUpdate,
  targetFor,
  type AutoInstallState,
  type DesktopFileDto,
} from '../electron/shared/update-core';

const SERVER = 'https://api.opencord.pro';
const exe = (version: string, url = `${SERVER}/downloads/files/OpenCord-Setup-${version}-x64.exe`): DesktopFileDto => ({
  platform: 'windows',
  arch: 'x64',
  format: 'exe',
  url,
  fileName: `OpenCord-Setup-${version}-x64.exe`,
  version,
  sizeBytes: 100,
});
const WIN = targetFor('win32', 'x64', false)!;

describe('isNewer', () => {
  it('compara x.y.z numericamente', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });
  it('versões inválidas nunca são novas', () => {
    expect(isNewer(null, '0.1.0')).toBe(false);
    expect(isNewer('1.0', '0.1.0')).toBe(false);
    expect(isNewer('9.9.9-beta', '0.1.0')).toBe(false);
  });
});

describe('targetFor', () => {
  it('formato por plataforma', () => {
    expect(WIN).toEqual({ platform: 'windows', arch: 'x64', format: 'exe' });
    expect(targetFor('darwin', 'arm64', false)).toEqual({ platform: 'mac', arch: 'arm64', format: 'dmg' });
    expect(targetFor('linux', 'x64', true)?.format).toBe('AppImage');
    expect(targetFor('linux', 'x64', false)?.format).toBe('deb');
    expect(targetFor('freebsd', 'x64', false)).toBeNull();
  });
});

describe('isTrustedInstallerUrl', () => {
  it('aceita só o mesmo servidor, por https, no caminho de downloads', () => {
    expect(isTrustedInstallerUrl(`${SERVER}/downloads/files/OpenCord-Setup-0.2.0-x64.exe`, SERVER)).toBe(true);
    expect(isTrustedInstallerUrl('https://evil.example/downloads/files/OpenCord-Setup-0.2.0-x64.exe', SERVER)).toBe(
      false,
    );
    expect(isTrustedInstallerUrl('http://api.opencord.pro/downloads/files/a.exe', 'http://api.opencord.pro')).toBe(
      false,
    );
    expect(isTrustedInstallerUrl(`${SERVER}/outra/a.exe`, SERVER)).toBe(false);
    expect(isTrustedInstallerUrl(`${SERVER}/downloads/files/a.zip`, SERVER)).toBe(false);
    expect(isTrustedInstallerUrl(`${SERVER}/downloads/files/..%2Fa.exe`, SERVER)).toBe(false);
    expect(isTrustedInstallerUrl('https://user:pw@api.opencord.pro/downloads/files/a.exe', SERVER)).toBe(false);
  });
  it('http só em localhost (desenvolvimento)', () => {
    expect(isTrustedInstallerUrl('http://localhost:3000/downloads/files/a.exe', 'http://localhost:3000')).toBe(true);
  });
});

describe('pickUpdate', () => {
  it('escolhe o instalador mais novo da plataforma', () => {
    expect(pickUpdate([exe('0.2.0')], WIN, '0.1.0', SERVER)?.version).toBe('0.2.0');
  });
  it('ignora mesma versão, outra plataforma e origem estranha', () => {
    expect(pickUpdate([exe('0.1.0')], WIN, '0.1.0', SERVER)).toBeNull();
    expect(pickUpdate([{ ...exe('0.2.0'), platform: 'mac', format: 'dmg' }], WIN, '0.1.0', SERVER)).toBeNull();
    expect(pickUpdate([exe('0.2.0', 'https://cdn.example/OpenCord.exe')], WIN, '0.1.0', SERVER)).toBeNull();
  });
});

const HASH = 'a'.repeat(64);

describe('hashMatches', () => {
  it('confere o SHA-256 publicado (sem diferenciar maiúsculas)', () => {
    expect(hashMatches(HASH, HASH)).toBe(true);
    expect(hashMatches(HASH.toUpperCase(), HASH)).toBe(true);
    expect(hashMatches(HASH, 'b'.repeat(64))).toBe(false);
  });
  it('hash publicado malformado nunca confere', () => {
    expect(hashMatches('abc', 'abc')).toBe(false);
    expect(hashMatches('z'.repeat(64), 'z'.repeat(64))).toBe(false);
    expect(hashMatches('', HASH)).toBe(false);
  });
  it('servidor antigo sem hash: vale só a origem confiável', () => {
    expect(hashMatches(undefined, HASH)).toBe(true);
    expect(hashMatches(null, HASH)).toBe(true);
  });
  it('pickUpdate repassa o hash publicado', () => {
    expect(pickUpdate([{ ...exe('0.2.0'), sha256: HASH }], WIN, '0.1.0', SERVER)?.sha256).toBe(HASH);
  });
});

describe('installerArgs', () => {
  it('manual mostra o progresso e reabre; automático é silencioso e reabre; ao encerrar não reabre', () => {
    expect(installerArgs('manual')).toEqual(['--updated', '--force-run']);
    expect(installerArgs('auto')).toEqual(['/S', '--updated', '--force-run']);
    expect(installerArgs('quit')).toEqual(['/S', '--updated']);
  });
});

describe('shouldAutoInstall', () => {
  const away: AutoInstallState = {
    platform: 'win32',
    ready: true,
    inVoice: false,
    gameRunning: false,
    windowVisible: true,
    idleSeconds: AUTO_INSTALL_IDLE_S,
  };
  it('instala com a pessoa longe do PC há 10 min e fora de chamada', () => {
    expect(shouldAutoInstall(away)).toBe(true);
  });
  it('nunca durante uma chamada (Go Live e gravação só existem dentro dela)', () => {
    expect(shouldAutoInstall({ ...away, inVoice: true, idleSeconds: 24 * 3600 })).toBe(false);
  });
  it('nunca com jogo aberto', () => {
    expect(shouldAutoInstall({ ...away, gameRunning: true })).toBe(false);
  });
  it('só com instalador pronto e só no Windows', () => {
    expect(shouldAutoInstall({ ...away, ready: false })).toBe(false);
    expect(shouldAutoInstall({ ...away, platform: 'darwin' })).toBe(false);
    expect(shouldAutoInstall({ ...away, platform: 'linux' })).toBe(false);
  });
  it('janela à mostra: espera os 10 min sem mexer no PC', () => {
    expect(shouldAutoInstall({ ...away, idleSeconds: AUTO_INSTALL_IDLE_S - 1 })).toBe(false);
  });
  it('janela escondida: basta um pouco sem mexer no PC (não instala enquanto se usa outro programa)', () => {
    const hidden = { ...away, windowVisible: false };
    expect(shouldAutoInstall({ ...hidden, idleSeconds: AUTO_INSTALL_HIDDEN_IDLE_S })).toBe(true);
    expect(shouldAutoInstall({ ...hidden, idleSeconds: AUTO_INSTALL_HIDDEN_IDLE_S - 1 })).toBe(false);
    expect(shouldAutoInstall({ ...hidden, idleSeconds: 0 })).toBe(false);
  });
});

describe('startHiddenAfterUpdate', () => {
  const now = 1_000_000_000;
  const argv = ['OpenCord.exe', '--updated'];
  it('reaberto pelo instalador logo depois de instalar escondido: volta à bandeja', () => {
    expect(startHiddenAfterUpdate({ hidden: true, at: now - 30_000 }, argv, now)).toBe(true);
  });
  it('janela estava à mostra, marca velha, sem --updated ou marca inválida: abre normal', () => {
    expect(startHiddenAfterUpdate({ hidden: false, at: now }, argv, now)).toBe(false);
    expect(startHiddenAfterUpdate({ hidden: true, at: now - RELAUNCH_MARKER_MAX_AGE_MS - 1 }, argv, now)).toBe(false);
    expect(startHiddenAfterUpdate({ hidden: true, at: now + 60_000 }, argv, now)).toBe(false);
    expect(startHiddenAfterUpdate({ hidden: true, at: now }, ['OpenCord.exe'], now)).toBe(false);
    expect(startHiddenAfterUpdate(null, argv, now)).toBe(false);
    expect(startHiddenAfterUpdate({ hidden: 'sim', at: now }, argv, now)).toBe(false);
  });
});

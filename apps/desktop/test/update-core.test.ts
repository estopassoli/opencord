import { describe, expect, it } from 'vitest';
import {
  isNewer,
  isTrustedInstallerUrl,
  pickUpdate,
  targetFor,
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

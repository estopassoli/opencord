import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadAppButton } from '../src/components/DownloadApp';
import { detectPlatform, pickFile, type DesktopFile } from '../src/lib/downloads';

const file = (f: Partial<DesktopFile> & Pick<DesktopFile, 'platform' | 'arch' | 'format'>): DesktopFile => ({
  url: `http://x/downloads/files/${f.platform}-${f.arch}.${f.format}`,
  fileName: `${f.platform}-${f.arch}.${f.format}`,
  version: '0.2.0',
  sizeBytes: 120 * 1024 * 1024,
  ...f,
});
const WIN = file({ platform: 'windows', arch: 'x64', format: 'exe' });
const MAC_ARM = file({ platform: 'mac', arch: 'arm64', format: 'dmg' });
const MAC_X64 = file({ platform: 'mac', arch: 'x64', format: 'dmg' });
const APPIMAGE = file({ platform: 'linux', arch: 'x64', format: 'AppImage' });
const DEB = file({ platform: 'linux', arch: 'x64', format: 'deb' });
const ALL = [WIN, MAC_ARM, MAC_X64, APPIMAGE, DEB];

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/150.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
};

describe('plataforma de quem está no navegador', () => {
  it('reconhece Windows, macOS e Linux; celular e iPad não recebem app desktop', () => {
    expect(detectPlatform({ userAgent: UA.windows })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe('mac');
    expect(detectPlatform({ userAgent: UA.linux })).toBe('linux');
    expect(detectPlatform({ userAgent: UA.android })).toBeNull();
    expect(detectPlatform({ userAgent: UA.iphone })).toBeNull();
    // iPadOS se identifica como Mac, mas tem toque
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 5 })).toBeNull();
    expect(detectPlatform({ userAgent: UA.windows, userAgentData: { platform: 'Windows', mobile: true } })).toBeNull();
  });

  it('sugere Apple Silicon no Mac e AppImage no Linux', () => {
    expect(pickFile(ALL, 'windows')).toBe(WIN);
    expect(pickFile(ALL, 'mac')).toBe(MAC_ARM);
    expect(pickFile([MAC_X64], 'mac')).toBe(MAC_X64);
    expect(pickFile(ALL, 'linux')).toBe(APPIMAGE);
    expect(pickFile([DEB], 'linux')).toBe(DEB);
    expect(pickFile([WIN], 'mac')).toBeNull();
    expect(pickFile(ALL, null)).toBeNull();
  });
});

/** No navegador (sem window.opencord) o botão aparece com o link do servidor; sem instalador publicado, some. */
describe('DownloadAppButton (navegador)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mostra o instalador do sistema atual e as outras versões', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.mac);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ windows: WIN, files: ALL }))),
    );
    render(<DownloadAppButton />);
    const btn = await screen.findByRole('button', { name: /Baixar para macOS 0\.2\.0 · 120 MB/ });
    const link = btn.closest('a');
    expect(link?.getAttribute('href')).toBe(MAC_ARM.url);
    expect(link?.hasAttribute('download')).toBe(true);
    for (const name of ['Windows (64 bits)', 'macOS (Intel)', 'Linux (AppImage)', 'Linux (.deb)'])
      expect(screen.getByRole('link', { name })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'macOS (Apple Silicon)' })).toBeNull();
  });

  it('servidor antigo (só windows): continua oferecendo o instalador do Windows', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.windows);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ windows: { ...WIN, platform: undefined } }))),
    );
    render(<DownloadAppButton />);
    expect(await screen.findByRole('button', { name: /Baixar para Windows 0\.2\.0/ })).toBeTruthy();
  });

  it('não aparece sem instalador publicado ou com servidor fora do ar', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.windows);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ windows: null, files: [] }))),
    );
    const { container, unmount } = render(<DownloadAppButton />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.querySelector('a')).toBeNull();
    unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    const r2 = render(<DownloadAppButton />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(r2.container.querySelector('a')).toBeNull();
  });
});

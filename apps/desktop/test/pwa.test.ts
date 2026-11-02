import { describe, expect, it } from 'vitest';
import { buildServiceWorker, precacheFromBundle, versionFromBundle } from '../scripts/pwa.mjs';
import { initialInstallKind, isIos, isMobileWeb, isStandalone } from '../src/lib/pwa';

const bundle = {
  'index.html': { type: 'asset' },
  'assets/index-AAAA1111.js': {
    type: 'chunk',
    isEntry: true,
    imports: ['assets/vendor-BBBB2222.js'],
    viteMetadata: { importedCss: new Set(['assets/index-CCCC3333.css']) },
  },
  'assets/vendor-BBBB2222.js': { type: 'chunk', isEntry: false, imports: [] },
  'assets/lazy-DDDD4444.js': { type: 'chunk', isEntry: false, imports: [] },
  'assets/three-EEEE5555.js': { type: 'chunk', isEntry: false, imports: [] },
};

describe('service worker gerado no build', () => {
  it('pré-cacheia a casca: página, entrada, CSS, imports estáticos, manifesto e ícones; não os chunks sob demanda', () => {
    const list = precacheFromBundle(bundle);
    expect(list).toContain('./index.html');
    expect(list).toContain('./assets/index-AAAA1111.js');
    expect(list).toContain('./assets/index-CCCC3333.css');
    expect(list).toContain('./assets/vendor-BBBB2222.js');
    expect(list).toContain('./manifest.webmanifest');
    expect(list).toContain('./icons/icon-maskable-512.png');
    expect(list).not.toContain('./assets/lazy-DDDD4444.js');
  });
  it('a versão muda quando um arquivo do bundle muda de hash', () => {
    const a = versionFromBundle(bundle);
    const b = versionFromBundle({ ...bundle, 'assets/lazy-ZZZZ9999.js': bundle['assets/lazy-DDDD4444.js'] });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
  it('o worker só mexe em GET da própria origem: API e LiveKit ficam fora do cache', () => {
    const sw = buildServiceWorker({ version: 'abc', precache: ['./index.html'] });
    expect(sw).toContain("const CACHE = 'opencord-abc'");
    expect(sw).toContain('["./index.html"]');
    expect(sw).toContain("if (request.method !== 'GET') return;");
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
    expect(sw).toContain("caches.match('./index.html')");
    // código do worker é JS válido
    expect(() => new Function(sw)).not.toThrow();
  });
});

const nav = (ua: string, extra: Partial<Navigator> = {}) =>
  ({ userAgent: ua, platform: '', maxTouchPoints: 0, ...extra }) as Navigator;
const win = (standalone: boolean) =>
  ({ matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') }) }) as unknown as Window;

describe('convite de instalação', () => {
  it('iPhone e iPad (iPadOS como Mac com toque) recebem a orientação do Safari', () => {
    expect(isIos(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toBe(true);
    expect(
      isIos(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { platform: 'MacIntel', maxTouchPoints: 5 })),
    ).toBe(true);
    expect(isIos(nav('Mozilla/5.0 (Linux; Android 14) Chrome/130'))).toBe(false);
    expect(initialInstallKind(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), win(false))).toBe('ios');
  });
  it('já instalado (display-mode standalone ou navigator.standalone) não oferece de novo', () => {
    expect(isStandalone(nav('x'), win(true))).toBe(true);
    expect(isStandalone(nav('x', { standalone: true } as Partial<Navigator>), win(false))).toBe(true);
    expect(initialInstallKind(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), win(true))).toBe('none');
  });
  it('Android/desktop começam sem convite: só o beforeinstallprompt do navegador libera o botão', () => {
    expect(initialInstallKind(nav('Mozilla/5.0 (Linux; Android 14) Chrome/130'), win(false))).toBe('none');
  });
  it('navegador de celular = Android ou iOS (o motor de voz evita AudioContext nesse caso)', () => {
    expect(isMobileWeb(nav('Mozilla/5.0 (Linux; Android 14) Chrome/130'))).toBe(true);
    expect(isMobileWeb(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toBe(true);
    expect(isMobileWeb(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'))).toBe(false);
    expect(isMobileWeb(undefined)).toBe(false);
  });
});

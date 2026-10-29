import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadAppButton } from '../src/components/DownloadApp';

/** No navegador (sem window.opencord) o botão aparece com o link do servidor; sem instalador publicado, some. */
describe('DownloadAppButton (navegador)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra versão, tamanho e link quando o servidor publica o instalador', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              windows: {
                url: 'http://x/downloads/files/OpenCord%20Setup%200.2.0.exe',
                fileName: 'OpenCord Setup 0.2.0.exe',
                version: '0.2.0',
                sizeBytes: 120 * 1024 * 1024,
              },
            }),
          ),
      ),
    );
    render(<DownloadAppButton />);
    const btn = await screen.findByRole('button', { name: /Baixar para Windows 0\.2\.0 · 120 MB/ });
    const link = btn.closest('a');
    expect(link?.getAttribute('href')).toBe('http://x/downloads/files/OpenCord%20Setup%200.2.0.exe');
    expect(link?.hasAttribute('download')).toBe(true);
  });

  it('não aparece sem instalador publicado ou com servidor fora do ar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ windows: null }))),
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

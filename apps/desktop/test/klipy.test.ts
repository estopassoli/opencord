import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGifs, gifUrlOf, toGif } from '../src/lib/klipy';

const cfg = { provider: 'klipy' as const, appKey: 'chave-teste', apiUrl: 'https://api.klipy.com/' };
const file = (n: string) => ({ url: `https://static.klipy.com/ii/abc/${n}.gif`, width: 220, height: 124 });

describe('KLIPY', () => {
  afterEach(() => vi.restoreAllMocks());

  it('envia o GIF médio, mostra a miniatura e ignora item sem arquivo', () => {
    expect(toGif({ slug: 'oi', title: 'Oi', file: { md: { gif: file('md') }, sm: { gif: file('sm') } } })).toEqual({
      slug: 'oi',
      title: 'Oi',
      url: 'https://static.klipy.com/ii/abc/md.gif',
      preview: 'https://static.klipy.com/ii/abc/sm.gif',
      width: 220,
      height: 124,
    });
    expect(toGif({ slug: 'nada' })).toBeNull();
  });

  it('pesquisa direto no KLIPY com a chave e o id anônimo, e deixa anúncio de fora', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            result: true,
            data: {
              data: [
                { slug: 'a', type: 'gif', file: { md: { gif: file('a') } } },
                { slug: 'ad', type: 'ad' },
              ],
              current_page: 1,
              has_next: true,
            },
          }),
        ),
    );
    const page = await fetchGifs(cfg, { q: 'bom dia', customer: 'c123' });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://api.klipy.com/api/v1/chave-teste/gifs/search');
    expect(url.searchParams.get('q')).toBe('bom dia');
    expect(url.searchParams.get('customer_id')).toBe('c123');
    expect(page).toMatchObject({ hasNext: true, page: 1 });
    expect(page.gifs.map((g) => g.slug)).toEqual(['a']);

    await fetchGifs(cfg, { customer: 'c123' });
    expect(new URL(fetchMock.mock.calls[1]![0] as string).pathname).toBe('/api/v1/chave-teste/gifs/trending');
  });

  it('reconhece mensagem que é só um GIF do KLIPY', () => {
    expect(gifUrlOf(' https://static.klipy.com/ii/abc/x.gif ')).toBe('https://static.klipy.com/ii/abc/x.gif');
    expect(gifUrlOf('olha https://static.klipy.com/ii/abc/x.gif')).toBeNull();
    expect(gifUrlOf('https://klipy.com.evil.test/x.gif')).toBeNull();
    expect(gifUrlOf('https://evil.test/klipy.com/x.gif')).toBeNull();
  });
});

/**
 * Seletor de GIFs (ADR-0044): o app busca direto no KLIPY, como pedem os termos deles (requisições e mídia saem do
 * cliente, URLs usadas como vieram, resultados na ordem entregue). A chave vem em InstanceInfo.gifs.
 */
import type { GifFavorite, InstanceInfo } from '@opencord/contracts';

export type GifConfig = NonNullable<InstanceInfo['gifs']>;

type KlipyFile = { url: string; width: number; height: number };
type KlipyItem = {
  id?: number | string;
  slug: string;
  title?: string;
  type?: string;
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', Partial<Record<'gif' | 'webp' | 'mp4' | 'jpg', KlipyFile>>>>;
};
type KlipyPage = { result?: boolean; data?: { data?: KlipyItem[]; has_next?: boolean; current_page?: number } };
type KlipyCategories = {
  result?: boolean;
  data?: { categories?: { category: string; query: string; preview_url: string }[] };
};

export interface Gif {
  slug: string;
  title: string;
  /** enviada no chat (GIF animado em tamanho médio) */
  url: string;
  /** miniatura do seletor (a menor animação disponível) */
  preview: string;
  width: number;
  height: number;
}
export interface GifPage {
  gifs: Gif[];
  hasNext: boolean;
  page: number;
}
export interface GifCategory {
  name: string;
  query: string;
  preview: string;
}

const PER_PAGE = 24;

/** id estável e anônimo da pessoa para o KLIPY (recentes e métricas): hash do id, nunca o id em si */
export async function customerId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`opencord-gifs:${userId}`));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const base = (cfg: GifConfig) => `${cfg.apiUrl.replace(/\/+$/, '')}/api/v1/${encodeURIComponent(cfg.appKey)}/gifs`;

/** "pt_BR" a partir do idioma do navegador */
const locale = () => (navigator.language || 'pt-BR').replace('-', '_');

export function toGif(it: KlipyItem): Gif | null {
  const f = it.file;
  const send = f?.md?.gif ?? f?.hd?.gif ?? f?.sm?.gif;
  const thumb = f?.sm?.gif ?? f?.xs?.gif ?? send;
  if (!it.slug || !send?.url || !thumb?.url) return null;
  return {
    slug: it.slug,
    title: it.title ?? '',
    url: send.url,
    preview: thumb.url,
    width: send.width || 1,
    height: send.height || 1,
  };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, signal ? { signal } : {});
  if (!r.ok) throw new Error(`KLIPY respondeu ${r.status}`);
  return (await r.json()) as T;
}

/** Em alta (`q` vazio) ou pesquisa. Itens que não são GIF (ex.: anúncio) ficam de fora. */
export async function fetchGifs(
  cfg: GifConfig,
  opts: { q?: string; page?: number; customer: string; signal?: AbortSignal },
): Promise<GifPage> {
  const p = new URLSearchParams({
    page: String(opts.page ?? 1),
    per_page: String(PER_PAGE),
    customer_id: opts.customer,
    locale: locale(),
  });
  const q = opts.q?.trim();
  if (q) p.set('q', q);
  const body = await getJson<KlipyPage>(`${base(cfg)}/${q ? 'search' : 'trending'}?${p.toString()}`, opts.signal);
  const items = body.data?.data ?? [];
  return {
    gifs: items.filter((i) => !i.type || i.type === 'gif').flatMap((i) => toGif(i) ?? []),
    hasNext: Boolean(body.data?.has_next),
    page: body.data?.current_page ?? opts.page ?? 1,
  };
}

export async function fetchCategories(cfg: GifConfig, signal?: AbortSignal): Promise<GifCategory[]> {
  const body = await getJson<KlipyCategories>(`${base(cfg)}/categories?locale=${locale()}`, signal);
  return (body.data?.categories ?? []).map((c) => ({ name: c.category, query: c.query, preview: c.preview_url }));
}

/** Avisa o KLIPY que o GIF foi enviado (melhora os resultados; falha é ignorada). */
export function registerShare(cfg: GifConfig, slug: string, customer: string, q: string) {
  void fetch(`${base(cfg)}/share/${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer_id: customer, ...(q ? { q } : {}) }),
  }).catch(() => undefined);
}

export const toFavorite = (g: Gif): GifFavorite => ({
  slug: g.slug,
  url: g.url,
  preview: g.preview,
  width: g.width,
  height: g.height,
});

/** Mensagem que é só um GIF do KLIPY: o chat mostra a animação em vez do link. */
const KLIPY_MEDIA = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/\S+\.(gif|webp)(\?\S*)?$/i;
export const gifUrlOf = (body: string): string | null => {
  const t = body.trim();
  return KLIPY_MEDIA.test(t) ? t : null;
};

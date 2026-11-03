import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SpotifyKind, SpotifySearchResult, SpotifyTrackInfo } from '@opencord/contracts';
import { APP_CONFIG, type AppConfig, youtubeApiHeaders } from '../config/config.js';
import { RedisService } from '../common/redis.service.js';

/** faixa do catálogo pronta para entrar na fila */
export interface CatalogTrack extends SpotifyTrackInfo {
  title: string;
}

type Img = { url?: string; width?: number }[] | undefined;
type ApiTrack = {
  id?: string;
  name?: string;
  duration_ms?: number;
  is_local?: boolean;
  artists?: { name?: string }[];
  album?: { name?: string; images?: Img };
  external_urls?: { spotify?: string };
};

const MATCH_TTL_S = 30 * 24 * 3600;
const MISS_TTL_S = 24 * 3600;
const MAX_PAGES = 10;

/** imagem média (≈300 px) das que o Spotify devolve */
const pickImage = (imgs: Img) => {
  if (!imgs?.length) return null;
  const sorted = [...imgs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 250) ?? sorted[sorted.length - 1])?.url ?? null;
};
const artistsOf = (a: { name?: string }[] | undefined) =>
  (a ?? [])
    .map((x) => x.name)
    .filter(Boolean)
    .join(', ');

/** "PT4M13S" → 253 */
export function isoDurationSec(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** minúsculas, sem acento e sem pontuação; `keepExtras` mantém o que vem entre parênteses/colchetes */
const norm = (s: string, keepExtras = false) => {
  const base = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return (keepExtras ? base : base.replace(/\(.*?\)|\[.*?\]/g, ' ')).replace(/[^a-z0-9]+/g, ' ').trim();
};

/**
 * Nota de um candidato do YouTube para uma faixa do Spotify: duração perto, título e artista presentes, canal oficial
 * ("Artista - Topic", VEVO). Versões ao vivo, covers, karaokê e "slowed" perdem pontos quando a faixa não é assim.
 */
export function scoreCandidate(
  track: { title: string; artists: string; durationMs: number },
  c: { title: string; channel: string; durationSec: number },
): number {
  const want = track.durationMs / 1000;
  const diff = Math.abs(c.durationSec - want);
  if (want > 0 && c.durationSec > 0 && diff > Math.max(20, want * 0.12)) return -Infinity;
  const t = norm(c.title);
  const ch = norm(c.channel);
  let score = 0;
  if (t.includes(norm(track.title))) score += 4;
  const firstArtist = norm(track.artists.split(',')[0] ?? '');
  if (firstArtist && (t.includes(firstArtist) || ch.includes(firstArtist))) score += 3;
  if (/ - topic$/i.test(c.channel) || /vevo$/i.test(c.channel)) score += 3;
  if (want > 0 && c.durationSec > 0) score += Math.max(0, 3 - diff / 3);
  // "(Live …)", "[Cover]" costumam vir entre parênteses: aqui o título completo conta
  const full = ` ${norm(c.title, true)} `;
  const original = ` ${norm(track.title, true)} `;
  for (const bad of [
    'live',
    'ao vivo',
    'cover',
    'karaoke',
    'instrumental',
    'slowed',
    'reverb',
    'sped up',
    'remix',
    'lyrics',
    'letra',
  ])
    if (full.includes(` ${bad} `) && !original.includes(` ${bad} `))
      score -= bad === 'lyrics' || bad === 'letra' ? 1 : 4;
  return score;
}

/**
 * Catálogo do Spotify na atividade Música (pedido do mantenedor, 2026-11-03): pesquisa e links de faixa, álbum e
 * playlist vêm da Web API do Spotify (client credentials, só metadados). O áudio não vem do Spotify: cada faixa é
 * tocada pelo correspondente no YouTube, encontrado aqui (Data API: search + videos), no mesmo player oficial da
 * música da chamada (ADR-0014). Correspondências ficam no Redis por 30 dias; "sem correspondente", por 1 dia.
 */
@Injectable()
export class SpotifyService {
  private readonly log = new Logger('Spotify');
  private token: { value: string; until: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly redis: RedisService,
  ) {}

  get available(): boolean {
    return Boolean(this.cfg.SPOTIFY_CLIENT_ID && this.cfg.SPOTIFY_CLIENT_SECRET && this.cfg.YOUTUBE_API_KEY);
  }

  private requireAvailable() {
    if (!this.available) throw new ServiceUnavailableException('o Spotify não está configurado neste servidor');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.SPOTIFY_CLIENT_ID}:${this.cfg.SPOTIFY_CLIENT_SECRET}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(`${this.cfg.SPOTIFY_ACCOUNTS_URL}/api/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new ServiceUnavailableException('não foi possível falar com o Spotify agora');
    }
    if (!res.ok) {
      this.log.warn(`token do Spotify recusado: ${res.status}`);
      throw new ServiceUnavailableException('o Spotify recusou as credenciais deste servidor');
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new BadGatewayException('resposta inesperada do Spotify');
    this.token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  private async api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const u = new URL(`${this.cfg.SPOTIFY_API_URL}${path}`);
    u.search = new URLSearchParams(params).toString();
    const send = async () =>
      fetch(u, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
    let res: Response;
    try {
      res = await send();
      if (res.status === 401) {
        this.token = null;
        res = await send();
      }
    } catch {
      throw new ServiceUnavailableException('não foi possível falar com o Spotify agora');
    }
    if (res.status === 404 || res.status === 400)
      throw new BadRequestException('não encontrado no Spotify (playlists privadas não podem ser abertas)');
    if (res.status === 429)
      throw new ServiceUnavailableException('o Spotify pediu para esperar; tente de novo em instantes');
    if (!res.ok) throw new BadGatewayException(`o Spotify respondeu ${res.status}`);
    return (await res.json()) as T;
  }

  private toTrack(t: ApiTrack, album?: { name?: string; images?: Img }): CatalogTrack | null {
    if (!t.id || !/^[A-Za-z0-9]{22}$/.test(t.id) || t.is_local || !t.name) return null;
    const a = t.album ?? album;
    return {
      id: t.id,
      title: t.name.slice(0, 200),
      url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
      artists: artistsOf(t.artists).slice(0, 200),
      album: a?.name?.slice(0, 200) ?? null,
      image: pickImage(a?.images),
      durationMs: t.duration_ms ?? 0,
    };
  }

  async search(q: string): Promise<SpotifySearchResult> {
    this.requireAvailable();
    const j = await this.api<{
      tracks?: { items?: (ApiTrack | null)[] };
      albums?: {
        items?: ({
          id?: string;
          name?: string;
          artists?: { name?: string }[];
          images?: Img;
          total_tracks?: number;
          external_urls?: { spotify?: string };
        } | null)[];
      };
      playlists?: {
        items?: ({
          id?: string;
          name?: string;
          owner?: { display_name?: string };
          images?: Img;
          tracks?: { total?: number };
          items?: { total?: number };
          external_urls?: { spotify?: string };
        } | null)[];
      };
    }>('/search', { q, type: 'track,album,playlist', limit: '8', market: 'BR' });
    const ok = (id: string | undefined): id is string => Boolean(id && /^[A-Za-z0-9]{22}$/.test(id));
    return {
      tracks: (j.tracks?.items ?? [])
        .map((t) => (t ? this.toTrack(t) : null))
        .filter((t): t is CatalogTrack => t !== null)
        .map((t) => ({
          id: t.id,
          title: t.title,
          artists: t.artists,
          album: t.album,
          image: t.image,
          durationMs: t.durationMs,
          url: t.url,
        })),
      albums: (j.albums?.items ?? [])
        .filter((a): a is NonNullable<typeof a> => Boolean(a && ok(a.id)))
        .map((a) => ({
          id: a.id!,
          name: a.name ?? '',
          artists: artistsOf(a.artists),
          image: pickImage(a.images),
          url: a.external_urls?.spotify ?? `https://open.spotify.com/album/${a.id}`,
          total: a.total_tracks ?? 0,
        })),
      playlists: (j.playlists?.items ?? [])
        .filter((p): p is NonNullable<typeof p> => Boolean(p && ok(p.id)))
        .map((p) => ({
          id: p.id!,
          name: p.name ?? '',
          owner: p.owner?.display_name ?? '',
          image: pickImage(p.images),
          url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
          total: p.tracks?.total ?? p.items?.total ?? 0,
        })),
    };
  }

  /** Faixas de um link (faixa, álbum ou playlist), na ordem, até `max`. */
  async tracksOf(kind: SpotifyKind, id: string, max: number): Promise<CatalogTrack[]> {
    this.requireAvailable();
    if (kind === 'track') {
      const t = this.toTrack(await this.api<ApiTrack>(`/tracks/${id}`, { market: 'BR' }));
      return t ? [t] : [];
    }
    const out: CatalogTrack[] = [];
    if (kind === 'album') {
      const al = await this.api<{ name?: string; images?: Img; tracks?: { items?: ApiTrack[]; next?: string | null } }>(
        `/albums/${id}`,
        { market: 'BR' },
      );
      for (const t of al.tracks?.items ?? []) {
        const x = this.toTrack(t, al);
        if (x) out.push(x);
        if (out.length >= max) return out;
      }
      let offset = al.tracks?.items?.length ?? 0;
      for (let page = 0; al.tracks?.next && page < MAX_PAGES && out.length < max; page++) {
        const more = await this.api<{ items?: ApiTrack[]; next?: string | null }>(`/albums/${id}/tracks`, {
          limit: '50',
          offset: String(offset),
          market: 'BR',
        });
        for (const t of more.items ?? []) {
          const x = this.toTrack(t, al);
          if (x) out.push(x);
          if (out.length >= max) return out;
        }
        offset += more.items?.length ?? 0;
        if (!more.next) break;
      }
      return out;
    }
    let offset = 0;
    for (let page = 0; page < MAX_PAGES && out.length < max; page++) {
      const pl = await this.api<{
        items?: { track?: ApiTrack | null; item?: ApiTrack | null }[];
        next?: string | null;
      }>(`/playlists/${id}/tracks`, { limit: '50', offset: String(offset), market: 'BR' });
      for (const it of pl.items ?? []) {
        const t = it.track ?? it.item;
        const x = t ? this.toTrack(t) : null;
        if (x) out.push(x);
        if (out.length >= max) return out;
      }
      offset += pl.items?.length ?? 0;
      if (!pl.next) break;
    }
    return out;
  }

  /**
   * Correspondente tocável de uma faixa do catálogo: id do vídeo ou null (nenhum candidato confiável). Cacheado.
   * Custo de cota no YouTube: 101 unidades por faixa nova (search + videos); repetidas saem do cache.
   */
  async match(
    t: { id: string; title: string; artists: string; durationMs: number },
    opts: { retry?: boolean } = {},
  ): Promise<string | null> {
    const cacheKey = `spotify:match:${t.id}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached !== null && !(opts.retry && cached === '-')) return cached === '-' ? null : cached;
    const key = this.cfg.YOUTUBE_API_KEY;
    if (!key) return null;
    const firstArtist = t.artists.split(',')[0]?.trim() ?? '';
    let found: string | null = null;
    try {
      const su = new URL(`${this.cfg.YOUTUBE_API_URL}/search`);
      su.search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: '6',
        q: `${firstArtist} ${t.title}`.trim(),
        key,
      }).toString();
      const sr = await fetch(su, {
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
        headers: youtubeApiHeaders(this.cfg),
      });
      if (!sr.ok) {
        // cota esgotada ou falha: não guarda "sem correspondente" (tenta de novo depois)
        this.log.warn(`busca de correspondente falhou: ${sr.status}`);
        return null;
      }
      const sj = (await sr.json()) as {
        items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[];
      };
      const cands = (sj.items ?? [])
        .filter((i) => i.id?.videoId && /^[A-Za-z0-9_-]{11}$/.test(i.id.videoId))
        .map((i) => ({
          videoId: i.id!.videoId!,
          title: decode(i.snippet?.title ?? ''),
          channel: decode(i.snippet?.channelTitle ?? ''),
        }));
      if (cands.length) {
        const vu = new URL(`${this.cfg.YOUTUBE_API_URL}/videos`);
        vu.search = new URLSearchParams({
          part: 'contentDetails',
          id: cands.map((c) => c.videoId).join(','),
          key,
        }).toString();
        const vr = await fetch(vu, {
          redirect: 'error',
          signal: AbortSignal.timeout(6000),
          headers: youtubeApiHeaders(this.cfg),
        });
        const durations = new Map<string, number>();
        if (vr.ok) {
          const vj = (await vr.json()) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };
          for (const v of vj.items ?? [])
            if (v.id) durations.set(v.id, isoDurationSec(v.contentDetails?.duration ?? ''));
        }
        let best = -Infinity;
        for (const c of cands) {
          const sc = scoreCandidate(t, { ...c, durationSec: durations.get(c.videoId) ?? 0 });
          if (sc > best) {
            best = sc;
            found = c.videoId;
          }
        }
        // nenhum candidato com pelo menos título ou artista: melhor marcar como indisponível do que tocar outra coisa
        if (best < 3) found = null;
      }
    } catch (e) {
      this.log.warn(`correspondente: ${String(e)}`);
      return null;
    }
    await this.redis.client.set(cacheKey, found ?? '-', 'EX', found ? MATCH_TTL_S : MISS_TTL_S);
    return found;
  }
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

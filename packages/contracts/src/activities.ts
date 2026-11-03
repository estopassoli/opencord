/**
 * Atividades na chamada de voz (ADR-0009). Primeira: "Assistir juntos" (YouTube).
 * O vídeo NÃO passa pelo OpenCord: cada pessoa toca no player oficial embutido; aqui só se sincroniza o estado.
 */
import { z } from 'zod';
import { Id } from './api.js';

export const YouTubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

/** Link do YouTube (watch, youtu.be, shorts, embed, live, music) ou o próprio id → id do vídeo. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && YouTubeVideoId.safeParse(id).success ? id : null;
}

export const YouTubePlaylistId = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);

/** Playlist num link do YouTube / YouTube Music (`list=`) → id da playlist. */
export function parseYouTubePlaylistId(input: string): string | null {
  let u: URL;
  try {
    const s = input.trim();
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const id = u.searchParams.get('list');
  return id && YouTubePlaylistId.safeParse(id).success ? id : null;
}

export const ActivityState = z.object({
  kind: z.literal('youtube'),
  channelId: Id,
  serverId: Id,
  videoId: YouTubeVideoId,
  title: z.string().nullable(),
  author: z.string().nullable(),
  startedBy: Id,
  /** quem fez a última ação (play/pausa/pulo/troca) */
  updatedBy: Id,
  playing: z.boolean(),
  /** posição (s) no instante `updatedAt`; tocando, a posição atual = positionSec + (agora − updatedAt) */
  positionSec: z.number().min(0),
  /** relógio do servidor (ms) */
  updatedAt: z.number(),
  /** relógio do servidor no envio: o cliente estima a diferença para o próprio relógio */
  serverNow: z.number(),
  revision: z.number().int(),
});
export type ActivityState = z.infer<typeof ActivityState>;

export const ActivityControl = z.object({
  channelId: Id,
  action: z.enum(['play', 'pause', 'seek']),
  positionSec: z
    .number()
    .min(0)
    .max(24 * 60 * 60),
});

export const YouTubeSearchResult = z.object({
  videoId: YouTubeVideoId,
  title: z.string(),
  channel: z.string(),
  thumbnail: z.string().nullable(),
});
export type YouTubeSearchResult = z.infer<typeof YouTubeSearchResult>;

// ---------- Música na chamada (ADR-0014) ----------
/** Faixa da fila: um vídeo do YouTube / YouTube Music tocado no player oficial de cada pessoa. */
/** Spotify (catálogo): id de faixa, álbum ou playlist (22 caracteres base62). */
export const SpotifyId = z.string().regex(/^[A-Za-z0-9]{22}$/);
export const SPOTIFY_KINDS = ['track', 'album', 'playlist'] as const;
export type SpotifyKind = (typeof SPOTIFY_KINDS)[number];

/** Link do Spotify: open.spotify.com/(intl-xx/)track|album|playlist/<id> ou spotify:track:<id>. */
export function parseSpotifyLink(input: string): { kind: SpotifyKind; id: string } | null {
  const s = input.trim();
  const uri = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/.exec(s);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2]! };
  try {
    const u = new URL(s);
    if (u.hostname !== 'open.spotify.com' && u.hostname !== 'play.spotify.com') return null;
    const m = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{22})/i.exec(
      u.pathname,
    );
    return m ? { kind: m[1]!.toLowerCase() as SpotifyKind, id: m[2]! } : null;
  } catch {
    return null;
  }
}

/** Faixa vinda do catálogo do Spotify (capa, artistas, link para abrir no Spotify). */
export const SpotifyTrackInfo = z.object({
  id: SpotifyId,
  url: z.string(),
  artists: z.string(),
  album: z.string().nullable(),
  image: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
});
export type SpotifyTrackInfo = z.infer<typeof SpotifyTrackInfo>;

export const MusicTrack = z.object({
  id: Id,
  /** null: faixa do Spotify ainda sem correspondente pronto para tocar */
  videoId: YouTubeVideoId.nullable(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  addedBy: Id,
  /** faixa do catálogo do Spotify */
  spotify: SpotifyTrackInfo.optional(),
  /** não foi possível tocar (sem correspondente): fica na fila marcada e é pulada */
  unavailable: z.boolean().default(false),
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const MUSIC_QUEUE_MAX = 100;

export const MusicState = z.object({
  channelId: Id,
  serverId: Id,
  queue: z.array(MusicTrack).max(MUSIC_QUEUE_MAX),
  /** faixa atual na fila (-1 = fila terminou) */
  index: z.number().int().min(-1),
  playing: z.boolean(),
  /** posição (s) da faixa atual no instante `updatedAt` */
  positionSec: z.number().min(0),
  updatedAt: z.number(),
  serverNow: z.number(),
  updatedBy: Id,
  revision: z.number().int(),
  /** quem controla a fila (play/pausa, pular, adicionar, tirar, encerrar); quem ouve só controla o próprio player */
  djId: Id,
});
export type MusicState = z.infer<typeof MusicState>;

export const MusicControl = z.object({
  channelId: Id,
  action: z.enum(['play', 'pause', 'seek', 'next', 'prev', 'jump', 'remove', 'ended']),
  positionSec: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .optional(),
  /** faixa alvo (jump/remove) ou a que terminou (ended: só avança se ainda for a atual) */
  trackId: Id.optional(),
});
export type MusicControl = z.infer<typeof MusicControl>;

/** Resultado da pesquisa no catálogo do Spotify (atividade Música). */
export const SpotifySearchResult = z.object({
  tracks: z.array(
    z.object({
      id: SpotifyId,
      title: z.string(),
      artists: z.string(),
      album: z.string().nullable(),
      image: z.string().nullable(),
      durationMs: z.number().int(),
      url: z.string(),
    }),
  ),
  albums: z.array(
    z.object({
      id: SpotifyId,
      name: z.string(),
      artists: z.string(),
      image: z.string().nullable(),
      url: z.string(),
      total: z.number().int(),
    }),
  ),
  playlists: z.array(
    z.object({
      id: SpotifyId,
      name: z.string(),
      owner: z.string(),
      image: z.string().nullable(),
      url: z.string(),
      total: z.number().int(),
    }),
  ),
});
export type SpotifySearchResult = z.infer<typeof SpotifySearchResult>;

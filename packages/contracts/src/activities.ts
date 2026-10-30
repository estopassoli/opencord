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
export const MusicTrack = z.object({
  id: Id,
  videoId: YouTubeVideoId,
  title: z.string().nullable(),
  author: z.string().nullable(),
  addedBy: Id,
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

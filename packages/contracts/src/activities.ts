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

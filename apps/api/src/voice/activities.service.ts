import { BadGatewayException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { rooms, type ActivityState, type YouTubeSearchResult } from '@opencord/contracts';
import { forbidden } from '../common/errors.js';
import { RedisService } from '../common/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { VoiceService } from './voice.service.js';

/** A sessão some sozinha se ninguém mexer por muito tempo (e é apagada quando a chamada esvazia). */
const TTL_S = 6 * 60 * 60;
const key = (channelId: string) => `activity:${channelId}`;

/**
 * Atividades da chamada (ADR-0009). "Assistir juntos": guarda e transmite só o ESTADO (vídeo, tocando/pausado,
 * posição); cada pessoa toca o vídeo no player oficial do YouTube. Só quem está na chamada vê e controla.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly redis: RedisService,
    private readonly voice: VoiceService,
    private readonly realtime: RealtimeService,
  ) {}

  private get r() {
    return this.redis.client;
  }

  /** Exige estar na chamada desse canal; devolve o servidor. */
  private async requireInCall(userId: string, channelId: string): Promise<string> {
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId) throw forbidden('entre na chamada para usar a atividade');
    return s.serverId;
  }

  private async load(channelId: string): Promise<ActivityState | null> {
    const raw = await this.r.get(key(channelId));
    return raw ? (JSON.parse(raw) as ActivityState) : null;
  }

  private async publish(s: Omit<ActivityState, 'serverNow'>): Promise<ActivityState> {
    await this.r.set(key(s.channelId), JSON.stringify(s), 'EX', TTL_S);
    const out = { ...s, serverNow: Date.now() };
    this.realtime.emit(rooms.server(s.serverId), 'activity:state', out);
    return out;
  }

  async get(userId: string, channelId: string): Promise<ActivityState | null> {
    await this.requireInCall(userId, channelId);
    const s = await this.load(channelId);
    return s ? { ...s, serverNow: Date.now() } : null;
  }

  async startYouTube(userId: string, channelId: string, videoId: string): Promise<ActivityState> {
    const serverId = await this.requireInCall(userId, channelId);
    const prev = await this.load(channelId);
    const meta = await this.oembed(videoId);
    return this.publish({
      kind: 'youtube',
      channelId,
      serverId,
      videoId,
      title: meta?.title ?? null,
      author: meta?.author ?? null,
      startedBy: prev?.startedBy ?? userId,
      updatedBy: userId,
      playing: true,
      positionSec: 0,
      updatedAt: Date.now(),
      revision: (prev?.revision ?? 0) + 1,
    });
  }

  async control(
    userId: string,
    channelId: string,
    action: 'play' | 'pause' | 'seek',
    positionSec: number,
  ): Promise<ActivityState> {
    await this.requireInCall(userId, channelId);
    const s = await this.load(channelId);
    if (!s) throw forbidden('nenhuma atividade em andamento');
    return this.publish({
      ...s,
      playing: action === 'play' ? true : action === 'pause' ? false : s.playing,
      positionSec,
      updatedAt: Date.now(),
      updatedBy: userId,
      revision: s.revision + 1,
    });
  }

  async stop(userId: string, channelId: string): Promise<null> {
    const serverId = await this.requireInCall(userId, channelId);
    await this.end(channelId, serverId);
    return null;
  }

  /** Encerra (também chamado quando a chamada esvazia). */
  async end(channelId: string, serverId: string) {
    if ((await this.r.del(key(channelId))) > 0)
      this.realtime.emit(rooms.server(serverId), 'activity:ended', { channelId, serverId });
  }

  /** Título/canal pelo oEmbed público do YouTube (sem chave). Falha = segue sem título. */
  private async oembed(videoId: string): Promise<{ title: string; author: string } | null> {
    if (!this.cfg.YOUTUBE_OEMBED) return null;
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const j = (await res.json()) as { title?: unknown; author_name?: unknown };
      return typeof j.title === 'string'
        ? { title: j.title.slice(0, 200), author: typeof j.author_name === 'string' ? j.author_name.slice(0, 100) : '' }
        : null;
    } catch {
      return null;
    }
  }

  /** Pesquisa no YouTube (Data API v3); só com YOUTUBE_API_KEY. */
  async search(q: string): Promise<YouTubeSearchResult[]> {
    const k = this.cfg.YOUTUBE_API_KEY;
    if (!k) throw new ServiceUnavailableException('pesquisa do YouTube não configurada neste servidor; cole um link');
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',
      safeSearch: 'moderate',
      maxResults: '12',
      q,
      key: k,
    }).toString();
    let res: Response;
    try {
      res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(6000) });
    } catch {
      throw new ServiceUnavailableException('não foi possível pesquisar agora');
    }
    if (res.status === 403) throw new ServiceUnavailableException('cota diária de pesquisa do YouTube esgotada');
    if (!res.ok) throw new BadGatewayException(`o YouTube respondeu ${res.status}`);
    const j = (await res.json()) as {
      items?: {
        id?: { videoId?: string };
        snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } };
      }[];
    };
    return (j.items ?? [])
      .filter((i) => typeof i.id?.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(i.id.videoId))
      .map((i) => ({
        videoId: i.id!.videoId!,
        title: decodeEntities(i.snippet?.title ?? ''),
        channel: decodeEntities(i.snippet?.channelTitle ?? ''),
        thumbnail: i.snippet?.thumbnails?.medium?.url ?? null,
      }));
  }
}

/** A Data API devolve títulos com entidades HTML (&amp;, &#39;…). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

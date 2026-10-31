import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  /** Tocar/pausar/pular para o grupo, trocar e encerrar: só quem iniciou (os outros pausam só para si, no app). */
  private requireOwner(s: ActivityState, userId: string) {
    if (s.startedBy !== userId) throw forbidden('só quem colocou o vídeo controla a reprodução do grupo');
  }

  private async load(channelId: string): Promise<ActivityState | null> {
    const raw = await this.r.get(key(channelId));
    return raw ? (JSON.parse(raw) as ActivityState) : null;
  }

  private async publish(s: Omit<ActivityState, 'serverNow'>): Promise<ActivityState> {
    await this.r.set(key(s.channelId), JSON.stringify(s), 'EX', TTL_S);
    const out = { ...s, serverNow: Date.now() };
    this.realtime.emit(rooms.channel(s.channelId), 'activity:state', out);
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
    // trocar o vídeo de uma sessão em andamento é só para quem a iniciou
    if (prev) this.requireOwner(prev, userId);
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
    this.requireOwner(s, userId);
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
    const s = await this.load(channelId);
    if (s) this.requireOwner(s, userId);
    await this.end(channelId, serverId);
    return null;
  }

  /** Encerra (também chamado quando a chamada esvazia). */
  async end(channelId: string, serverId: string) {
    if ((await this.r.del(key(channelId))) > 0)
      this.realtime.emit(rooms.channel(channelId), 'activity:ended', { channelId, serverId });
  }

  /** Título/canal pelo oEmbed público do YouTube (sem chave). Falha = segue sem título. */
  async oembed(videoId: string): Promise<{ title: string; author: string } | null> {
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

  /**
   * Faixas de uma playlist (Data API v3, playlistItems; 1 unidade de cota por página de 50). Só com YOUTUBE_API_KEY.
   * Mixes automáticos ("RD…", "Rádio" do YouTube Music) não existem na API: dão 404 e quem chama decide o que fazer.
   * Vídeos privados ou removidos ficam de fora.
   */
  async playlist(playlistId: string, max: number): Promise<{ videoId: string; title: string; author: string }[]> {
    const k = this.cfg.YOUTUBE_API_KEY;
    if (!k) throw new ServiceUnavailableException('playlists precisam da chave do YouTube neste servidor');
    const out: { videoId: string; title: string; author: string }[] = [];
    let page: string | undefined;
    do {
      const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      u.search = new URLSearchParams({
        part: 'snippet,status',
        playlistId,
        maxResults: '50',
        key: k,
        ...(page ? { pageToken: page } : {}),
      }).toString();
      let res: Response;
      try {
        res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(8000) });
      } catch {
        throw new ServiceUnavailableException('não foi possível ler a playlist agora');
      }
      if (res.status === 404)
        throw new BadRequestException(
          'playlist não encontrada (mixes automáticos e playlists privadas não podem ser importados)',
        );
      if (res.status === 403) throw new ServiceUnavailableException('cota diária do YouTube esgotada');
      if (!res.ok) throw new BadGatewayException(`o YouTube respondeu ${res.status}`);
      const j = (await res.json()) as {
        nextPageToken?: string;
        items?: {
          status?: { privacyStatus?: string };
          snippet?: { title?: string; videoOwnerChannelTitle?: string; resourceId?: { videoId?: string } };
        }[];
      };
      for (const i of j.items ?? []) {
        const id = i.snippet?.resourceId?.videoId;
        if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id) || i.status?.privacyStatus === 'private') continue;
        out.push({
          videoId: id,
          title: decodeEntities(i.snippet?.title ?? '').slice(0, 200),
          author: decodeEntities(i.snippet?.videoOwnerChannelTitle ?? '')
            .replace(/ - Topic$/, '')
            .slice(0, 100),
        });
        if (out.length >= max) return out;
      }
      page = j.nextPageToken;
    } while (page);
    return out;
  }

  /**
   * Faixas de um mix automático ("RD…": Mix/Rádio do YouTube e YouTube Music), que a Data API não expõe.
   * NÃO OFICIAL (decisão do mantenedor, ADR-0014): lê a página do vídeo no mix e tira a lista do `ytInitialData`.
   * Pode quebrar se o YouTube mudar a página; quem chama cai para o vídeo do link.
   */
  async mix(playlistId: string, videoId: string | undefined, max: number) {
    if (!this.cfg.YOUTUBE_OEMBED) throw new ServiceUnavailableException('acesso ao YouTube desligado neste servidor');
    const u = new URL('https://www.youtube.com/watch');
    u.search = new URLSearchParams({ ...(videoId ? { v: videoId } : {}), list: playlistId }).toString();
    let html: string;
    try {
      const res = await fetch(u, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          // aceite de cookies já dado: sem isso, servidores na Europa recebem a página de consentimento
          cookie: 'CONSENT=YES+1; SOCS=CAI',
        },
      });
      if (!res.ok) throw new Error(String(res.status));
      html = await res.text();
    } catch {
      throw new ServiceUnavailableException('não foi possível ler o mix agora');
    }
    return parseMix(html, max);
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

/** Lista de um mix a partir do HTML da página do YouTube (`playlistPanelVideoRenderer` dentro do `ytInitialData`). */
export function parseMix(html: string, max: number): { videoId: string; title: string; author: string }[] {
  const start = html.indexOf('ytInitialData = ');
  if (start < 0) throw new BadGatewayException('o YouTube mudou a página do mix');
  const from = start + 'ytInitialData = '.length;
  const end = html.indexOf(';</script>', from);
  let data: unknown;
  try {
    data = JSON.parse(html.slice(from, end));
  } catch {
    throw new BadGatewayException('o YouTube mudou a página do mix');
  }
  type Text = { simpleText?: string; runs?: { text?: string }[] };
  const text = (t: Text | undefined) => t?.simpleText ?? t?.runs?.map((r) => r.text ?? '').join('') ?? '';
  const out: { videoId: string; title: string; author: string }[] = [];
  const seen = new Set<string>();
  const walk = (n: unknown) => {
    if (out.length >= max || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const o = n as Record<string, unknown>;
    const r = o.playlistPanelVideoRenderer as
      { videoId?: string; title?: Text; shortBylineText?: Text; longBylineText?: Text } | undefined;
    if (r?.videoId && /^[A-Za-z0-9_-]{11}$/.test(r.videoId) && !seen.has(r.videoId)) {
      seen.add(r.videoId);
      out.push({
        videoId: r.videoId,
        title: text(r.title).slice(0, 200),
        author: text(r.shortBylineText ?? r.longBylineText)
          .replace(/ - Topic$/, '')
          .slice(0, 100),
      });
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  if (!out.length) throw new BadGatewayException('o YouTube mudou a página do mix');
  return out;
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { MUSIC_QUEUE_MAX, rooms, type MusicState, type MusicTrack } from '@opencord/contracts';
import { randomUUID } from 'node:crypto';
import { forbidden } from '../common/errors.js';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ActivitiesService } from './activities.service.js';
import { VoiceService } from './voice.service.js';

const TTL_S = 6 * 60 * 60;
const key = (channelId: string) => `music:${channelId}`;

type Stored = Omit<MusicState, 'serverNow'>;

/**
 * Música na chamada (ADR-0014): fila compartilhada de vídeos do YouTube/YouTube Music. Como no "Assistir juntos",
 * o áudio não passa pelo OpenCord: cada pessoa toca no player oficial e aqui só se sincroniza o estado.
 * DJ (revisão do mantenedor): quem começa a música é o DJ e só ele controla (tocar/pausar, pular, tirar da fila,
 * encerrar); qualquer pessoa na chamada adiciona à fila. Quem ouve controla só o próprio player (volume, pausar para si) no app. Se o DJ sai da chamada,
 * quem está nela há mais tempo assume (VoiceService); se todos saem, a música acaba.
 */
@Injectable()
export class MusicService {
  constructor(
    private readonly redis: RedisService,
    private readonly voice: VoiceService,
    private readonly realtime: RealtimeService,
    private readonly activities: ActivitiesService,
  ) {}

  private get r() {
    return this.redis.client;
  }

  private async requireInCall(userId: string, channelId: string): Promise<string> {
    const s = await this.voice.stateOf(userId);
    if (!s || s.channelId !== channelId) throw forbidden('entre na chamada para usar a música');
    return s.serverId;
  }

  private async load(channelId: string): Promise<Stored | null> {
    const raw = await this.r.get(key(channelId));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    // fila de antes do DJ existir (deploy no meio de uma música): quem mexeu por último vira o DJ
    return s.djId ? s : { ...s, djId: s.updatedBy };
  }

  private async publish(s: Stored): Promise<MusicState> {
    await this.r.set(key(s.channelId), JSON.stringify(s), 'EX', TTL_S);
    const out = { ...s, serverNow: Date.now() };
    this.realtime.emit(rooms.server(s.serverId), 'music:state', out);
    return out;
  }

  /** posição atual da faixa (s), contando o tempo tocando desde a última mudança */
  private positionNow(s: Stored, now = Date.now()) {
    return s.playing ? s.positionSec + (now - s.updatedAt) / 1000 : s.positionSec;
  }

  async get(userId: string, channelId: string): Promise<MusicState | null> {
    await this.requireInCall(userId, channelId);
    const s = await this.load(channelId);
    return s ? { ...s, serverNow: Date.now() } : null;
  }

  private requireDj(s: Stored, userId: string) {
    if (s.djId !== userId) throw forbidden('só o DJ controla a música');
  }

  /**
   * Adiciona um vídeo, uma playlist inteira ou um vídeo dentro de playlist (a fila começa por ele). Com a fila
   * parada (sem música ou terminada), quem adiciona vira o DJ e a primeira faixa nova começa a tocar; tocando,
   * qualquer pessoa na chamada adiciona ao fim da fila e o DJ continua o mesmo.
   */
  async add(userId: string, channelId: string, src: { videoId?: string; playlistId?: string }): Promise<MusicState> {
    const serverId = await this.requireInCall(userId, channelId);
    const prev = await this.load(channelId);
    const idle = !prev || prev.index < 0 || prev.index >= prev.queue.length;
    const room = MUSIC_QUEUE_MAX - (idle ? 0 : (prev?.queue.length ?? 0));
    if (room <= 0) throw new BadRequestException('a fila está cheia');
    let found: { videoId: string; title: string | null; author: string | null }[] = [];
    if (src.playlistId) {
      try {
        // mix automático ("RD…") não existe na Data API: lido da página (não oficial, ADR-0014)
        found = src.playlistId.startsWith('RD')
          ? await this.activities.mix(src.playlistId, src.videoId, room)
          : await this.activities.playlist(src.playlistId, room);
      } catch (e) {
        // mix automático / privada / sem chave: com um vídeo no link, segue só com ele
        if (!src.videoId) throw e;
      }
      if (src.videoId) {
        const i = found.findIndex((t) => t.videoId === src.videoId);
        if (i > 0) found = [...found.slice(i), ...found.slice(0, i)];
        else if (i < 0) found = [];
      }
    }
    if (!found.length && src.videoId) {
      const meta = await this.activities.oembed(src.videoId);
      found = [{ videoId: src.videoId, title: meta?.title ?? null, author: meta?.author ?? null }];
    }
    if (!found.length) throw new BadRequestException('a playlist está vazia');
    const tracks: MusicTrack[] = found.slice(0, room).map((t) => ({
      id: randomUUID(),
      videoId: t.videoId,
      title: t.title || null,
      author: t.author || null,
      addedBy: userId,
    }));
    const now = Date.now();
    // fila terminada: recomeça do zero (a fila velha já tocou)
    const base = idle ? [] : (prev?.queue ?? []);
    const queue = [...base, ...tracks];
    return this.publish({
      channelId,
      serverId,
      queue,
      index: idle ? 0 : prev.index,
      playing: idle ? true : prev.playing,
      positionSec: idle ? 0 : this.positionNow(prev, now),
      updatedAt: now,
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
      djId: idle ? userId : prev.djId,
    });
  }

  async control(
    userId: string,
    channelId: string,
    action: 'play' | 'pause' | 'seek' | 'next' | 'prev' | 'jump' | 'remove' | 'ended',
    positionSec?: number,
    trackId?: string,
  ): Promise<MusicState> {
    await this.requireInCall(userId, channelId);
    const s = await this.load(channelId);
    if (!s) throw forbidden('nenhuma música tocando');
    // fim da faixa vem do player de quem estiver ouvindo; o resto é do DJ
    if (action !== 'ended') this.requireDj(s, userId);
    const now = Date.now();
    const pos = this.positionNow(s, now);
    const current = s.queue[s.index];
    const at = (index: number, playing = true): Stored => ({
      ...s,
      index: index >= 0 && index < s.queue.length ? index : -1,
      playing: index >= 0 && index < s.queue.length ? playing : false,
      positionSec: 0,
    });
    let next: Stored;
    switch (action) {
      case 'play':
        next = { ...s, playing: s.index >= 0, positionSec: positionSec ?? pos };
        break;
      case 'pause':
        next = { ...s, playing: false, positionSec: positionSec ?? pos };
        break;
      case 'seek':
        next = { ...s, positionSec: positionSec ?? pos };
        break;
      case 'next':
        next = at(s.index + 1);
        break;
      case 'prev':
        // no começo da faixa volta à anterior; depois de alguns segundos, reinicia a atual
        next = pos > 3 || s.index <= 0 ? { ...s, positionSec: 0 } : at(s.index - 1);
        break;
      case 'jump': {
        const i = s.queue.findIndex((t) => t.id === trackId);
        if (i < 0) throw new BadRequestException('faixa não está na fila');
        next = at(i);
        break;
      }
      case 'ended':
        // vários players avisam o fim da mesma faixa: só o primeiro aviso da faixa atual avança
        if (!current || current.id !== trackId) return { ...s, serverNow: now };
        next = at(s.index + 1);
        break;
      case 'remove': {
        const i = s.queue.findIndex((t) => t.id === trackId);
        if (i < 0) return { ...s, serverNow: now };
        const queue = s.queue.filter((t) => t.id !== trackId);
        if (i < s.index) next = { ...s, queue, index: s.index - 1, positionSec: pos };
        else if (i > s.index) next = { ...s, queue, positionSec: pos };
        else {
          // tirou a que estava tocando: segue para a que ocupou o lugar dela
          const has = s.index < queue.length;
          next = { ...s, queue, index: has ? s.index : -1, playing: has && s.playing, positionSec: 0 };
        }
        break;
      }
    }
    return this.publish({ ...next, updatedAt: now, updatedBy: userId, revision: s.revision + 1 });
  }

  async stop(userId: string, channelId: string): Promise<null> {
    const serverId = await this.requireInCall(userId, channelId);
    const s = await this.load(channelId);
    if (s) this.requireDj(s, userId);
    await this.end(channelId, serverId);
    return null;
  }

  /** Encerra (também quando a chamada esvazia). */
  async end(channelId: string, serverId: string) {
    if ((await this.r.del(key(channelId))) > 0)
      this.realtime.emit(rooms.server(serverId), 'music:ended', { channelId, serverId });
  }
}

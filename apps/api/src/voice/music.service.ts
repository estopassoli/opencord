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
 * o áudio não passa pelo OpenCord: cada pessoa toca no player oficial e aqui só se sincroniza o estado. Qualquer
 * pessoa na chamada adiciona e controla (decisão do mantenedor); o volume é de cada um, no app.
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
    return raw ? (JSON.parse(raw) as Stored) : null;
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

  /** Adiciona à fila; com a fila parada (vazia ou terminada), a faixa nova começa a tocar. */
  async add(userId: string, channelId: string, videoId: string): Promise<MusicState> {
    const serverId = await this.requireInCall(userId, channelId);
    const prev = await this.load(channelId);
    if (prev && prev.queue.length >= MUSIC_QUEUE_MAX) throw new BadRequestException('a fila está cheia');
    const meta = await this.activities.oembed(videoId);
    const track: MusicTrack = {
      id: randomUUID(),
      videoId,
      title: meta?.title ?? null,
      author: meta?.author ?? null,
      addedBy: userId,
    };
    const now = Date.now();
    const queue = [...(prev?.queue ?? []), track];
    const idle = !prev || prev.index < 0 || prev.index >= prev.queue.length;
    return this.publish({
      channelId,
      serverId,
      queue,
      index: idle ? queue.length - 1 : prev.index,
      playing: idle ? true : prev.playing,
      positionSec: idle ? 0 : this.positionNow(prev, now),
      updatedAt: now,
      updatedBy: userId,
      revision: (prev?.revision ?? 0) + 1,
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
    await this.end(channelId, serverId);
    return null;
  }

  /** Encerra (também quando a chamada esvazia). */
  async end(channelId: string, serverId: string) {
    if ((await this.r.del(key(channelId))) > 0)
      this.realtime.emit(rooms.server(serverId), 'music:ended', { channelId, serverId });
  }
}

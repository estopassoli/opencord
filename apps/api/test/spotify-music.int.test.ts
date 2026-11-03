/**
 * Catálogo do Spotify na música da chamada: pesquisa, links de faixa/álbum/playlist, correspondente tocável
 * resolvido perto de tocar (com cache) e faixa sem correspondente marcada e pulada. Spotify e YouTube são stubs locais.
 */
import http from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InstanceInfo, MusicState, ServerDetail, SpotifySearchResult } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis.service.js';
import { scoreCandidate } from '../src/voice/spotify.service.js';
import { bootstrapOwner, command, connectSocket, Http, register, resetDb, startApp } from './helpers.js';

const STUB_PORT = 4791;
const base = `http://127.0.0.1:${STUB_PORT}`;
const id22 = (c: string) => c.repeat(22);
const T1 = id22('a');
const T2 = id22('b');
const T3 = id22('c');
const ALBUM = id22('d');
const PLAYLIST = id22('e');

const track = (id: string, name: string, ms: number) => ({
  id,
  name,
  duration_ms: ms,
  artists: [{ name: 'Banda Teste' }],
  album: { name: 'Disco Teste', images: [{ url: `https://img.test/${id}.jpg`, width: 300 }] },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});
const TRACKS: Record<string, ReturnType<typeof track>> = {
  [T1]: track(T1, 'Primeira Canção', 200_000),
  [T2]: track(T2, 'Faixa Perdida', 180_000),
  [T3]: track(T3, 'Terceira Canção', 240_000),
};
/** vídeos do YouTube por palavra do título pesquisado */
const VIDEOS: Record<string, { id: string; title: string; channel: string; dur: string }[]> = {
  primeira: [
    { id: 'AAAAAAAAAA1', title: 'Banda Teste - Primeira Canção (Ao Vivo)', channel: 'Fã Clube', dur: 'PT3M21S' },
    { id: 'AAAAAAAAAA2', title: 'Primeira Canção', channel: 'Banda Teste - Topic', dur: 'PT3M20S' },
  ],
  perdida: [{ id: 'BBBBBBBBBB1', title: 'Outra coisa completamente diferente', channel: 'Aleatório', dur: 'PT11M0S' }],
  terceira: [{ id: 'CCCCCCCCCC1', title: 'Terceira Canção', channel: 'Banda Teste - Topic', dur: 'PT4M1S' }],
};
let ytSearches = 0;

function stub(): http.Server {
  return http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', base);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/accounts/api/token') return json(200, { access_token: 'tok', expires_in: 3600 });
    if (u.pathname.startsWith('/spotify/') && req.headers.authorization !== 'Bearer tok') return json(401, {});
    if (u.pathname === '/spotify/search')
      return json(200, {
        tracks: { items: [TRACKS[T1], null] },
        albums: {
          items: [
            {
              id: ALBUM,
              name: 'Disco Teste',
              artists: [{ name: 'Banda Teste' }],
              images: [],
              total_tracks: 2,
              external_urls: {},
            },
          ],
        },
        playlists: {
          items: [
            null,
            { id: PLAYLIST, name: 'Para a call', owner: { display_name: 'Ana' }, images: [], tracks: { total: 3 } },
          ],
        },
      });
    const m = /^\/spotify\/tracks\/(\w+)$/.exec(u.pathname);
    if (m) return TRACKS[m[1]!] ? json(200, TRACKS[m[1]!]) : json(404, {});
    if (u.pathname === `/spotify/albums/${ALBUM}`)
      return json(200, {
        name: 'Disco Teste',
        images: [{ url: 'https://img.test/album.jpg', width: 300 }],
        tracks: { items: [TRACKS[T1]!, TRACKS[T3]!].map(({ album: _a, ...t }) => t), next: null },
      });
    if (u.pathname === `/spotify/playlists/${PLAYLIST}/tracks`)
      return json(200, { items: [T1, T2, T3].map((id) => ({ track: TRACKS[id] })), next: null });
    if (u.pathname === '/yt/search') {
      ytSearches++;
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      const key = Object.keys(VIDEOS).find((k) => q.includes(k));
      return json(200, {
        items: (key ? VIDEOS[key]! : []).map((v) => ({
          id: { videoId: v.id },
          snippet: { title: v.title, channelTitle: v.channel },
        })),
      });
    }
    if (u.pathname === '/yt/videos') {
      const ids = (u.searchParams.get('id') ?? '').split(',');
      const all = Object.values(VIDEOS).flat();
      return json(200, {
        items: ids.map((id) => ({ id, contentDetails: { duration: all.find((v) => v.id === id)?.dur ?? 'PT0S' } })),
      });
    }
    json(404, {});
  });
}

let app: NestFastifyApplication;
let httpc: Http;
let server: http.Server;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = stub();
  await new Promise<void>((r) => server.listen(STUB_PORT, '127.0.0.1', r));
  app = await startApp({
    SPOTIFY_CLIENT_ID: 'client-id-0123456789',
    SPOTIFY_CLIENT_SECRET: 'client-secret-0123456789',
    SPOTIFY_API_URL: `${base}/spotify`,
    SPOTIFY_ACCOUNTS_URL: `${base}/accounts`,
    YOUTUBE_API_KEY: 'yt-key-0123456789',
    YOUTUBE_API_URL: `${base}/yt`,
    YOUTUBE_OEMBED: 'false',
  });
  httpc = new Http(app);
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  ytSearches = 0;
  // cache de correspondentes vive no Redis
  const r = app.get(RedisService).client;
  const keys = await r.keys('spotify:match:*');
  if (keys.length) await r.del(...keys);
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function setup() {
  const { owner, serverId } = await bootstrapOwner(httpc);
  const ana = await register(httpc, 'Ana');
  const d = await httpc.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
  const voiceId = d.body.channels.find((c) => c.kind === 'voice')!.id;
  expect((await httpc.req('POST', `/voice/channels/${voiceId}/join`, { token: ana.token })).status).toBe(201);
  const s = await connectSocket(ana.token);
  sockets.push(s);
  return { ana, voiceId, s };
}
const data = <T>(r: { ok: boolean; data?: unknown; error?: unknown }) => {
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.data as T;
};

describe('Spotify na música da chamada', () => {
  it('pesquisa faixas, álbuns e playlists; a instância anuncia o Spotify', async () => {
    const { ana } = await setup();
    const info = await httpc.req<InstanceInfo>('GET', '/auth/instance');
    expect(info.body.spotify).toBe(true);
    const r = await httpc.req<SpotifySearchResult>('GET', '/activities/spotify/search?q=banda', { token: ana.token });
    expect(r.status).toBe(200);
    expect(r.body.tracks).toEqual([
      expect.objectContaining({ id: T1, title: 'Primeira Canção', artists: 'Banda Teste', album: 'Disco Teste' }),
    ]);
    expect(r.body.albums[0]).toMatchObject({ id: ALBUM, total: 2, url: `https://open.spotify.com/album/${ALBUM}` });
    expect(r.body.playlists).toEqual([expect.objectContaining({ id: PLAYLIST, owner: 'Ana', total: 3 })]);
  });

  it('playlist: resolve a atual e a próxima; sem correspondente fica marcada e é pulada; cache evita nova busca', async () => {
    const { voiceId, s } = await setup();
    const st = data<MusicState>(
      await command(s, 'music:add', { channelId: voiceId, spotify: { kind: 'playlist', id: PLAYLIST } }),
    );
    expect(st.queue.map((t) => t.title)).toEqual(['Primeira Canção', 'Faixa Perdida', 'Terceira Canção']);
    expect(st.index).toBe(0);
    // escolhe o canal oficial, não o ao vivo
    expect(st.queue[0]).toMatchObject({ videoId: 'AAAAAAAAAA2', spotify: { id: T1, artists: 'Banda Teste' } });
    // a próxima já foi tentada: sem correspondente confiável
    expect(st.queue[1]).toMatchObject({ videoId: null, unavailable: true });
    // a terceira ainda não (gasta cota só perto de tocar)
    expect(st.queue[2]).toMatchObject({ videoId: null, unavailable: false });
    expect(ytSearches).toBe(2);

    // fim da primeira: pula a perdida e toca a terceira
    const after = data<MusicState>(
      await command(s, 'music:control', { channelId: voiceId, action: 'ended', trackId: st.queue[0]!.id }),
    );
    expect(after.index).toBe(2);
    expect(after.queue[2]!.videoId).toBe('CCCCCCCCCC1');
    expect(ytSearches).toBe(3);

    // o DJ clica na indisponível: tenta de novo (sem correspondente de novo, segue para a seguinte)
    const retried = data<MusicState>(
      await command(s, 'music:control', { channelId: voiceId, action: 'jump', trackId: st.queue[1]!.id }),
    );
    expect(ytSearches).toBe(4);
    expect(retried.queue[1]!.unavailable).toBe(true);
    expect(retried.index).toBe(2);

    // a mesma faixa de novo: sai do cache
    data<MusicState>(await command(s, 'music:add', { channelId: voiceId, spotify: { kind: 'track', id: T1 } }));
    expect(ytSearches).toBe(4);
  });

  it('álbum entra inteiro com a capa do álbum; link que não existe é recusado', async () => {
    const { voiceId, s } = await setup();
    const st = data<MusicState>(
      await command(s, 'music:add', { channelId: voiceId, spotify: { kind: 'album', id: ALBUM } }),
    );
    expect(st.queue.map((t) => t.title)).toEqual(['Primeira Canção', 'Terceira Canção']);
    expect(st.queue[1]!.spotify).toMatchObject({ album: 'Disco Teste', image: 'https://img.test/album.jpg' });
    expect((await command(s, 'music:add', { channelId: voiceId, spotify: { kind: 'track', id: id22('z') } })).ok).toBe(
      false,
    );
  });
});

describe('nota do candidato', () => {
  const t = { title: 'Primeira Canção', artists: 'Banda Teste', durationMs: 200_000 };
  it('prefere o canal oficial com a duração certa e descarta duração muito diferente', () => {
    const official = scoreCandidate(t, { title: 'Primeira Canção', channel: 'Banda Teste - Topic', durationSec: 201 });
    const live = scoreCandidate(t, { title: 'Primeira Canção (Ao Vivo)', channel: 'Fã', durationSec: 201 });
    expect(official).toBeGreaterThan(live);
    expect(scoreCandidate(t, { title: 'Primeira Canção', channel: 'x', durationSec: 600 })).toBe(-Infinity);
    // "(Live …)" entre parênteses também conta como versão ao vivo
    const vevoLive = scoreCandidate(t, {
      title: 'Banda Teste - Primeira Canção (Live On TV)',
      channel: 'BandaVEVO',
      durationSec: 199,
    });
    const vevo = scoreCandidate(t, {
      title: 'Banda Teste - Primeira Canção (Official Video)',
      channel: 'BandaVEVO',
      durationSec: 205,
    });
    expect(vevo).toBeGreaterThan(vevoLive);
  });
});

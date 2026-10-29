// Carga da SFU (F6.2): N participantes com áudio Opus sintético + S "streams" de vídeo sintético, todos assinando tudo.
// Mede CPU/RSS do processo livekit-server (via /proc) e bytes recebidos por participante. Nada é reproduzido.
// Uso: LIVEKIT_PID=$(pgrep -x livekit-server) node load/voice-load.mjs [participantes=10] [streams=3] [segundos=30]
import { readFileSync } from 'node:fs';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const [N = 10, S = 3, SECS = 30] = process.argv.slice(2).map(Number);
const URL = process.env.LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
const KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret';
const PID = Number(process.env.LIVEKIT_PID);
const room = `load-${Date.now()}`;
const W = 1280,
  H = 720,
  FPS = 30;

const token = (id) => {
  const at = new AccessToken(KEY, SECRET, { identity: id, ttl: '10m' });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
};
const procStat = () => {
  const f = readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' ');
  const ticks = Number(f[11]) + Number(f[12]);
  const rss = Number(readFileSync(`/proc/${PID}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) * 1024;
  return { ticks, rss, t: Date.now() };
};

const stops = [];
const rooms = [];
const recv = new Map();
for (let i = 0; i < N; i++) {
  const r = new Room();
  const id = `p${i}`;
  recv.set(id, 0);
  r.on(RoomEvent.TrackSubscribed, async (track) => {
    // conta frames recebidos (prova de entrega); leitura contínua
    const { AudioStream, VideoStream } = await import('@livekit/rtc-node');
    const stream = track.kind === 1 ? new AudioStream(track) : new VideoStream(track);
    (async () => {
      for await (const _ of stream) recv.set(id, recv.get(id) + 1);
    })().catch(() => undefined);
  });
  await r.connect(URL, await token(id), { autoSubscribe: true, dynacast: true });
  rooms.push(r);
  const src = new AudioSource(48000, 1);
  const o = new TrackPublishOptions();
  o.source = TrackSource.SOURCE_MICROPHONE;
  await r.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('mic', src), o);
  let ph = 0;
  let alive = true;
  (async () => {
    while (alive) {
      const d = new Int16Array(480);
      for (let k = 0; k < 480; k++) d[k] = Math.sin((ph += (2 * Math.PI * (300 + i * 20)) / 48000)) * 3000;
      await src.captureFrame(new AudioFrame(d, 48000, 1, 480));
    }
  })();
  stops.push(() => {
    alive = false;
  });
  if (i < S) {
    const vs = new VideoSource(W, H);
    const vo = new TrackPublishOptions();
    vo.source = TrackSource.SOURCE_SCREENSHARE;
    vo.simulcast = true;
    await r.localParticipant.publishTrack(LocalVideoTrack.createVideoTrack('screen', vs), vo);
    const buf = new Uint8Array(W * H * 4);
    let n = 0;
    const timer = setInterval(() => {
      buf.fill((n++ * 7) % 255);
      vs.captureFrame(new VideoFrame(buf, W, H, VideoBufferType.RGBA));
    }, 1000 / FPS);
    stops.push(() => clearInterval(timer));
  }
}
await new Promise((r) => setTimeout(r, 5000)); // aquecimento
const a = procStat();
const recvA = new Map(recv);
await new Promise((r) => setTimeout(r, SECS * 1000));
const b = procStat();
const hz = 100;
const cpuPct = ((b.ticks - a.ticks) / hz / ((b.t - a.t) / 1000)) * 100;
const perParticipant = [...recv].map(([id, v]) => ({ id, framesPerSec: Math.round((v - recvA.get(id)) / SECS) }));
console.log(
  JSON.stringify(
    {
      room,
      participants: N,
      videoStreams: S,
      video: `${W}x${H}@${FPS} simulcast`,
      seconds: SECS,
      livekitCpuPercentOfOneCore: Math.round(cpuPct),
      livekitRssMiB: Math.round(b.rss / 2 ** 20),
      minRecvFramesPerSec: Math.min(...perParticipant.map((p) => p.framesPerSec)),
      perParticipant,
    },
    null,
    1,
  ),
);
for (const s of stops) s();
for (const r of rooms) await r.disconnect();
process.exit(0);

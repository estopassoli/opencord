// F0.2 — PoC isolada: dois participantes LiveKit com áudio bidirecional.
// Cada participante publica um tom senoidal distinto (A=440 Hz, B=880 Hz) e verifica,
// pelo algoritmo de Goertzel, que recebe o tom do outro participante via SFU.
// Uso: LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret node poc.mjs
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';

const url = process.env.LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';
const SAMPLE_RATE = 48000;
const FRAME_MS = 10;
const SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
const LISTEN_MS = 4000;
const roomName = `poc-${randomUUID()}`;

async function mintToken(identity) {
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '5m' });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

function goertzel(samples, freq) {
  const k = (2 * Math.cos((2 * Math.PI * freq) / SAMPLE_RATE));
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s0 = x + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / samples.length;
}

async function startTone(source, freq, signal) {
  let phase = 0;
  const step = (2 * Math.PI * freq) / SAMPLE_RATE;
  while (!signal.aborted) {
    const data = new Int16Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      data[i] = Math.round(Math.sin(phase) * 8000);
      phase += step;
    }
    await source.captureFrame(new AudioFrame(data, SAMPLE_RATE, 1, SAMPLES));
  }
}

async function participant(identity, freq) {
  const room = new Room();
  const t0 = performance.now();
  await room.connect(url, await mintToken(identity), { autoSubscribe: true, dynacast: false });
  const connectMs = performance.now() - t0;
  const source = new AudioSource(SAMPLE_RATE, 1);
  const track = LocalAudioTrack.createAudioTrack('microphone', source);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, opts);
  const abort = new AbortController();
  const toneDone = startTone(source, freq, abort.signal);

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${identity}: nenhuma trilha remota em 10s`)), 10000);
    room.on(RoomEvent.TrackSubscribed, async (remoteTrack, _pub, remote) => {
      if (remoteTrack.kind !== TrackKind.KIND_AUDIO) return;
      clearTimeout(timer);
      const firstAudioAt = performance.now();
      const stream = new AudioStream(remoteTrack, SAMPLE_RATE, 1);
      const collected = [];
      const deadline = Date.now() + LISTEN_MS;
      for await (const frame of stream) {
        collected.push(...frame.data);
        if (Date.now() > deadline) break;
      }
      // descarta 500 ms iniciais (jitter buffer / silêncio de arranque)
      const tail = collected.slice(SAMPLE_RATE / 2);
      resolve({
        from: remote.identity,
        samples: tail.length,
        e440: goertzel(tail, 440),
        e880: goertzel(tail, 880),
        subscribeAfterConnectMs: Math.round(firstAudioAt - t0 - connectMs),
      });
    });
  });

  return {
    identity,
    connectMs: Math.round(connectMs),
    received,
    async close() {
      abort.abort();
      await toneDone.catch(() => {});
      await room.disconnect();
    },
  };
}

const a = await participant('alice', 440);
const b = await participant('bob', 880);
let ok = false;
try {
  const [ra, rb] = await Promise.all([a.received, b.received]);
  const report = {
    livekitUrl: url,
    room: roomName,
    alice: { connectMs: a.connectMs, heard: ra },
    bob: { connectMs: b.connectMs, heard: rb },
  };
  // alice deve ouvir 880 Hz (bob) dominante; bob deve ouvir 440 Hz (alice)
  const aliceOk = ra.from === 'bob' && ra.e880 > 10 * ra.e440 && ra.samples > SAMPLE_RATE;
  const bobOk = rb.from === 'alice' && rb.e440 > 10 * rb.e880 && rb.samples > SAMPLE_RATE;
  ok = aliceOk && bobOk;
  console.log(JSON.stringify({ ...report, aliceOk, bobOk, result: ok ? 'PASS' : 'FAIL' }, null, 2));
} finally {
  await a.close();
  await b.close();
}
process.exit(ok ? 0 : 1);

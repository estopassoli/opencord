// Testes executados no renderer (sandbox, sem Node). Resultados enviados via bridge allowlist.
const TONE_HZ = 1234; // frequência pouco comum para distinguir do áudio ambiente
const logEl = document.getElementById('log');
const preview = document.getElementById('preview');
const log = (...a) => (logEl.textContent += a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureFps(track, ms = 2000) {
  preview.srcObject = new MediaStream([track]);
  await preview.play();
  let frames = 0;
  const start = performance.now();
  // Conteúdo estático pode não gerar quadros novos: o prazo é sempre respeitado.
  await new Promise((resolve) => {
    const deadline = setTimeout(resolve, ms + 250);
    const tick = () => {
      frames++;
      if (performance.now() - start < ms) preview.requestVideoFrameCallback(tick);
      else {
        clearTimeout(deadline);
        resolve();
      }
    };
    preview.requestVideoFrameCallback(tick);
  });
  const fps = frames / ((performance.now() - start) / 1000);
  return { fps: Math.round(fps * 10) / 10, videoWidth: preview.videoWidth, videoHeight: preview.videoHeight };
}

// Mede o nível (dB) no bin do tom, antes e durante a reprodução local do tom.
async function measureLoopbackTone(audioTrack, external = false) {
  if (!window.__withTone) return { skipped: 'tom desativado (use --with-tone)' };
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser); // não conectar ao destination: evita realimentação
  const buf = new Float32Array(analyser.frequencyBinCount);
  const bin = Math.round(TONE_HZ / (ctx.sampleRate / analyser.fftSize));
  const sample = async (ms) => {
    const vals = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      analyser.getFloatFrequencyData(buf);
      vals.push(Math.max(buf[bin - 1], buf[bin], buf[bin + 1]));
      await sleep(50);
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)]; // mediana em dB
  };
  await sleep(300);
  const baselineDb = await sample(1000);
  let toneDb;
  if (external) {
    const played = window.poc.externalTone(TONE_HZ);
    await sleep(400); // tempo de arranque do PowerShell
    toneDb = await sample(900);
    await played;
  } else {
    const out = new AudioContext();
    const osc = out.createOscillator();
    const gain = out.createGain();
    osc.frequency.value = TONE_HZ;
    gain.gain.value = 0.05; // volume baixo
    osc.connect(gain).connect(out.destination);
    osc.start();
    await sleep(200);
    toneDb = await sample(1300);
    osc.stop();
    await out.close();
  }
  await ctx.close();
  // -Infinity (silêncio digital) não é serializável em JSON
  const db = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : String(v));
  return {
    source: external ? 'external-process' : 'same-process',
    sampleRate: ctx.sampleRate,
    toneHz: TONE_HZ,
    baselineDb: db(baselineDb),
    toneDb: db(toneDb),
    deltaDb: db(toneDb - baselineDb),
    detected: Number.isFinite(toneDb) && toneDb > -80 && toneDb - baselineDb > 20,
  };
}

async function capture(sourceId, audio, fps = 60, audioConstraints = true) {
  await window.poc.grant(sourceId, audio);
  const t0 = performance.now();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: audio ? audioConstraints : false,
  });
  return { stream, acquireMs: Math.round(performance.now() - t0) };
}

function trackInfo(t) {
  const s = t.getSettings();
  return { kind: t.kind, readyState: t.readyState, settings: { width: s.width, height: s.height, frameRate: s.frameRate, sampleRate: s.sampleRate, channelCount: s.channelCount, displaySurface: s.displaySurface } };
}

async function stopAndVerify(stream) {
  const tracks = stream.getTracks();
  const t0 = performance.now();
  tracks.forEach((t) => t.stop());
  preview.srcObject = null;
  return { stopMs: Math.round(performance.now() - t0), allEnded: tracks.every((t) => t.readyState === 'ended'), streamActive: stream.active };
}

async function run(name, fn) {
  try {
    const r = await fn();
    log(name, 'OK', JSON.stringify(r));
    await window.poc.result({ name, ok: true, ...r });
  } catch (e) {
    log(name, 'ERRO', String(e));
    await window.poc.result({ name, ok: false, error: `${e.name}: ${e.message}` });
  }
}

(async () => {
  const plan = await window.poc.plan();
  window.__withTone = plan.withTone === true;
  if (!plan.screenId) {
    await window.poc.result({ name: 'plan', ok: false, error: 'nenhum monitor' });
    return window.poc.done();
  }

  // Silencioso: codecs WebRTC disponíveis e eficiência (proxy de encoder por hardware).
  await run('webrtc codec capabilities', async () => {
    const caps = RTCRtpSender.getCapabilities('video');
    const mimes = [...new Set(caps.codecs.map((c) => c.mimeType))].filter((m) => !/rtx|red|ulpfec|flexfec/i.test(m));
    const probe = {};
    for (const [label, contentType] of [['H264', 'video/H264'], ['VP8', 'video/VP8'], ['VP9', 'video/VP9'], ['AV1', 'video/AV1']]) {
      for (const [w, h, fr] of [[1280, 720, 30], [1920, 1080, 60], [2560, 1440, 60]]) {
        const info = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType, width: w, height: h, bitrate: 6_000_000, framerate: fr } });
        probe[`${label} ${h}p${fr}`] = { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
      }
    }
    return { sendCodecs: mimes, encodingInfo: probe };
  });

  // Silencioso: encoder efetivamente usado por codec (loopback WebRTC local, sem rede/sem áudio).
  await run('webrtc encoder implementation (screen 1080p60)', async () => {
    const { stream } = await capture(plan.screenId, false, 60);
    const [v] = stream.getVideoTracks();
    const results = {};
    for (const mime of ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1', 'video/H265']) {
      const pcA = new RTCPeerConnection();
      const pcB = new RTCPeerConnection();
      pcA.onicecandidate = (e) => e.candidate && pcB.addIceCandidate(e.candidate);
      pcB.onicecandidate = (e) => e.candidate && pcA.addIceCandidate(e.candidate);
      const tr = pcA.addTransceiver(v, { direction: 'sendonly', sendEncodings: [{ maxBitrate: 8_000_000, maxFramerate: 60 }] });
      const codecs = RTCRtpSender.getCapabilities('video').codecs.filter((c) => c.mimeType === mime);
      if (!codecs.length) { results[mime] = { supported: false }; pcA.close(); pcB.close(); continue; }
      tr.setCodecPreferences(codecs);
      await pcA.setLocalDescription();
      await pcB.setRemoteDescription(pcA.localDescription);
      await pcB.setLocalDescription();
      await pcA.setRemoteDescription(pcB.localDescription);
      await sleep(3000);
      const stats = await pcA.getStats();
      let out = null;
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          out = { encoderImplementation: r.encoderImplementation, powerEfficientEncoder: r.powerEfficientEncoder, frameWidth: r.frameWidth, frameHeight: r.frameHeight, framesPerSecond: r.framesPerSecond, qualityLimitationReason: r.qualityLimitationReason };
          const c = stats.get(r.codecId);
          if (c) out.codec = c.mimeType;
        }
      });
      results[mime] = out ?? { error: 'sem outbound-rtp' };
      pcA.close();
      pcB.close();
    }
    await stopAndVerify(stream);
    return { results };
  });

  await run('screen+systemAudio', async () => {
    const { stream, acquireMs } = await capture(plan.screenId, true);
    const [v] = stream.getVideoTracks();
    const [a] = stream.getAudioTracks();
    const video = { ...trackInfo(v), ...(await measureFps(v)) };
    const audio = a ? { ...trackInfo(a), loopback: await measureLoopbackTone(a) } : null;
    const stop = await stopAndVerify(stream);
    return { acquireMs, videoTracks: stream.getVideoTracks().length, audioTracks: audio ? 1 : 0, video, audio, stop };
  });

  await run('screen recapture after stop (30fps)', async () => {
    const { stream, acquireMs } = await capture(plan.screenId, true, 30);
    const [v] = stream.getVideoTracks();
    const video = { ...trackInfo(v), ...(await measureFps(v, 1500)) };
    const [a] = stream.getAudioTracks();
    const externalLoopback = a ? await measureLoopbackTone(a, true) : null;
    const stop = await stopAndVerify(stream);
    return { acquireMs, audioTracks: stream.getAudioTracks().length, video, externalLoopback, stop };
  });

  // Excluir o áudio do próprio OpenCord (vozes da chamada) do loopback, mantendo apps externos.
  await run('screen+systemAudio restrictOwnAudio', async () => {
    const { stream, acquireMs } = await capture(plan.screenId, true, 30, { restrictOwnAudio: true });
    const [a] = stream.getAudioTracks();
    const supported = navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio === true;
    const settings = a ? a.getSettings() : null;
    const sameProcess = a ? await measureLoopbackTone(a, false) : null;
    const externalProcess = a ? await measureLoopbackTone(a, true) : null;
    const stop = await stopAndVerify(stream);
    return { acquireMs, supported, appliedRestrictOwnAudio: settings?.restrictOwnAudio ?? null, sameProcess, externalProcess, stop };
  });

  if (plan.targetWindowId) {
    await run('own window video + source closed ends track', async () => {
      const { stream, acquireMs } = await capture(plan.targetWindowId, false);
      const [v] = stream.getVideoTracks();
      const video = { ...trackInfo(v), ...(await measureFps(v, 1500)) };
      const ended = new Promise((r) => v.addEventListener('ended', () => r(true), { once: true }));
      const t0 = performance.now();
      await window.poc.closeTarget();
      const endedOnClose = await Promise.race([ended, sleep(5000).then(() => false)]);
      const endMs = Math.round(performance.now() - t0);
      const readyStateAfterClose = v.readyState;
      const stop = await stopAndVerify(stream);
      return { acquireMs, video, endedOnClose, endMs, readyStateAfterClose, stop };
    });
  } else {
    await window.poc.result({ name: 'own window video + source closed ends track', ok: false, error: `janela-alvo não listada (listed=${plan.targetIdListed})` });
  }

  if (plan.windowId) {
    await run('third-party window video (informativo)', async () => {
      const { stream, acquireMs } = await capture(plan.windowId, false);
      const [v] = stream.getVideoTracks();
      const video = { ...trackInfo(v), ...(await measureFps(v, 1500)) };
      const stop = await stopAndVerify(stream);
      return { acquireMs, video, stop };
    });
  } else {
    await window.poc.result({ name: 'window video', ok: false, error: 'nenhuma janela elegível' });
  }

  await window.poc.done();
})();

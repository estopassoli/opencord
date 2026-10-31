import { bridge } from '../lib/bridge';
// arquivo próprio: o CSP (script-src 'self') não aceita o worklet embutido como data:
import workletUrl from './pcm-worklet.js?url&no-inline';

/**
 * Som dos clipes em trilhas separadas (ADR-0022, ADR-0024), mais a mistura de todas (a trilha principal do arquivo):
 * - a saída padrão do Windows, sem o som do próprio OpenCord (captura do Chromium);
 * - cada outra saída do Windows (ex.: o "Chat"/"Voice" de um fone com duas saídas), pelo oc-audio.exe;
 * - o meu microfone, as vozes da chamada e os efeitos sonoros, direto do app.
 * Se o OpenCord toca numa das outras saídas, as vozes e os efeitos já estão no som dela e não ganham trilha própria
 * (senão sairiam dobrados).
 */
export interface ClipAudioOptions {
  system: MediaStreamTrack | null;
  /** nome da trilha da saída padrão */
  systemName: string;
  /** outras saídas do Windows a gravar */
  outputs: { id: string; name: string }[];
  /** o OpenCord toca numa das `outputs` */
  opencordInOutputs: boolean;
  mic: () => MediaStreamTrack | null;
  voices: () => MediaStreamTrack[];
}

interface Lane {
  name: string;
  dest: MediaStreamAudioDestinationNode;
}

export const MIC_TRACK = 'Microfone';
export const VOICES_TRACK = 'Vozes da chamada';
export const FX_TRACK = 'Efeitos sonoros';

export class ClipAudio {
  private readonly mix: MediaStreamAudioDestinationNode;
  private readonly lanes: Lane[] = [];
  private readonly mic: Lane;
  private readonly voices: Lane | null;
  private readonly fx: Lane | null;
  private readonly live = new Map<string, MediaStreamAudioSourceNode>();
  private readonly players = new Map<string, AudioWorkletNode>();
  private offPcm: (() => void) | null = null;
  private readonly bytesIn: Record<string, number> = {};
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly opts: ClipAudioOptions,
    outputs: ClipAudioOptions['outputs'],
  ) {
    this.mix = ctx.createMediaStreamDestination();
    const lane = (name: string) => {
      const l = { name, dest: this.ctx.createMediaStreamDestination() };
      this.lanes.push(l);
      return l;
    };
    const system = lane(opts.systemName);
    if (opts.system) this.route(this.ctx.createMediaStreamSource(new MediaStream([opts.system])), system);
    for (const o of outputs) {
      const node = new AudioWorkletNode(this.ctx, 'oc-pcm-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.route(node, lane(o.name));
      this.players.set(o.id, node);
    }
    this.mic = lane(MIC_TRACK);
    const own = opts.opencordInOutputs && outputs.length > 0;
    this.voices = own ? null : lane(VOICES_TRACK);
    this.fx = own ? null : lane(FX_TRACK);
    // trilha sem nenhuma fonte não gera amostras (medido no E2E: voz e efeitos sumiam do arquivo); o silêncio contínuo
    // mantém todas as trilhas com a mesma duração
    const silence = this.ctx.createConstantSource();
    silence.offset.value = 0;
    for (const d of [this.mix, ...this.lanes.map((l) => l.dest)]) silence.connect(d);
    silence.start();
  }

  static async create(opts: ClipAudioOptions): Promise<ClipAudio> {
    const ctx = new AudioContext({ sampleRate: 48_000 });
    // o worklet precisa estar no contexto antes de criar os nós; sem ele (ou fora do Windows), só as outras trilhas
    let outputs = bridge?.winAudio ? opts.outputs : [];
    if (outputs.length) {
      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } catch {
        outputs = [];
      }
    }
    const a = new ClipAudio(ctx, opts, outputs);
    await ctx.resume().catch(() => undefined);
    a.listen();
    a.sync();
    a.timer = setInterval(() => a.sync(), 1000);
    return a;
  }

  private listen() {
    if (!this.players.size || !bridge) return;
    this.offPcm = bridge.on('win-audio', ({ id, pcm }) => {
      const node = this.players.get(id);
      if (!node) return;
      this.bytesIn[id] = (this.bytesIn[id] ?? 0) + pcm.byteLength;
      const whole = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength;
      const buf = (whole ? pcm.buffer : pcm.slice().buffer) as ArrayBuffer;
      node.port.postMessage(buf, [buf]);
    });
    for (const id of this.players.keys()) void bridge.winAudio.start(id).catch(() => undefined);
  }

  private route(node: AudioNode, to: Lane) {
    node.connect(to.dest);
    node.connect(this.mix);
  }

  /** entra e sai gente da chamada, o microfone muda: revisa a cada segundo */
  private sync() {
    const want = new Map<string, [MediaStreamTrack, Lane]>();
    const mic = this.opts.mic();
    if (mic?.readyState === 'live') want.set(mic.id, [mic, this.mic]);
    if (this.voices)
      for (const t of this.opts.voices()) if (t.readyState === 'live') want.set(t.id, [t, this.voices]);
    for (const [id, node] of this.live)
      if (!want.has(id)) {
        node.disconnect();
        this.live.delete(id);
      }
    for (const [id, [t, lane]] of want)
      if (!this.live.has(id)) {
        const node = this.ctx.createMediaStreamSource(new MediaStream([t]));
        this.route(node, lane);
        this.live.set(id, node);
      }
  }

  /** um efeito sonoro tocando agora (o som do elemento vai para a trilha de efeitos) */
  addEffect(stream: MediaStream, el: HTMLMediaElement) {
    if (!this.fx || !stream.getAudioTracks().length) return;
    const node = this.ctx.createMediaStreamSource(stream);
    this.route(node, this.fx);
    // efeitos não têm limite de duração: solta quando o som acaba ou é parado
    const done = () => node.disconnect();
    for (const ev of ['ended', 'pause', 'error']) el.addEventListener(ev, done, { once: true });
  }

  /** diagnóstico: bytes de PCM recebidos de cada saída */
  received(): Record<string, number> {
    return { ...this.bytesIn };
  }

  /** nomes das trilhas, na ordem de `tracks()` (a primeira é a mistura) */
  names(): string[] {
    return ['Tudo', ...this.lanes.map((l) => l.name)];
  }

  tracks(): MediaStreamTrack[] {
    return [this.mix, ...this.lanes.map((l) => l.dest)].map((d) => d.stream.getAudioTracks()[0]!);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.offPcm?.();
    for (const id of this.players.keys()) void bridge?.winAudio.stop(id).catch(() => undefined);
    for (const n of this.live.values()) n.disconnect();
    this.live.clear();
    void this.ctx.close().catch(() => undefined);
  }
}

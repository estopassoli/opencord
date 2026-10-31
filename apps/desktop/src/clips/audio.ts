/**
 * Som dos clipes em trilhas separadas (ADR-0022): computador (som do sistema sem o próprio OpenCord), voz da chamada
 * e efeitos sonoros, cada uma numa trilha, mais a mistura das três (a trilha principal do arquivo).
 */
export class ClipAudio {
  private readonly ctx = new AudioContext({ sampleRate: 48_000 });
  private readonly mix = this.ctx.createMediaStreamDestination();
  private readonly computer = this.ctx.createMediaStreamDestination();
  private readonly voice = this.ctx.createMediaStreamDestination();
  private readonly fx = this.ctx.createMediaStreamDestination();
  private readonly voiceNodes = new Map<string, MediaStreamAudioSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    system: MediaStreamTrack | null,
    private readonly voiceTracks: () => MediaStreamTrack[],
  ) {
    void this.ctx.resume().catch(() => undefined);
    // trilha sem nenhuma fonte não gera amostras (medido no E2E: voz e efeitos sumiam do arquivo); o silêncio contínuo
    // mantém as quatro trilhas com a mesma duração
    const silence = this.ctx.createConstantSource();
    silence.offset.value = 0;
    for (const d of [this.mix, this.computer, this.voice, this.fx]) silence.connect(d);
    silence.start();
    if (system) this.route(this.ctx.createMediaStreamSource(new MediaStream([system])), this.computer);
    this.sync();
    this.timer = setInterval(() => this.sync(), 1000);
  }

  private route(node: AudioNode, to: MediaStreamAudioDestinationNode) {
    node.connect(to);
    node.connect(this.mix);
  }

  /** entra e sai gente da chamada: revisa a cada segundo */
  private sync() {
    const live = new Map(
      this.voiceTracks()
        .filter((t) => t.readyState === 'live')
        .map((t) => [t.id, t]),
    );
    for (const [id, node] of this.voiceNodes)
      if (!live.has(id)) {
        node.disconnect();
        this.voiceNodes.delete(id);
      }
    for (const [id, t] of live)
      if (!this.voiceNodes.has(id)) {
        const node = this.ctx.createMediaStreamSource(new MediaStream([t]));
        this.route(node, this.voice);
        this.voiceNodes.set(id, node);
      }
  }

  /** um efeito sonoro tocando agora (o som do elemento vai para a trilha de efeitos) */
  addEffect(stream: MediaStream) {
    if (!stream.getAudioTracks().length) return;
    const node = this.ctx.createMediaStreamSource(stream);
    this.route(node, this.fx);
    const done = () => node.disconnect();
    stream.getAudioTracks()[0]!.addEventListener('ended', done, { once: true });
    setTimeout(done, 15_000);
  }

  /** na ordem de CLIP_AUDIO_NAMES: mistura, computador, voz, efeitos */
  tracks(): MediaStreamTrack[] {
    return [this.mix, this.computer, this.voice, this.fx].map((d) => d.stream.getAudioTracks()[0]!);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const n of this.voiceNodes.values()) n.disconnect();
    this.voiceNodes.clear();
    void this.ctx.close().catch(() => undefined);
  }
}

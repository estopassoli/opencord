/* global AudioWorkletProcessor, registerProcessor */
// Toca na Web Audio o PCM que chega de uma saída do Windows (ADR-0024): float32 estéreo intercalado, 48 kHz.
// Fila curta: o relógio da placa e o da Web Audio não são iguais, então o excesso é descartado e a falta vira silêncio.
const MAX = 9600; // 200 ms
const KEEP = 4800; // volta para 100 ms

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.off = 0;
    this.frames = 0;
    this.port.onmessage = (e) => {
      const f = new Float32Array(e.data);
      this.q.push(f);
      this.frames += f.length / 2;
      while (this.frames > MAX && this.q.length) {
        const drop = Math.min(this.frames - KEEP, (this.q[0].length - this.off) / 2);
        this.off += drop * 2;
        this.frames -= drop;
        if (this.off >= this.q[0].length) {
          this.q.shift();
          this.off = 0;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const [l, r] = outputs[0];
    for (let i = 0; i < l.length; i++) {
      const head = this.q[0];
      if (!head) {
        l[i] = 0;
        if (r) r[i] = 0;
        continue;
      }
      l[i] = head[this.off];
      if (r) r[i] = head[this.off + 1];
      this.off += 2;
      this.frames--;
      if (this.off >= head.length) {
        this.q.shift();
        this.off = 0;
      }
    }
    return true;
  }
}

registerProcessor('oc-pcm-player', PcmPlayer);

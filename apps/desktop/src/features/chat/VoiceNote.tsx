/**
 * Mensagem de voz na conversa: player com forma de onda, tocar/pausar, clique para avançar e o tempo. A forma de
 * onda e a duração vêm do próprio áudio (decodificado uma vez): o WebM gravado pelo navegador não traz a duração nos
 * metadados. Se não der para decodificar, cai no player comum.
 */
import type { Attachment } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';

export const BARS = 48;

/** Altura relativa (0–1) de cada barra: pico de cada fatia, normalizado pelo maior. Puro, para teste. */
export function peaksOf(samples: Float32Array, bars = BARS): number[] {
  if (samples.length === 0) return Array.from({ length: bars }, () => 0);
  const size = Math.max(1, Math.floor(samples.length / bars));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    const end = Math.min(samples.length, (i + 1) * size);
    for (let j = i * size; j < end; j++) {
      const v = Math.abs(samples[j] as number);
      if (v > peak) peak = v;
    }
    out.push(peak);
  }
  const max = Math.max(...out) || 1;
  return out.map((p) => p / max);
}

export const fmt = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const cache = new Map<string, Promise<{ peaks: number[]; duration: number } | null>>();
function analyze(a: Attachment) {
  let p = cache.get(a.id);
  if (!p) {
    p = (async () => {
      try {
        const buf = await (await fetch(a.url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 48_000);
        const audio = await ctx.decodeAudioData(buf);
        return { peaks: peaksOf(audio.getChannelData(0)), duration: audio.duration };
      } catch {
        return null;
      }
    })();
    cache.set(a.id, p);
  }
  return p;
}

export function VoiceNote({ attachment }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [info, setInfo] = useState<{ peaks: number[]; duration: number } | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);

  useEffect(() => {
    let alive = true;
    void analyze(attachment).then((r) => alive && setInfo(r));
    return () => {
      alive = false;
    };
  }, [attachment]);

  if (info === null) return <audio src={attachment.url} controls preload="metadata" className="attachment-audio" />;

  const duration = info?.duration ?? 0;
  const progress = duration ? Math.min(1, t / duration) : 0;
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration));
  };

  return (
    <div className="voice-note" data-playing={playing ? 'true' : undefined}>
      <audio
        ref={audio}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setT(0)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
      />
      <button
        className="icon-btn voice-note-play"
        aria-label={playing ? 'Pausar mensagem de voz' : 'Ouvir mensagem de voz'}
        onClick={toggle}
        disabled={info === undefined}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div
        className="voice-note-wave"
        role="slider"
        aria-label="Posição"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t)}
        tabIndex={0}
        onClick={seek}
        onKeyDown={(e) => {
          const el = audio.current;
          if (!el) return;
          if (e.key === 'ArrowRight') el.currentTime = Math.min(duration, el.currentTime + 5);
          else if (e.key === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5);
          else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ '--voice-progress': `${progress * 100}%` } as React.CSSProperties}
      >
        {(info?.peaks ?? Array.from({ length: BARS }, () => 0.15)).map((p, i) => (
          <span key={i} style={{ height: `${Math.max(8, p * 100)}%` }} />
        ))}
      </div>
      <span className="voice-note-time small muted">{playing || t > 0 ? fmt(t) : fmt(duration)}</span>
    </div>
  );
}

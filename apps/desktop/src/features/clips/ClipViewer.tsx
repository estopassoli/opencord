/**
 * Visualizador de clipes (ADR-0022): toca o clipe, mostra a linha do tempo com miniaturas e bordas para cortar, e
 * exporta o trecho como vídeo ou áudio, copia o arquivo, mostra na pasta, apaga ou manda o som para os efeitos
 * sonoros do servidor.
 */
import { Button, Icon } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ClipInfo } from '../../../electron/shared/ipc';
import { exportRange } from '../../clips/edit';
import { Tooltip } from '../../components/Tooltip';
import { bridge } from '../../lib/bridge';
import { useClips } from '../../store/clips';
import { useData } from '../../store/data';
import { describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { moveHandle, type TrimRange } from '../voice/soundTrim';
import { UploadSoundDialog } from '../voice/Soundboard';

const THUMBS = 10;
const MIN_MS = 1000;

const fmt = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};
export const clipTitle = (c: Pick<ClipInfo, 'createdAt'>) => {
  const d = new Date(c.createdAt);
  return `Clipe de ${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Miniaturas ao longo do clipe (para a linha do tempo), tiradas de um <video> escondido. */
function useStrip(url: string | null, durationMs: number) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!url || !durationMs) return;
    let cancelled = false;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    void (async () => {
      await new Promise((ok) => v.addEventListener('loadeddata', ok, { once: true }));
      const out: string[] = [];
      for (let i = 0; i < THUMBS && !cancelled; i++) {
        v.currentTime = ((i + 0.5) / THUMBS) * (durationMs / 1000);
        await new Promise((ok) => v.addEventListener('seeked', ok, { once: true }));
        ctx?.drawImage(v, 0, 0, 160, 90);
        out.push(canvas.toDataURL('image/jpeg', 0.7));
        if (!cancelled) setFrames([...out]);
      }
    })();
    return () => {
      cancelled = true;
      v.removeAttribute('src');
      v.load();
    };
  }, [url, durationMs]);
  return frames;
}

export function ClipViewer() {
  const clip = useClips((s) => s.viewing);
  if (!clip) return null;
  return <Viewer key={clip.file} clip={clip} />;
}

function Viewer({ clip }: { clip: ClipInfo }) {
  const close = () => useClips.getState().open(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(clip.durationMs);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: clip.durationMs });
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sound, setSound] = useState<File | null>(null);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  const frames = useStrip(url, duration);
  // efeitos sonoros vão para o servidor da chamada ou o que está aberto
  const callServer = useVoice((v) => v.serverId);
  const viewServer = useUi((s) => (s.view.kind === 'server' ? s.view.serverId : null));
  const soundServer = callServer ?? viewServer;

  useEffect(() => {
    let alive = true;
    bridge?.clips
      .read(clip.file)
      .then((data) => alive && setBlob(new Blob([data], { type: 'video/mp4' })))
      .catch(() => alive && setError('Não consegui abrir este clipe.'));
    return () => {
      alive = false;
    };
  }, [clip.file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sound) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sound]);

  // toca só dentro do corte
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime * 1000;
      if (t >= range.end) {
        v.pause();
        v.currentTime = range.start / 1000;
      }
      setNow(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [range, url]);

  const seek = (ms: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(range.start, Math.min(range.end, ms)) / 1000;
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime * 1000 < range.start || v.currentTime * 1000 >= range.end - 50) seek(range.start);
      void v.play();
    } else v.pause();
  };
  const pct = (ms: number) => `${(ms / Math.max(1, duration)) * 100}%`;
  const msAt = (x: number) => {
    const b = track.current?.getBoundingClientRect();
    return b ? ((x - b.left) / b.width) * duration : 0;
  };
  const drag = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let r = range;
    const move = (ev: PointerEvent) => {
      r = moveHandle(r, which, msAt(ev.clientX), duration, duration);
      if (r.end - r.start < MIN_MS) return;
      setRange(r);
      seek(which === 'start' ? r.start : r.end - 1);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const trimmed = range.start > 0 || range.end < duration - 50;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(null);
    }
  };
  const exportAs = (kind: 'video' | 'audio') =>
    run(kind === 'video' ? 'Exportando vídeo…' : 'Exportando áudio…', async () => {
      if (!blob || !bridge) return;
      const data =
        kind === 'video' && !trimmed
          ? new Uint8Array(await blob.arrayBuffer())
          : await exportRange(blob, { start: range.start / 1000, end: range.end / 1000 }, kind);
      const saved = await bridge.clips.exportFile({ kind, name: clip.name, data });
      if (saved) useUi.getState().toast('success', kind === 'video' ? 'Vídeo exportado.' : 'Áudio exportado.');
    });
  const toSound = () =>
    run('Preparando o som…', async () => {
      if (!blob) return;
      const data = await exportRange(blob, { start: range.start / 1000, end: range.end / 1000 }, 'audio');
      setSound(new File([data], `${clip.game ?? 'Clipe'}.m4a`, { type: 'audio/mp4' }));
    });

  return (
    <div className="clip-viewer-backdrop" role="presentation">
      <section className="clip-viewer" role="dialog" aria-modal="true" aria-label={clipTitle(clip)}>
        <div className="clip-main">
          <header className="clip-head">
            <button className="icon-btn" aria-label="Voltar" onClick={close}>
              <Icon name="chevron-right" className="clip-back" />
            </button>
            <div className="clip-titles">
              <h2 className="truncate">{clipTitle(clip)}</h2>
              <span className="muted small clip-sub">
                {clip.icon ? <img src={clip.icon} alt="" width={14} height={14} /> : <Icon name="gamepad" size={14} />}
                {clip.game ?? 'Clipe'} · {new Date(clip.createdAt).toLocaleString('pt-BR')}
              </span>
            </div>
          </header>
          <div className="clip-stage">
            {error ? (
              <p className="form-error">{error}</p>
            ) : url ? (
              <video
                ref={video}
                src={url}
                onLoadedMetadata={(e) => {
                  const d = Math.round(e.currentTarget.duration * 1000);
                  if (Number.isFinite(d) && d > 0) {
                    setDuration(d);
                    setRange((r) => (r.end === clip.durationMs || r.end > d ? { start: r.start, end: d } : r));
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={toggle}
              />
            ) : (
              <p className="muted">Abrindo o clipe…</p>
            )}
          </div>
          <div className="clip-timeline">
            <div className="clip-controls">
              <span className="small clip-time">
                <strong>{fmt(now)}</strong> / {fmt(duration)}
              </span>
              <span className="spacer" />
              <button className="icon-btn" aria-label="Voltar 10 segundos" onClick={() => seek(now - 10_000)}>
                <Icon name="refresh" className="clip-rewind" />
              </button>
              <button className="icon-btn" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={toggle}>
                <Icon name={playing ? 'pause' : 'play'} active />
              </button>
              <button className="icon-btn" aria-label="Avançar 10 segundos" onClick={() => seek(now + 10_000)}>
                <Icon name="refresh" />
              </button>
              <span className="spacer" />
              <span className="small muted clip-time">{trimmed ? `Corte: ${fmt(range.end - range.start)}` : ''}</span>
            </div>
            <div className="clip-ruler" aria-hidden>
              {Array.from({ length: Math.floor(duration / 10_000) + 1 }, (_, i) => (
                <span key={i} style={{ left: pct(i * 10_000) }}>
                  {i * 10}s
                </span>
              ))}
            </div>
            <div
              className="clip-track"
              ref={track}
              onPointerDown={(e) => seek(msAt(e.clientX))}
              role="group"
              aria-label="Linha do tempo do clipe"
            >
              <div className="clip-strip">
                {Array.from({ length: THUMBS }, (_, i) =>
                  frames[i] ? <img key={i} src={frames[i]} alt="" draggable={false} /> : <span key={i} />,
                )}
              </div>
              <div className="clip-out" style={{ left: 0, width: pct(range.start) }} />
              <div className="clip-out" style={{ left: pct(range.end), right: 0 }} />
              <div className="clip-sel" style={{ left: pct(range.start), width: pct(range.end - range.start) }} />
              {(['start', 'end'] as const).map((w) => (
                <span
                  key={w}
                  role="slider"
                  tabIndex={0}
                  className={`clip-handle clip-handle-${w}`}
                  style={{ left: pct(range[w]) }}
                  aria-label={w === 'start' ? 'Início do corte' : 'Fim do corte'}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={range[w]}
                  aria-valuetext={fmt(range[w])}
                  onPointerDown={drag(w)}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 1000 : 100;
                    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    if (!d) return;
                    e.preventDefault();
                    const r = moveHandle(range, w, range[w] + d, duration, duration);
                    if (r.end - r.start >= MIN_MS) setRange(r);
                  }}
                />
              ))}
              <div className="clip-playhead" style={{ left: pct(now) }} />
            </div>
          </div>
        </div>
        <aside className="clip-side" aria-label="Ações do clipe">
          <div className="clip-side-top">
            <Tooltip label="Apagar clipe">
              <button
                className="icon-btn"
                aria-label="Apagar clipe"
                onClick={() => {
                  if (confirmDelete()) void useClips.getState().remove(clip);
                }}
              >
                <Icon name="trash" />
              </button>
            </Tooltip>
            <span className="spacer" />
            <Tooltip label="Fechar">
              <button className="icon-btn" aria-label="Fechar" onClick={close}>
                <Icon name="close" />
              </button>
            </Tooltip>
          </div>
          <h3 className="clip-side-title">Informações do clipe</h3>
          <div className="clip-info">
            {clip.thumb ? <img src={clip.thumb} alt="" /> : <span className="clip-info-ph" />}
            <span className="clip-info-names">
              <strong className="truncate">{clipTitle(clip)}</strong>
              <span className="muted small">
                {fmt(duration)} · {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB
              </span>
            </span>
          </div>
          <h3 className="clip-side-title">Exportar {trimmed ? 'o corte' : ''}</h3>
          <div className="clip-actions">
            <Button
              variant="secondary"
              icon="download"
              disabled={!blob || !!busy}
              onClick={() => void exportAs('video')}
            >
              Arquivo de vídeo
            </Button>
            <Button
              variant="secondary"
              icon="speaker"
              disabled={!blob || !!busy}
              onClick={() => void exportAs('audio')}
            >
              Arquivo de áudio
            </Button>
            <Button
              variant="secondary"
              icon="copy"
              disabled={!!busy}
              onClick={() =>
                void run('Copiando…', async () => {
                  await bridge?.clips.copy(clip.file);
                  useUi.getState().toast('success', 'Clipe copiado. Cole onde quiser (Ctrl+V).');
                })
              }
            >
              Copiar arquivo
            </Button>
            <Button variant="secondary" icon="folder" onClick={() => void bridge?.clips.reveal(clip.file)}>
              Mostrar na pasta
            </Button>
          </div>
          {busy && (
            <p className="small muted" role="status">
              {busy}
            </p>
          )}
          <span className="spacer" />
          {soundServer && (
            <Button variant="secondary" icon="plus" disabled={!blob || !!busy} onClick={() => void toSound()}>
              Adicionar aos efeitos sonoros
            </Button>
          )}
        </aside>
      </section>
      {sound && soundServer && (
        <UploadSoundDialog serverId={soundServer} initialFile={sound} onClose={() => setSound(null)} />
      )}
    </div>
  );
}

const confirmDelete = () => window.confirm('Apagar este clipe do computador?');

/** Miniaturas dos clipes recentes no painel do usuário (do jogo aberto, se houver). */
export function RecentClips({ game }: { game: string | null }) {
  const library = useClips((s) => s.library);
  const recent = useMemo(() => {
    const ofGame = game ? library.filter((c) => c.game === game) : library;
    return (ofGame.length ? ofGame : library).slice(0, 4);
  }, [library, game]);
  const meId = useData((d) => d.me?.id);
  // sem nenhum clipe a faixa some (as vagas vazias só completam a fila quando já há clipes)
  if (!meId || !recent.length) return null;
  return (
    <ul className="recent-clips" aria-label="Clipes recentes">
      {Array.from({ length: 4 }, (_, i) => {
        const c = recent[i];
        return (
          <li key={c?.file ?? i}>
            {c ? (
              <button
                className="recent-clip"
                aria-label={`Abrir ${clipTitle(c)}`}
                data-tip={clipTitle(c)}
                onClick={() => useClips.getState().open(c)}
              >
                {c.thumb ? <img src={c.thumb} alt="" draggable={false} /> : <Icon name="film" size={16} />}
              </button>
            ) : (
              <span className="recent-clip recent-clip-empty" aria-hidden />
            )}
          </li>
        );
      })}
    </ul>
  );
}

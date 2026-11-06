/**
 * Player dos vídeos enviados na conversa (clipes e anexos): tocar/pausar no clique, barra de progresso arrastável
 * com o trecho já carregado, tempo, volume (lembrado neste aparelho), velocidade, tela cheia e, no topo, o nome do
 * arquivo com o botão de baixar. Os controles somem durante a reprodução quando o mouse para.
 * Teclado (com o player em foco): espaço/K tocar, ←/→ 5 s, ↑/↓ volume, M mudo, F tela cheia.
 */
import type { Attachment } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Tooltip } from '../../components/Tooltip';
import { fmt } from './VoiceNote';

const VOLUME_KEY = 'oc:video-volume';
const SPEEDS = [1, 1.25, 1.5, 2, 0.5] as const;
const HIDE_MS = 2200;
const MAX_W = 480;
const MAX_H = 360;

function readVolume(): { volume: number; muted: boolean } {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
    if (v && typeof v === 'object' && 'volume' in v && typeof v.volume === 'number')
      return { volume: Math.min(1, Math.max(0, v.volume)), muted: 'muted' in v && v.muted === true };
  } catch {
    // sem armazenamento: volume cheio
  }
  return { volume: 1, muted: false };
}
function saveVolume(volume: number, muted: boolean) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // sem armazenamento: só não lembra
  }
}

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Tamanho na conversa: o do vídeo, cabendo em 480×360 (sem medidas, 16:9 até os metadados chegarem). */
function boxSize(w: number | null, h: number | null) {
  if (!w || !h) return { width: MAX_W, aspectRatio: '16 / 9' };
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  return { width: Math.round(w * scale), aspectRatio: `${w} / ${h}` };
}

export function VideoPlayer({
  attachment,
  fill = false,
}: {
  attachment: Attachment;
  /** ocupa a largura do contêiner em 16:9 (cartões dos destaques), em vez do tamanho do vídeo */
  fill?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [{ volume, muted }, setVol] = useState(readVolume);
  const [speed, setSpeed] = useState<number>(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dims, setDims] = useState({ w: attachment.width, h: attachment.height });
  const seeking = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);

  // progresso suave: a barra anda por quadro (variável CSS, sem re-render); o texto do tempo, pelo timeupdate
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v && v.duration) box.current?.style.setProperty('--vp-progress', String(v.currentTime / v.duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const doc = box.current?.ownerDocument ?? document;
    const onChange = () => setFull(doc.fullscreenElement === box.current);
    doc.addEventListener('fullscreenchange', onChange);
    return () => doc.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => !seeking.current && setIdle(true), HIDE_MS);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => {});
    else v.pause();
  };
  const seekBy = (s: number) => {
    const v = video.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + s));
    setTime(v.currentTime);
    box.current?.style.setProperty('--vp-progress', String(v.currentTime / v.duration));
    wake();
  };
  const setVolume = (next: number, nextMuted = next === 0) => {
    const v = Math.min(1, Math.max(0, next));
    setVol({ volume: v, muted: nextMuted });
    saveVolume(v, nextMuted);
  };
  const volumeAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    setVolume(Math.round(((clientX - r.left) / r.width) * 20) / 20);
  };
  const toggleMute = () => {
    if (muted || volume === 0) setVolume(volume === 0 ? 1 : volume, false);
    else setVolume(volume, true);
  };
  const toggleFull = () => {
    const doc = box.current?.ownerDocument ?? document;
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => {});
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    if (video.current) video.current.playbackRate = next;
  };

  // barra de progresso: clicar ou arrastar
  const seekTo = (clientX: number) => {
    const v = video.current;
    const r = bar.current?.getBoundingClientRect();
    if (!v || !r || !v.duration) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = f * v.duration;
    setTime(v.currentTime);
    box.current?.style.setProperty('--vp-progress', String(f));
  };
  const onBarDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seeking.current = true;
    seekTo(e.clientX);
  };
  const onBarMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = bar.current?.getBoundingClientRect();
    if (r)
      bar.current?.style.setProperty('--vp-hover', String(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
    if (seeking.current) seekTo(e.clientX);
  };
  const onBarUp = () => {
    seeking.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // os controles (botões, barras) tratam as próprias teclas
    if (e.target !== e.currentTarget && (e.key === ' ' || e.key === 'Enter')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') toggle();
    else if (k === 'arrowright' || k === 'l') seekBy(5);
    else if (k === 'arrowleft' || k === 'j') seekBy(-5);
    else if (k === 'arrowup') setVolume(volume + 0.1, false);
    else if (k === 'arrowdown') setVolume(volume - 0.1);
    else if (k === 'm') toggleMute();
    else if (k === 'f') toggleFull();
    else return;
    e.preventDefault();
    e.stopPropagation();
    wake();
  };

  if (failed)
    return (
      <a href={attachment.url} className="attachment-file" target="_blank" rel="noreferrer">
        <Icon name="download" size={18} />
        <span className="truncate">{attachment.originalName}</span>
        <span className="muted small">{sizeLabel(attachment.sizeBytes)}</span>
      </a>
    );

  const hideControls = playing && idle;
  const quiet = muted || volume === 0;
  const size = boxSize(dims.w, dims.h);

  return (
    <div
      ref={box}
      className={fill ? 'video-player video-player-fill' : 'video-player'}
      style={fill ? undefined : { width: size.width, aspectRatio: size.aspectRatio }}
      data-playing={playing ? 'true' : undefined}
      data-idle={hideControls ? 'true' : undefined}
      data-fullscreen={full ? 'true' : undefined}
      tabIndex={0}
      role="group"
      aria-label={`Vídeo ${attachment.originalName}`}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
    >
      <video
        ref={video}
        // #t: o navegador mostra o primeiro quadro como capa em vez de tela preta
        src={`${attachment.url}#t=0.001`}
        preload="metadata"
        playsInline
        onClick={() => {
          toggle();
          wake();
        }}
        onDoubleClick={toggleFull}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          wake();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          if (!playing && e.currentTarget.duration)
            box.current?.style.setProperty(
              '--vp-progress',
              String(e.currentTarget.currentTime / e.currentTarget.duration),
            );
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration)) setDuration(v.duration);
          if (v.videoWidth && v.videoHeight) setDims({ w: v.videoWidth, h: v.videoHeight });
          v.volume = volume;
          v.muted = muted;
        }}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.duration && v.buffered.length)
            bar.current?.style.setProperty('--vp-buffered', String(v.buffered.end(v.buffered.length - 1) / v.duration));
        }}
        onError={() => setFailed(true)}
      />

      <div className="video-player-top">
        <span className="video-player-name truncate">{attachment.originalName}</span>
        <span className="video-player-size">{sizeLabel(attachment.sizeBytes)}</span>
        <Tooltip label="Baixar">
          <a
            className="video-player-btn"
            href={attachment.url}
            download={attachment.originalName}
            target="_blank"
            rel="noreferrer"
            aria-label={`Baixar ${attachment.originalName}`}
          >
            <Icon name="download" size={18} />
          </a>
        </Tooltip>
      </div>

      {!playing && (
        <button
          type="button"
          className="video-player-big"
          aria-label={started ? 'Continuar' : 'Tocar vídeo'}
          tabIndex={-1}
          onClick={toggle}
        >
          <Icon name="play" size={28} />
        </button>
      )}

      <div className="video-player-bar">
        <div
          ref={bar}
          className="video-player-track"
          role="slider"
          aria-label="Posição"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmt(time)} de ${fmt(duration)}`}
          tabIndex={0}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarUp}
          onLostPointerCapture={onBarUp}
          onKeyDown={(e) => {
            if (e.key === 'Home') seekBy(-Infinity);
            else if (e.key === 'End') seekBy(Infinity);
            else return;
            e.preventDefault();
          }}
        >
          <span className="video-player-buffered" />
          <span className="video-player-played" />
          <span className="video-player-thumb" />
        </div>
        <div className="video-player-row">
          <Tooltip label={playing ? 'Pausar (K)' : 'Tocar (K)'}>
            <button
              type="button"
              className="video-player-btn"
              aria-label={playing ? 'Pausar' : 'Tocar'}
              onClick={toggle}
            >
              <Icon name={playing ? 'pause' : 'play'} size={18} />
            </button>
          </Tooltip>
          <span className="video-player-time">
            {fmt(time)} <span className="video-player-dur">/ {fmt(duration)}</span>
          </span>
          <span className="video-player-spacer" />
          <div className="video-player-volume">
            <Tooltip label={quiet ? 'Ativar som (M)' : 'Silenciar (M)'}>
              <button
                type="button"
                className="video-player-btn"
                aria-label={quiet ? 'Ativar som' : 'Silenciar'}
                aria-pressed={quiet}
                onClick={toggleMute}
              >
                <Icon name={quiet ? 'speaker-off' : 'speaker'} size={18} />
              </button>
            </Tooltip>
            <div
              className="video-player-vol"
              role="slider"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((quiet ? 0 : volume) * 100)}
              tabIndex={0}
              style={{ '--vp-vol': quiet ? 0 : volume } as CSSProperties}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                volumeAt(e.currentTarget, e.clientX);
              }}
              onPointerMove={(e) =>
                e.currentTarget.hasPointerCapture(e.pointerId) && volumeAt(e.currentTarget, e.clientX)
              }
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setVolume(volume + 0.05, false);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setVolume(volume - 0.05);
                else return;
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          </div>
          <Tooltip label="Velocidade">
            <button
              type="button"
              className="video-player-btn video-player-speed"
              aria-label={`Velocidade ${speed}x`}
              onClick={cycleSpeed}
            >
              {String(speed).replace('.', ',')}×
            </button>
          </Tooltip>
          <Tooltip label={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}>
            <button
              type="button"
              className="video-player-btn"
              aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}
              onClick={toggleFull}
            >
              <Icon name={full ? 'minimize' : 'maximize'} size={18} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

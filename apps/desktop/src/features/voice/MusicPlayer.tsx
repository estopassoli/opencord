/**
 * Música na chamada (ADR-0014): fila compartilhada de músicas do YouTube / YouTube Music. Cada pessoa ouve no
 * player oficial do YouTube (visível, como exigem os termos), dentro de um player do OpenCord: capa, título,
 * barra de progresso, anterior/tocar/próxima, fila e volume. Qualquer pessoa na chamada adiciona e controla.
 */
import { parseYouTubeId, type MusicTrack } from '@opencord/contracts';
import { Avatar, Button, Icon, Slider, TextField } from '@opencord/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMusic } from '../../store/music';
import { useVoice } from '../../store/voice';
import { fmt, thumb, useYouTubeFrame } from './WatchTogether';

/** diferença tolerada entre o meu player e o grupo antes de pular para o ponto certo */
const DRIFT_S = 2;

/** Cartão flutuante no palco da chamada. */
export function MusicPlayer() {
  const s = useMusic((m) => m.state);
  const joined = useMusic((m) => m.joined);
  const open = useMusic((m) => m.open);
  const myCall = useVoice((v) => v.machine.channelId);
  // sem fila ainda: o card "Música" em Atividades abre o player vazio, com o campo para o primeiro link
  if (!s && open && myCall)
    return (
      <section className="music-player" aria-label="Música da chamada">
        <div className="music-empty">
          <Icon name="speaker" size={22} />
          <p className="small">
            <strong>Música na chamada</strong>
            <br />
            <span className="muted">Cole um link do YouTube ou do YouTube Music; todos na chamada ouvem juntos.</span>
          </p>
        </div>
        <AddTrack channelId={myCall} />
        <div className="music-foot">
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => useMusic.getState().setOpen(false)}>
            Fechar
          </Button>
        </div>
      </section>
    );
  if (!s || s.channelId !== myCall) return null;
  const track = s.queue[s.index];
  if (!joined)
    return (
      <div className="music-pill" role="region" aria-label="Música da chamada">
        <Icon name="speaker" size={16} />
        <span className="truncate">
          {track ? `Tocando: ${track.title ?? 'música do YouTube'}` : 'Fila de músicas da chamada'}
        </span>
        <Button size="sm" icon="play" onClick={() => useMusic.getState().join(true)}>
          Ouvir
        </Button>
      </div>
    );
  return <MusicCard />;
}

function MusicCard() {
  const s = useMusic((m) => m.state)!;
  const [showQueue, setShowQueue] = useState(false);
  const track = s.queue[s.index];
  return (
    <section className="music-player" aria-label="Música da chamada">
      {track ? (
        <SyncedTrack key={track.id} track={track} />
      ) : (
        <div className="music-empty">
          <Icon name="speaker" size={22} />
          <p className="muted small">A fila acabou. Adicione uma música para continuar.</p>
        </div>
      )}
      <AddTrack channelId={s.channelId} />
      <div className="music-foot">
        <button
          className="icon-btn"
          aria-expanded={showQueue}
          aria-label={`Fila (${s.queue.length})`}
          data-tip="Fila"
          onClick={() => setShowQueue((v) => !v)}
        >
          <Icon name="menu" size={18} />
          <span className="small">{s.queue.length}</span>
        </button>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label="Parar de ouvir (só você)"
          data-tip="Parar de ouvir (só você)"
          onClick={() => useMusic.getState().join(false)}
        >
          <Icon name="speaker-off" size={18} />
        </button>
        <button
          className="icon-btn"
          aria-label="Encerrar a música para todos"
          data-tip="Encerrar para todos"
          onClick={() => void useMusic.getState().stop()}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {showQueue && <Queue />}
    </section>
  );
}

function SyncedTrack({ track }: { track: MusicTrack }) {
  const s = useMusic((m) => m.state)!;
  const volume = useMusic((m) => m.volume);
  const { frame, src, info, ready, send } = useYouTubeFrame(track.videoId);
  const [scrub, setScrub] = useState<number | null>(null);
  const lastSeek = useRef(0);
  const reportedEnd = useRef(false);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
    },
    [],
  );

  // segue o estado do grupo: play/pausa e posição (com tolerância)
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const cur = useMusic.getState().state;
      if (!cur) return;
      const want = useMusic.getState().expectedPosition();
      if (cur.playing && info.state !== 1 && info.state !== 3 && info.state !== 0) send('playVideo');
      if (!cur.playing && info.state === 1) send('pauseVideo');
      const stable = info.state === 1 || info.state === 2;
      const now = Date.now();
      if (stable && Math.abs(info.currentTime - want) > DRIFT_S && now - lastSeek.current > 1500) {
        lastSeek.current = now;
        send('seekTo', [want, true]);
      }
    };
    sync();
    const t = setInterval(sync, 1000);
    return () => clearInterval(t);
  }, [ready, info.state, info.currentTime, s.revision, send]);

  useEffect(() => {
    if (ready) send('setVolume', [volume]);
  }, [ready, volume, send]);

  // fim da faixa: avisa uma vez; o servidor só avança no primeiro aviso de quem estiver ouvindo
  useEffect(() => {
    if (info.state === 0 && !reportedEnd.current) {
      reportedEnd.current = true;
      void useMusic.getState().control('ended', { trackId: track.id });
    }
  }, [info.state, track.id]);

  const duration = info.duration || 0;
  const position = scrub ?? Math.min(duration || Infinity, useMusic.getState().expectedPosition());
  const playing = s.playing;
  const control = useMusic.getState().control;
  return (
    <>
      <div className="music-video">
        <iframe
          ref={frame}
          src={src}
          title={track.title ?? 'Música do YouTube'}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="music-meta">
        <strong className="truncate">{track.title ?? 'Música do YouTube'}</strong>
        {track.author && <span className="muted small truncate">{track.author}</span>}
      </div>
      <div className="music-progress">
        <span className="small muted">{fmt(position)}</span>
        <Slider
          aria-label="Posição da música"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={1}
          value={Math.floor(position)}
          disabled={!duration}
          format={fmt}
          onChange={(v) => {
            // arrastar só envia o pulo ao grupo quando a pessoa para de mexer
            setScrub(v);
            if (seekTimer.current) clearTimeout(seekTimer.current);
            seekTimer.current = setTimeout(() => {
              void control('seek', { positionSec: v });
              setScrub(null);
            }, 350);
          }}
        />
        <span className="small muted">{duration ? fmt(duration) : '–:––'}</span>
      </div>
      <div className="music-controls">
        <button
          className="icon-btn"
          aria-label="Anterior"
          data-tip="Anterior"
          onClick={() => void control('prev', { positionSec: position })}
        >
          <Icon name="chevron-right" size={20} className="music-prev" />
        </button>
        <button
          className="music-play"
          aria-label={playing ? 'Pausar para todos' : 'Tocar para todos'}
          data-tip={playing ? 'Pausar para todos' : 'Tocar para todos'}
          onClick={() => void control(playing ? 'pause' : 'play', { positionSec: position })}
        >
          <Icon name={playing ? 'pause' : 'play'} size={22} active />
        </button>
        <button className="icon-btn" aria-label="Próxima" data-tip="Próxima" onClick={() => void control('next')}>
          <Icon name="chevron-right" size={20} />
        </button>
        <div className="music-volume">
          <Slider
            label="Volume (só para você)"
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            value={volume}
            onChange={(v) => useMusic.getState().setVolume(v)}
          />
        </div>
      </div>
    </>
  );
}

function AddTrack({ channelId }: { channelId: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(text);
    if (!id) return setError('Cole um link do YouTube ou do YouTube Music.');
    setError(null);
    setBusy(true);
    if (await useMusic.getState().add(channelId, id)) setText('');
    setBusy(false);
  };
  return (
    <form className="music-add" onSubmit={(e) => void submit(e)}>
      <TextField
        fieldClassName="music-add-field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Link do YouTube ou YouTube Music"
        aria-label="Adicionar música à fila (link do YouTube ou YouTube Music)"
        aria-invalid={error ? true : undefined}
      />
      <Button type="submit" size="sm" icon="plus" disabled={busy || !text.trim()}>
        Adicionar
      </Button>
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Queue() {
  const s = useMusic((m) => m.state)!;
  const names = useVoice((v) => v.participants);
  const nameOf = (id: string) => names.find((p) => p.identity === id)?.name ?? 'alguém';
  return (
    <ol className="music-queue" aria-label="Fila de músicas">
      {s.queue.map((t, i) => (
        <li key={t.id} data-current={i === s.index ? 'true' : undefined} data-done={i < s.index ? 'true' : undefined}>
          <button
            className="music-queue-item"
            aria-current={i === s.index ? 'true' : undefined}
            aria-label={`Tocar ${t.title ?? 'música'}`}
            onClick={() => void useMusic.getState().control('jump', { trackId: t.id })}
          >
            <img src={thumb(t.videoId)} alt="" draggable={false} />
            <span className="music-queue-names">
              <span className="truncate">{t.title ?? 'Música do YouTube'}</span>
              <span className="muted small truncate">
                <Avatar id={t.addedBy} name={nameOf(t.addedBy)} size={14} /> {nameOf(t.addedBy)}
              </span>
            </span>
          </button>
          <button
            className="icon-btn"
            aria-label={`Tirar ${t.title ?? 'música'} da fila`}
            data-tip="Tirar da fila"
            onClick={() => void useMusic.getState().control('remove', { trackId: t.id })}
          >
            <Icon name="trash" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}

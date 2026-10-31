/**
 * Música na chamada (ADR-0014): fila compartilhada de músicas do YouTube / YouTube Music. Cada pessoa ouve no
 * player oficial do YouTube (visível, como exigem os termos), dentro de um player do OpenCord: capa, título,
 * barra de progresso, anterior/tocar/próxima, fila e volume. Quem começa a música é o DJ: só ele controla o que toca
 * para todos e tira da fila. Quem ouve adiciona à fila e controla o próprio player: volume, pausar para si e voltar ao vivo.
 */
import { parseYouTubeId, parseYouTubePlaylistId, type MusicTrack } from '@opencord/contracts';
import { Avatar, Button, Icon, Slider, TextField } from '@opencord/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { useMusic } from '../../store/music';
import { useVoice } from '../../store/voice';
import { fmt, thumb, useYouTubeFrame } from './WatchTogether';

/** diferença tolerada entre o meu player e o grupo antes de pular para o ponto certo */
const DRIFT_S = 2;

/** sou o DJ da música desta chamada? */
const useIsDj = () => {
  const dj = useMusic((m) => m.state?.djId);
  const me = useData((d) => d.me?.id);
  return Boolean(dj && dj === me);
};
const useDjName = () => {
  const dj = useMusic((m) => m.state?.djId);
  return useVoice((v) => v.participants.find((p) => p.identity === dj)?.name ?? 'alguém');
};

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
            <span className="muted">
              Cole o link de uma música ou de uma playlist do YouTube ou do YouTube Music. Quem começa vira o DJ.
            </span>
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
  const minimized = useMusic((m) => m.minimized);
  const isDj = useIsDj();
  const djName = useDjName();
  const track = s.queue[s.index];
  return (
    <section
      className="music-player"
      data-minimized={minimized && track ? 'true' : undefined}
      aria-label="Música da chamada"
    >
      {track ? (
        <SyncedTrack key={track.id} track={track} minimized={minimized} />
      ) : (
        <div className="music-empty">
          <Icon name="speaker" size={22} />
          <p className="muted small">A fila acabou. Adicione uma música ou playlist para continuar.</p>
        </div>
      )}
      {!(minimized && track) && <AddTrack channelId={s.channelId} />}
      {!(minimized && track) && (
        <div className="music-foot">
          <button
            className="icon-btn"
            aria-label="Minimizar o player"
            data-tip="Minimizar"
            onClick={() => useMusic.getState().setMinimized(true)}
          >
            <Icon name="minimize" size={18} />
          </button>
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
          <span
            className="music-dj small"
            data-tip={
              isDj
                ? 'Você controla a música; todos podem adicionar à fila'
                : `${djName} controla a música; você pode adicionar à fila`
            }
          >
            <Icon name="crown" size={14} />
            {isDj ? 'Você é o DJ' : `DJ: ${djName}`}
          </span>
          <span className="spacer" />
          <button
            className="icon-btn"
            aria-label="Parar de ouvir (só você)"
            data-tip="Parar de ouvir (só você)"
            onClick={() => useMusic.getState().join(false)}
          >
            <Icon name="speaker-off" size={18} />
          </button>
          {isDj && (
            <button
              className="icon-btn"
              aria-label="Encerrar a música para todos"
              data-tip="Encerrar para todos"
              onClick={() => void useMusic.getState().stop()}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      {showQueue && !(minimized && track) && <Queue />}
    </section>
  );
}

function SyncedTrack({ track, minimized }: { track: MusicTrack; minimized: boolean }) {
  const s = useMusic((m) => m.state)!;
  const volume = useMusic((m) => m.volume);
  const localPaused = useMusic((m) => m.localPaused);
  const isDj = useIsDj();
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
      // pausado só para mim: fica parado; ao voltar, o próprio laço pula para onde o grupo está
      if (useMusic.getState().localPaused) {
        if (info.state === 1) send('pauseVideo');
        return;
      }
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
  }, [ready, info.state, info.currentTime, s.revision, localPaused, send]);

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
  // minimizado (decisão do mantenedor, ADR-0014): o player oficial segue tocando fora de vista; só capa, nome e tempo
  if (minimized)
    return (
      <>
        <div className="music-video" data-hidden="true" aria-hidden="true">
          <iframe
            ref={frame}
            src={src}
            title={track.title ?? 'Música do YouTube'}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
          />
        </div>
        <button
          className="music-mini"
          aria-label={`Expandir o player: ${track.title ?? 'música'}, ${fmt(position)} de ${duration ? fmt(duration) : '–'}`}
          onClick={() => useMusic.getState().setMinimized(false)}
        >
          <img src={thumb(track.videoId)} alt="" draggable={false} />
          <span className="music-mini-names">
            <strong className="truncate">{track.title ?? 'Música do YouTube'}</strong>
            <span className="muted small">
              {fmt(position)} / {duration ? fmt(duration) : '–:––'}
              {!playing ? ' · pausada' : localPaused ? ' · pausada só para você' : ''}
            </span>
          </span>
          <Icon name="maximize" size={16} />
        </button>
      </>
    );
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
          disabled={!duration || !isDj}
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
        {isDj ? (
          <>
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
          </>
        ) : (
          // quem ouve: pausa só o próprio player; ao voltar, entra onde o DJ está
          <button
            className="music-play"
            aria-label={localPaused ? 'Voltar ao vivo' : 'Pausar só para mim'}
            data-tip={localPaused ? 'Voltar ao vivo (onde o DJ está)' : 'Pausar só para mim'}
            disabled={!playing}
            onClick={() => useMusic.getState().setLocalPaused(!localPaused)}
          >
            <Icon name={localPaused ? 'play' : 'pause'} size={22} active />
          </button>
        )}
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
    const videoId = parseYouTubeId(text);
    const playlistId = parseYouTubePlaylistId(text);
    if (!videoId && !playlistId) return setError('Cole um link do YouTube ou do YouTube Music.');
    setError(null);
    setBusy(true);
    const src = { ...(videoId ? { videoId } : {}), ...(playlistId ? { playlistId } : {}) };
    if (await useMusic.getState().add(channelId, src)) setText('');
    setBusy(false);
  };
  return (
    <form className="music-add" onSubmit={(e) => void submit(e)}>
      <TextField
        fieldClassName="music-add-field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Link de música ou playlist do YouTube"
        aria-label="Adicionar música ou playlist à fila (link do YouTube ou YouTube Music)"
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
  const isDj = useIsDj();
  const names = useVoice((v) => v.participants);
  const nameOf = (id: string) => names.find((p) => p.identity === id)?.name ?? 'alguém';
  return (
    <ol className="music-queue" aria-label="Fila de músicas">
      {s.queue.map((t, i) => (
        <li key={t.id} data-current={i === s.index ? 'true' : undefined} data-done={i < s.index ? 'true' : undefined}>
          <button
            className="music-queue-item"
            aria-current={i === s.index ? 'true' : undefined}
            aria-label={isDj ? `Tocar ${t.title ?? 'música'}` : (t.title ?? 'música')}
            disabled={!isDj}
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
          {isDj && (
            <button
              className="icon-btn"
              aria-label={`Tirar ${t.title ?? 'música'} da fila`}
              data-tip="Tirar da fila"
              onClick={() => void useMusic.getState().control('remove', { trackId: t.id })}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

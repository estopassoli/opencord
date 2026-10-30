/**
 * "Assistir juntos" (ADR-0009): cada pessoa toca o vídeo no player oficial do YouTube; o OpenCord só sincroniza
 * o estado (vídeo, tocando/pausado, posição) entre quem está na chamada.
 *
 * O player fica sem os controles do YouTube: play/pausa/pulo vêm da nossa barra e viram ações do grupo. Assim um
 * anúncio que aparece só para alguém nunca mexe na sessão dos outros; quando acaba, a pessoa é levada ao ponto do
 * grupo. Anúncios não são bloqueados (termos do YouTube); com YouTube Premium logado, não aparecem.
 */
import { parseYouTubeId, type YouTubeSearchResult } from '@opencord/contracts';
import { Button, Icon, Slider, TextField } from '@opencord/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { useActivity } from '../../store/activity';
import { useData } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

const YT_ORIGIN = 'https://www.youtube.com';
/** diferença tolerada entre o meu player e o grupo antes de pular para o ponto certo */
const DRIFT_S = 2;

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

interface PlayerInfo {
  currentTime: number;
  duration: number;
  /** -1 não iniciado, 0 fim, 1 tocando, 2 pausado, 3 carregando, 5 pronto */
  state: number;
}

/** Player oficial do YouTube controlado por postMessage (sem carregar o script externo da API do YouTube). */
function useYouTubeFrame(videoId: string) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [info, setInfo] = useState<PlayerInfo>({ currentTime: 0, duration: 0, state: -1 });
  const [ready, setReady] = useState(false);
  const send = useCallback((func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }),
      YT_ORIGIN,
    );
  }, []);

  useEffect(() => {
    setReady(false);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let d: { event?: string; info?: unknown };
      try {
        d = JSON.parse(e.data) as typeof d;
      } catch {
        return;
      }
      if (d.event === 'onReady' || d.event === 'initialDelivery') setReady(true);
      if (d.event === 'infoDelivery' && d.info && typeof d.info === 'object') {
        const i = d.info as { currentTime?: number; duration?: number; playerState?: number };
        setInfo((p) => ({
          currentTime: typeof i.currentTime === 'number' ? i.currentTime : p.currentTime,
          duration: typeof i.duration === 'number' && i.duration > 0 ? i.duration : p.duration,
          state: typeof i.playerState === 'number' ? i.playerState : p.state,
        }));
      }
      if (d.event === 'onStateChange' && typeof d.info === 'number')
        setInfo((p) => ({ ...p, state: d.info as number }));
    };
    window.addEventListener('message', onMsg);
    // o player só começa a mandar eventos depois de ouvir "listening"; repete até ele responder
    const hello = setInterval(() => {
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        YT_ORIGIN,
      );
    }, 500);
    return () => {
      window.removeEventListener('message', onMsg);
      clearInterval(hello);
    };
  }, [videoId]);

  const src = `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&playsinline=1&rel=0&iv_load_policy=3&fs=0`;
  return { frame, src, info, ready, send };
}

/** Tile da atividade no palco: capa com "Assistir" até a pessoa entrar; depois o player sincronizado. */
export function ActivityTile({ large }: { large?: boolean }) {
  const s = useActivity((a) => a.state);
  const joined = useActivity((a) => a.joined);
  if (!s) return null;
  return (
    <div className="tile tile-activity" data-large={large ? 'true' : undefined}>
      <div className="tile-actions">
        <button
          className="icon-btn"
          aria-label={large ? 'Voltar à grade' : 'Destacar vídeo'}
          data-tip={large ? 'Voltar à grade' : 'Destacar'}
          onClick={() => useUi.getState().focusStream(large ? null : 'activity')}
        >
          <Icon name={large ? 'grid' : 'spotlight'} />
        </button>
      </div>
      {joined ? (
        <SyncedPlayer key={s.videoId} videoId={s.videoId} large={large} />
      ) : (
        <div className="activity-cover" style={{ backgroundImage: `url(${thumb(s.videoId)})` }}>
          <div className="activity-cover-body">
            <span className="activity-badge">
              <Icon name="play" size={14} /> Assistir juntos
            </span>
            <p className="truncate">{s.title ?? 'Vídeo do YouTube'}</p>
            <Button icon="play" onClick={() => useActivity.getState().join(true)}>
              Assistir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncedPlayer({ videoId, large }: { videoId: string; large?: boolean }) {
  const s = useActivity((a) => a.state)!;
  const { frame, src, info, ready, send } = useYouTubeFrame(videoId);
  const [volume, setVolume] = useState(80);
  const [scrub, setScrub] = useState<number | null>(null);
  const lastApplied = useRef(0);
  const seekTimer = useRef<number | undefined>(undefined);
  // dono = quem colocou o vídeo: controla o grupo. Os outros pausam só para si; ao voltar, alcançam o dono.
  const me = useData((d) => d.me?.id);
  const owner = s.startedBy === me;
  const ownerName = useVoice((v) => v.participants.find((p) => p.identity === s.startedBy)?.name) ?? 'quem iniciou';
  const [localPaused, setLocalPaused] = useState(false);

  // segue o estado do grupo: play/pausa e posição (com tolerância), sem nunca anunciar nada por conta própria
  useEffect(() => {
    if (!ready) return;
    if (localPaused) {
      if (info.state === 1) send('pauseVideo');
      return;
    }
    const sync = () => {
      const want = useActivity.getState().expectedPosition();
      const cur = useActivity.getState().state;
      if (!cur) return;
      const now = Date.now();
      if (cur.playing && info.state !== 1 && info.state !== 3) send('playVideo');
      if (!cur.playing && info.state === 1) send('pauseVideo');
      // só corrige posição com o vídeo de fato tocando/pausado (não durante carregamento/anúncio inicial)
      const stable = info.state === 1 || info.state === 2;
      if (stable && Math.abs(info.currentTime - want) > DRIFT_S && now - lastApplied.current > 1500) {
        lastApplied.current = now;
        send('seekTo', [want, true]);
      }
    };
    sync();
    const t = setInterval(sync, 1000);
    return () => clearInterval(t);
  }, [ready, info.state, info.currentTime, s.revision, send, localPaused]);

  useEffect(() => {
    if (ready) send('setVolume', [volume]);
  }, [ready, volume, send]);

  // o que o botão mostra: para o dono, o estado do grupo; para os outros, o próprio player
  const showPlaying = owner ? s.playing : s.playing && !localPaused;
  const groupPausedForMe = !owner && !s.playing;
  const toggleLabel = owner
    ? s.playing
      ? 'Pausar para todos'
      : 'Tocar para todos'
    : groupPausedForMe
      ? `Pausado por ${ownerName}`
      : localPaused
        ? 'Voltar a assistir (alcança o dono)'
        : 'Pausar só para você';
  const toggle = () => {
    if (groupPausedForMe) return;
    if (owner)
      void useActivity.getState().control(s.playing ? 'pause' : 'play', useActivity.getState().expectedPosition());
    else setLocalPaused((p) => !p);
  };
  const duration = info.duration || 0;
  const position = scrub ?? Math.min(duration || Infinity, useActivity.getState().expectedPosition());

  return (
    <div className="yt-player">
      <iframe
        ref={frame}
        src={src}
        title={s.title ?? 'Vídeo do YouTube'}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {/* camada transparente: cliques no vídeo viram play/pausa do grupo (o player não tem controles próprios) */}
      <button className="yt-click" aria-label={toggleLabel} onClick={toggle} />
      <div className="yt-bar" data-large={large ? 'true' : undefined}>
        <button
          className="icon-btn"
          aria-label={toggleLabel}
          data-tip={toggleLabel}
          aria-disabled={groupPausedForMe || undefined}
          onClick={toggle}
        >
          <Icon name={showPlaying ? 'pause' : 'play'} />
        </button>
        <span className="yt-time">
          {fmt(position)}
          {duration ? ` / ${fmt(duration)}` : ''}
        </span>
        <div className="yt-seek">
          <Slider
            aria-label={owner ? 'Posição do vídeo (para todos)' : `Posição do vídeo (controlada por ${ownerName})`}
            min={0}
            max={Math.max(1, duration)}
            step={1}
            value={Math.min(position, Math.max(1, duration))}
            format={fmt}
            disabled={!duration || !owner}
            onChange={(v) => {
              setScrub(v);
              // arrastar a barra: só anuncia ao grupo quando para de mexer
              window.clearTimeout(seekTimer.current);
              seekTimer.current = window.setTimeout(() => {
                void useActivity.getState().control('seek', v);
                setScrub(null);
              }, 250);
            }}
          />
        </div>
        <div className="yt-volume">
          <Slider
            aria-label="Volume (só para você)"
            min={0}
            max={100}
            step={5}
            value={volume}
            format={(v) => `${v}%`}
            onChange={setVolume}
          />
        </div>
        {owner ? (
          <button
            className="icon-btn yt-extra"
            aria-label="Trocar vídeo"
            data-tip="Trocar vídeo"
            onClick={() => useUi.getState().openModal({ kind: 'watch-together' })}
          >
            <Icon name="refresh" />
          </button>
        ) : (
          <span className="yt-owner muted small yt-extra" data-tip={`Quem controla a reprodução: ${ownerName}`}>
            de {ownerName}
          </span>
        )}
        <button
          className="icon-btn yt-extra"
          aria-label="Sair do vídeo (só você)"
          data-tip="Sair do vídeo (só você)"
          onClick={() => useActivity.getState().join(false)}
        >
          <Icon name="eye-off" />
        </button>
        {owner && (
          <button
            className="icon-btn danger"
            aria-label="Encerrar para todos"
            data-tip="Encerrar para todos"
            onClick={() => void useActivity.getState().stop()}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Escolher o vídeo: link (sempre) ou pesquisa (se o servidor tiver YOUTUBE_API_KEY). */
export function WatchTogetherDialog({ onClose }: { onClose: () => void }) {
  const channelId = useVoice((v) => v.machine.channelId);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSearch, setCanSearch] = useState(false);
  const playing = useActivity((a) => a.state);

  useEffect(() => {
    const url = useSession.getState().serverUrl;
    if (!url) return;
    void fetch(new URL('/auth/instance', url))
      .then((r) => r.json() as Promise<{ youtubeSearch?: boolean }>)
      .then((i) => setCanSearch(Boolean(i.youtubeSearch)))
      .catch(() => undefined);
  }, []);

  const start = async (videoId: string) => {
    if (!channelId) return;
    await useActivity.getState().start(channelId, videoId);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const id = parseYouTubeId(q);
    if (id) return start(id);
    if (!canSearch) return setError('Cole o link de um vídeo do YouTube (youtube.com/watch?v=… ou youtu.be/…).');
    setBusy(true);
    try {
      setResults(
        await api().request<YouTubeSearchResult[]>(
          'GET',
          `/activities/youtube/search?q=${encodeURIComponent(q.trim())}`,
        ),
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={playing ? 'Trocar vídeo' : 'Assistir juntos'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <TextField
          label={canSearch ? 'Link ou pesquisa no YouTube' : 'Link do vídeo do YouTube'}
          placeholder={canSearch ? 'Cole um link ou pesquise…' : 'https://www.youtube.com/watch?v=…'}
          hint="Cada pessoa assiste pelo player oficial do YouTube, sincronizado com o grupo. Quem tem YouTube Premium logado não vê anúncios."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          required
          maxLength={200}
          autoFocus
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {results && (
          <ul className="yt-results" aria-label="Resultados">
            {results.map((r) => (
              <li key={r.videoId}>
                <button type="button" className="yt-result" onClick={() => void start(r.videoId)}>
                  <img src={r.thumbnail ?? thumb(r.videoId)} alt="" />
                  <span>
                    <strong>{r.title}</strong>
                    <span className="muted small">{r.channel}</span>
                  </span>
                </button>
              </li>
            ))}
            {!results.length && <li className="muted">Nada encontrado.</li>}
          </ul>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="play" disabled={busy}>
            {parseYouTubeId(q)
              ? 'Assistir juntos'
              : canSearch
                ? busy
                  ? 'Pesquisando…'
                  : 'Pesquisar'
                : 'Assistir juntos'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Indicador na barra lateral: o canal de voz está assistindo algo. */
export function ActivityHint({ channelId }: { channelId: string }) {
  const a = useActivity((s) => s.channels[channelId]);
  if (!a) return null;
  return (
    <span className="activity-hint truncate" data-tip={a.title ?? 'Assistir juntos'}>
      <Icon name="play" size={12} /> {a.title ?? 'Assistindo juntos'}
    </span>
  );
}

/**
 * Painel "Atividades" (aberto pelo botão da chamada): cartões das atividades disponíveis. Por ora, o YouTube.
 * Arte própria (sem logotipos de terceiros).
 */
export function ActivitiesPanel({ onClose }: { onClose: () => void }) {
  const running = useActivity((a) => a.state);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.activities-btn')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('.app-card')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const openYouTube = () => {
    onClose();
    if (running) {
      useActivity.getState().join(true);
      useUi.getState().focusStream('activity');
    } else useUi.getState().openModal({ kind: 'watch-together' });
  };
  return (
    <div className="activities-panel" ref={ref} role="dialog" aria-label="Atividades">
      <div className="activities-head">
        <Icon name="activities" size={18} />
        <strong>Atividades</strong>
      </div>
      <ul className="activities-list">
        <li>
          <button className="app-card app-youtube" onClick={openYouTube}>
            <span className="app-art" aria-hidden="true">
              <Icon name="play" size={34} />
            </span>
            <span className="app-name">
              <strong>YouTube</strong>
              <span className="muted small">{running ? 'Em andamento: abrir' : 'Assistir juntos'}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}

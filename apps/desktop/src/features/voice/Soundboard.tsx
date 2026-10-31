/**
 * Efeitos sonoros (ADR-0016): painel para tocar sons na chamada, envio de som com prévia e a lista nas
 * configurações do servidor. Qualquer membro envia; tocar avisa a chamada e cada um ouve no próprio app.
 */
import { SOUND_MAX_BYTES, SOUND_MAX_MS, type SoundEffect } from '@opencord/contracts';
import { Avatar, Button, Icon, Slider, TextField } from '@opencord/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { previewSound, useSounds } from '../../store/sounds';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { decodeAudio, moveHandle, peaks, trimToWav, type TrimRange } from './soundTrim';

const NO_SOUNDS: SoundEffect[] = [];

/** Painel flutuante (botão de efeitos no painel da chamada ou nos controles do palco). */
export function SoundboardPanel({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const serverId = useVoice((v) => v.serverId);
  const channelId = useVoice((v) => v.machine.channelId);
  const servers = useData((d) => d.servers);
  const byServer = useSounds((s) => s.byServer);
  const usage = useSounds((s) => s.usage);
  const muted = useSounds((s) => s.muted);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useSounds.getState().loadAll();
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.soundboard-btn') && !t.closest('dialog')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || adding) return;
      if (showVolume) setShowVolume(false);
      else onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, adding, showVolume]);
  useEffect(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus(), []);

  // o servidor da chamada primeiro, depois os outros na ordem da barra de servidores
  const groups = useMemo(() => {
    const order = [...servers].sort((a, b) => Number(b.id === serverId) - Number(a.id === serverId));
    return order.map((server) => ({ server, sounds: byServer[server.id] ?? NO_SOUNDS }));
  }, [servers, byServer, serverId]);
  const all = useMemo(() => groups.flatMap((g) => g.sounds), [groups]);
  const q = query.trim().toLowerCase();
  const match = (s: SoundEffect) => !q || s.name.toLowerCase().includes(q);
  const frequent = useMemo(
    () =>
      all
        .filter((s) => (usage[s.id] ?? 0) > 0)
        .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
        .slice(0, 6),
    [all, usage],
  );
  const visible = groups.filter((g) => g.server.id === serverId || g.sounds.some(match));
  const play = (s: SoundEffect) => channelId && void useSounds.getState().play(channelId, s);
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const jump = (id: string) => {
    setCollapsed((c) => ({ ...c, [id]: false }));
    body.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // abre acima do botão, sem sair da janela
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 588)),
    bottom: window.innerHeight - anchor.top + 8,
  };

  return (
    <div className="soundboard" ref={ref} role="dialog" aria-label="Efeitos sonoros" style={style}>
      <div className="soundboard-head">
        <TextField
          fieldClassName="soundboard-search"
          leadingIcon="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Encontre o som perfeito"
          aria-label="Buscar efeitos sonoros"
        />
        <button
          className="icon-btn"
          aria-pressed={muted || showVolume}
          aria-expanded={showVolume}
          aria-label="Volume dos efeitos sonoros"
          data-tip={showVolume ? undefined : muted ? 'Efeitos silenciados' : 'Volume dos efeitos'}
          onClick={() => setShowVolume((v) => !v)}
        >
          <Icon name={muted ? 'speaker-off' : 'speaker'} size={20} />
        </button>
        {showVolume && <SoundVolume />}
      </div>
      <div className="soundboard-main">
        <nav className="soundboard-rail" aria-label="Ir para">
          {frequent.length > 0 && (
            <button
              className="soundboard-rail-btn"
              aria-label="Utilizados com frequência"
              data-tip="Utilizados com frequência"
              onClick={() => jump('frequent')}
            >
              <Icon name="refresh" size={18} />
            </button>
          )}
          {groups
            .filter((g) => g.sounds.length > 0 || g.server.id === serverId)
            .map(({ server }) => (
              <button
                key={server.id}
                className="soundboard-rail-btn server"
                aria-label={server.name}
                data-tip={server.name}
                onClick={() => jump(server.id)}
              >
                <ServerIcon name={server.name} iconKey={server.iconKey} official={server.official} />
              </button>
            ))}
        </nav>
        <div className="soundboard-body" ref={body}>
          {!q && frequent.length > 0 && (
            <SoundSection
              id="frequent"
              title="Utilizados com frequência"
              icon={<Icon name="refresh" size={14} />}
              collapsed={!!collapsed.frequent}
              onToggle={() => toggle('frequent')}
            >
              <SoundGrid sounds={frequent} onPlay={play} />
            </SoundSection>
          )}
          {visible.map(({ server, sounds }) => {
            const list = sounds.filter(match);
            return (
              <SoundSection
                key={server.id}
                id={server.id}
                title={server.name}
                icon={
                  <span className="soundboard-section-icon">
                    <ServerIcon name={server.name} iconKey={server.iconKey} official={server.official} />
                  </span>
                }
                collapsed={!q && !!collapsed[server.id]}
                onToggle={() => toggle(server.id)}
              >
                <SoundGrid
                  sounds={list}
                  onPlay={play}
                  onAdd={!q && server.id === serverId ? () => setAdding(true) : undefined}
                />
                {list.length === 0 && server.id !== serverId && <p className="muted small">Nenhum som.</p>}
              </SoundSection>
            );
          })}
          {q && !visible.some((g) => g.sounds.some(match)) && <p className="muted small">Nenhum som com esse nome.</p>}
        </div>
      </div>
      {adding && serverId && <UploadSoundDialog serverId={serverId} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Balão do volume, preso ao botão do alto-falante. */
function SoundVolume() {
  const volume = useSounds((s) => s.volume);
  const muted = useSounds((s) => s.muted);
  return (
    <div className="soundboard-volume" role="group" aria-label="Volume dos efeitos sonoros">
      <Slider
        label="Volume dos efeitos sonoros (só para você)"
        min={0}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        value={muted ? 0 : Math.round(volume * 100)}
        onChange={(v) => {
          useSounds.getState().setVolume(v / 100);
          if (muted && v > 0) useSounds.getState().setMuted(false);
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={muted ? 'speaker' : 'speaker-off'}
        onClick={() => useSounds.getState().setMuted(!muted)}
      >
        {muted ? 'Ativar efeitos' : 'Silenciar efeitos'}
      </Button>
    </div>
  );
}

function SoundSection({
  id,
  title,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section role="region" aria-label={title} data-section={id}>
      <h3 className="soundboard-title">
        <button type="button" aria-expanded={!collapsed} onClick={onToggle}>
          {icon}
          <span className="truncate">{title}</span>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
        </button>
      </h3>
      {!collapsed && children}
    </section>
  );
}

function SoundGrid({
  sounds,
  onPlay,
  onAdd,
}: {
  sounds: SoundEffect[];
  onPlay: (s: SoundEffect) => void;
  onAdd?: (() => void) | undefined;
}) {
  return (
    <ul className="sound-grid">
      {sounds.map((s) => (
        <li key={s.id}>
          <button className="sound-btn" onClick={() => onPlay(s)} aria-label={`Tocar ${s.name}`}>
            {s.emoji && <span aria-hidden="true">{s.emoji}</span>}
            <span className="truncate">{s.name}</span>
          </button>
        </li>
      ))}
      {onAdd && (
        <li>
          <button className="sound-btn sound-add" onClick={onAdd}>
            <Icon name="plus" size={16} />
            <span>Adicionar som</span>
          </button>
        </li>
      )}
    </ul>
  );
}

/** Arquivos maiores que isto nem são lidos (o recorte enviado continua limitado a 1 MB e 10 s). */
const SOURCE_MAX_BYTES = 25 * 1024 * 1024;
const BARS = 96;
const secs = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

export function UploadSoundDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 });
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = usePreview(audio, range, volume);
  const total = audio ? Math.round(audio.duration * 1000) : 0;
  const length = range.end - range.start;

  const pick = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    setError(null);
    if (f.size > SOURCE_MAX_BYTES) return setError('O arquivo passa de 25 MB.');
    const buf = await decodeAudio(f);
    if (!buf) return setError('Não consegui ler esse áudio. Use MP3, OGG ou WAV.');
    preview.stop();
    setFile(f);
    setAudio(buf);
    setRange({ start: 0, end: Math.min(Math.round(buf.duration * 1000), SOUND_MAX_MS) });
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !audio) return setError('Escolha um arquivo de áudio.');
    if (!name.trim()) return setError('Dê um nome ao som.');
    setBusy(true);
    preview.stop();
    try {
      // o arquivo original vai como está quando nada foi cortado e ele já cabe no limite
      const whole = range.start === 0 && range.end === total && file.size <= SOUND_MAX_BYTES;
      const body = whole
        ? file
        : new File([await trimToWav(audio, range.start, range.end)], `${file.name.replace(/\.[^.]+$/, '')}.wav`, {
            type: 'audio/wav',
          });
      if (body.size > SOUND_MAX_BYTES) throw new Error('O trecho passa de 1 MB.');
      await api().upload<SoundEffect>(`/servers/${serverId}/sounds`, body, {
        name: name.trim(),
        ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
        volume: String(volume / 100),
        durationMs: String(length),
      });
      await useSounds.getState().load(serverId);
      useUi.getState().toast('success', 'Som adicionado.');
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Enviar um som"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="upload-sound" disabled={busy || !file || !name.trim()}>
            {busy ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <form id="upload-sound" className="upload-sound" onSubmit={(e) => void submit(e)}>
        {file && audio && (
          <div className="upload-sound-preview">
            <div className="upload-sound-head">
              <button
                type="button"
                className="music-play"
                aria-label={preview.playing ? 'Parar prévia' : 'Ouvir o trecho escolhido'}
                data-tip={preview.playing ? 'Parar' : 'Ouvir o trecho'}
                onClick={preview.toggle}
              >
                <Icon name={preview.playing ? 'stop' : 'play'} size={18} active />
              </button>
              <span className="truncate">{file.name}</span>
              <span className="muted small">
                {length === total ? secs(total) : `${secs(length)} de ${secs(total)}`}
              </span>
            </div>
            <SoundTrimmer audio={audio} range={range} total={total} playhead={preview.at} onChange={setRange} />
            <p className="muted small upload-sound-hint">
              {total > SOUND_MAX_MS
                ? `O áudio tem ${secs(total)}. Arraste as bordas para escolher um trecho de até 10 s.`
                : 'Arraste as bordas para cortar o começo ou o fim.'}
            </p>
          </div>
        )}
        <div className="upload-sound-file">
          <Button type="button" variant="secondary" icon="upload" onClick={() => input.current?.click()}>
            {file ? 'Trocar arquivo' : 'Escolher arquivo'}
          </Button>
          <span className="muted small">MP3, OGG ou WAV · trecho de até 10 s</span>
          <input
            ref={input}
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"
            hidden
            aria-label="Escolher arquivo de áudio"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
        <div className="field-row">
          <TextField
            label="Nome do som"
            value={name}
            maxLength={32}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Emoji (opcional)"
            value={emoji}
            maxLength={16}
            placeholder="ex.: 😂"
            onChange={(e) => setEmoji(e.target.value)}
          />
        </div>
        <Slider
          label="Volume do som"
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          value={volume}
          onChange={setVolume}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Toca só o trecho escolhido; `at` é a posição atual (ms no áudio inteiro) para desenhar o cursor. */
function usePreview(audio: AudioBuffer | null, range: TrimRange, volume: number) {
  const [at, setAt] = useState<number | null>(null);
  const live = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const stop = useCallback(() => {
    const l = live.current;
    live.current = null;
    if (l) {
      cancelAnimationFrame(l.raf);
      void l.ctx.close();
    }
    setAt(null);
  }, []);
  const toggle = () => {
    if (live.current || !audio) return stop();
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = volume / 100;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime;
    src.start(0, range.start / 1000, (range.end - range.start) / 1000);
    src.onended = stop;
    const l = { ctx, raf: 0 };
    const tick = () => {
      setAt(range.start + (ctx.currentTime - t0) * 1000);
      l.raf = requestAnimationFrame(tick);
    };
    l.raf = requestAnimationFrame(tick);
    live.current = l;
  };
  useEffect(() => stop, [stop]);
  // mexer no trecho durante a prévia para de tocar (o som antigo não corresponde mais)
  useEffect(stop, [range.start, range.end, stop]);
  return { playing: at !== null, at, toggle, stop };
}

/** Forma de onda com duas bordas arrastáveis (mouse ou setas do teclado; Shift anda 1 s). */
function SoundTrimmer({
  audio,
  range,
  total,
  playhead,
  onChange,
}: {
  audio: AudioBuffer;
  range: TrimRange;
  total: number;
  playhead: number | null;
  onChange: (r: TrimRange) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => peaks(audio, BARS), [audio]);
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  const msAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? ((clientX - box.left) / box.width) * total : 0;
  };
  const move = (which: 'start' | 'end', ms: number) => onChange(moveHandle(range, which, ms, total, SOUND_MAX_MS));
  const drag = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.focus();
    el.setPointerCapture(e.pointerId);
    let r = range;
    const onMove = (ev: PointerEvent) => {
      r = moveHandle(r, which, msAt(ev.clientX), total, SOUND_MAX_MS);
      onChange(r);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };
  // clicar fora do trecho leva a borda mais próxima até ali
  const jump = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ms = msAt(e.clientX);
    if (ms < range.start) move('start', ms);
    else if (ms > range.end) move('end', ms);
  };
  const keys = (which: 'start' | 'end') => (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 1000 : 100;
    const now = range[which];
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? now - step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? now + step
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? total
              : null;
    if (to === null) return;
    e.preventDefault();
    move(which, to);
  };
  const handle = (which: 'start' | 'end') => (
    <span
      role="slider"
      tabIndex={0}
      className={`trim-handle trim-${which}`}
      style={{ left: pct(range[which]) }}
      aria-label={which === 'start' ? 'Início do trecho' : 'Fim do trecho'}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={range[which]}
      aria-valuetext={secs(range[which])}
      onPointerDown={drag(which)}
      onKeyDown={keys(which)}
    />
  );

  return (
    <div className="trim">
      <div className="trim-track" ref={track} onPointerDown={jump}>
        <div className="trim-wave" aria-hidden="true">
          {bars.map((v, i) => {
            const mid = ((i + 0.5) / BARS) * total;
            return (
              <span
                key={i}
                className={mid >= range.start && mid <= range.end ? 'on' : undefined}
                style={{ height: `${Math.max(6, v * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="trim-sel" style={{ left: pct(range.start), width: pct(range.end - range.start) }} />
        {playhead !== null && <div className="trim-playhead" style={{ left: pct(playhead) }} />}
        {handle('start')}
        {handle('end')}
      </div>
      <div className="trim-times muted small">
        <span>{secs(range.start)}</span>
        <span>{secs(range.end)}</span>
      </div>
    </div>
  );
}

/** Aba "Efeitos sonoros" nas configurações do servidor. */
export function SoundsTab({ serverId, canManage, myId }: { serverId: string; canManage: boolean; myId: string }) {
  const sounds = useSounds((s) => s.byServer[serverId] ?? NO_SOUNDS);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    void useSounds.getState().load(serverId);
  }, [serverId]);
  const remove = async (s: SoundEffect) => {
    if (!confirm(`Remover o som "${s.name}"?`)) return;
    try {
      await api().request('DELETE', `/servers/${serverId}/sounds/${s.id}`);
      await useSounds.getState().load(serverId);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Efeitos sonoros</h3>
      <p className="muted small">
        Sons que qualquer pessoa deste servidor toca na chamada de voz em que estiver. Qualquer membro pode enviar.
      </p>
      <Button icon="upload" onClick={() => setAdding(true)}>
        Enviar som
      </Button>
      <ul className="sounds-list" aria-label="Efeitos sonoros do servidor">
        {sounds.length === 0 && <li className="muted small">Nenhum som ainda.</li>}
        {sounds.map((s) => (
          <li key={s.id}>
            <button
              className="icon-btn"
              aria-label={`Ouvir ${s.name}`}
              data-tip="Ouvir (só você)"
              onClick={() => void previewSound(s)}
            >
              <Icon name="play" size={16} />
            </button>
            <span className="sounds-emoji" aria-hidden="true">
              {s.emoji ?? ''}
            </span>
            <span className="truncate">{s.name}</span>
            <span className="muted small">{(s.durationMs / 1000).toFixed(1)} s</span>
            <span className="sounds-by muted small">
              <Avatar id={s.createdBy.id} name={s.createdBy.displayName} size={18} />
              {s.createdBy.displayName}
            </span>
            {(canManage || s.createdBy.id === myId) && (
              <button
                className="icon-btn"
                aria-label={`Remover ${s.name}`}
                data-tip="Remover"
                onClick={() => void remove(s)}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && <UploadSoundDialog serverId={serverId} onClose={() => setAdding(false)} />}
    </section>
  );
}

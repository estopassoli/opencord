/**
 * Efeitos sonoros (ADR-0016): painel para tocar sons na chamada, envio de som com prévia e a lista nas
 * configurações do servidor. Qualquer membro envia; tocar avisa a chamada e cada um ouve no próprio app.
 */
import { SOUND_MAX_BYTES, SOUND_MAX_MS, type SoundEffect } from '@opencord/contracts';
import { Avatar, Button, Icon, Slider, TextField } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { previewSound, useSounds } from '../../store/sounds';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

const NO_SOUNDS: SoundEffect[] = [];

/** Painel flutuante (botão de efeitos no painel da chamada ou nos controles do palco). */
export function SoundboardPanel({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const serverId = useVoice((v) => v.serverId);
  const channelId = useVoice((v) => v.machine.channelId);
  const server = useData((d) => (serverId ? d.servers.find((s) => s.id === serverId) : undefined));
  const sounds = useSounds((s) => (serverId ? (s.byServer[serverId] ?? NO_SOUNDS) : NO_SOUNDS));
  const usage = useSounds((s) => s.usage);
  const muted = useSounds((s) => s.muted);
  const volume = useSounds((s) => s.volume);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (serverId) void useSounds.getState().load(serverId);
  }, [serverId]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.soundboard-btn') && !t.closest('dialog')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !adding && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, adding]);

  const q = query.trim().toLowerCase();
  const filtered = q ? sounds.filter((s) => s.name.toLowerCase().includes(q)) : sounds;
  const frequent = useMemo(
    () =>
      [...sounds]
        .filter((s) => (usage[s.id] ?? 0) > 0)
        .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
        .slice(0, 6),
    [sounds, usage],
  );
  const play = (s: SoundEffect) => channelId && void useSounds.getState().play(channelId, s);
  // abre acima do botão, sem sair da janela
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 528)),
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
          aria-pressed={muted}
          aria-label={muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros (só para você)'}
          data-tip={muted ? 'Efeitos silenciados' : 'Volume dos efeitos'}
          onClick={() => (muted ? useSounds.getState().setMuted(false) : setShowVolume((v) => !v))}
        >
          <Icon name={muted ? 'speaker-off' : 'speaker'} size={20} />
        </button>
      </div>
      {showVolume && !muted && (
        <div className="soundboard-volume">
          <Slider
            label="Volume dos efeitos sonoros (só para você)"
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            value={Math.round(volume * 100)}
            onChange={(v) => useSounds.getState().setVolume(v / 100)}
          />
          <Button size="sm" variant="ghost" icon="speaker-off" onClick={() => useSounds.getState().setMuted(true)}>
            Silenciar efeitos
          </Button>
        </div>
      )}
      <div className="soundboard-body">
        {!q && frequent.length > 0 && (
          <section role="region" aria-label="Utilizados com frequência">
            <h3 className="soundboard-title">
              <Icon name="refresh" size={14} /> Utilizados com frequência
            </h3>
            <SoundGrid sounds={frequent} onPlay={play} />
          </section>
        )}
        <section role="region" aria-label={server?.name ?? 'Servidor'}>
          <h3 className="soundboard-title">{server?.name ?? 'Servidor'}</h3>
          <SoundGrid sounds={filtered} onPlay={play} onAdd={q ? undefined : () => setAdding(true)} />
          {q && filtered.length === 0 && <p className="muted small">Nenhum som com esse nome.</p>}
        </section>
      </div>
      {adding && serverId && <UploadSoundDialog serverId={serverId} onClose={() => setAdding(false)} />}
    </div>
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

/** Duração de um áudio (ms) pelo próprio decodificador do navegador; null se não for áudio válido. */
async function durationOf(file: File): Promise<number | null> {
  try {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();
    return Math.round(buf.duration * 1000);
  } catch {
    return null;
  }
}

export function UploadSoundDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLAudioElement | null>(null);

  const pick = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    setError(null);
    if (f.size > SOUND_MAX_BYTES) return setError('O som passa de 1 MB.');
    const ms = await durationOf(f);
    if (ms === null) return setError('Não consegui ler esse áudio. Use MP3, OGG ou WAV.');
    if (ms > SOUND_MAX_MS) return setError(`O som tem ${(ms / 1000).toFixed(1)} s; o máximo é 10 s.`);
    setFile(f);
    setDuration(ms);
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32));
  };
  const listen = () => {
    if (!file) return;
    preview.current?.pause();
    const el = new Audio(URL.createObjectURL(file));
    el.volume = volume / 100;
    preview.current = el;
    void el.play();
  };
  useEffect(() => () => preview.current?.pause(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !duration) return setError('Escolha um arquivo de áudio.');
    if (!name.trim()) return setError('Dê um nome ao som.');
    setBusy(true);
    try {
      await api().upload<SoundEffect>(`/servers/${serverId}/sounds`, file, {
        name: name.trim(),
        ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
        volume: String(volume / 100),
        durationMs: String(duration),
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
        {file && (
          <div className="upload-sound-preview">
            <button type="button" className="music-play" aria-label="Ouvir prévia" data-tip="Ouvir" onClick={listen}>
              <Icon name="play" size={18} active />
            </button>
            <span className="truncate">{file.name}</span>
            <span className="muted small">{duration ? `${(duration / 1000).toFixed(2)} s` : ''}</span>
          </div>
        )}
        <div className="upload-sound-file">
          <Button type="button" variant="secondary" icon="upload" onClick={() => input.current?.click()}>
            {file ? 'Trocar arquivo' : 'Escolher arquivo'}
          </Button>
          <span className="muted small">MP3, OGG ou WAV · até 1 MB e 10 s</span>
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

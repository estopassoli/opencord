import type { Me, UserSettings } from '@opencord/contracts';
import { Button, ColorSwatches, RadioGroup, Select, Slider, Switch, TextField, type SelectOption } from '@opencord/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AppInfo, AppPrefsState, GpuMode } from '../../../electron/shared/ipc';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { playSound } from '../../lib/sounds';
import {
  familyFromFileName,
  FONT_ACCEPT,
  FontImportError,
  importFont,
  removeImportedFont,
  useImportedFonts,
} from '../../lib/fonts';
import { isFontAvailable } from '../../lib/theme';
import { useData } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { updateSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import './settings.css';
import { deviceLabel } from '../voice/devices';
import { AvatarPicker } from './AvatarPicker';

// ---------------------------------------------------------------------------
// Layout de abas verticais (compartilhado com as configurações do servidor)
// ---------------------------------------------------------------------------

export interface TabDef<K extends string> {
  id: K;
  label: string;
}

/** Lista de abas vertical acessível (setas ↑/↓, Home/End) + painel. */
export function TabbedLayout<K extends string>({
  tabs,
  active,
  onChange,
  label,
  footer,
  children,
}: {
  tabs: readonly TabDef<K>[];
  active: K;
  onChange: (id: K) => void;
  label: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const base = useId();
  const tabId = (id: K) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === active);
    if (idx < 0 || tabs.length === 0) return;
    let next = idx;
    if (e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const t = tabs[next];
    if (!t) return;
    onChange(t.id);
    document.getElementById(tabId(t.id))?.focus();
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        <div role="tablist" aria-orientation="vertical" aria-label={label} onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              className="settings-tab"
              aria-selected={t.id === active}
              aria-controls={panelId}
              tabIndex={t.id === active ? 0 : -1}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {footer}
      </nav>
      <div className="settings-panel" role="tabpanel" id={panelId} aria-labelledby={tabId(active)} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}

/** Seção com título dentro de um painel. */
export function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {description && <p className="muted small settings-desc">{description}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modal de configurações do usuário
// ---------------------------------------------------------------------------

type UserTab = 'account' | 'voice' | 'keybinds' | 'appearance' | 'notifications' | 'about';

const USER_TABS: readonly TabDef<UserTab>[] = [
  { id: 'account', label: 'Minha conta' },
  { id: 'voice', label: 'Voz e vídeo' },
  { id: 'keybinds', label: 'Atalhos' },
  { id: 'appearance', label: 'Aparência' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'about', label: 'Sobre' },
];

const isUserTab = (v: unknown): v is UserTab => USER_TABS.some((t) => t.id === v);

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useData((s) => s.settings);
  const initialTab = useUi((s) => (s.modal?.kind === 'settings' ? s.modal.tab : undefined));
  const [tab, setTab] = useState<UserTab>(isUserTab(initialTab) ? initialTab : 'account');
  if (!settings) return null;

  return (
    <Dialog title="Configurações do usuário" onClose={onClose} fullscreen>
      <TabbedLayout tabs={USER_TABS} active={tab} onChange={setTab} label="Seções das configurações">
        {tab === 'account' && <AccountTab />}
        {tab === 'voice' && <VoiceTab settings={settings} />}
        {tab === 'keybinds' && <KeybindsTab settings={settings} />}
        {tab === 'appearance' && <AppearanceTab settings={settings} />}
        {tab === 'notifications' && <NotificationsTab settings={settings} />}
        {tab === 'about' && (
          <>
            <AboutTab />
            <HardwareAcceleration />
          </>
        )}
      </TabbedLayout>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Minha conta
// ---------------------------------------------------------------------------

/** Transforma a identidade só com apelido em conta (mesmo usuário, servidores e histórico). */
function ClaimAccount() {
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError('A senha precisa ter pelo menos 10 caracteres.');
    if (password !== confirmPw) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      const updated = await api().request<Me>('POST', '/auth/claim', {
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      useData.setState((s) => ({ me: s.me ? { ...s.me, ...updated } : updated }));
      useUi
        .getState()
        .toast('success', 'Conta criada. Agora você pode entrar de qualquer computador com seu apelido e senha.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Criar conta (opcional)"
      description="Mantém o mesmo apelido, servidores e histórico, e permite entrar de outros computadores."
    >
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="field-row">
          <TextField
            label="Senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            maxLength={256}
          />
          <TextField
            label="Confirmar senha"
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            required
            minLength={10}
            maxLength={256}
          />
        </div>
        <TextField
          label="E-mail (opcional)"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" size="sm" disabled={busy}>
            Criar conta
          </Button>
        </div>
      </form>
    </Section>
  );
}

function AccountTab() {
  const me = useData((s) => s.me);
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  if (!me) return null;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) return setNameError('O apelido precisa de ao menos 2 caracteres.');
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await api().request<Me>('PATCH', '/me', { displayName: name });
      useData.setState((s) => ({ me: s.me ? { ...s.me, ...updated } : updated }));
      useUi.getState().toast('success', 'Apelido atualizado.');
    } catch (err) {
      setNameError(describeError(err));
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) return setPwError('A nova senha precisa ter pelo menos 10 caracteres.');
    if (newPassword !== confirmPassword) return setPwError('As senhas não conferem.');
    setSavingPw(true);
    setPwError(null);
    try {
      await api().request('POST', '/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      useUi.getState().toast('success', 'Senha alterada.');
    } catch (err) {
      setPwError(describeError(err));
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <>
      <Section title="Perfil">
        <AvatarPicker me={me} />
        <dl className="settings-kv">
          <dt>Usuário</dt>
          <dd>@{me.username}</dd>
          {me.email && (
            <>
              <dt>E-mail</dt>
              <dd>{me.email}</dd>
            </>
          )}
        </dl>
        <form className="form" onSubmit={(e) => void saveName(e)}>
          <TextField
            label="Apelido"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={2}
            maxLength={32}
          />
          {nameError && (
            <p className="form-error" role="alert">
              {nameError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" size="sm" disabled={savingName || displayName.trim() === me.displayName}>
              Salvar
            </Button>
          </div>
        </form>
      </Section>

      {!me.hasAccount && <ClaimAccount />}

      {me.hasAccount && (
        <Section title="Alterar senha" description="Mínimo de 10 caracteres.">
          <form className="form" onSubmit={(e) => void changePassword(e)}>
            <TextField
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              maxLength={256}
            />
            <div className="field-row">
              <TextField
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={10}
                maxLength={256}
              />
              <TextField
                label="Confirmar nova senha"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={10}
                maxLength={256}
              />
            </div>
            {pwError && (
              <p className="form-error" role="alert">
                {pwError}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" size="sm" disabled={savingPw}>
                Alterar senha
              </Button>
            </div>
          </form>
        </Section>
      )}

      <Section
        title="Sessão"
        description={
          me.hasAccount
            ? undefined
            : 'Você entrou só com apelido: sua identidade fica neste computador. Crie uma conta acima para não perder o apelido ao sair.'
        }
      >
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (me.hasAccount || confirm(`Sair e perder o acesso ao apelido "${me.displayName}" neste dispositivo?`))
              void useSession.getState().logout();
          }}
        >
          Sair
        </Button>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Voz e vídeo
// ---------------------------------------------------------------------------

let labelsUnlocked = false;

/** Lista dispositivos de mídia; pede permissão de microfone uma vez para liberar os nomes. */
function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.enumerateDevices !== 'function') {
      setError('Este ambiente não permite listar dispositivos de mídia.');
      return;
    }
    const refresh = async () => {
      const list = await md.enumerateDevices();
      if (!cancelled) setDevices(list);
    };
    void (async () => {
      try {
        let list = await md.enumerateDevices();
        if (!labelsUnlocked && list.some((d) => !d.label)) {
          labelsUnlocked = true;
          try {
            const s = await md.getUserMedia({ audio: true });
            s.getTracks().forEach((t) => t.stop());
            list = await md.enumerateDevices();
          } catch {
            if (!cancelled) setError('Sem permissão de microfone: os nomes dos dispositivos podem não aparecer.');
          }
        }
        if (!cancelled) setDevices(list);
      } catch {
        if (!cancelled) setError('Não foi possível listar os dispositivos de mídia.');
      }
    })();
    const onChange = () => void refresh().catch(() => undefined);
    md.addEventListener('devicechange', onChange);
    return () => {
      cancelled = true;
      md.removeEventListener('devicechange', onChange);
    };
  }, []);

  return { devices, error };
}

const DEFAULT_DEVICE = '__default__';

function DeviceSelect({
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default');
  const missing = value !== null && !list.some((d) => d.deviceId === value);
  const options: SelectOption<string>[] = [
    { value: DEFAULT_DEVICE, label: 'Padrão do sistema' },
    ...list.map((d, i) => ({ value: d.deviceId, label: deviceLabel(d.label) || `Dispositivo ${i + 1}` })),
    ...(missing && value !== null ? [{ value, label: 'Dispositivo desconectado' }] : []),
  ];
  return (
    <Select
      label={label}
      value={value ?? DEFAULT_DEVICE}
      options={options}
      onChange={(v) => onChange(v === DEFAULT_DEVICE ? null : v)}
    />
  );
}

const DB_MIN = -100;

/** Medidor de nível do microfone. Analisa localmente; nunca reproduz áudio nos alto-falantes. */
function MicMeter({ audio }: { audio: UserSettings['audio'] }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const thresholdRef = useRef(audio.vadThreshold);
  useEffect(() => {
    thresholdRef.current = audio.vadThreshold;
  }, [audio.vadThreshold]);

  const { inputDeviceId, echoCancellation, noiseSuppression, autoGainControl } = audio;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;

    void (async () => {
      try {
        const constraints: MediaTrackConstraints = { echoCancellation, noiseSuppression, autoGainControl };
        if (inputDeviceId) constraints.deviceId = { exact: inputDeviceId };
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser); // analyser NÃO é ligado ao destination
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          const db = rms > 0 ? Math.max(DB_MIN, 20 * Math.log10(rms)) : DB_MIN;
          const pct = ((db - DB_MIN) / -DB_MIN) * 100;
          const bar = barRef.current;
          if (bar) {
            bar.style.width = `${pct}%`;
            bar.dataset.active = db >= thresholdRef.current ? 'true' : 'false';
          }
          if (valueRef.current) valueRef.current.textContent = `${Math.round(db)} dB`;
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Permissão de microfone negada.'
            : 'Não foi possível abrir o microfone selecionado.',
        );
        setRunning(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      if (barRef.current) barRef.current.style.width = '0%';
      if (valueRef.current) valueRef.current.textContent = '';
    };
  }, [running, inputDeviceId, echoCancellation, noiseSuppression, autoGainControl]);

  const thresholdPct = ((audio.vadThreshold - DB_MIN) / -DB_MIN) * 100;

  return (
    <div className="mic-test">
      <div className="mic-test-row">
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={running}
          onClick={() => {
            setError(null);
            setRunning((r) => !r);
          }}
        >
          {running ? 'Parar teste' : 'Testar microfone'}
        </Button>
        <div className="mic-meter" aria-hidden="true">
          <div className="mic-meter-bar" ref={barRef} />
          <div className="mic-meter-threshold" style={{ left: `${thresholdPct}%` }} />
        </div>
        <span className="mic-meter-value small muted" ref={valueRef} aria-hidden="true" />
      </div>
      <p className="muted small">
        {running
          ? 'A barra fica verde quando o volume passa do limite de ativação. O áudio não é reproduzido.'
          : 'O teste usa o microfone selecionado apenas localmente.'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function setAudio(patch: Partial<UserSettings['audio']>) {
  updateSettings((s) => ({ ...s, audio: { ...s.audio, ...patch } }));
}
function setVideo(patch: Partial<UserSettings['video']>) {
  updateSettings((s) => ({ ...s, video: { ...s.video, ...patch } }));
}

const INPUT_MODE_OPTIONS: readonly { value: UserSettings['audio']['inputMode']; label: string }[] = [
  { value: 'vad', label: 'Detecção de voz' },
  { value: 'ptt', label: 'Pressionar para falar' },
];

const STREAM_PROFILE_OPTIONS: readonly SelectOption<UserSettings['video']['streamProfile']>[] = [
  { value: '720p30', label: '720p 30 fps' },
  { value: '1080p60', label: '1080p 60 fps' },
  { value: '1440p60', label: '1440p 60 fps' },
];

const STREAM_BITRATE_OPTIONS: readonly SelectOption<UserSettings['video']['streamBitrate']>[] = [
  { value: 'low', label: 'Leve (para upload fraco)' },
  { value: 'medium', label: 'Equilibrada (recomendado)' },
  { value: 'high', label: 'Máxima (precisa de upload folgado)' },
];

const CODEC_OPTIONS: readonly SelectOption<UserSettings['video']['preferredCodec']>[] = [
  { value: 'h264', label: 'H.264' },
  { value: 'vp8', label: 'VP8' },
  { value: 'vp9', label: 'VP9' },
  { value: 'av1', label: 'AV1' },
];

function VoiceTab({ settings }: { settings: UserSettings }) {
  const { devices, error } = useMediaDevices();
  const { audio, video } = settings;
  const sinkSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  return (
    <>
      <Section title="Dispositivos">
        {error && <p className="muted small">{error}</p>}
        <div className="field-row">
          <DeviceSelect
            label="Dispositivo de entrada"
            kind="audioinput"
            devices={devices}
            value={audio.inputDeviceId}
            onChange={(v) => setAudio({ inputDeviceId: v })}
          />
          <DeviceSelect
            label="Dispositivo de saída"
            kind="audiooutput"
            devices={devices}
            value={audio.outputDeviceId}
            onChange={(v) => setAudio({ outputDeviceId: v })}
          />
        </div>
        {!sinkSupported && (
          <p className="muted small">A escolha do dispositivo de saída não é suportada neste ambiente.</p>
        )}
        <Slider
          label="Volume de saída"
          min={0}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          value={Math.round(audio.outputVolume * 100)}
          onChange={(v) => setAudio({ outputVolume: v / 100 })}
        />
      </Section>

      <Section title="Modo de entrada">
        <RadioGroup
          label="Modo de entrada"
          hideLabel
          variant="cards"
          value={audio.inputMode}
          options={INPUT_MODE_OPTIONS}
          onChange={(v) => setAudio({ inputMode: v })}
        />

        {audio.inputMode === 'vad' ? (
          <Slider
            label="Limite de ativação"
            min={-100}
            max={0}
            step={1}
            format={(v) => `${v} dB`}
            value={audio.vadThreshold}
            onChange={(v) => setAudio({ vadThreshold: v })}
          />
        ) : (
          <Slider
            label="Atraso ao soltar a tecla"
            min={0}
            max={2000}
            step={20}
            format={(v) => `${v} ms`}
            value={audio.pttReleaseDelayMs}
            onChange={(v) => setAudio({ pttReleaseDelayMs: v })}
          />
        )}
        <MicMeter audio={audio} />
      </Section>

      <Section title="Processamento de voz">
        <Switch
          label="Cancelamento de eco"
          checked={audio.echoCancellation}
          onChange={(v) => setAudio({ echoCancellation: v })}
        />
        <Switch
          label="Supressão de ruído"
          checked={audio.noiseSuppression}
          onChange={(v) => setAudio({ noiseSuppression: v })}
        />
        <Switch
          label="Controle automático de ganho"
          checked={audio.autoGainControl}
          onChange={(v) => setAudio({ autoGainControl: v })}
        />
      </Section>

      <Section title="Vídeo e transmissão">
        <DeviceSelect
          label="Câmera"
          kind="videoinput"
          devices={devices}
          value={video.cameraDeviceId}
          onChange={(v) => setVideo({ cameraDeviceId: v })}
        />
        <div className="field-row">
          <Select
            label="Qualidade da transmissão"
            value={video.streamProfile}
            options={STREAM_PROFILE_OPTIONS}
            onChange={(v) => setVideo({ streamProfile: v })}
          />
          <Select
            label="Bitrate da transmissão"
            value={video.streamBitrate}
            options={STREAM_BITRATE_OPTIONS}
            onChange={(v) => setVideo({ streamBitrate: v })}
          />
          <Select
            label="Codec preferido"
            value={video.preferredCodec}
            options={CODEC_OPTIONS}
            onChange={(v) => setVideo({ preferredCodec: v })}
          />
        </div>
        <p className="muted small">
          1440p60 só é usado quando houver encoder por hardware. H.264 usa encoder de hardware quando disponível.
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Atalhos
// ---------------------------------------------------------------------------

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Converte KeyboardEvent.code em tecla de accelerator do Electron (A–Z, 0–9, F1–F24) ou null. */
function acceleratorKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1]) return digit[1];
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fn) return code;
  return null;
}

/** Texto legível para um KeyboardEvent.code (ex.: "KeyV" → "V"). */
function formatCode(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/Left$|Right$/, (m) => (m === 'Left' ? ' (esq.)' : ' (dir.)'));
}

function formatAccelerator(acc: string): string {
  return acc
    .split('+')
    .map((p) => (p === 'CommandOrControl' ? 'Ctrl' : p))
    .join(' + ');
}

function KeyCapture({
  label,
  value,
  mode,
  onChange,
}: {
  label: string;
  value: string | null;
  mode: 'code' | 'accelerator';
  onChange: (v: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const errorId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (e.key === 'Tab') {
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      setRecording(false);
      return;
    }
    if (mode === 'code') {
      if (!e.code) return;
      onChange(e.code);
      setError(null);
      setRecording(false);
      return;
    }
    if (MODIFIER_CODES.has(e.code)) return; // aguarda a tecla principal
    const key = acceleratorKey(e.code);
    if (!key) {
      setError('Use letras A–Z, números 0–9 ou F1–F24, com modificadores.');
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (mods.length === 0 && !key.startsWith('F')) {
      setError('Atalhos globais com letras ou números precisam de Ctrl, Alt ou Shift.');
      return;
    }
    onChange([...mods, key].join('+'));
    setError(null);
    setRecording(false);
  };

  const shown = value ? (mode === 'code' ? formatCode(value) : formatAccelerator(value)) : 'Nenhum';

  return (
    <div className="keybind">
      <span className="keybind-label" id={labelId}>
        {label}
      </span>
      <div className="keybind-controls">
        <button
          type="button"
          className="keybind-capture"
          data-recording={recording ? 'true' : undefined}
          aria-labelledby={labelId}
          aria-describedby={error ? errorId : undefined}
          aria-pressed={recording}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          <kbd>{recording ? 'Pressione uma tecla… (Esc cancela)' : shown}</kbd>
        </button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => onChange(null)}
          aria-label={`Limpar atalho: ${label}`}
        >
          Limpar
        </Button>
      </div>
      {error && (
        <p className="form-error small" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function setKeybind(patch: Partial<UserSettings['keybinds']>) {
  updateSettings((s) => ({ ...s, keybinds: { ...s.keybinds, ...patch } }));
}

function KeybindsTab({ settings }: { settings: UserSettings }) {
  const { keybinds, audio } = settings;
  return (
    <>
      <Section
        title="Pressionar para falar"
        description={
          <>
            Com a janela em foco, segure a tecla para falar. Fora do aplicativo o atalho global funciona como
            alternância (pressione para abrir o microfone e pressione de novo para fechar), porque atalhos globais não
            informam quando a tecla é solta.
          </>
        }
      >
        <KeyCapture
          label="Tecla de pressionar para falar"
          mode="code"
          value={keybinds.pushToTalk}
          onChange={(v) => setKeybind({ pushToTalk: v })}
        />
        {audio.inputMode !== 'ptt' && (
          <p className="muted small">Ative “Pressionar para falar” em Voz e vídeo para usar este atalho.</p>
        )}
      </Section>
      <Section title="Atalhos globais" description="Funcionam mesmo com o aplicativo em segundo plano.">
        <KeyCapture
          label="Silenciar / ativar microfone"
          mode="accelerator"
          value={keybinds.toggleMute}
          onChange={(v) => setKeybind({ toggleMute: v })}
        />
        <KeyCapture
          label="Ensurdecer / ativar áudio"
          mode="accelerator"
          value={keybinds.toggleDeafen}
          onChange={(v) => setKeybind({ toggleDeafen: v })}
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Aparência e notificações
// ---------------------------------------------------------------------------

function setAppearance(patch: Partial<UserSettings['appearance']>) {
  updateSettings((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
}

const THEME_OPTIONS: readonly { value: UserSettings['appearance']['theme']; label: string }[] = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
];

const REDUCED_MOTION_OPTIONS: readonly SelectOption<UserSettings['appearance']['reducedMotion']>[] = [
  { value: 'system', label: 'Seguir o sistema' },
  { value: 'on', label: 'Sempre reduzir' },
  { value: 'off', label: 'Nunca reduzir' },
];

/** Paleta própria de destaques (a primeira é a cor da logo). */
const ACCENTS = [
  '#4d56fd',
  '#7c5cff',
  '#b44dff',
  '#e0559b',
  '#ef4f4f',
  '#f08a24',
  '#d9a514',
  '#3fb27f',
  '#14a3a3',
  '#2d8cff',
  '#8a94a6',
] as const;
const DEFAULT_ACCENT = ACCENTS[0];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME_RE = /^[\p{L}\p{N} ._-]*$/u;

const SURFACE_OPTIONS: readonly { value: UserSettings['appearance']['surface']; label: string; description: string }[] =
  [
    { value: 'default', label: 'Grafite', description: 'Cinza neutro (padrão).' },
    { value: 'midnight', label: 'Meia-noite', description: 'Azul bem escuro.' },
    { value: 'oled', label: 'OLED', description: 'Preto puro.' },
    { value: 'slate', label: 'Ardósia', description: 'Cinza mais claro.' },
  ];

const FONT_PRESETS: readonly SelectOption<string>[] = [
  { value: '', label: 'Padrão (Inter)' },
  { value: 'Segoe UI Variable Text', label: 'Segoe UI Variable' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Consolas', label: 'Consolas' },
  { value: '__custom', label: 'Outra fonte instalada…' },
];

const DEFAULT_APPEARANCE: Pick<
  UserSettings['appearance'],
  'accent' | 'surface' | 'radiusScale' | 'fontFamily' | 'fontScale' | 'compact'
> = { accent: DEFAULT_ACCENT, surface: 'default', radiusScale: 1, fontFamily: '', fontScale: 1, compact: true };

function AppearanceTab({ settings }: { settings: UserSettings }) {
  const a = settings.appearance;
  const [hex, setHex] = useState(a.accent);
  useEffect(() => setHex(a.accent), [a.accent]);
  const imported = useImportedFonts((st) => st.families);
  const fontOptions: readonly SelectOption<string>[] = [
    ...FONT_PRESETS.slice(0, -1),
    ...imported.map((f) => ({ value: f, label: `${f} (importada)` })),
    FONT_PRESETS[FONT_PRESETS.length - 1]!,
  ];
  const isPreset = fontOptions.some((f) => f.value === a.fontFamily && f.value !== '__custom');
  const [customFont, setCustomFont] = useState(!isPreset);
  const [fontDraft, setFontDraft] = useState(isPreset ? '' : a.fontFamily);
  const fontMissing = a.fontFamily !== '' && !isFontAvailable(a.fontFamily);
  return (
    <>
      <Section title="Tema">
        <RadioGroup
          label="Tema"
          hideLabel
          variant="cards"
          value={a.theme}
          options={THEME_OPTIONS}
          onChange={(v) => setAppearance({ theme: v })}
        />
      </Section>
      <Section title="Cores" description="A cor de destaque aparece em botões, seleções, menções e indicadores.">
        <ColorSwatches
          label="Cor de destaque"
          colors={ACCENTS.slice(1)}
          defaultColor={DEFAULT_ACCENT}
          value={a.accent.toLowerCase() === DEFAULT_ACCENT ? null : a.accent}
          onChange={(v) => setAppearance({ accent: v ?? DEFAULT_ACCENT })}
        />
        <TextField
          label="Código da cor"
          hint="Formato #RRGGBB. O texto sobre a cor é ajustado automaticamente para manter a leitura."
          value={hex}
          maxLength={7}
          spellCheck={false}
          error={HEX_RE.test(hex) ? undefined : 'Use o formato #RRGGBB.'}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (HEX_RE.test(v)) setAppearance({ accent: v.toLowerCase() });
          }}
        />
        {a.theme === 'dark' ? (
          <RadioGroup
            label="Fundo"
            variant="cards"
            value={a.surface}
            options={SURFACE_OPTIONS}
            onChange={(v) => setAppearance({ surface: v })}
          />
        ) : (
          <p className="muted small">Os tons de fundo valem para o tema escuro.</p>
        )}
      </Section>
      <Section title="Formas">
        <Slider
          label="Cantos arredondados"
          min={0}
          max={2}
          step={0.25}
          format={(v) => (v === 0 ? 'Retos' : `${Math.round(v * 100)}%`)}
          value={a.radiusScale}
          onChange={(v) => setAppearance({ radiusScale: v })}
        />
      </Section>
      <Section title="Texto">
        <Select
          label="Fonte"
          value={customFont ? '__custom' : a.fontFamily}
          options={fontOptions}
          onChange={(v) => {
            if (v === '__custom') {
              setCustomFont(true);
              return;
            }
            setCustomFont(false);
            setAppearance({ fontFamily: v });
          }}
        />
        {customFont && (
          <TextField
            label="Nome da fonte"
            hint="Qualquer fonte instalada no seu computador, pelo nome exato."
            value={fontDraft}
            maxLength={64}
            spellCheck={false}
            error={FONT_NAME_RE.test(fontDraft) ? undefined : 'Use apenas letras, números, espaço, ponto, hífen ou _.'}
            onChange={(e) => {
              const v = e.target.value;
              setFontDraft(v);
              if (FONT_NAME_RE.test(v)) setAppearance({ fontFamily: v.trim() });
            }}
          />
        )}
        {fontMissing && (
          <p className="small warning-text" role="status">
            A fonte “{a.fontFamily}” não foi encontrada neste computador; usando a fonte padrão.
          </p>
        )}
        <FontImporter
          current={a.fontFamily}
          onUse={(family) => {
            setCustomFont(false);
            setAppearance({ fontFamily: family });
          }}
          onRemoved={(family) => {
            if (a.fontFamily === family) setAppearance({ fontFamily: '' });
          }}
        />
        <Slider
          label="Tamanho da fonte"
          min={0.8}
          max={1.5}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          value={a.fontScale}
          onChange={(v) => setAppearance({ fontScale: v })}
        />
        <Switch
          label="Modo compacto"
          description="Mensagens e listas mais densas."
          checked={a.compact}
          onChange={(v) => setAppearance({ compact: v })}
        />
      </Section>
      <Section title="Movimento">
        <Select
          label="Reduzir animações"
          value={a.reducedMotion}
          options={REDUCED_MOTION_OPTIONS}
          onChange={(v) => setAppearance({ reducedMotion: v })}
        />
      </Section>
      <Section title="Restaurar">
        <Button
          variant="secondary"
          onClick={() => {
            setCustomFont(false);
            setFontDraft('');
            setAppearance(DEFAULT_APPEARANCE);
          }}
        >
          Restaurar aparência padrão
        </Button>
      </Section>
    </>
  );
}

/**
 * Importa arquivos de fonte do computador do usuário. Ficam só neste PC (IndexedDB) e nunca são enviados:
 * a preferência sincronizada guarda apenas o nome da família.
 */
function FontImporter({
  current,
  onUse,
  onRemoved,
}: {
  current: string;
  onUse: (family: string) => void;
  onRemoved: (family: string) => void;
}) {
  const families = useImportedFonts((st) => st.families);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [family, setFamily] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await importFont(family, pending);
      setPending(null);
      onUse(family.trim());
      useUi.getState().toast('success', `Fonte “${family.trim()}” importada.`);
    } catch (e) {
      setError(e instanceof FontImportError ? e.message : 'Não foi possível importar a fonte.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="font-importer">
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={FONT_ACCEPT}
        aria-label="Arquivos de fonte"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!list.length) return;
          setPending(list);
          setFamily(familyFromFileName(list[0]!.name));
          setError(null);
        }}
      />
      {pending ? (
        <div className="font-import-form">
          <TextField
            label="Nome da fonte importada"
            hint={`${pending.length} arquivo(s): ${pending.map((f) => f.name).join(', ')}`}
            value={family}
            maxLength={64}
            spellCheck={false}
            error={error ?? undefined}
            onChange={(e) => setFamily(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <div className="font-import-actions">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !family.trim()}>
              {busy ? 'Importando…' : 'Importar e usar'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" icon="upload" onClick={() => input.current?.click()}>
          Importar fonte…
        </Button>
      )}
      <p className="muted small">
        WOFF2, WOFF, TTF ou OTF (até 5 MB cada). A fonte fica só neste computador e não é enviada a ninguém; você é
        responsável pela licença do arquivo.
      </p>
      {families.length > 0 && (
        <ul className="font-list" aria-label="Fontes importadas">
          {families.map((f) => (
            <li key={f}>
              <span className="truncate" style={{ fontFamily: `"${f}"` }}>
                {f}
              </span>
              {current === f ? (
                <span className="muted small">Em uso</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onUse(f)}>
                  Usar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remover ${f}`}
                onClick={() => void removeImportedFont(f).then(() => onRemoved(f))}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationsTab({ settings }: { settings: UserSettings }) {
  const n = settings.notifications;
  const set = (patch: Partial<UserSettings['notifications']>) =>
    updateSettings((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
  return (
    <Section title="Notificações">
      <Switch label="Notificações na área de trabalho" checked={n.desktop} onChange={(v) => set({ desktop: v })} />
      <Switch
        label="Efeitos sonoros"
        description="Entrar e sair da voz, gente entrando e saindo, mutar, transmissão, conexão e mensagens."
        checked={n.sounds}
        onChange={(v) => set({ sounds: v })}
      />
      {n.sounds && (
        <div className="sound-volume">
          <Slider
            label="Volume dos efeitos"
            min={0}
            max={1}
            step={0.05}
            value={n.soundVolume}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ soundVolume: v })}
          />
          <Button variant="secondary" icon="play" onClick={() => playSound('join', { force: true })}>
            Ouvir exemplo
          </Button>
        </div>
      )}
      <Switch
        label="Não perturbe"
        description="Silencia notificações e sons."
        checked={n.dnd}
        onChange={(v) => set({ dnd: v })}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sobre
// ---------------------------------------------------------------------------

/** "Verificar atualizações": o app também verifica sozinho ao abrir, a cada 20 min e ao voltar para a janela. */
function UpdateCheck() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = () => {
    if (!bridge) return;
    setBusy(true);
    setMsg(null);
    bridge.updates.check().then(
      (s) => {
        setBusy(false);
        setMsg(
          s.state === 'ready'
            ? `Versão ${s.version} baixada: clique em "Atualização pronta" na barra de título para instalar.`
            : s.state === 'downloading'
              ? `Baixando a versão ${s.version}… ${s.progress}%`
              : s.state === 'available'
                ? `Versão ${s.version} disponível: use o botão de atualização na barra de título.`
                : 'Você já está na versão mais recente.',
        );
      },
      () => {
        setBusy(false);
        setMsg('Não foi possível verificar agora. Tente de novo em instantes.');
      },
    );
  };
  return (
    <div className="update-check">
      <Button variant="secondary" icon="refresh" disabled={busy} onClick={check}>
        {busy ? 'Verificando…' : 'Verificar atualizações'}
      </Button>
      {msg && (
        <p className="muted small" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge
      .appInfo()
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section title="Sobre o OpenCord">
      {!bridge ? (
        <p className="muted">Executando no navegador.</p>
      ) : error ? (
        <p className="form-error">Não foi possível obter as informações do aplicativo.</p>
      ) : !info ? (
        <p className="muted">Carregando…</p>
      ) : (
        <dl className="settings-kv">
          <dt>Versão</dt>
          <dd>{info.version}</dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chromium</dt>
          <dd>{info.chrome}</dd>
          <dt>Sistema</dt>
          <dd>
            {info.platform} {info.osRelease}
          </dd>
          <dt>Armazenamento seguro</dt>
          <dd>{info.secureStorage ? 'Sim' : 'Não'}</dd>
        </dl>
      )}
      {bridge && <UpdateCheck />}
    </Section>
  );
}

const GPU_MODE_OPTIONS: readonly { value: GpuMode; label: string; description: string }[] = [
  {
    value: 'full',
    label: 'Placa de vídeo para tudo',
    description: 'Interface, lives que você assiste e a sua live usam a placa de vídeo.',
  },
  {
    value: 'off',
    label: 'Sem aceleração',
    description:
      'Tudo pelo processador, inclusive a sua live (mais pesado e com menos fps). Use se o app piscar, ficar com a tela preta ou travar.',
  },
];

/** Uso da placa de vídeo. Só no app: precisa ser aplicado antes de a janela abrir, então pede reinício. */
function HardwareAcceleration() {
  const [state, setState] = useState<AppPrefsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.prefs.get().then(
      (s) => !cancelled && setState(s),
      () => !cancelled && setError('Não foi possível ler esta opção.'),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (!bridge || (!state && !error)) return null;
  const pending = state && state.saved.gpuMode !== state.activeGpuMode;
  return (
    <Section title="Desempenho">
      {error && <p className="form-error">{error}</p>}
      {state && (
        <RadioGroup
          label="Uso da placa de vídeo"
          options={GPU_MODE_OPTIONS}
          value={state.saved.gpuMode}
          onChange={(gpuMode) =>
            bridge?.prefs.set({ gpuMode }).then(setState, () => setError('Não foi possível salvar.'))
          }
        />
      )}
      {pending && (
        <div className="settings-restart">
          <p className="muted small">Reinicie o OpenCord para aplicar. Se estiver em uma chamada, você sai dela.</p>
          <Button variant="secondary" onClick={() => void bridge?.relaunch()}>
            Reiniciar agora
          </Button>
        </div>
      )}
    </Section>
  );
}

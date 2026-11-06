import type { UserSettings } from '@opencord/contracts';
import { Button, RadioGroup, Select, Slider, Switch, type SelectOption } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { updateSettings } from '../../store/settings';
import { deviceLabel } from '../voice/devices';
import { Section } from './Section';

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

export function VoiceTab({ settings }: { settings: UserSettings }) {
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
          1440p 60 fps precisa de encoder por hardware: sem ele, a live desce sozinha para 1080p 60 fps. H.264 usa o
          encoder da placa de vídeo quando disponível.
        </p>
      </Section>
    </>
  );
}

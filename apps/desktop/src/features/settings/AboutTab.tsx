import { Button, RadioGroup } from '@opencord/ui';
import { Fragment, useEffect, useState } from 'react';
import type { AppInfo, AppPrefsState, GpuMode, ProcessMetric, RendererMemory } from '../../../electron/shared/ipc';
import { clipsDiag } from '../../store/clips';
import { InstallAppBlock } from '../../components/InstallApp';
import { bridge } from '../../lib/bridge';
import { useUi } from '../../store/ui';
import { Section } from './Section';

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

export function AboutTab() {
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
        <>
          <p className="muted">Executando no navegador.</p>
          <InstallAppBlock />
        </>
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

const PROCESS_LABEL: Record<string, string> = {
  Browser: 'Processo principal',
  Tab: 'Interface (janela)',
  GPU: 'Placa de vídeo',
  Utility: 'Auxiliar',
  Zygote: 'Auxiliar',
  Pepper: 'Plugin',
  Unknown: 'Outro',
};

/** Memória por processo e pelas partes do app que guardam dados (para investigar consumo alto). */
export function MemorySection() {
  const [rows, setRows] = useState<ProcessMetric[] | null>(null);
  const [inside, setInside] = useState<{ heap: number; clips: number; videos: number } | null>(null);
  const [mem, setMem] = useState<RendererMemory | null>(null);
  const load = () => {
    if (!bridge) return;
    void bridge.appMetrics().then(setRows, () => setRows([]));
    void bridge.rendererMemory().then(setMem, () => setMem(null));
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    setInside({
      heap: Math.round((perf.memory?.usedJSHeapSize ?? 0) / 1048576),
      clips: Math.round(clipsDiag().bytes / 1048576),
      videos: document.querySelectorAll('video').length,
    });
  };
  useEffect(load, []);
  if (!bridge) return null;
  const total = rows?.reduce((n, r) => n + r.mb, 0) ?? 0;
  const text = () =>
    [
      `OpenCord memória (${new Date().toLocaleString()})`,
      ...(rows ?? []).map((r) => `${PROCESS_LABEL[r.type] ?? r.type} (pid ${r.pid}): ${r.mb} MB`),
      `total: ${total} MB`,
      `interface: heap JS ${inside?.heap ?? '?'} MB · buffer de clipes ${inside?.clips ?? '?'} MB · vídeos na tela ${inside?.videos ?? '?'}`,
      `interface (detalhe): heap ${mem?.heap ?? '?'} MB · fora do heap (buffers) ${mem?.external ?? '?'} MB · Blink/mídia ${mem?.blink ?? '?'} MB · privada ${mem?.privateMb ?? '?'} MB · nós DOM ${document.getElementsByTagName('*').length}`,
    ].join('\n');
  return (
    <Section title="Memória" description="Quanto cada processo do app está usando agora.">
      <dl className="settings-kv">
        {rows?.map((r) => (
          <Fragment key={r.pid}>
            <dt>{PROCESS_LABEL[r.type] ?? r.type}</dt>
            <dd>{r.mb} MB</dd>
          </Fragment>
        ))}
        <dt>Total</dt>
        <dd>{total} MB</dd>
        {inside && (
          <>
            <dt>Interface: heap JS</dt>
            <dd>{inside.heap} MB</dd>
            <dt>Interface: buffer de clipes</dt>
            <dd>{inside.clips} MB</dd>
            <dt>Interface: vídeos na tela</dt>
            <dd>{inside.videos}</dd>
          </>
        )}
        {mem && (
          <>
            <dt>Interface: buffers fora do heap</dt>
            <dd>{mem.external} MB</dd>
            <dt>Interface: Blink/mídia</dt>
            <dd>{mem.blink} MB</dd>
            <dt>Interface: memória privada</dt>
            <dd>{mem.privateMb} MB</dd>
          </>
        )}
      </dl>
      <div className="form-actions">
        <Button size="sm" variant="secondary" icon="refresh" onClick={load}>
          Atualizar
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="copy"
          onClick={() =>
            void navigator.clipboard.writeText(text()).then(() => useUi.getState().toast('success', 'Copiado.'))
          }
        >
          Copiar
        </Button>
      </div>
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
export function HardwareAcceleration() {
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

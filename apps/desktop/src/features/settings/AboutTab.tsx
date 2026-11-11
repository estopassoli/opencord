import { Button, RadioGroup } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { AppInfo, AppPrefsState, GpuMode } from '../../../electron/shared/ipc';
import { InstallAppBlock } from '../../components/InstallApp';
import { bridge } from '../../lib/bridge';
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

/** o app em Tauri responde "Tauri 2.x" e "WebView2 1xx"; o Electron, só os números */
const isTauri = (i: AppInfo) => i.electron.startsWith('Tauri');
const appBase = (i: AppInfo) => (isTauri(i) ? i.electron : `Electron ${i.electron}`);
const engineOf = (i: AppInfo) => (isTauri(i) ? i.chrome : `Chromium ${i.chrome}`);

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
          <dt>Base do app</dt>
          <dd>{appBase(info)}</dd>
          <dt>Motor da interface</dt>
          <dd>{engineOf(info)}</dd>
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

type GpuOption = { value: GpuMode; label: string; description: string };

/** Electron: a live sai da própria janela (getDisplayMedia), então ela segue a opção */
const GPU_MODE_OPTIONS: readonly GpuOption[] = [
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

/** app em Tauri (ADR-0062): a sua live sai de um processo à parte (oc-live), sempre pelo encoder da placa */
const GPU_MODE_OPTIONS_NATIVE_LIVE: readonly GpuOption[] = [
  {
    value: 'full',
    label: 'Placa de vídeo para tudo',
    description: 'A interface e as lives que você assiste usam a placa de vídeo.',
  },
  {
    value: 'off',
    label: 'Sem aceleração na interface',
    description:
      'A interface e as lives que você assiste passam pelo processador (mais pesado). A sua live continua na placa de vídeo, num processo à parte. Use se o app piscar, ficar com a tela preta ou travar.',
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
          options={bridge.nativeLive ? GPU_MODE_OPTIONS_NATIVE_LIVE : GPU_MODE_OPTIONS}
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

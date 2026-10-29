import { availableProfiles, type StreamProfileId } from '@opencord/media';
import { Button, Icon, Select } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { CaptureSourceDto } from '../../../electron/shared/ipc';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useVoice } from '../../store/voice';

/** Seletor de fonte do Go Live com miniaturas reais (desktopCapturer), perfil e opção de áudio do sistema. */
export function ScreenSourcePicker({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const defaultProfile = useData((s) => s.settings?.video.streamProfile ?? '1080p60');
  const [profile, setProfile] = useState<StreamProfileId>(defaultProfile);
  const isWindows = navigator.userAgent.includes('Windows');

  const refresh = () => {
    if (!bridge) return;
    bridge.capture.listSources().then(
      (s) => {
        setSources(s);
        setSelected((cur) => cur ?? s.find((x) => x.kind === 'screen')?.id ?? null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'Falha ao listar fontes'),
    );
  };
  useEffect(refresh, []);
  // hardware só é confirmado após a primeira transmissão; 1440p60 aparece mas é limitado (effectiveProfile)
  const profiles = availableProfiles({ hardware: true });

  const start = () =>
    // áudio do sistema sempre junto (Windows no app; no navegador, depende da opção marcada no seletor dele)
    void useVoice.getState().startStream(bridge ? selected : null, isWindows || !bridge, profile);

  const visible = (sources ?? []).filter((s) => s.kind === tab);

  return (
    <Dialog
      title="Transmitir (Go Live)"
      onClose={onClose}
      wide
      actions={
        <>
          {bridge && !isWindows && <span className="muted small">Áudio do sistema só no Windows</span>}
          <Select<StreamProfileId>
            aria-label="Qualidade"
            className="picker-quality"
            value={profile}
            onChange={setProfile}
            options={profiles.map((p) => ({
              value: p.id,
              label: p.id,
              ...(p.requiresHardware ? { description: 'requer encoder por hardware' } : {}),
            }))}
          />
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon="screen" disabled={Boolean(bridge) && !selected} onClick={start}>
            Transmitir
          </Button>
        </>
      }
    >
      {!bridge ? (
        <p>
          No navegador, o seletor do próprio navegador será aberto ao iniciar. Para incluir o som, escolha{' '}
          <strong>Tela inteira</strong> (ou uma aba) e deixe marcado <strong>Compartilhar áudio do sistema</strong>:
          janelas avulsas não enviam áudio no navegador. O app para Windows captura o som de qualquer fonte.
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Tipo de fonte">
            <button role="tab" className="tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>
              Telas
            </button>
            <button role="tab" className="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
              Janelas
            </button>
            <span className="spacer" />
            <button className="icon-btn" aria-label="Atualizar fontes" title="Atualizar" onClick={refresh}>
              <Icon name="refresh" />
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          {!sources && <p className="muted">Carregando fontes…</p>}
          <ul className="source-grid" role="listbox" aria-label={tab === 'screen' ? 'Telas' : 'Janelas'}>
            {visible.map((s) => (
              <li
                key={s.id}
                role="option"
                aria-selected={selected === s.id}
                tabIndex={0}
                className="source"
                onClick={() => setSelected(s.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(s.id)}
                onDoubleClick={start}
              >
                <img src={s.thumbnail} alt="" />
                <span className="source-name">
                  {s.appIcon && <img src={s.appIcon} alt="" className="source-icon" />}
                  <span className="truncate">{s.name}</span>
                </span>
              </li>
            ))}
          </ul>
          {tab === 'window' && (
            <p className="muted small">
              Jogos em tela cheia exclusiva podem aparecer pretos; prefira janela sem bordas ou capture a tela inteira.
              Conteúdo protegido (DRM) não é capturado.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

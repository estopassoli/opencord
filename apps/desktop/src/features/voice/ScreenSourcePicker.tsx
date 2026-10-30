import {
  availableProfiles,
  STREAM_PROFILES,
  streamBitrate,
  type StreamBitrateLevel,
  type StreamProfileId,
} from '@opencord/media';
import { Button, Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import type { CaptureSourceDto } from '../../../electron/shared/ipc';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { updateSettings } from '../../store/settings';
import { useVoice } from '../../store/voice';

type Tab = 'window' | 'screen';

const ARM_MS = 500;

const QUALITY_HINT: Record<StreamProfileId, string> = {
  '720p30': 'leve, para internet fraca',
  '1080p60': 'recomendado',
  '1440p60': 'máxima, exige upload alto',
};

const BITRATE_HINT: Record<StreamBitrateLevel, string> = {
  low: 'leve, para upload fraco',
  medium: 'recomendado',
  high: 'máxima, precisa de upload folgado',
};

const mbps = (bps: number) => `${(bps / 1_000_000).toLocaleString('pt-BR')} Mbps`;

const label = (id: StreamProfileId) => {
  const p = STREAM_PROFILES[id];
  return `${p.height}p · ${p.fps} fps`;
};

/**
 * Seletor do Go Live: aplicativos (janelas) ou tela inteira, em miniaturas grandes; um clique já transmite.
 * Rodapé com o resumo (qualidade, áudio) e engrenagem para trocar a qualidade ou transmitir sem som.
 * Pronto para jogos: sem escolha de modo (ver DECISIONS); o áudio do sistema vai junto por padrão.
 */
export function ScreenSourcePicker({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('window');
  const profile = useData((s) => s.settings?.video.streamProfile ?? '1080p60');
  const bitrate = useData((s) => s.settings?.video.streamBitrate ?? 'medium');
  const [muted, setMuted] = useState(false);
  const isWindows = navigator.userAgent.includes('Windows');
  const audioPossible = isWindows || !bridge;

  const refresh = () => {
    if (!bridge) return;
    bridge.capture
      .listSources()
      .then(setSources, (e: unknown) => setError(e instanceof Error ? e.message : 'Falha ao listar fontes'));
  };
  useEffect(refresh, []);

  // Trava contra clique acidental: a lista demora ~2 s; um clique dado enquanto ela aparece/troca de aba
  // caía num card que surgiu embaixo do cursor (relato: transmitiu a janela errada). Só vale o clique que
  // COMEÇOU no card, depois de ele estar na tela há pelo menos ARM_MS.
  const shownAt = useRef(0);
  const pressed = useRef<string | null>(null);
  useEffect(() => {
    shownAt.current = performance.now();
  }, [tab, sources]);
  const armed = () => performance.now() - shownAt.current >= ARM_MS;

  const start = (s: CaptureSourceDto | null) =>
    void useVoice.getState().startStream(s?.id ?? null, audioPossible && !muted, profile, s?.name ?? null);

  const settingsMenu = (e: React.MouseEvent | React.KeyboardEvent) => {
    const items: MenuEntry[] = availableProfiles({ hardware: true }).map((p) => ({
      label: label(p.id),
      hint: QUALITY_HINT[p.id],
      checked: p.id === profile,
      onSelect: () => updateSettings((s) => ({ ...s, video: { ...s.video, streamProfile: p.id } })),
    }));
    items.push('separator');
    // se a subida de quem transmite não comporta o bitrate, a live engasga para todo mundo que assiste
    for (const level of ['low', 'medium', 'high'] as const) {
      items.push({
        label: mbps(streamBitrate(profile, level)),
        hint: BITRATE_HINT[level],
        checked: level === bitrate,
        onSelect: () => updateSettings((s) => ({ ...s, video: { ...s.video, streamBitrate: level } })),
      });
    }
    items.push('separator', {
      label: 'Transmitir sem som',
      hint: audioPossible ? 'o áudio do PC não vai junto' : 'áudio do sistema só no Windows',
      checked: muted || !audioPossible,
      disabled: !audioPossible,
      onSelect: () => setMuted((m) => !m),
    });
    openContextMenu(e, items, 'Opções da transmissão');
  };

  const visible = (sources ?? []).filter((s) => s.kind === tab);

  return (
    <Dialog title="Transmitir" onClose={onClose} wide bare>
      <div className="golive">
        {bridge && (
          <div className="golive-tabs" role="tablist" aria-label="O que transmitir">
            <button role="tab" className="golive-tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
              <Icon name="window" size={18} /> Aplicativos
            </button>
            <button role="tab" className="golive-tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>
              <Icon name="screen" size={18} /> Tela inteira
            </button>
            <button
              className="icon-btn golive-refresh"
              aria-label="Atualizar lista"
              title="Atualizar lista"
              onClick={refresh}
            >
              <Icon name="refresh" />
            </button>
          </div>
        )}

        {!bridge ? (
          <div className="golive-browser">
            <Icon name="screen" size={40} />
            <p>
              O navegador abre o seletor dele. Para levar o som, escolha <strong>Tela inteira</strong> (ou uma aba) e
              deixe marcado <strong>Compartilhar áudio do sistema</strong>; janelas avulsas não enviam áudio no
              navegador. O app para Windows transmite o som de qualquer fonte.
            </p>
            <Button size="lg" icon="screen" onClick={() => start(null)}>
              Escolher o que transmitir
            </Button>
          </div>
        ) : (
          <>
            {error && <p className="form-error">{error}</p>}
            <ul
              className="golive-grid"
              role="listbox"
              aria-label={tab === 'screen' ? 'Telas' : 'Aplicativos'}
              aria-busy={!sources || undefined}
            >
              {/* carregando: cards fantasmas no lugar dos reais (layout não pula quando chegam) */}
              {!sources &&
                Array.from({ length: tab === 'screen' ? 2 : 4 }, (_, i) => (
                  <li key={`sk-${i}`} className="golive-card golive-skeleton" aria-hidden="true">
                    <span className="golive-thumb" />
                    <span className="golive-name">
                      <span className="golive-skeleton-text" />
                    </span>
                  </li>
                ))}
              {visible.map((s) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={false}
                  aria-label={`Transmitir ${s.name}`}
                  tabIndex={0}
                  className="golive-card"
                  onPointerDown={() => {
                    pressed.current = armed() ? s.id : null;
                  }}
                  onClick={(e) => {
                    // teclado (Enter/Espaço vira click sem pointerdown: detail 0) segue valendo
                    if (e.detail !== 0 && pressed.current !== s.id) return;
                    pressed.current = null;
                    start(s);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    start(s);
                  }}
                >
                  <span className="golive-thumb">
                    <img src={s.thumbnail} alt="" />
                    <span className="golive-go" aria-hidden="true">
                      Transmitir
                    </span>
                  </span>
                  <span className="golive-name">
                    {s.appIcon ? (
                      <img src={s.appIcon} alt="" />
                    ) : (
                      <Icon name={s.kind === 'screen' ? 'screen' : 'window'} size={16} />
                    )}
                    <span className="truncate">{s.name}</span>
                  </span>
                </li>
              ))}
            </ul>
            {sources && !visible.length && <p className="muted golive-loading">Nada para mostrar aqui.</p>}
            {tab === 'window' && (
              <p className="muted small golive-note">
                Jogo em tela cheia exclusiva pode aparecer preto: use janela sem bordas ou transmita a tela inteira.
              </p>
            )}
          </>
        )}

        <footer className="golive-foot">
          <div className="golive-summary">
            <strong>Pronto para jogos</strong>
            <span className="muted small">
              {label(profile)} · {mbps(streamBitrate(profile, bitrate))} ·{' '}
              {audioPossible && !muted ? 'com áudio do sistema' : 'sem som'}
            </span>
          </div>
          <button
            className="icon-btn golive-gear"
            aria-label="Opções da transmissão"
            aria-haspopup="menu"
            onClick={settingsMenu}
          >
            <Icon name="settings" />
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

import type { PresenceStatus } from '@opencord/contracts';
import { Avatar, Icon, STATUS_LABEL } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { useContextMenu } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { updateSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { isInCall, useVoice } from '../../store/voice';
import { SoundboardPanel } from '../voice/Soundboard';
import { deviceMenu } from '../voice/devices';

const STATUSES: Exclude<PresenceStatus, 'offline'>[] = ['online', 'idle', 'dnd', 'invisible'];

const VOICE_LABEL = {
  authorizing: 'Autorizando…',
  connecting: 'Conectando…',
  connected: 'Voz conectada',
  reconnecting: 'Reconectando…',
  failed: 'Falha na conexão',
  disconnected: '',
} as const;

function openDevices(e: React.MouseEvent, kind: 'audioinput' | 'audiooutput') {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  void deviceMenu(kind).then((items) =>
    useContextMenu.getState().show(r.left, r.top - 8 - 36 * items.length, items, 'Dispositivos'),
  );
}

/**
 * Painel inferior em cartão (flutua sobre o rodapé do rail + sidebar):
 * estado da chamada (quando houver) e identidade com controles rápidos de áudio.
 */
export function UserDock() {
  const [soundAnchor, setSoundAnchor] = useState<DOMRect | null>(null);
  const me = useData((s) => s.me);
  const myStatus = useData((s) => s.myStatus);
  const details = useData((s) => s.details);
  const v = useVoice();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // altura do cartão vira --dock-h: rail e sidebar reservam esse espaço no fim da rolagem
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight + 16}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [me]);
  const noise = useData((st) => st.settings?.audio.noiseSuppression ?? true);
  if (!me) return null;
  const inCall = isInCall(v.machine);
  const channel = v.serverId ? details[v.serverId]?.channels.find((c) => c.id === v.machine.channelId) : undefined;
  const server = v.serverId ? details[v.serverId] : undefined;
  const live = v.stream.status === 'live';

  const setStatus = (status: Exclude<PresenceStatus, 'offline'>) => {
    useData.setState({ myStatus: status });
    setMenu(false);
    void api().request('PUT', '/me/presence', { status });
  };

  return (
    <div className="dock" ref={ref}>
      {(inCall || v.machine.status === 'failed') && (
        <section className="voice-dock" aria-label="Chamada de voz">
          <div className="voice-dock-row">
            <span
              className="voice-dock-signal"
              data-status={v.machine.status}
              {...(v.stats && v.machine.status === 'connected'
                ? {
                    'data-tip': `Ping ${v.stats.rttMs ?? '–'} ms · jitter ${v.stats.jitterMs ?? '–'} ms · perda ${v.stats.lossPct ?? '–'}%`,
                    role: 'img',
                    'aria-label': `Qualidade da conexão: ping ${v.stats.rttMs ?? 'desconhecido'} ms`,
                  }
                : { 'aria-hidden': true })}
            >
              <Icon name="signal" size={20} />
            </span>
            <span className="voice-dock-texts">
              <strong className="voice-dock-title" data-status={v.machine.status} role="status" aria-live="polite">
                {VOICE_LABEL[v.machine.status]}
                {v.machine.status === 'reconnecting' && ` (${v.machine.attempts})`}
              </strong>
              {channel && server && (
                <button
                  className="link-btn voice-dock-where truncate"
                  onClick={() => useUi.getState().go({ kind: 'server', serverId: server.id, channelId: channel.id })}
                >
                  {channel.name} / {server.name}
                </button>
              )}
            </span>
            {inCall && (
              <Tooltip label={noise ? 'Supressão de ruído: ligada' : 'Supressão de ruído: desligada'}>
                <button
                  className="icon-btn"
                  aria-pressed={noise}
                  aria-label="Supressão de ruído"
                  onClick={() =>
                    updateSettings((st) => ({
                      ...st,
                      audio: { ...st.audio, noiseSuppression: !st.audio.noiseSuppression },
                    }))
                  }
                >
                  <Icon name="noise" size={20} active={noise} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={inCall ? 'Sair da chamada' : 'Fechar'}>
              <button
                className="icon-btn"
                aria-label={inCall ? 'Sair da chamada' : 'Fechar'}
                onClick={() => void v.leave()}
              >
                <Icon name={inCall ? 'hangup' : 'close'} size={20} />
              </button>
            </Tooltip>
          </div>
          {soundAnchor && inCall && <SoundboardPanel anchor={soundAnchor} onClose={() => setSoundAnchor(null)} />}
          {v.machine.status === 'failed' && v.machine.error && <p className="small danger-text">{v.machine.error}</p>}
          {inCall && (
            <div className="voice-dock-actions">
              <Tooltip label={v.camera ? 'Desligar câmera' : 'Ligar câmera'}>
                <button
                  className="dock-action"
                  aria-pressed={v.camera}
                  aria-label="Câmera"
                  disabled={!v.perms.canVideo || v.machine.status !== 'connected'}
                  onClick={() => void v.toggleCamera()}
                >
                  <Icon name={v.camera ? 'camera' : 'camera-off'} size={20} />
                </button>
              </Tooltip>
              <Tooltip label={live ? 'Parar transmissão' : 'Transmitir tela'}>
                <button
                  className="dock-action"
                  aria-pressed={live}
                  aria-label={live ? 'Parar' : v.stream.status === 'starting' ? 'Iniciando…' : 'Transmitir'}
                  disabled={
                    !v.perms.canStream ||
                    v.machine.status !== 'connected' ||
                    v.stream.status === 'starting' ||
                    v.stream.status === 'stopping'
                  }
                  onClick={() => (live ? void v.stopStream() : v.openStreamPicker())}
                >
                  <Icon name="screen" size={20} />
                </button>
              </Tooltip>
              <Tooltip label="Atividades">
                <button
                  className="dock-action"
                  aria-label="Atividades"
                  disabled={v.machine.status !== 'connected'}
                  onClick={() => {
                    // leva ao palco da chamada e abre o painel de atividades lá
                    if (channel && server)
                      useUi.getState().go({ kind: 'server', serverId: server.id, channelId: channel.id });
                    useUi.getState().setActivitiesOpen(true);
                  }}
                >
                  <Icon name="activities" size={20} />
                </button>
              </Tooltip>
              <Tooltip label="Efeitos sonoros">
                <button
                  className="dock-action soundboard-btn"
                  aria-label="Efeitos sonoros"
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(soundAnchor)}
                  disabled={v.machine.status !== 'connected'}
                  onClick={(e) =>
                    setSoundAnchor(soundAnchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())
                  }
                >
                  <Icon name="soundboard" size={20} />
                </button>
              </Tooltip>
            </div>
          )}
        </section>
      )}
      <div className="user-dock">
        <div className="popover-anchor user-dock-anchor">
          <button
            className="user-dock-id"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            data-tip="Alterar status"
          >
            <Avatar
              id={me.id}
              name={me.displayName}
              size={32}
              status={myStatus === 'invisible' ? 'offline' : myStatus}
            />
            <span className="user-dock-names">
              <strong className="truncate">{me.displayName}</strong>
              <span className="muted small truncate">{STATUS_LABEL[myStatus]}</span>
            </span>
          </button>
          {menu && (
            <ul className="menu menu-up" role="menu">
              {STATUSES.map((s) => (
                <li key={s} role="none">
                  <button
                    role="menuitem"
                    aria-current={myStatus === s ? 'true' : undefined}
                    onClick={() => setStatus(s)}
                  >
                    <span className="oc-status-dot" data-status={s === 'invisible' ? 'offline' : s} aria-hidden />{' '}
                    {STATUS_LABEL[s]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="dock-split" data-off={v.selfMute ? 'true' : undefined}>
          <Tooltip label={v.selfMute ? 'Ativar microfone' : 'Silenciar microfone'}>
            <button
              className="icon-btn"
              aria-label={v.selfMute ? 'Ativar microfone' : 'Silenciar microfone'}
              aria-pressed={v.selfMute}
              onClick={() => void v.toggleMute()}
            >
              <Icon name="microphone" slashed={v.selfMute} />
            </button>
          </Tooltip>
          <button
            className="icon-btn icon-btn-chevron"
            aria-label="Escolher microfone"
            onClick={(e) => openDevices(e, 'audioinput')}
          >
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
        <div className="dock-split" data-off={v.selfDeaf ? 'true' : undefined}>
          <Tooltip label={v.selfDeaf ? 'Ativar áudio' : 'Ensurdecer'}>
            <button
              className="icon-btn"
              aria-label={v.selfDeaf ? 'Ativar áudio' : 'Ensurdecer'}
              aria-pressed={v.selfDeaf}
              onClick={() => void v.toggleDeafen()}
            >
              <Icon name={v.selfDeaf ? 'speaker-off' : 'speaker'} />
            </button>
          </Tooltip>
          <button
            className="icon-btn icon-btn-chevron"
            aria-label="Escolher saída de áudio"
            onClick={(e) => openDevices(e, 'audiooutput')}
          >
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
        <Tooltip label="Configurações do usuário">
          <button
            className="icon-btn"
            aria-label="Configurações do usuário"
            onClick={() => useUi.getState().openModal({ kind: 'settings' })}
          >
            <Icon name="settings" />
          </button>
        </Tooltip>
      </div>
      {v.pttActive && (
        <div className="ptt-indicator" role="status">
          Transmitindo (push-to-talk)
        </div>
      )}
    </div>
  );
}

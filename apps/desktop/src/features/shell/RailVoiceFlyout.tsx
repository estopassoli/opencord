import { Avatar, Icon, portalTarget } from '@opencord/ui';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '../../components/Tooltip';
import { useAliases } from '../../lib/names';
import { useIsMobile } from '../../lib/media';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { isInCall, useVoice } from '../../store/voice';
import { CallTimer } from './CallTimer';
import { roleColorOf } from './MemberList';

/** tempo para alcançar o painel saindo do rail (e vice-versa) antes de ele fechar */
const CLOSE_MS = 300;

/**
 * Lista de canais escondida: passar o mouse no rail abre, ancorado no ícone do servidor, um painel só com quem está
 * na minha chamada (controles de microfone/áudio/sair) e o botão para reabrir a lista de canais.
 */
export function RailVoiceFlyout({ rail }: { rail: RefObject<HTMLElement | null> }) {
  const hidden = useUi((s) => s.channelsHidden);
  const view = useUi((s) => s.view);
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const closeSoon = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), CLOSE_MS);
  };
  // no celular a lista de canais nunca fica escondida (a gaveta já faz esse papel)
  const active = hidden && view.kind === 'server' && !mobile;

  useEffect(() => {
    const el = rail.current;
    if (!active || !el) return setOpen(false);
    const enter = () => {
      cancel();
      setOpen(true);
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', closeSoon);
    return () => {
      cancel();
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', closeSoon);
    };
  }, [active, rail]);

  if (!active || !open) return null;
  return createPortal(
    <FlyoutPanel rail={rail} viewServerId={view.serverId} onEnter={cancel} onLeave={closeSoon} />,
    portalTarget(),
  );
}

function FlyoutPanel({
  rail,
  viewServerId,
  onEnter,
  onLeave,
}: {
  rail: RefObject<HTMLElement | null>;
  viewServerId: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const v = useVoice();
  const inServerCall = isInCall(v.machine) && Boolean(v.serverId) && !v.conversationId;
  // ancorado no servidor da minha chamada; fora de chamada, no servidor aberto
  const serverId = inServerCall && v.serverId ? v.serverId : viewServerId;
  const detail = useData((s) => s.details[serverId]);
  const voiceStates = useData((s) => s.voiceStates);
  const aliases = useAliases();
  const channelId = inServerCall ? v.machine.channelId : null;
  const channel = channelId ? detail?.channels.find((c) => c.id === channelId) : undefined;
  const members = channelId ? Object.values(voiceStates).filter((s) => s.channelId === channelId) : [];
  const speaking = new Set(v.participants.filter((p) => p.speaking).map((p) => p.identity));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const r = rail.current;
    if (!el || !r) return;
    const place = () => {
      // ícone do servidor; dentro de uma pasta fechada, o da pasta; sem nenhum, o item ativo do rail
      const anchor =
        r.querySelector(`[data-server-id="${serverId}"]`) ??
        r.querySelector(`[data-folder-servers~="${serverId}"]`) ??
        r.querySelector('.rail-li[data-active]');
      const a = anchor?.getBoundingClientRect() ?? r.getBoundingClientRect();
      const top = Math.max(8, Math.min(a.top, window.innerHeight - el.offsetHeight - 8));
      setPos({ left: r.getBoundingClientRect().right + 8, top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    r.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      r.removeEventListener('scroll', place, true);
    };
  }, [rail, serverId]);

  const memberOf = (userId: string) => detail?.members.find((x) => x.user.id === userId);
  const nameOf = (userId: string) => {
    const m = memberOf(userId);
    return aliases?.[userId] ?? m?.nickname ?? m?.user.displayName ?? 'Alguém';
  };
  const showChannels = () => useUi.getState().setChannelsHidden(false);

  return (
    <div
      ref={ref}
      className="rail-flyout"
      role="region"
      aria-label={channel ? `Chamada em ${channel.name}` : 'Sua chamada'}
      style={pos ?? { visibility: 'hidden' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header className="rail-flyout-head">
        <span className="rail-flyout-server truncate">{detail?.name ?? 'Servidor'}</span>
        {channel ? (
          <span className="rail-flyout-channel">
            <Icon name="speaker" size={16} />
            <span className="truncate">{channel.name}</span>
            <CallTimer members={members} />
          </span>
        ) : (
          <span className="small muted">Você não está em um canal de voz deste servidor.</span>
        )}
      </header>
      {channel && (
        <ul className="rail-flyout-members" aria-label={`Pessoas em ${channel.name}`}>
          {members.map((m) => {
            const name = nameOf(m.userId);
            return (
              <li key={m.userId} className="rail-flyout-member">
                <Avatar id={m.userId} name={name} size={24} speaking={speaking.has(m.userId)} />
                <span
                  className="truncate"
                  style={{ color: detail ? roleColorOf(detail, memberOf(m.userId)) : undefined }}
                >
                  {name}
                </span>
                {m.streaming && <span className="live-pill">AO VIVO</span>}
                {m.video && <Icon name="camera" size={14} label="Câmera ligada" />}
                {(m.selfMute || m.serverMute) && (
                  <Icon
                    name="microphone"
                    size={14}
                    slashed
                    label={m.serverMute ? 'Silenciado pelo servidor' : 'Microfone desligado'}
                  />
                )}
                {m.selfDeaf && <Icon name="speaker-off" size={14} label="Áudio desligado" />}
              </li>
            );
          })}
        </ul>
      )}
      <footer className="rail-flyout-foot">
        {channel && (
          <>
            <Tooltip label={v.selfMute ? 'Ligar microfone' : 'Desligar microfone'}>
              <button
                className="icon-btn"
                aria-label={v.selfMute ? 'Ligar microfone' : 'Desligar microfone'}
                aria-pressed={v.selfMute}
                data-off={v.selfMute ? 'true' : undefined}
                onClick={() => void v.toggleMute()}
              >
                <Icon name="microphone" size={18} slashed={v.selfMute} />
              </button>
            </Tooltip>
            <Tooltip label={v.selfDeaf ? 'Ligar áudio' : 'Desligar áudio'}>
              <button
                className="icon-btn"
                aria-label={v.selfDeaf ? 'Ligar áudio' : 'Desligar áudio'}
                aria-pressed={v.selfDeaf}
                data-off={v.selfDeaf ? 'true' : undefined}
                onClick={() => void v.toggleDeafen()}
              >
                <Icon name={v.selfDeaf ? 'speaker-off' : 'speaker'} size={18} />
              </button>
            </Tooltip>
            <Tooltip label="Sair da chamada">
              <button
                className="icon-btn rail-flyout-leave"
                aria-label="Sair da chamada"
                onClick={() => void v.leave()}
              >
                <Icon name="hangup" size={18} />
              </button>
            </Tooltip>
          </>
        )}
        <button className="rail-flyout-show" onClick={showChannels}>
          <Icon name="panel-open" size={16} />
          Mostrar canais
        </button>
      </footer>
    </div>
  );
}

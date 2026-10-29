import { MobileNavButton } from '../../components/MobileNavButton';
import { Avatar, Button, Icon } from '@opencord/ui';
import type { Member } from '@opencord/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openContextMenu, useContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { deviceMenu } from './devices';
import { useShallow } from 'zustand/react/shallow';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { isInCall, useVoice, type ParticipantView } from '../../store/voice';
import { closeStreamWindow, openStreamWindow } from './popout';
import { ActivitiesPanel, ActivityTile } from './WatchTogether';
import { useActivity } from '../../store/activity';
import { useIsMobile } from '../../lib/media';

const NO_MEMBERS: Member[] = [];

/** Palco do canal de voz: grade de participantes, câmeras e streams (Go Live) com destaque e tela cheia. */
export function VoiceStage({ channelId, serverId }: { channelId: string; serverId: string }) {
  const machine = useVoice((s) => s.machine);
  const participants = useVoice((s) => s.participants);
  const focused = useUi((s) => s.focusedStream);
  const activity = useActivity((s) => s.state);
  const channel = useData((s) => s.details[serverId]?.channels.find((c) => c.id === channelId));
  // seletores que derivam arrays precisam de comparação rasa (zustand v5 + useSyncExternalStore)
  const others = useData(useShallow((s) => Object.values(s.voiceStates).filter((v) => v.channelId === channelId)));
  const members = useData((s) => s.details[serverId]?.members) ?? NO_MEMBERS;
  const here = machine.channelId === channelId && isInCall(machine);
  const stageRef = useRef<HTMLElement>(null);

  if (!here) {
    return (
      <section className="stage stage-idle" aria-label={`Canal de voz ${channel?.name ?? ''}`}>
        <Icon name="speaker" size={48} />
        <h2>{channel?.name}</h2>
        <p className="muted">{others.length ? `${others.length} pessoa(s) na chamada` : 'Ninguém aqui ainda.'}</p>
        <ul className="stage-preview">
          {others.map((v) => {
            const m = members.find((x) => x.user.id === v.userId);
            return (
              <li key={v.userId}>
                <Avatar id={v.userId} name={m?.user.displayName ?? '?'} size={48} />
              </li>
            );
          })}
        </ul>
        <Button
          size="lg"
          icon="speaker"
          onClick={() => void useVoice.getState().join(channelId, serverId)}
          disabled={machine.status === 'authorizing' || machine.status === 'connecting'}
        >
          {machine.status === 'authorizing' || machine.status === 'connecting' ? 'Conectando…' : 'Entrar na chamada'}
        </Button>
      </section>
    );
  }

  const streamers = participants.filter((p) => p.hasScreen);
  const focus = streamers.find((p) => p.identity === focused && p.watchingScreen) ?? null;
  const activityFocused = Boolean(activity) && focused === 'activity';

  return (
    <section className="stage" aria-label={`Chamada em ${channel?.name ?? ''}`} ref={stageRef}>
      <StageHeader channelName={channel?.name ?? ''} focus={focus} activity={activityFocused} mobile />
      {activityFocused ? (
        <FocusLayout main={<ActivityTile large />} participants={participants} />
      ) : focus ? (
        <FocusLayout main={<StreamTile p={focus} large />} exclude={focus.identity} participants={participants} />
      ) : (
        <ul
          className="stage-grid"
          data-count={Math.min(participants.length + streamers.length + (activity ? 1 : 0), 9)}
        >
          {activity && (
            <li key="activity">
              <ActivityTile />
            </li>
          )}
          {streamers.map((p) => (
            <li key={`s-${p.identity}`}>
              <StreamTile p={p} />
            </li>
          ))}
          {participants.map((p) => (
            <li key={p.identity}>
              <ParticipantTile p={p} />
            </li>
          ))}
        </ul>
      )}
      <CallControls stageRef={stageRef} />
    </section>
  );
}

/** Cabeçalho do palco: canal · quem está ao vivo (e o que transmite) · selo de qualidade AO VIVO. */
function StageHeader({
  channelName,
  focus,
  activity,
  mobile,
}: {
  channelName: string;
  focus: ParticipantView | null;
  activity?: boolean;
  mobile?: boolean;
}) {
  const source = useVoice((s) => s.streamSource);
  const title = useActivity((s) => s.state?.title);
  return (
    <header className="chat-header stage-header">
      {mobile && <MobileNavButton />}
      <Icon name="speaker" size={22} />
      <h2 className="truncate">{channelName}</h2>
      {focus && (
        <span className="stage-live-who truncate">
          <span aria-hidden="true">·</span>
          <Avatar id={focus.identity} name={focus.name} size={20} />
          <span className="truncate">
            {focus.isLocal ? 'Você' : focus.name} está transmitindo
            {focus.isLocal && source ? <strong> {source}</strong> : null}
          </span>
        </span>
      )}
      {activity && (
        <span className="stage-live-who truncate">
          <span aria-hidden="true">·</span>
          <Icon name="play" size={16} />
          <span className="truncate">Assistindo juntos{title ? <strong> {title}</strong> : null}</span>
        </span>
      )}
      <span className="spacer" />
      <LiveBadge focus={focus} />
    </header>
  );
}

const STATS_HINT =
  'O servidor pausa o envio enquanto ninguém assiste, para economizar banda; volta sozinho quando alguém clica em Assistir.';

/** Selo "1080p 60 FPS · AO VIVO"; detalhes técnicos (encoder, Mb/s, banda) no tooltip. */
function LiveBadge({ focus }: { focus: ParticipantView | null }) {
  const stream = useVoice((s) => s.stream);
  const stats = useVoice((s) => s.stats?.stream);
  const audioUnavailable = stream.status === 'live' && stream.audioUnavailable;
  if (stream.status !== 'live') {
    return focus ? <span className="live-pill">AO VIVO</span> : null;
  }
  if (!stats) return <span className="live-pill">AO VIVO</span>;
  if (stats.paused) {
    return (
      <span className="live-badge stream-stats" title={STATS_HINT}>
        <span className="live-badge-q">Em espera · ninguém assistindo</span>
        <span className="live-pill">AO VIVO</span>
      </span>
    );
  }
  const details = [
    `Transmitindo ${stats.width}×${stats.height} · ${stats.fps ?? '–'} fps · ${stats.codec?.replace('video/', '') ?? ''}${
      stats.hardware ? ' (hardware)' : stats.hardware === false ? ' (software)' : ''
    }`,
    stats.kbps !== null ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : null,
    stats.limitation && stats.limitation !== 'none'
      ? `limitado por ${stats.limitation === 'cpu' ? 'CPU' : 'banda'}`
      : null,
    stats.availableKbps !== null ? `banda de subida estimada: ${(stats.availableKbps / 1000).toFixed(1)} Mb/s` : null,
    stats.encoder,
    stats.fmtp,
    audioUnavailable ? 'sem áudio do sistema' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="live-badge stream-stats" title={details} aria-label={details}>
      <span className="live-badge-q">
        <Icon name="signal" size={14} />
        {stats.height ? `${stats.height}p` : '–'} {stats.fps ?? '–'} FPS
        {stats.limitation && stats.limitation !== 'none' ? <Icon name="warning" size={14} /> : null}
      </span>
      {audioUnavailable && <span className="warn-text small">sem áudio</span>}
      <span className="live-pill">AO VIVO</span>
    </span>
  );
}

/** Item em destaque (transmissão ou atividade) + faixa de participantes (que pode ser ocultada). */
function FocusLayout({
  main,
  exclude,
  participants,
}: {
  main: ReactNode;
  /** quem transmite não se repete na faixa (a não ser com câmera) */
  exclude?: string;
  participants: ParticipantView[];
}) {
  const hidden = useUi((s) => s.stripHidden);
  const label = hidden ? 'Mostrar membros' : 'Ocultar membros';
  return (
    <div className="stage-focus" data-strip={hidden ? 'hidden' : undefined}>
      {main}
      <div className="strip-wrap">
        <Tooltip label={label}>
          <button
            className="strip-toggle"
            aria-label={label}
            aria-expanded={!hidden}
            onClick={() => useUi.getState().toggleStrip()}
          >
            <Icon name={hidden ? 'chevron-up' : 'chevron-down'} size={14} />
            <Icon name="users" size={16} />
          </button>
        </Tooltip>
        {/* sempre montada: some/aparece com animação (altura, opacidade, deslize); oculta = inerte */}
        <ul className="stage-strip" aria-hidden={hidden || undefined} inert={hidden || undefined}>
          {/* as outras transmissões (inclusive a minha) ficam na faixa: um clique assiste e destaca */}
          {participants
            .filter((p) => p.hasScreen && p.identity !== exclude)
            .map((p) => (
              <li key={`s-${p.identity}`}>
                <StripStream p={p} />
              </li>
            ))}
          {participants
            .filter((p) => p.identity !== exclude || p.hasCamera)
            .map((p) => (
              <li key={p.identity}>
                <ParticipantTile p={p} compact />
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/** Transmissão na faixa sob o destaque: miniatura "AO VIVO"; clique assiste e põe em destaque. */
function StripStream({ p }: { p: ParticipantView }) {
  const open = () => {
    if (p.isLocal) useUi.getState().focusStream(p.identity);
    else useVoice.getState().watch(p.identity, true);
  };
  return (
    <button
      className="tile strip-stream"
      data-compact="true"
      aria-label={p.isLocal ? 'Ver sua transmissão' : `Assistir a transmissão de ${p.name}`}
      onClick={open}
    >
      {p.watchingScreen ? <Video identity={p.identity} source="screen" /> : <Icon name="screen" size={28} />}
      <span className="tile-label">
        <span className="live-pill">AO VIVO</span>
        <span className="truncate">{p.isLocal ? 'Sua transmissão' : p.name}</span>
      </span>
    </button>
  );
}

/** Conteúdo da janela separada da transmissão (renderizado por portal em outra janela). */
export function PopoutStage() {
  const popped = useUi((s) => s.poppedStream);
  const participants = useVoice((s) => s.participants);
  const machine = useVoice((s) => s.machine);
  const channel = useData((s) =>
    Object.values(s.details)
      .flatMap((d) => d.channels)
      .find((c) => c.id === machine.channelId),
  );
  const ref = useRef<HTMLElement>(null);
  const focus = participants.find((p) => p.identity === popped && p.hasScreen) ?? null;
  const ended = !isInCall(machine) || !focus;
  useEffect(() => {
    // transmissão acabou (ou saiu da chamada): a janela não tem mais o que mostrar
    if (ended) closeStreamWindow();
  }, [ended]);
  if (!focus) return null;
  return (
    <section className="stage popout-stage" aria-label="Transmissão" ref={ref}>
      <StageHeader channelName={channel?.name ?? ''} focus={focus} />
      <FocusLayout
        main={<StreamTile p={focus} large inPopout />}
        exclude={focus.identity}
        participants={participants}
      />
      <CallControls stageRef={ref} popout />
    </section>
  );
}

function Video({ identity, source, mirrored }: { identity: string; source: 'camera' | 'screen'; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  // reanexa só quando a TRILHA muda: depender da lista de participantes reanexava a cada fala/mute/qualidade e o
  // vídeo piscava (relato real durante Go Live). O seletor devolve um id (primitivo), então só muda com a trilha.
  // (o seletor roda a cada atualização da store, inclusive as de participantes)
  const trackId = useVoice((s) => s.engine()?.videoTrack(identity, source)?.id ?? '');
  useEffect(() => {
    const el = ref.current;
    const engine = useVoice.getState().engine();
    if (!el || !engine || !trackId) return;
    return engine.attach(identity, source, el);
  }, [identity, source, trackId]);
  return <video ref={ref} autoPlay playsInline muted className={mirrored ? 'video mirrored' : 'video'} />;
}

function ParticipantTile({ p, compact }: { p: ParticipantView; compact?: boolean }) {
  return (
    <div className="tile" data-speaking={p.speaking ? 'true' : undefined} data-compact={compact ? 'true' : undefined}>
      {p.hasCamera ? (
        <Video identity={p.identity} source="camera" mirrored={p.isLocal} />
      ) : (
        <Avatar id={p.identity} name={p.name} size={compact ? 40 : 72} speaking={p.speaking} />
      )}
      <div className="tile-label">
        {p.micMuted && <Icon name="microphone" size={14} slashed label="Microfone desligado" />}
        <span className="truncate">
          {p.name}
          {p.isLocal ? ' (você)' : ''}
        </span>
        {p.quality === 'poor' || p.quality === 'lost' ? <Icon name="wifi" size={14} label="Conexão instável" /> : null}
      </div>
      {p.speaking && <span className="oc-visually-hidden">falando</span>}
    </div>
  );
}

function StreamTile({ p, large, inPopout }: { p: ParticipantView; large?: boolean; inPopout?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const popped = useUi((s) => s.poppedStream);
  const elsewhere = popped === p.identity && !inPopout;
  // no celular uma "nova janela" vira outra aba: não oferece
  const mobile = useIsMobile();
  const watching = p.watchingScreen;
  const engineWatch = (on: boolean) => useVoice.getState().watch(p.identity, on);
  const fullscreen = () => {
    const doc = box.current?.ownerDocument ?? document;
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void box.current?.requestFullscreen();
  };
  // botão direito na transmissão: volume do áudio dela (só para mim), silenciar, janela, tela cheia, parar de assistir
  const menu = (e: React.MouseEvent) => {
    const vol = useVoice.getState().screenVolume[p.identity] ?? 1;
    const items: MenuEntry[] = [];
    if (!p.isLocal && p.screenAudio)
      items.push(
        {
          kind: 'slider',
          label: 'Volume da transmissão',
          value: vol,
          min: 0,
          max: 2,
          step: 0.05,
          format: (x) => `${Math.round(x * 100)}%`,
          onChange: (x) => useVoice.getState().setScreenVolume(p.identity, x),
        },
        {
          label: 'Silenciar transmissão',
          hint: 'Só para você',
          checked: vol === 0,
          onSelect: () => useVoice.getState().setScreenVolume(p.identity, vol === 0 ? 1 : 0),
        },
        'separator',
      );
    if (watching && !mobile && !inPopout)
      items.push({
        label: 'Abrir em nova janela',
        icon: 'popout',
        onSelect: () => {
          useUi.getState().focusStream(p.identity);
          openStreamWindow(p.identity);
        },
      });
    if (watching) items.push({ label: 'Tela cheia', icon: 'maximize', onSelect: fullscreen });
    if (!p.isLocal && watching)
      items.push({ label: 'Parar de assistir', icon: 'eye-off', onSelect: () => engineWatch(false) });
    if (!p.isLocal && !watching) items.push({ label: 'Assistir', icon: 'play', onSelect: () => engineWatch(true) });
    if (items.length) openContextMenu(e, items, `Transmissão de ${p.name}`);
  };
  return (
    <div className="tile tile-stream" ref={box} data-large={large ? 'true' : undefined} onContextMenu={menu}>
      {elsewhere ? (
        <div className="stream-cover">
          <Icon name="popout" size={32} />
          <p>Transmissão aberta em outra janela</p>
          <Button variant="secondary" onClick={closeStreamWindow}>
            Trazer de volta
          </Button>
        </div>
      ) : watching ? (
        <Video identity={p.identity} source="screen" />
      ) : (
        <div className="stream-cover">
          <span className="live-pill">AO VIVO</span>
          <p>{p.name} está transmitindo</p>
          <Button icon="play" onClick={() => engineWatch(true)}>
            Assistir
          </Button>
        </div>
      )}
      <div className="tile-label">
        <span className="live-pill">AO VIVO</span>
        <span className="truncate">{p.isLocal ? 'Sua transmissão' : p.name}</span>
        {!p.screenAudio && <span className="small muted">sem áudio</span>}
      </div>
      {watching && !elsewhere && (
        <div className="tile-actions">
          {inPopout ? (
            <button
              className="icon-btn"
              aria-label="Voltar para o app"
              title="Voltar para o app"
              onClick={closeStreamWindow}
            >
              <Icon name="popin" />
            </button>
          ) : mobile ? null : (
            <button
              className="icon-btn"
              aria-label="Abrir em nova janela"
              title="Abrir em nova janela"
              onClick={() => {
                useUi.getState().focusStream(p.identity);
                openStreamWindow(p.identity);
              }}
            >
              <Icon name="popout" />
            </button>
          )}
          {inPopout ? null : !large ? (
            <button
              className="icon-btn"
              aria-label="Destacar transmissão"
              title="Destacar"
              onClick={() => useUi.getState().focusStream(p.identity)}
            >
              <Icon name="spotlight" />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Voltar à grade"
              title="Voltar à grade"
              onClick={() => useUi.getState().focusStream(null)}
            >
              <Icon name="grid" />
            </button>
          )}
          <button className="icon-btn" aria-label="Tela cheia" title="Tela cheia" onClick={fullscreen}>
            <Icon name="maximize" />
          </button>
          {!p.isLocal && (
            <button
              className="icon-btn"
              aria-label="Parar de assistir"
              title="Parar de assistir"
              onClick={() => engineWatch(false)}
            >
              <Icon name="eye-off" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Barra de controles da chamada (centralizada embaixo do palco). */
function CallControls({ stageRef, popout }: { stageRef: React.RefObject<HTMLElement | null>; popout?: boolean }) {
  // Seletor raso: a barra não re-renderiza a cada estatística da live ou mudança de participante.
  const v = useVoice(
    useShallow((s) => ({
      streamStatus: s.stream.status,
      selfMute: s.selfMute,
      selfDeaf: s.selfDeaf,
      camera: s.camera,
      perms: s.perms,
      toggleMute: s.toggleMute,
      toggleDeafen: s.toggleDeafen,
      toggleCamera: s.toggleCamera,
      stopStream: s.stopStream,
      openStreamPicker: s.openStreamPicker,
      leave: s.leave,
    })),
  );
  const live = v.streamStatus === 'live';
  const activityOn = useActivity((s) => s.state !== null);
  const [panel, setPanel] = useState(false);
  const menu = (e: React.MouseEvent, kind: 'audioinput' | 'audiooutput') => {
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    void deviceMenu(kind).then((items) =>
      useContextMenu.getState().show(r.left, r.top - 8 - 36 * items.length, items, 'Dispositivos'),
    );
  };
  return (
    <>
      {panel && <ActivitiesPanel onClose={() => setPanel(false)} />}
      <div className="call-controls" role="toolbar" aria-label="Controles da chamada">
        <div className="call-group">
          <Tooltip label={v.selfMute ? 'Ativar microfone' : 'Silenciar microfone'}>
            <button
              className="call-btn"
              aria-pressed={v.selfMute}
              aria-label={v.selfMute ? 'Ativar microfone' : 'Silenciar microfone'}
              data-off={v.selfMute ? 'true' : undefined}
              onClick={() => void v.toggleMute()}
            >
              <Icon name="microphone" slashed={v.selfMute} />
            </button>
          </Tooltip>
          {!popout && (
            <Tooltip label="Escolher microfone">
              <button
                className="call-btn call-chevron"
                aria-label="Escolher microfone"
                onClick={(e) => menu(e, 'audioinput')}
              >
                <Icon name="chevron-down" size={14} />
              </button>
            </Tooltip>
          )}
          <Tooltip label={v.camera ? 'Desligar câmera' : 'Ligar câmera'}>
            <button
              className="call-btn"
              aria-pressed={v.camera}
              aria-label={v.camera ? 'Desligar câmera' : 'Ligar câmera'}
              disabled={!v.perms.canVideo}
              onClick={() => void v.toggleCamera()}
            >
              <Icon name={v.camera ? 'camera' : 'camera-off'} />
            </button>
          </Tooltip>
        </div>
        <div className="call-group">
          <Tooltip label="Atividades">
            <button
              className="call-btn activities-btn"
              aria-label="Atividades"
              aria-haspopup="dialog"
              aria-expanded={panel}
              aria-pressed={activityOn}
              onClick={() => setPanel((o) => !o)}
            >
              <Icon name="activities" />
            </button>
          </Tooltip>
          <Tooltip label={live ? 'Parar transmissão' : 'Transmitir tela'}>
            <button
              className="call-btn"
              aria-pressed={live}
              aria-label={live ? 'Parar transmissão' : 'Transmitir tela'}
              disabled={!v.perms.canStream || v.streamStatus === 'starting' || v.streamStatus === 'stopping'}
              onClick={() => (live ? void v.stopStream() : v.openStreamPicker())}
            >
              <Icon name="screen" />
            </button>
          </Tooltip>
          <Tooltip label={v.selfDeaf ? 'Ativar áudio' : 'Ensurdecer'}>
            <button
              className="call-btn"
              aria-pressed={v.selfDeaf}
              aria-label={v.selfDeaf ? 'Ativar áudio' : 'Ensurdecer'}
              data-off={v.selfDeaf ? 'true' : undefined}
              onClick={() => void v.toggleDeafen()}
            >
              <Icon name={v.selfDeaf ? 'speaker-off' : 'speaker'} />
            </button>
          </Tooltip>
        </div>
        <Tooltip label="Sair da chamada">
          <button className="call-btn call-hangup" aria-label="Sair da chamada" onClick={() => void v.leave()}>
            <Icon name="hangup" />
          </button>
        </Tooltip>
      </div>
      {/* fora da barra: a barra usa transform para centralizar e capturaria o posicionamento */}
      <Tooltip label="Tela cheia">
        <button
          className="call-btn call-fullscreen"
          aria-label="Tela cheia"
          onClick={() => {
            const doc = stageRef.current?.ownerDocument ?? document;
            if (doc.fullscreenElement) void doc.exitFullscreen();
            else void stageRef.current?.requestFullscreen();
          }}
        >
          <Icon name="maximize" />
        </button>
      </Tooltip>
    </>
  );
}

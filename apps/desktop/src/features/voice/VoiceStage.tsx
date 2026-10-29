import { Avatar, Button, Icon } from '@opencord/ui';
import type { Member } from '@opencord/contracts';
import { useEffect, useRef } from 'react';
import { useContextMenu } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { deviceMenu } from './devices';
import { useShallow } from 'zustand/react/shallow';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { isInCall, useVoice, type ParticipantView } from '../../store/voice';

const NO_MEMBERS: Member[] = [];

/** Palco do canal de voz: grade de participantes, câmeras e streams (Go Live) com destaque e tela cheia. */
export function VoiceStage({ channelId, serverId }: { channelId: string; serverId: string }) {
  const machine = useVoice((s) => s.machine);
  const participants = useVoice((s) => s.participants);
  const stream = useVoice((s) => s.stream);
  const stats = useVoice((s) => s.stats);
  const focused = useUi((s) => s.focusedStream);
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

  return (
    <section className="stage" aria-label={`Chamada em ${channel?.name ?? ''}`} ref={stageRef}>
      <header className="chat-header">
        <Icon name="speaker" size={22} />
        <h2 className="truncate">{channel?.name}</h2>
        <span className="spacer" />
        {stream.status === 'live' && stats?.stream && (
          <span className="muted small" title={stats.stream.encoder ?? ''}>
            Transmitindo {stats.stream.width}×{stats.stream.height} · {stats.stream.fps ?? '–'} fps ·{' '}
            {stats.stream.codec?.replace('video/', '') ?? ''}
            {stats.stream.hardware ? ' (hardware)' : stats.stream.hardware === false ? ' (software)' : ''}
            {stats.stream.limitation && stats.stream.limitation !== 'none'
              ? ` · limitado por ${stats.stream.limitation === 'cpu' ? 'CPU' : 'banda'}`
              : ''}
          </span>
        )}
        {stream.status === 'live' && stream.audioUnavailable && (
          <span className="warn-text small">sem áudio do sistema</span>
        )}
      </header>
      {focus ? (
        <div className="stage-focus">
          <StreamTile p={focus} large />
          <ul className="stage-strip">
            {participants
              .filter((p) => p.identity !== focus.identity || p.hasCamera)
              .map((p) => (
                <li key={p.identity}>
                  <ParticipantTile p={p} compact />
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <ul className="stage-grid" data-count={Math.min(participants.length + streamers.length, 9)}>
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

function Video({ identity, source, mirrored }: { identity: string; source: 'camera' | 'screen'; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const participants = useVoice((s) => s.participants);
  useEffect(() => {
    const el = ref.current;
    const engine = useVoice.getState().engine();
    if (!el || !engine) return;
    return engine.attach(identity, source, el);
  }, [identity, source, participants]);
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

function StreamTile({ p, large }: { p: ParticipantView; large?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const watching = p.watchingScreen;
  const engineWatch = (on: boolean) => useVoice.getState().watch(p.identity, on);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  };
  return (
    <div className="tile tile-stream" ref={box} data-large={large ? 'true' : undefined}>
      {watching ? (
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
      {watching && (
        <div className="tile-actions">
          {!large ? (
            <button
              className="icon-btn"
              aria-label="Destacar transmissão"
              title="Destacar"
              onClick={() => useUi.getState().focusStream(p.identity)}
            >
              <Icon name="maximize" />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Voltar à grade"
              title="Voltar à grade"
              onClick={() => useUi.getState().focusStream(null)}
            >
              <Icon name="minimize" />
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
function CallControls({ stageRef }: { stageRef: React.RefObject<HTMLElement | null> }) {
  const v = useVoice();
  const live = v.stream.status === 'live';
  const menu = (e: React.MouseEvent, kind: 'audioinput' | 'audiooutput') => {
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    void deviceMenu(kind).then((items) =>
      useContextMenu.getState().show(r.left, r.top - 8 - 36 * items.length, items, 'Dispositivos'),
    );
  };
  return (
    <>
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
          <Tooltip label="Escolher microfone">
            <button
              className="call-btn call-chevron"
              aria-label="Escolher microfone"
              onClick={(e) => menu(e, 'audioinput')}
            >
              <Icon name="chevron-down" size={14} />
            </button>
          </Tooltip>
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
          <Tooltip label={live ? 'Parar transmissão' : 'Transmitir tela'}>
            <button
              className="call-btn"
              aria-pressed={live}
              aria-label={live ? 'Parar transmissão' : 'Transmitir tela'}
              disabled={!v.perms.canStream || v.stream.status === 'starting' || v.stream.status === 'stopping'}
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
          onClick={() =>
            document.fullscreenElement ? void document.exitFullscreen() : void stageRef.current?.requestFullscreen()
          }
        >
          <Icon name="maximize" />
        </button>
      </Tooltip>
    </>
  );
}

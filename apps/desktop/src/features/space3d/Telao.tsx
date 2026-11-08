/**
 * O que passa no telão do Espaço 3D (ADR-0055): a live de alguém da chamada (vídeo como textura) ou o vídeo do
 * "Assistir juntos" (player oficial do YouTube, sincronizado como no palco, desenhado num plano CSS 3D).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActivity } from '../../store/activity';
import { useSpace } from '../../store/space';
import { useVoice } from '../../store/voice';
import { useYouTubeFrame } from '../voice/WatchTogether';
import type { ScreenSource } from './scene';

const DRIFT_S = 2;

/** Player do telão: só segue o estado do grupo (tocar/pausar/posição); os controles ficam na barra do espaço. */
function TelaoYouTube({ videoId }: { videoId: string }) {
  const { frame, src, info, ready, send } = useYouTubeFrame(videoId);
  const revision = useActivity((a) => a.state?.revision);
  const lastApplied = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const cur = useActivity.getState().state;
      if (!cur) return;
      const want = useActivity.getState().expectedPosition();
      if (cur.playing && info.state !== 1 && info.state !== 3) send('playVideo');
      if (!cur.playing && info.state === 1) send('pauseVideo');
      const stable = info.state === 1 || info.state === 2;
      if (stable && Math.abs(info.currentTime - want) > DRIFT_S && Date.now() - lastApplied.current > 1500) {
        lastApplied.current = Date.now();
        send('seekTo', [want, true]);
      }
    };
    sync();
    const t = setInterval(sync, 1000);
    return () => clearInterval(t);
  }, [ready, info.state, info.currentTime, revision, send]);
  useEffect(() => {
    if (ready) send('setVolume', [80]);
  }, [ready, send]);
  return (
    <iframe
      ref={frame}
      src={src}
      title="Vídeo no telão"
      className="space3d-yt"
      allow="autoplay; encrypted-media"
      sandbox="allow-scripts allow-same-origin allow-presentation"
    />
  );
}

/**
 * Resolve o que o telão mostra e entrega à cena. Para a live, assina a transmissão (como clicar em "Assistir") e
 * desfaz ao sair, se a pessoa não estava assistindo antes.
 */
export function TelaoSource({ onSource }: { onSource: (s: ScreenSource) => void }) {
  const screen = useSpace((s) => s.session?.screen ?? null);
  const activity = useActivity((a) => a.state);
  const streamId = screen?.kind === 'stream' ? screen.userId : null;
  const streaming = useVoice((v) =>
    streamId ? (v.participants.find((p) => p.identity === streamId)?.hasScreen ?? false) : false,
  );
  const trackId = useVoice((v) => (streamId ? (v.engine()?.videoTrack(streamId, 'screen')?.id ?? '') : ''));
  const video = useRef<HTMLVideoElement>(null);
  const [ytHost] = useState(() => {
    const d = document.createElement('div');
    d.className = 'space3d-yt-host';
    return d;
  });
  const videoId = screen?.kind === 'activity' ? (activity?.videoId ?? null) : null;

  // assinar a live escolhida enquanto ela estiver no telão
  useEffect(() => {
    if (!streamId || !streaming) return;
    const eng = useVoice.getState().engine();
    const p = useVoice.getState().participants.find((x) => x.identity === streamId);
    const wasWatching = p?.watchingScreen || p?.isLocal;
    if (!wasWatching) eng?.watch(streamId, true);
    return () => {
      if (!wasWatching) useVoice.getState().engine()?.watch(streamId, false);
    };
  }, [streamId, streaming]);

  useEffect(() => {
    const el = video.current;
    const eng = useVoice.getState().engine();
    if (!streamId || !el || !eng || !trackId) return;
    const detach = eng.attach(streamId, 'screen', el);
    void el.play().catch(() => undefined);
    onSource({ kind: 'video', el });
    return () => {
      detach();
      onSource(null);
    };
  }, [streamId, trackId, onSource]);

  useEffect(() => {
    if (!videoId) return;
    onSource({ kind: 'html', el: ytHost });
    return () => onSource(null);
  }, [videoId, ytHost, onSource]);

  return (
    <>
      {/* fica no tamanho do espaço (transparente): a SFU escolhe a qualidade pelo tamanho do elemento */}
      <video ref={video} className="space3d-video" autoPlay playsInline muted aria-hidden="true" />
      {videoId && createPortal(<TelaoYouTube key={videoId} videoId={videoId} />, ytHost)}
    </>
  );
}

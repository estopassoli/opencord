/**
 * O que passa no telão do Espaço 3D (ADR-0055): a live de alguém da chamada (vídeo como textura) ou o vídeo do
 * "Assistir juntos" (player oficial do YouTube, sincronizado como no palco, desenhado num plano CSS 3D).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useActivity } from '../../store/activity';
import { useSpace } from '../../store/space';
import { useVoice } from '../../store/voice';
import { useYouTubeFrame } from '../voice/WatchTogether';
import type { ScreenSource } from './scene';

const DRIFT_S = 2;

/**
 * Estado local do player do telão (por pessoa): volume, legendas, pausa só para mim e o que o player informa.
 * A barra de controles (TelaoControls) lê e escreve aqui; o player do YouTube segue.
 */
interface TelaoPlayer {
  volume: number;
  muted: boolean;
  captions: boolean;
  /** quem não pôs o vídeo pausa só para si; ao voltar, alcança o grupo */
  localPaused: boolean;
  currentTime: number;
  duration: number;
  send: ((func: string, args?: unknown[]) => void) | null;
  set(p: Partial<Omit<TelaoPlayer, 'set'>>): void;
}
export const useTelaoPlayer = create<TelaoPlayer>()((set) => ({
  volume: 80,
  muted: false,
  captions: true,
  localPaused: false,
  currentTime: 0,
  duration: 0,
  send: null,
  set: (p) => set(p),
}));

/** Player do telão: segue o estado do grupo (tocar/pausar/posição); os controles ficam na barra do espaço. */
function TelaoYouTube({ videoId }: { videoId: string }) {
  const { frame, src, info, ready, send } = useYouTubeFrame(videoId);
  const revision = useActivity((a) => a.state?.revision);
  const { volume, muted, captions, localPaused } = useTelaoPlayer();
  const lastApplied = useRef(0);
  useEffect(() => {
    useTelaoPlayer.getState().set({ send, localPaused: false });
    return () => useTelaoPlayer.getState().set({ send: null, currentTime: 0, duration: 0 });
  }, [send]);
  useEffect(() => {
    useTelaoPlayer.getState().set({ currentTime: info.currentTime, duration: info.duration });
  }, [info.currentTime, info.duration]);
  useEffect(() => {
    if (!ready) return;
    if (localPaused) {
      if (info.state === 1) send('pauseVideo');
      return;
    }
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
  }, [ready, info.state, info.currentTime, revision, send, localPaused]);
  useEffect(() => {
    if (!ready) return;
    send('setVolume', [volume]);
    send(muted ? 'mute' : 'unMute');
  }, [ready, volume, muted, send]);
  useEffect(() => {
    // legendas: o player oficial liga/desliga pelo módulo "captions"
    if (ready) send(captions ? 'loadModule' : 'unloadModule', ['captions']);
  }, [ready, captions, send]);
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

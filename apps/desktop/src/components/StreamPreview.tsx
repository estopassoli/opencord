import { Avatar, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { api, describeError } from '../store/session';
import { useUi } from '../store/ui';
import { useVoice } from '../store/voice';

/** Entra na chamada (se preciso), abre o canal e assiste a live de `userId` em destaque. */
export async function watchStream(serverId: string, channelId: string, userId: string, here: boolean) {
  useUi.getState().go({ kind: 'server', serverId, channelId });
  try {
    if (!here) await useVoice.getState().join(channelId, serverId);
  } catch (e) {
    useUi.getState().toast('error', describeError(e));
    return;
  }
  useVoice.getState().watch(userId, true);
  useUi.getState().focusStream(userId);
}

/** Prévia da live (imagem que quem transmite publica na API a cada 5 min); um clique entra e assiste. */
export function StreamPreviewCard({
  userId,
  previewAt,
  name,
  onWatch,
  showName = true,
}: {
  userId: string;
  previewAt: string | null;
  name: string;
  onWatch: () => void;
  showName?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewAt) return;
    let alive = true;
    let made: string | null = null;
    void api()
      .blob(`/voice/members/${userId}/stream-preview`)
      .then(
        (b) => {
          if (!alive) return;
          made = URL.createObjectURL(b);
          setUrl(made);
        },
        () => undefined,
      );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [userId, previewAt]);
  return (
    <button className="now-stream" onClick={onWatch} aria-label={`Assistir a transmissão de ${name}`}>
      <span className="now-stream-thumb">
        {url ? <img src={url} alt="" draggable={false} /> : <Icon name="screen" size={24} />}
        <span className="live-pill">AO VIVO</span>
        <span className="now-stream-play" aria-hidden="true">
          <Icon name="play" size={18} />
          Assistir
        </span>
      </span>
      {showName && (
        <span className="now-stream-name truncate">
          <Avatar id={userId} name={name} size={18} />
          {name}
        </span>
      )}
    </button>
  );
}

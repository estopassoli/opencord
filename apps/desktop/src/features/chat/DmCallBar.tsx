import { Avatar, Button, Icon } from '@opencord/ui';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { VoiceMemberState } from '@opencord/contracts';
import { api } from '../../store/session';
import { useData } from '../../store/data';
import { isInCall, useVoice } from '../../store/voice';

/**
 * Chamada privada (ADR-0038): quem está na chamada desta conversa e o botão de entrar/sair. Aparece só quando há
 * alguém na chamada (ou eu); o botão "Ligar" do cabeçalho começa uma do zero.
 */
export function DmCallBar({ conversationId }: { conversationId: string }) {
  const conv = useData((s) => s.conversations.find((c) => c.id === conversationId));
  const inCall = useData(useShallow((s) => Object.values(s.voiceStates).filter((v) => v.channelId === conversationId)));
  const machine = useVoice((s) => s.machine);
  const mine = machine.channelId === conversationId && isInCall(machine);

  // quem já está na chamada ao abrir a conversa
  useEffect(() => {
    let cancelled = false;
    api()
      .request<VoiceMemberState[]>('GET', `/conversations/${conversationId}/voice-states`)
      .then((list) => {
        if (cancelled) return;
        const d = useData.getState();
        for (const v of Object.values(d.voiceStates))
          if (v.channelId === conversationId && !list.some((x) => x.userId === v.userId)) d.removeVoiceState(v.userId);
        for (const v of list) d.setVoiceState(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!inCall.length && !mine) return null;
  const nameOf = (id: string) => conv?.members.find((m) => m.id === id)?.displayName ?? '?';
  return (
    <div className="dm-call-bar" role="status">
      <Icon name="phone" size={18} />
      <ul className="dm-call-people" aria-label="Na chamada">
        {inCall.map((v) => (
          <li key={v.userId} data-tip={nameOf(v.userId)}>
            <Avatar id={v.userId} name={nameOf(v.userId)} size={24} />
          </li>
        ))}
      </ul>
      <span className="truncate">
        {mine ? 'Você está na chamada' : `${inCall.map((v) => nameOf(v.userId)).join(', ')} na chamada`}
      </span>
      <span className="spacer" />
      {mine ? (
        <Button variant="danger" size="sm" icon="hangup" onClick={() => void useVoice.getState().leave()}>
          Sair
        </Button>
      ) : (
        <Button size="sm" icon="phone" onClick={() => void useVoice.getState().joinConversation(conversationId)}>
          Entrar na chamada
        </Button>
      )}
    </div>
  );
}

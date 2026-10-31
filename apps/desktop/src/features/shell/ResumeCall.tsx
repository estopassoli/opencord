/**
 * Ao abrir o app de novo: "Você estava em Sala · OpenCord — Reconectar" (a chamada em que eu estava quando o app
 * fechou, nas últimas 12 h). Sair da chamada pelo botão apaga a lembrança.
 */
import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { useData } from '../../store/data';
import { loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import { forgetLastCall, readLastCall, useVoice } from '../../store/voice';

/** lida uma vez, ao carregar o app (antes de qualquer chamada nova sobrescrever) */
const atStartup = readLastCall();

export function ResumeCall() {
  const [call, setCall] = useState(atStartup);
  const inCall = useVoice((v) => v.machine.status !== 'disconnected');
  const server = useData((d) => (call ? d.servers.find((s) => s.id === call.serverId) : undefined));
  const channel = useData((d) =>
    call ? d.details[call.serverId]?.channels.find((c) => c.id === call.channelId) : undefined,
  );
  // entrou numa chamada (esta ou outra): o convite some de vez
  useEffect(() => {
    if (inCall) setCall(null);
  }, [inCall]);
  useEffect(() => {
    if (call && server && !useData.getState().details[call.serverId])
      void loadServer(call.serverId).catch(() => undefined);
  }, [call, server]);
  if (!call || inCall || !server || channel?.kind !== 'voice') return null;
  const dismiss = () => {
    forgetLastCall();
    setCall(null);
  };
  return (
    <section className="resume-call" aria-label="Voltar para a chamada">
      <Icon name="speaker" size={18} />
      <span className="resume-call-names">
        <strong className="truncate">Você estava em {channel.name}</strong>
        <span className="muted small truncate">{server.name}</span>
      </span>
      <Button
        size="sm"
        onClick={() => {
          useUi.getState().go({ kind: 'server', serverId: call.serverId, channelId: call.channelId });
          void useVoice.getState().join(call.channelId, call.serverId);
        }}
      >
        Reconectar
      </Button>
      <button className="icon-btn" aria-label="Não reconectar" data-tip="Dispensar" onClick={dismiss}>
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}

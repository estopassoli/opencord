/**
 * Canal de ausentes (ADR-0049): quem está numa chamada de servidor sem mexer no teclado nem no mouse pelo limite do
 * servidor (e sem falar nesse tempo) vai sozinho para o canal de ausentes, com o microfone silenciado. Só no app
 * desktop: o tempo parado do computador vem do processo principal a cada 30 s (o navegador não informa).
 */
import { bridge } from './bridge';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { useVoice } from '../store/voice';
import { afkTarget } from './afkRule';

let started = false;
let lastSpokeAt = Date.now();

export function startAfk(): void {
  if (started || !bridge) return;
  started = true;
  // falar conta como atividade (quem conversa sem tocar no computador não está ausente)
  useVoice.subscribe((s) => {
    if (s.participants.some((p) => p.isLocal && p.speaking)) lastSpokeAt = Date.now();
  });
  bridge.on('idle', (idleSeconds) => {
    const v = useVoice.getState();
    const serverId = v.serverId;
    if (!serverId || v.conversationId) return;
    const detail = useData.getState().details[serverId];
    if (!detail) return;
    const target = afkTarget({
      idleSeconds,
      sinceSpokeMs: Date.now() - lastSpokeAt,
      inCall: v.machine.status === 'connected',
      channelId: v.machine.channelId,
      streaming: v.stream.status === 'live',
      afkChannelId: detail.afkChannelId ?? null,
      afkTimeoutSec: detail.afkTimeoutSec ?? 300,
      afkChannelExists: detail.channels.some((c) => c.id === detail.afkChannelId && c.kind === 'voice'),
    });
    if (!target) return;
    const name = detail.channels.find((c) => c.id === target)?.name ?? 'ausentes';
    void v
      .join(target, serverId)
      .then(async () => {
        if (!useVoice.getState().selfMute) await useVoice.getState().toggleMute();
        useUi.getState().toast('info', `Você ficou parado e foi para #${name}.`);
      })
      .catch(() => undefined);
  });
}

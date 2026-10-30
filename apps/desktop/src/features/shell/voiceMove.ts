import { hasPermission, Permission, type Channel } from '@opencord/contracts';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

/** Canais de voz para onde posso arrastar alguém (preciso de CONNECT no destino; a API confere o resto). */
export function moveTargets(serverId: string, fromChannelId: string): Channel[] {
  const detail = useData.getState().details[serverId];
  if (!detail || !hasPermission(detail.myPermissions, Permission.MOVE_MEMBERS)) return [];
  return detail.channels
    .filter((c) => c.kind === 'voice' && c.id !== fromChannelId && hasPermission(c.myPermissions, Permission.CONNECT))
    .sort((a, b) => a.position - b.position);
}

/** Leva alguém (ou eu mesmo) para outro canal de voz. Eu mesmo = entrar no canal, sem precisar de permissão. */
export function moveToVoice(userId: string, serverId: string, channelId: string) {
  if (userId === useData.getState().me?.id) return void useVoice.getState().join(channelId, serverId);
  void api()
    .request('PUT', `/voice/members/${userId}/channel`, { channelId })
    .catch((e: unknown) => useUi.getState().toast('error', describeError(e)));
}

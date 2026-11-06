/**
 * Modo lento (ADR-0052) do meu lado: depois de mandar uma mensagem num canal com modo lento, a caixa espera o tempo
 * do canal (quem gerencia mensagens ou o canal não espera). A API é quem manda; isto só evita o envio recusado.
 */
import { hasPermission, Permission } from '@opencord/contracts';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useData } from '../store/data';

export const useSlowmode = create<{ until: Record<string, number> }>()(() => ({ until: {} }));

const setUntil = (channelId: string, at: number) =>
  useSlowmode.setState((s) => ({ until: { ...s.until, [channelId]: at } }));

function channelOf(channelId: string) {
  for (const d of Object.values(useData.getState().details)) {
    const c = d.channels.find((x) => x.id === channelId);
    if (c) return c;
  }
  return undefined;
}

/** espera do canal para mim (0 = sem modo lento ou eu não espero) */
export function slowmodeFor(channelId: string) {
  const c = channelOf(channelId);
  if (!c?.slowmodeSec) return 0;
  const p = c.myPermissions;
  if (hasPermission(p, Permission.MANAGE_MESSAGES) || hasPermission(p, Permission.MANAGE_CHANNELS)) return 0;
  return c.slowmodeSec;
}

export function noteSent(channelId: string, now = Date.now()) {
  const sec = slowmodeFor(channelId);
  if (sec) setUntil(channelId, now + sec * 1000);
}

/** envio recusado pelo modo lento: usa o tempo que a API disse ("espere 12 s") */
export function noteRefused(channelId: string, message: string, now = Date.now()) {
  const m = /Modo lento: espere (\d+) s/.exec(message);
  if (!m) return false;
  setUntil(channelId, now + Number(m[1]) * 1000);
  return true;
}

/** segundos que faltam (atualiza a cada segundo enquanto houver espera) */
export function useSlowmodeLeft(channelId: string | null | undefined) {
  const until = useSlowmode((s) => (channelId ? (s.until[channelId] ?? 0) : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

import type { VoiceMemberState } from '@opencord/contracts';
import { useEffect, useState } from 'react';

/** 4:32:29 / 12:05 / 0:07 */
export const formatCallTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

/** início da chamada do canal: o mais antigo entre os presentes (API antiga sem callStartedAt: a entrada mais antiga) */
export function callStartOf(members: VoiceMemberState[]): number | null {
  let start: number | null = null;
  for (const v of members) {
    const t = Date.parse(v.callStartedAt ?? v.joinedAt);
    if (!Number.isNaN(t) && (start === null || t < start)) start = t;
  }
  return start;
}

/** Há quanto tempo o canal de voz tem gente, ao lado do nome (atualiza a cada segundo). */
export function CallTimer({ members }: { members: VoiceMemberState[] }) {
  const start = callStartOf(members);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (start === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start]);
  if (start === null) return null;
  return <span className="call-timer">{formatCallTime(now - start)}</span>;
}

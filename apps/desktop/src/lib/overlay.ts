/**
 * Overlay no jogo (ADR-0027): enquanto um jogo está aberto, uma janelinha transparente no canto do monitor mostra quem
 * está na chamada (quem fala acende), o meu mudo/surdo e os avisos do app (clipe salvo, pedido de controle remoto).
 * Este módulo junta o estado das stores e manda para o processo principal, que cuida da janela. As preferências
 * (ligado, canto) ficam neste computador.
 */
import type { OverlayCorner, OverlayState } from '../../electron/shared/overlay';
import { bridge } from './bridge';
import { useData } from '../store/data';
import { useGames } from '../store/games';
import { useUi } from '../store/ui';
import { isInCall, useVoice } from '../store/voice';
import { useRemote } from '../voice/remote-control';
import { create } from 'zustand';

const KEY = 'oc:overlay';
const NOTICE_MS = 6000;

interface OverlayPrefs {
  enabled: boolean;
  corner: OverlayCorner;
}
const DEFAULTS: OverlayPrefs = { enabled: true, corner: 'tl' };

function readPrefs(): OverlayPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<OverlayPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const useOverlayPrefs = create<OverlayPrefs & { set(p: Partial<OverlayPrefs>): void }>((set, get) => ({
  ...readPrefs(),
  set: (p) => {
    set(p);
    const { enabled, corner } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled, corner }));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  },
}));

interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  until: number;
}
let notices: Notice[] = [];
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Aviso curto no overlay (some sozinho). */
export function overlayNotice(text: string, kind: Notice['kind'] = 'info') {
  notices = [...notices.slice(-4), { id: ++seq, text, kind, until: Date.now() + NOTICE_MS }];
  push();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    notices = notices.filter((n) => n.until > Date.now());
    push();
  }, NOTICE_MS + 50);
}

function build(): OverlayState {
  const prefs = useOverlayPrefs.getState();
  const v = useVoice.getState();
  const game = useGames.getState().mine;
  const inCall = isInCall(v.machine) && v.machine.status === 'connected';
  const channel = v.serverId
    ? useData.getState().details[v.serverId]?.channels.find((c) => c.id === v.machine.channelId)?.name
    : undefined;
  const live = notices.filter((n) => n.until > Date.now());
  return {
    visible: prefs.enabled && Boolean(game) && (inCall || live.length > 0),
    corner: prefs.corner,
    call: inCall
      ? {
          channel: channel ?? 'Chamada',
          muted: v.selfMute,
          deafened: v.selfDeaf,
          people: v.participants.slice(0, 50).map((p) => ({
            id: p.identity,
            name: p.name,
            speaking: p.speaking,
            muted: p.micMuted,
            me: p.isLocal,
          })),
        }
      : null,
    notices: live.map(({ id, text, kind }) => ({ id, text, kind })),
  };
}

let last = '';
let frame = 0;
function push() {
  if (!bridge || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const s = build();
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    bridge?.overlay.update(s);
  });
}

let started = false;
export function startOverlay() {
  if (started || !bridge) return;
  started = true;
  useVoice.subscribe(push);
  useGames.subscribe(push);
  useOverlayPrefs.subscribe(push);
  // os avisos do app (clipe salvo, erro) também aparecem no jogo
  let seenToast = 0;
  useUi.subscribe((s) => {
    for (const t of s.toasts) {
      if (t.id <= seenToast) continue;
      seenToast = t.id;
      overlayNotice(t.text, t.kind);
    }
  });
  let lastPending: string | null = null;
  useRemote.subscribe((s) => {
    const id = s.pendingFrom?.identity ?? null;
    if (id && id !== lastPending) overlayNotice(`${s.pendingFrom?.name} quer controlar seu PC. Abra o OpenCord.`);
    lastPending = id;
  });
  push();
}

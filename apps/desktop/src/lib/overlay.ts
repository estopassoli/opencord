/**
 * Overlay no jogo (ADR-0027): enquanto um jogo está aberto, uma janelinha transparente no canto do monitor mostra quem
 * está na chamada (quem fala acende), o meu mudo/surdo e os avisos do app (clipe salvo, pedido de controle remoto).
 * Este módulo junta o estado das stores e manda para o processo principal, que cuida da janela. As preferências
 * (ligado, canto) ficam neste computador.
 */
import type { OverlayCorner, OverlayState } from '../../electron/shared/overlay';
import { bridge } from './bridge';
import { useData } from '../store/data';
import { useSession } from '../store/session';
import { callStartOf } from '../features/shell/CallTimer';
import { roleColorOf } from '../features/shell/MemberList';
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
  kind: 'info' | 'error' | 'success' | 'clip' | 'clip-error';
  until: number;
  /** aparece mesmo com o overlay desligado nas preferências (resposta ao atalho de clipe) */
  force?: boolean;
}
let notices: Notice[] = [];
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Aviso curto no overlay (some sozinho). */
export function overlayNotice(text: string, kind: Notice['kind'] = 'info', force = false) {
  notices = [...notices.slice(-4), { id: ++seq, text, kind, until: Date.now() + NOTICE_MS, force }];
  push();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    notices = notices.filter((n) => n.until > Date.now());
    push();
  }, NOTICE_MS + 50);
}

/** o próximo aviso do app não se repete no overlay: é o mesmo do aviso de clipe que acabou de sair */
let skipNextToast = false;

/**
 * Aviso de clipe por cima do jogo: cartão próprio, mesmo com o overlay desligado (o atalho pede uma resposta). Chamar
 * logo antes do ui.toast equivalente.
 */
export function clipNotice(text: string, ok: boolean) {
  skipNextToast = true;
  overlayNotice(text, ok ? 'clip' : 'clip-error', true);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** foto da pessoa como o app mostra (GIF do KLIPY pronto ou /avatars/:nome no servidor), só http/https */
function avatarOf(id: string): string | null {
  const d = useData.getState();
  const base = useSession.getState().serverUrl.replace(/\/+$/, '');
  const users = [
    d.me,
    ...Object.values(d.details).flatMap((x) => x.members.map((m) => m.user)),
    ...d.friends.map((f) => f.user),
    ...d.conversations.flatMap((c) => c.members),
  ];
  const u = users.find((x) => x?.id === id);
  if (!u) return null;
  const url = u.avatarUrl ?? (u.avatarKey && base ? `${base}/avatars/${encodeURIComponent(u.avatarKey)}` : null);
  return url && /^https?:\/\//i.test(url) && url.length <= 1000 ? url : null;
}

function build(): OverlayState {
  const prefs = useOverlayPrefs.getState();
  const v = useVoice.getState();
  const game = useGames.getState().mine;
  const inCall = isInCall(v.machine) && v.machine.status === 'connected';
  const data = useData.getState();
  const detail = v.serverId ? data.details[v.serverId] : undefined;
  const channel = detail?.channels.find((c) => c.id === v.machine.channelId)?.name;
  const aliases = data.settings?.friendNicknames;
  const inChannel = Object.values(data.voiceStates).filter((x) => x.channelId === v.machine.channelId);
  // overlay desligado: só os avisos de clipe (pedidos pelo atalho) aparecem
  const live = notices.filter((n) => n.until > Date.now() && (prefs.enabled || n.force));
  return {
    visible: Boolean(game) && ((prefs.enabled && inCall) || live.length > 0),
    corner: prefs.corner,
    call:
      prefs.enabled && inCall
        ? {
            channel: (channel ?? 'Chamada').slice(0, 64),
            startedAt: callStartOf(inChannel),
            muted: v.selfMute,
            deafened: v.selfDeaf,
            people: v.participants.slice(0, 50).map((p) => {
              // mesmo nome e cor da lista de canais: apelido que dei > apelido no servidor > nome
              const m = detail?.members.find((x) => x.user.id === p.identity);
              const color = detail ? roleColorOf(detail, m) : undefined;
              return {
                id: p.identity.slice(0, 64),
                name: (aliases?.[p.identity] ?? m?.nickname ?? m?.user.displayName ?? p.name).slice(0, 64),
                speaking: p.speaking,
                muted: p.micMuted,
                me: p.isLocal,
                color: color && HEX.test(color) ? color : null,
                avatar: avatarOf(p.identity),
              };
            }),
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
  // nomes, cores, fotos e o início da chamada vêm dos dados do servidor
  useData.subscribe(push);
  // os avisos do app (clipe salvo, erro) também aparecem no jogo
  let seenToast = 0;
  useUi.subscribe((s) => {
    for (const t of s.toasts) {
      if (t.id <= seenToast) continue;
      seenToast = t.id;
      if (skipNextToast) {
        skipNextToast = false;
        continue;
      }
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

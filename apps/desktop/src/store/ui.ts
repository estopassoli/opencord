import { create } from 'zustand';
import type { TargetKey } from './data';

export type View =
  | { kind: 'home'; tab: 'friends' }
  | { kind: 'dm'; conversationId: string }
  | { kind: 'server'; serverId: string; channelId: string | null };

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export type Modal =
  | { kind: 'settings'; tab?: string }
  | { kind: 'server-settings'; serverId: string; tab?: string }
  | { kind: 'create-server' }
  | { kind: 'explore-servers' }
  | { kind: 'create-channel'; serverId: string; channelKind: 'text' | 'voice'; categoryId: string | null }
  | { kind: 'screen-picker' }
  | { kind: 'quick-switcher' }
  | null;

interface UiState {
  view: View;
  /** último canal visitado por servidor (navegação lembra o contexto) */
  lastChannel: Record<string, string>;
  drafts: Record<TargetKey, string>;
  replyTo: Record<TargetKey, string | null>;
  modal: Modal;
  showMembers: boolean;
  /** stream em foco no palco (identity do publisher) */
  focusedStream: string | null;
  /** mensagem em edição inline (seta para cima no composer edita a última própria) */
  editing: string | null;
  toasts: Toast[];
  connection: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  /** histórico para os botões voltar/avançar da barra de título */
  back: View[];
  forward: View[];
  go(v: View): void;
  goBack(): void;
  goForward(): void;
  setDraft(key: TargetKey, text: string): void;
  setReplyTo(key: TargetKey, id: string | null): void;
  openModal(m: Modal): void;
  toggleMembers(): void;
  focusStream(id: string | null): void;
  setEditing(id: string | null): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  setConnection(c: UiState['connection']): void;
}

let toastSeq = 0;

export const useUi = create<UiState>()((set) => ({
  view: { kind: 'home', tab: 'friends' },
  lastChannel: {},
  drafts: {},
  replyTo: {},
  modal: null,
  showMembers: true,
  focusedStream: null,
  editing: null,
  toasts: [],
  connection: 'connecting',
  back: [],
  forward: [],
  goBack: () =>
    set((s) => {
      const prev = s.back.at(-1);
      return prev ? { view: prev, back: s.back.slice(0, -1), forward: [s.view, ...s.forward].slice(0, 50) } : {};
    }),
  goForward: () =>
    set((s) => {
      const next = s.forward[0];
      return next ? { view: next, forward: s.forward.slice(1), back: [...s.back, s.view].slice(-50) } : {};
    }),
  go: (v) =>
    set((s) => ({
      view: v,
      back: JSON.stringify(s.view) === JSON.stringify(v) ? s.back : [...s.back, s.view].slice(-50),
      forward: JSON.stringify(s.view) === JSON.stringify(v) ? s.forward : [],
      lastChannel: v.kind === 'server' && v.channelId ? { ...s.lastChannel, [v.serverId]: v.channelId } : s.lastChannel,
    })),
  setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
  setReplyTo: (key, id) => set((s) => ({ replyTo: { ...s.replyTo, [key]: id } })),
  openModal: (m) => set({ modal: m }),
  toggleMembers: () => set((s) => ({ showMembers: !s.showMembers })),
  focusStream: (id) => set({ focusedStream: id }),
  setEditing: (editing) => set({ editing }),
  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnection: (connection) => set({ connection }),
}));

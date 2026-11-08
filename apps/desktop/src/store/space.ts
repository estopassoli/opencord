import {
  Permission,
  hasPermission,
  type ServerSpace,
  type SpaceLayout,
  type SpaceMove,
  type SpaceScreen,
  type SpaceSession,
} from '@opencord/contracts';
import { create } from 'zustand';
import { useData } from './data';
import { api, describeError, useSession } from './session';
import { useUi } from './ui';

/**
 * Espaço 3D da chamada (ADR-0055). O ambiente é do servidor (salvo pelo editor ou gerado pelo id); o telão é estado da
 * chamada; as posições dos outros ficam fora do React (mapa `peers`), lidas pela cena a cada quadro.
 */
export interface PeerPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
  /** quando chegou (ms, relógio local); sem notícia por PEER_TIMEOUT_MS o avatar some */
  at: number;
}
export const PEER_TIMEOUT_MS = 6000;
export const peers = new Map<string, PeerPose>();

interface SpaceStore {
  /** canal da chamada com o espaço aberto (null = fechado) */
  openChannelId: string | null;
  spaces: Record<string, ServerSpace>;
  session: SpaceSession | null;
  editing: boolean;
  open(channelId: string, serverId: string): Promise<void>;
  close(): void;
  load(serverId: string): Promise<ServerSpace | null>;
  applyLayout(s: ServerSpace): void;
  applySession(s: SpaceSession): void;
  ended(channelId: string): void;
  setScreen(screen: SpaceScreen | null): Promise<void>;
  /** liga/desliga luminária, lareira ou fliperama (para todos da chamada) */
  toggle(itemId: string, on: boolean): Promise<void>;
  /** menu "o que passa no telão" aberto (pela barra ou pela televisão no espaço) */
  screenMenu: boolean;
  setScreenMenu(on: boolean): void;
  setEditing(on: boolean): void;
  save(serverId: string, layout: SpaceLayout, baseRevision: number): Promise<boolean>;
  reset(serverId: string): Promise<void>;
  moved(m: SpaceMove & { userId: string }): void;
  left(channelId: string, userId: string): void;
  /** saiu da chamada: some do espaço de todo mundo e o espaço fecha */
  callEnded(): void;
}

export function canEditSpace(serverId: string | null): boolean {
  if (!serverId) return false;
  const d = useData.getState().details[serverId];
  return !!d && hasPermission(d.myPermissions, Permission.EDIT_SPACE);
}

export const useSpace = create<SpaceStore>()((set, get) => ({
  openChannelId: null,
  spaces: {},
  session: null,
  editing: false,

  async open(channelId, serverId) {
    set({ openChannelId: channelId, editing: false });
    useUi.getState().setActivitiesOpen(false);
    await get().load(serverId);
    const rt = useSession.getState().realtime;
    try {
      const s = rt ? await rt.command('space:get', { channelId }) : null;
      set({ session: s });
    } catch {
      /* sem conexão: o telão fica vazio até o próximo estado */
    }
  },
  close() {
    const ch = get().openChannelId;
    if (ch) useSession.getState().realtime?.sendVolatile('space:leave', { channelId: ch });
    peers.clear();
    set({ openChannelId: null, editing: false });
  },
  async load(serverId) {
    try {
      const s = await api().request<ServerSpace>('GET', `/servers/${serverId}/space`);
      get().applyLayout(s);
      return s;
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível abrir o espaço 3D: ${describeError(e)}`);
      return null;
    }
  },
  applyLayout(s) {
    const cur = get().spaces[s.serverId];
    // revisão 0 = gerado (reset); senão só avança
    if (cur && s.revision !== 0 && s.revision < cur.revision) return;
    set((st) => ({ spaces: { ...st.spaces, [s.serverId]: s } }));
  },
  applySession(s) {
    const cur = get().session;
    if (cur && cur.channelId === s.channelId && s.revision < cur.revision) return;
    set({ session: s });
  },
  ended(channelId) {
    if (get().session?.channelId === channelId) set({ session: null });
  },
  async setScreen(screen) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      get().applySession(await rt.command('space:screen', { channelId, screen }));
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível trocar o telão: ${describeError(e)}`);
    }
  },
  setEditing(on) {
    set({ editing: on });
  },
  screenMenu: false,
  setScreenMenu(on) {
    set({ screenMenu: on });
  },
  async toggle(itemId, on) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      get().applySession(await rt.command('space:toggle', { channelId, itemId, on }));
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível: ${describeError(e)}`);
    }
  },
  async save(serverId, layout, baseRevision) {
    try {
      const s = await api().request<ServerSpace>('PUT', `/servers/${serverId}/space`, { layout, baseRevision });
      get().applyLayout(s);
      useUi.getState().toast('success', 'Espaço salvo.');
      return true;
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível salvar o espaço: ${describeError(e)}`);
      return false;
    }
  },
  async reset(serverId) {
    try {
      const s = await api().request<ServerSpace>('DELETE', `/servers/${serverId}/space`);
      set((st) => ({ spaces: { ...st.spaces, [serverId]: s } }));
      useUi.getState().toast('success', 'O espaço voltou ao ambiente gerado.');
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível restaurar: ${describeError(e)}`);
    }
  },
  moved(m) {
    if (m.channelId !== get().openChannelId) return;
    peers.set(m.userId, { x: m.x, y: m.y, z: m.z, ry: m.ry, a: m.a, at: performance.now() });
  },
  left(channelId, userId) {
    if (channelId === get().openChannelId) peers.delete(userId);
  },
  callEnded() {
    peers.clear();
    set({ openChannelId: null, editing: false, session: null });
  },
}));

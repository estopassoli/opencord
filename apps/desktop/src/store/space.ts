import {
  Permission,
  hasPermission,
  type ServerSpace,
  type SpaceLayout,
  type SpaceMove,
  type SpaceScreen,
  MATCH_COUNTDOWN_MS,
  RACE_COUNTDOWN_MS,
  type SpaceBall,
  type SpaceGun,
  type SpaceGunPose,
  type SpacePool,
  type SpaceDuel,
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
  /** 0 sala do servidor; 1–3 arenas de esporte */
  zone: number;
  /** time na arena */
  team?: 'a' | 'b';
  /** gunfight: arma, mira, agachado, mirando, vivo */
  gun?: SpaceGunPose;
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
  /** arena em que estou (0 = sala do servidor) */
  zone: number;
  setZone(z: number): void;
  /** meu time na arena (escolhido ao entrar: o que tem menos gente) */
  team: 'a' | 'b';
  setTeam(t: 'a' | 'b'): void;
  /** bola que chegou pela rede (a cena registra quem recebe) */
  ballListener: ((b: SpaceBall & { by: string }) => void) | null;
  /** sinuca: bolas que chegaram pela rede */
  poolListener: ((p: SpacePool & { by: string }) => void) | null;
  /** gunfight: tiros, acertos e mortes que chegaram pela rede */
  gunListener: ((g: SpaceGun & { sender: string }) => void) | null;
  /** corrida: largada no MEU relógio (estimada ao receber a largada) e chave da corrida atual */
  raceLocalStart: number | null;
  raceKey: number | null;
  startRace(): Promise<void>;
  finishRace(ms: number): Promise<void>;
  score(zone: number, side: 'a' | 'b', points: number, by?: string, teams?: { a: number; b: number }): void;
  resetScore(zone: number): Promise<void>;
  /** Jogar/Revanche: zera e abre a contagem 3-2-1 da partida da arena (o servidor ignora no meio de uma partida) */
  startMatch(zone: number): Promise<void>;
  /** partidas: VAI de cada arena no MEU relógio (estimado ao receber a contagem), como a largada da corrida */
  matchLocalStart: Record<string, number>;
  /** reconectou com o espaço aberto: busca a sessão e os duelos de novo (o que mudou enquanto estava fora) */
  refresh(): Promise<void>;
  /** x1 no soco: lutas da chamada (convites, em andamento e as que acabaram há pouco) */
  duels: Record<string, SpaceDuel>;
  /** diferença entre o relógio do servidor e o meu (ms) */
  duelOffset: number;
  applyDuel(d: SpaceDuel): void;
  challenge(targetId: string): Promise<void>;
  answerDuel(duelId: string, accept: boolean): Promise<void>;
  punch(duelId: string, strong: boolean): void;
  forfeit(duelId: string): Promise<void>;
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
    set({
      openChannelId: channelId,
      editing: false,
      zone: 0,
      raceKey: null,
      raceLocalStart: null,
      matchLocalStart: {},
    });
    useUi.getState().setActivitiesOpen(false);
    await get().load(serverId);
    const rt = useSession.getState().realtime;
    try {
      const s = rt ? await rt.command('space:get', { channelId }) : null;
      // corrida (ou partida) já em andamento: quem chega assiste até a próxima largada (a chave fica gravada, então o
      // mesmo estado chegando depois não abre uma contagem nova)
      set({ session: s, raceKey: s?.race?.startAt ?? null, raceLocalStart: null, matchLocalStart: {} });
      for (const d of rt ? await rt.command('space:duel:get', { channelId }) : []) get().applyDuel(d);
    } catch {
      /* sem conexão: o telão fica vazio até o próximo estado */
    }
  },
  close() {
    const ch = get().openChannelId;
    if (ch) useSession.getState().realtime?.sendVolatile('space:leave', { channelId: ch });
    peers.clear();
    set({
      openChannelId: null,
      editing: false,
      duels: {},
      zone: 0,
      raceKey: null,
      raceLocalStart: null,
      matchLocalStart: {},
    });
  },
  async refresh() {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      const s = await rt.command('space:get', { channelId });
      if (s) get().applySession(s);
      for (const d of await rt.command('space:duel:get', { channelId })) get().applyDuel(d);
    } catch {
      /* tenta de novo na próxima reconexão */
    }
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
    // corrida nova: a contagem começa agora no meu relógio (o do servidor pode estar adiantado ou atrasado)
    const key = s.race?.startAt ?? null;
    // (quem abriu o espaço com uma corrida já em andamento espera a próxima)
    if (key !== get().raceKey)
      set({ raceKey: key, raceLocalStart: key !== null && cur ? Date.now() + RACE_COUNTDOWN_MS : null });
    // partida nova (contagem com outro startAt): o VAI no meu relógio é daqui a MATCH_COUNTDOWN_MS
    const prevMatches = cur?.channelId === s.channelId ? cur.matches : undefined;
    let local = get().matchLocalStart;
    for (const [z, m] of Object.entries(s.matches ?? {}))
      if (m.phase === 'countdown' && prevMatches?.[z]?.startAt !== m.startAt)
        local = { ...local, [z]: Date.now() + MATCH_COUNTDOWN_MS };
    if (local !== get().matchLocalStart) set({ matchLocalStart: local });
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
    peers.set(m.userId, {
      x: m.x,
      y: m.y,
      z: m.z,
      ry: m.ry,
      a: m.a,
      zone: m.zone ?? 0,
      ...(m.team ? { team: m.team } : {}),
      ...(m.gun ? { gun: m.gun } : {}),
      at: performance.now(),
    });
  },
  left(channelId, userId) {
    if (channelId === get().openChannelId) peers.delete(userId);
  },
  callEnded() {
    const ch = get().openChannelId;
    if (ch) useSession.getState().realtime?.sendVolatile('space:leave', { channelId: ch });
    peers.clear();
    set({
      openChannelId: null,
      editing: false,
      session: null,
      duels: {},
      zone: 0,
      raceKey: null,
      raceLocalStart: null,
      matchLocalStart: {},
    });
  },
  duels: {},
  duelOffset: 0,
  zone: 0,
  setZone(z) {
    if (z === get().zone) return;
    // time com menos gente na arena (empate: azul)
    let a = 0;
    let b = 0;
    const now = performance.now();
    for (const p of peers.values())
      if (p.zone === z && now - p.at < PEER_TIMEOUT_MS) {
        if (p.team === 'b') b++;
        else if (p.team === 'a') a++;
      }
    set({ zone: z, team: b < a ? 'b' : 'a' });
  },
  team: 'a',
  setTeam(t) {
    set({ team: t });
  },
  ballListener: null,
  gunListener: null,
  poolListener: null,
  raceLocalStart: null,
  raceKey: null,
  async startRace() {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      get().applySession(await rt.command('space:race:start', { channelId }));
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível largar: ${describeError(e)}`);
    }
  },
  async finishRace(ms) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    await rt
      .command('space:race:finish', { channelId, ms })
      .then((s) => get().applySession(s))
      .catch(() => undefined);
  },
  score(zone, side, points, by, teams) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    void rt
      .command('space:score', { channelId, zone, side, points, ...(by ? { by } : {}), ...(teams ? { teams } : {}) })
      .then((s) => get().applySession(s))
      .catch(() => undefined);
  },
  async resetScore(zone) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    await rt
      .command('space:score:reset', { channelId, zone })
      .then((s) => get().applySession(s))
      .catch(() => undefined);
  },
  matchLocalStart: {},
  async startMatch(zone) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      get().applySession(await rt.command('space:match:start', { channelId, zone }));
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível começar a partida: ${describeError(e)}`);
    }
  },
  applyDuel(d) {
    if (d.channelId !== get().openChannelId) return;
    set((st) => ({ duels: { ...st.duels, [d.id]: d }, duelOffset: d.serverNow - Date.now() }));
    // a luta acabou: some da tela depois de mostrar o resultado
    if (d.status === 'ended')
      setTimeout(() => {
        const cur = get().duels[d.id];
        if (cur?.status === 'ended') {
          const { [d.id]: _gone, ...rest } = get().duels;
          set({ duels: rest });
        }
      }, 8000);
  },
  async challenge(targetId) {
    const channelId = get().openChannelId;
    const rt = useSession.getState().realtime;
    if (!channelId || !rt) return;
    try {
      get().applyDuel(await rt.command('space:duel:challenge', { channelId, targetId }));
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível desafiar: ${describeError(e)}`);
    }
  },
  async answerDuel(duelId, accept) {
    const rt = useSession.getState().realtime;
    if (!rt) return;
    try {
      get().applyDuel(await rt.command('space:duel:answer', { duelId, accept }));
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  },
  punch(duelId, strong) {
    const rt = useSession.getState().realtime;
    // o servidor decide se acertou; o resultado chega pelo evento space:duel
    void rt?.command('space:duel:hit', { duelId, strong }).catch(() => undefined);
  },
  async forfeit(duelId) {
    const rt = useSession.getState().realtime;
    if (!rt) return;
    await rt
      .command('space:duel:forfeit', { duelId })
      .then((d) => get().applyDuel(d))
      .catch(() => undefined);
  },
}));

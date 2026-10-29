import {
  defaultUserSettings,
  type AuthResponse,
  type Conversation,
  type Me,
  type Message,
  type PresenceStatus,
  type ServerDetail,
  type ServerSummary,
  type UnreadState,
  type UserSettings,
  type VoiceMemberState,
} from '@opencord/contracts';
import { create } from 'zustand';
import { ApiClient, ApiError, normalizeServerUrl, type SessionTokens } from '../lib/api';
import { bridge, secrets } from '../lib/bridge';
import { RealtimeClient } from '../lib/realtime';
import { keyOf, useData, useMessages, type FriendWithPresence } from './data';
import { useUi } from './ui';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  serverUrl: string;
  api: ApiClient | null;
  realtime: RealtimeClient | null;
  error: string | null;
  restore(): Promise<void>;
  /** Login de conta: apelido ou e-mail + senha. */
  login(serverUrl: string, login: string, password: string): Promise<void>;
  /** Entrar só com apelido (ADR-0007). */
  join(serverUrl: string, nickname: string, accessCode?: string): Promise<void>;
  register(
    serverUrl: string,
    body: { nickname: string; password: string; email?: string | undefined; accessCode?: string | undefined },
  ): Promise<void>;
  logout(): Promise<void>;
}

const deviceId = (() => {
  try {
    let id = localStorage.getItem('oc:device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('oc:device', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

async function persistTokens(t: SessionTokens) {
  await secrets.set(
    'session',
    JSON.stringify({ refreshToken: t.refreshToken, accessToken: t.accessToken, accessExpiresAt: t.accessExpiresAt }),
  );
}

let restoring: Promise<void> | null = null;

export const useSession = create<SessionState>()((set, get) => {
  function makeApi(serverUrl: string) {
    const api = new ApiClient(serverUrl);
    api.onTokens = (t) => persistTokens(t).catch(() => undefined);
    api.readStored = async () => {
      const raw = await secrets.get('session');
      return raw ? (JSON.parse(raw) as SessionTokens) : null;
    };
    api.onAuthLost = () => void get().logout();
    return api;
  }

  async function start(api: ApiClient, serverUrl: string, auth?: AuthResponse) {
    const rt = new RealtimeClient(
      serverUrl,
      () => api.freshToken(),
      () => api.refresh(),
    );
    set({ api, realtime: rt, serverUrl, status: 'authenticated', error: null });
    if (auth) useData.setState({ me: auth.user });
    wireRealtime(rt);
    rt.onState = (s) => useUi.getState().setConnection(s);
    rt.onReady = (reconnect) => void (reconnect ? resync() : undefined);
    rt.connect();
    await bootstrap();
  }

  async function doRestore(): Promise<void> {
    const serverUrl = (await secrets.get('serverUrl')) ?? '';
    const raw = await secrets.get('session');
    if (!serverUrl || !raw) return set({ status: 'anonymous', serverUrl });
    try {
      const t = JSON.parse(raw) as SessionTokens;
      const api = makeApi(serverUrl);
      api.setTokens(t);
      // força validação: refresh rotaciona e prova que a sessão ainda vale
      if (!(await api.refresh()) && !api.accessToken) return set({ status: 'anonymous', serverUrl });
      await start(api, serverUrl);
    } catch {
      set({ status: 'anonymous', serverUrl });
    }
  }

  return {
    status: 'loading',
    serverUrl: '',
    api: null,
    realtime: null,
    error: null,

    restore() {
      // single-flight: o StrictMode (dev) roda efeitos duas vezes; dois restores em paralelo
      // apresentariam o mesmo refresh duas vezes e o servidor revogaria a sessão
      // (uma vez por carregamento da página: o login posterior não passa por aqui)
      restoring ??= doRestore();
      return restoring;
    },

    async login(serverUrlRaw, login, password) {
      const serverUrl = normalizeServerUrl(serverUrlRaw);
      const api = makeApi(serverUrl);
      const res = await api.login(login, password, deviceId);
      api.setTokens({
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        accessExpiresAt: res.tokens.accessExpiresAt,
      });
      await secrets.set('serverUrl', serverUrl);
      await persistTokens({
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        accessExpiresAt: res.tokens.accessExpiresAt,
      });
      await start(api, serverUrl, res);
    },

    async join(serverUrlRaw, nickname, accessCode) {
      const serverUrl = normalizeServerUrl(serverUrlRaw);
      const api = makeApi(serverUrl);
      const res = await api.guest(nickname, deviceId, accessCode);
      const t = {
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        accessExpiresAt: res.tokens.accessExpiresAt,
      };
      api.setTokens(t);
      await secrets.set('serverUrl', serverUrl);
      await persistTokens(t);
      await start(api, serverUrl, res);
    },

    async register(serverUrlRaw, body) {
      const serverUrl = normalizeServerUrl(serverUrlRaw);
      const api = makeApi(serverUrl);
      const res = await api.register({ ...body, deviceId });
      api.setTokens({
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        accessExpiresAt: res.tokens.accessExpiresAt,
      });
      await secrets.set('serverUrl', serverUrl);
      await persistTokens({
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        accessExpiresAt: res.tokens.accessExpiresAt,
      });
      await start(api, serverUrl, res);
    },

    async logout() {
      const { api, realtime } = get();
      // encerrar mídia antes de qualquer coisa: nunca deixar microfone/tela transmitindo
      const { useVoice } = await import('./voice');
      await useVoice
        .getState()
        .leave()
        .catch(() => undefined);
      if (api?.accessToken) await api.request('POST', '/auth/logout').catch(() => undefined);
      realtime?.disconnect();
      await secrets.delete('session');
      useData.getState().reset();
      useMessages.getState().clear();
      useUi.setState({ view: { kind: 'home', tab: 'friends' }, modal: null });
      set({ status: 'anonymous', api: null, realtime: null });
    },
  };
});

export const api = (): ApiClient => {
  const a = useSession.getState().api;
  if (!a) throw new Error('não autenticado');
  return a;
};

// ---------- Carga inicial e ressincronização ----------
export async function loadServer(serverId: string): Promise<ServerDetail> {
  const [detail, voices, presence] = await Promise.all([
    api().request<ServerDetail>('GET', `/servers/${serverId}`),
    api().request<VoiceMemberState[]>('GET', `/servers/${serverId}/voice-states`),
    api().request<Record<string, PresenceStatus>>('GET', `/servers/${serverId}/presence`),
  ]);
  const data = useData.getState();
  data.setServerDetail(detail);
  for (const v of Object.values(data.voiceStates)) if (v.serverId === serverId) data.removeVoiceState(v.userId);
  for (const v of voices) useData.getState().setVoiceState(v);
  useData.setState((s) => ({ presence: { ...s.presence, ...presence } }));
  return detail;
}

export async function loadFriends() {
  const friends = await api().request<FriendWithPresence[]>('GET', '/friends');
  useData.setState((s) => ({
    friends,
    presence: {
      ...s.presence,
      ...Object.fromEntries(friends.filter((f) => f.presence).map((f) => [f.user.id, f.presence as PresenceStatus])),
    },
  }));
}

async function bootstrap() {
  const a = api();
  const [me, settings, servers, conversations, unreads] = await Promise.all([
    a.request<Me & { presence: Exclude<PresenceStatus, 'offline'> }>('GET', '/me'),
    a.request<UserSettings>('GET', '/me/settings').catch(() => defaultUserSettings()),
    a.request<ServerSummary[]>('GET', '/servers'),
    a.request<Conversation[]>('GET', '/conversations'),
    a.request<UnreadState[]>('GET', '/me/unreads'),
  ]);
  useData.setState({
    me,
    settings,
    servers,
    conversations,
    myStatus: me.presence,
    unread: Object.fromEntries(unreads.map((u) => [keyOf(u), u])),
  });
  await Promise.all([
    ...servers.map((s) => loadServer(s.id).catch(() => undefined)),
    loadFriends().catch(() => undefined),
  ]);
  const { applySettingsSideEffects } = await import('./settings');
  applySettingsSideEffects(settings);
}

/** Após reconexão: recupera mensagens perdidas por cursor e recarrega estado volátil (presença/voz/não lidas). */
async function resync() {
  const rt = useSession.getState().realtime;
  if (!rt) return;
  const timelines = useMessages.getState().timelines;
  const channels = Object.entries(timelines)
    .filter(([k, t]) => k.startsWith('c:') && t.loaded)
    .map(([k, t]) => ({ channelId: k.slice(2), lastMessageId: t.messages.at(-1)?.id ?? null }));
  try {
    const r = await rt.command('sync:resume', { channels });
    for (const m of r.missed) useMessages.getState().upsert(m);
    if (r.truncated) for (const c of channels) await reloadTimeline(`c:${c.channelId}`);
  } catch {
    /* tentará na próxima reconexão */
  }
  await bootstrap().catch(() => undefined);
}

async function reloadTimeline(key: `c:${string}` | `d:${string}`) {
  const path = key.startsWith('c:') ? `/channels/${key.slice(2)}/messages` : `/conversations/${key.slice(2)}/messages`;
  const page = await api().request<{ messages: Message[]; nextBefore: string | null }>('GET', `${path}?limit=50`);
  useMessages.getState().setPage(key, page, 'replace');
}

// ---------- Eventos realtime → estado ----------
function wireRealtime(rt: RealtimeClient) {
  const d = () => useData.getState();
  const me = () => useData.getState().me?.id ?? '';
  const m = () => useMessages.getState();

  // `on` exige socket criado: registra após connect()
  queueMicrotask(() => {
    rt.on('chat:message:created', (msg) => {
      m().upsert(msg);
      const key = keyOf(msg);
      // o broadcast chega antes do ACK: remover a cópia otimista correspondente para não exibir duplicada
      if (msg.author.id === me()) {
        const pending = m().get(key).pending;
        const match = Object.entries(pending).find(([, p]) => !p.failed && p.body === msg.body);
        if (match) m().resolvePending(key, match[0]);
      }
      const view = useUi.getState().view;
      const viewing =
        (view.kind === 'server' && view.channelId === msg.channelId) ||
        (view.kind === 'dm' && view.conversationId === msg.conversationId);
      const mine = msg.author.id === me();
      if (viewing && document.hasFocus()) {
        d().markRead(key, msg.id);
        if (!mine)
          void rt
            .command('chat:read', {
              ...(msg.channelId ? { channelId: msg.channelId } : { conversationId: msg.conversationId as string }),
              messageId: msg.id,
            })
            .catch(() => undefined);
      } else {
        d().bumpUnread(key, msg.id, msg.mentions.includes(me()), mine);
      }
      d().setTyping(key, msg.author.id, false);
      if (msg.conversationId && !d().conversations.some((c) => c.id === msg.conversationId)) {
        void api()
          .request<Conversation[]>('GET', '/conversations')
          .then((cs) => useData.setState({ conversations: cs }));
      }
    });
    rt.on('chat:message:updated', (msg) => m().upsert(msg));
    rt.on('chat:message:deleted', (e) => m().markDeleted(keyOf(e), e.messageId));
    rt.on('chat:reaction:changed', (e) => m().reaction(keyOf(e), e.messageId, e.emoji, e.userId, e.on, e.count, me()));
    rt.on('chat:typing', (e) => d().setTyping(keyOf(e), e.userId, e.active));
    rt.on('presence:changed', (e) => useData.setState((s) => ({ presence: { ...s.presence, [e.userId]: e.status } })));
    rt.on('voice:member:joined', (v) => {
      d().setVoiceState(v);
      // participante ainda não está na lista de membros carregada (ex.: acabou de entrar): recarrega para ter o nome
      if (!d().details[v.serverId]?.members.some((m) => m.user.id === v.userId))
        void loadServer(v.serverId).catch(() => undefined);
    });
    rt.on('voice:state:changed', (v) => d().setVoiceState(v));
    rt.on('voice:member:left', (e) => {
      const cur = d().voiceStates[e.userId];
      if (cur?.channelId === e.channelId) d().removeVoiceState(e.userId);
    });
    rt.on('voice:force-disconnect', (e) => {
      void import('./voice').then(({ useVoice }) =>
        useVoice
          .getState()
          .forcedOut(
            e.reason === 'kicked'
              ? 'Você foi desconectado da chamada por um moderador.'
              : 'Sua permissão de voz foi revogada.',
          ),
      );
    });
    rt.on('server:updated', (s) =>
      useData.setState((st) => ({
        servers: st.servers.map((x) => (x.id === s.id ? s : x)),
        details: st.details[s.id]
          ? { ...st.details, [s.id]: { ...(st.details[s.id] as ServerDetail), ...s } }
          : st.details,
      })),
    );
    rt.on('server:added', (srv) => void loadServer(srv.id).catch(() => undefined));
    rt.on('server:deleted', (e) => leaveServerLocally(e.serverId, 'O servidor foi excluído.'));
    rt.on('server:removed', (e) =>
      leaveServerLocally(e.serverId, e.reason === 'kicked' ? 'Você foi removido do servidor.' : null),
    );
    rt.on('server:member:joined', (e) => d().upsertMember(e.serverId, e.member));
    rt.on('server:member:updated', (e) => d().upsertMember(e.serverId, e.member));
    rt.on('server:member:left', (e) => d().removeMember(e.serverId, e.userId));
    rt.on('channel:created', (c) => d().upsertChannel(c));
    rt.on('channel:updated', (c) => d().upsertChannel(c));
    rt.on('channel:deleted', (e) => {
      d().removeChannel(e.serverId, e.channelId);
      const v = useUi.getState().view;
      if (v.kind === 'server' && v.channelId === e.channelId)
        useUi.getState().go({ kind: 'server', serverId: e.serverId, channelId: null });
    });
    rt.on('category:upserted', (c) => d().upsertCategory(c));
    rt.on('category:deleted', (e) => d().removeCategory(e.serverId, e.categoryId));
    rt.on('role:upserted', (r) => d().upsertRole(r));
    rt.on('role:deleted', (e) => d().removeRole(e.serverId, e.roleId));
    // permissões efetivas mudaram: recarregar o servidor (canais visíveis e myPermissions)
    rt.on('permissions:changed', (e) => void loadServer(e.serverId).catch(() => undefined));
    rt.on('friend:changed', () => void loadFriends().catch(() => undefined));
    rt.on('conversation:upserted', (c) => d().upsertConversation(c));
    rt.on('notification:created', (n) => void import('./notify').then(({ notify }) => notify(n)));
    rt.on('session:revoked', () => {
      useUi.getState().toast('error', 'Sua sessão foi encerrada.');
      void useSession.getState().logout();
    });
  });
}

function leaveServerLocally(serverId: string, message: string | null) {
  void import('./voice').then(({ useVoice }) => {
    const v = useVoice.getState();
    if (v.serverId === serverId) void v.leave();
  });
  useData.getState().removeServer(serverId);
  const view = useUi.getState().view;
  if (view.kind === 'server' && view.serverId === serverId) useUi.getState().go({ kind: 'home', tab: 'friends' });
  if (message) useUi.getState().toast('info', message);
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Sem conexão com o servidor.';
    return e.message;
  }
  if (e instanceof TypeError) return 'Não foi possível conectar ao servidor. Verifique o endereço e sua conexão.';
  return e instanceof Error ? e.message : 'Erro inesperado';
}

export { bridge };

/** Marca um canal/conversa como lido até a última mensagem conhecida (atalho Esc e menus de contexto). */
export async function markTargetRead(key: `c:${string}` | `d:${string}`) {
  const u = useData.getState().unread[key];
  const last = u?.lastMessageId;
  if (!last || (u.unreadCount === 0 && u.lastReadMessageId === last)) return;
  useData.getState().markRead(key, last);
  const path = key.startsWith('c:') ? `/channels/${key.slice(2)}/read` : `/conversations/${key.slice(2)}/read`;
  await api()
    .request('PUT', path, { messageId: last })
    .catch(() => undefined);
}

/** Marca todos os canais de texto de um servidor como lidos. */
export async function markServerRead(serverId: string) {
  const channels = useData.getState().details[serverId]?.channels.filter((c) => c.kind === 'text') ?? [];
  await Promise.all(channels.map((c) => markTargetRead(`c:${c.id}`)));
}

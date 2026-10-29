import {
  ClientCommands,
  SOCKET_PATH,
  type Ack,
  type ClientCommand,
  type ClientCommandName,
  type ClientCommandResults,
  type EventEnvelope,
  type ServerEventName,
  type ServerEvents,
} from '@opencord/contracts';
import { io, type Socket } from 'socket.io-client';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * Cliente Socket.IO: autenticação pelo handshake (token renovado a cada tentativa), eventos desembrulhados do envelope,
 * comandos com ACK/timeout e deduplicação de eventos por eventId (eventos podem chegar duplicados).
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  onState: (s: ConnState) => void = () => undefined;
  onReady: (reconnect: boolean) => void = () => undefined;
  private everConnected = false;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly onUnauthorized: () => Promise<boolean>,
  ) {}

  connect() {
    if (this.socket) return;
    this.onState('connecting');
    const s = io(this.baseUrl, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: (cb) => {
        void this.getToken().then((token) => cb({ token }));
      },
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
    });
    this.socket = s;
    s.on('ready', (env: EventEnvelope<ServerEvents['ready']>) => {
      const reconnect = this.everConnected;
      this.everConnected = true;
      this.onState('connected');
      this.startHeartbeat(env.payload.heartbeatIntervalMs);
      this.onReady(reconnect);
    });
    s.on('disconnect', (reason) => {
      this.stopHeartbeat();
      // desconexão iniciada pelo servidor (ex.: sessão revogada) não reconecta sozinha
      this.onState(reason === 'io server disconnect' ? 'offline' : 'reconnecting');
    });
    s.on('connect_error', (err) => {
      this.onState('reconnecting');
      if (err.message === 'unauthorized') void this.onUnauthorized();
    });
  }

  private startHeartbeat(ms: number) {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => void this.command('presence:heartbeat', {}).catch(() => undefined), ms);
  }
  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  disconnect() {
    this.stopHeartbeat();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.everConnected = false;
  }

  /** Reconexão manual (ex.: após retomar do modo de suspensão). */
  reconnectNow() {
    if (this.socket && !this.socket.connected) this.socket.connect();
  }

  private dedupe(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    this.seenOrder.push(eventId);
    if (this.seenOrder.length > 2000) this.seen.delete(this.seenOrder.shift() as string);
    return true;
  }

  on<N extends ServerEventName>(name: N, handler: (payload: ServerEvents[N]) => void): () => void {
    const s = this.socket;
    if (!s) throw new Error('realtime não conectado');
    const h = (env: EventEnvelope<ServerEvents[N]>) => {
      if (env?.eventId && !this.dedupe(`${name}:${env.eventId}`)) return;
      handler(env.payload);
    };
    s.on(name as string, h);
    return () => s.off(name as string, h);
  }

  async command<N extends ClientCommandName>(
    name: N,
    payload: ClientCommand<N>,
    timeoutMs = 8000,
  ): Promise<ClientCommandResults[N]> {
    const parsed = ClientCommands[name].safeParse(payload);
    if (!parsed.success) throw new Error(`payload inválido para ${name}`);
    const s = this.socket;
    if (!s?.connected) throw new Error('sem conexão');
    const ack = (await s.timeout(timeoutMs).emitWithAck(name, parsed.data)) as Ack<ClientCommandResults[N]>;
    if (!ack.ok) throw new Error(ack.error.message);
    return ack.data;
  }

  get connected() {
    return this.socket?.connected ?? false;
  }
}

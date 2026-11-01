/**
 * Controle remoto do PC de quem transmite (ADR-0026). Quem assiste pede; o dono do PC aceita ou recusa numa janela do
 * app (escolhendo "só o mouse" ou "mouse e teclado"); aceito, o mouse e o teclado de quem controla vão pela sala do
 * LiveKit (pacotes de dados, tópico `remote-control`, só para a outra pessoa) e o processo principal do dono os injeta
 * com o oc-input.exe. Nada passa pelo Socket.IO nem pela API. A identidade de quem manda vem da SFU (token assinado
 * pelo servidor): o PC controlado só aceita entrada da pessoa que ele mesmo autorizou, e só enquanto transmite a tela
 * inteira.
 */
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client';
import { z } from 'zod';
import { create } from 'zustand';
import {
  KeyCode,
  MouseButton,
  REMOTE_PANIC_LABEL,
  type RemoteInputEvent,
  type RemoteInputStop,
} from '../../electron/shared/remote-input';
import { askChoice } from '../components/AskDialog';
import { bridge } from '../lib/bridge';
import { useUi } from '../store/ui';

export const REMOTE_TOPIC = 'remote-control';
/** sem resposta do dono do PC nesse tempo, o pedido cai */
const REQUEST_TIMEOUT_MS = 60_000;
/** sem nenhum movimento ou tecla nesse tempo, o controle acaba sozinho */
const IDLE_MS = 10 * 60_000;
/** quem teve o pedido recusado espera antes de pedir de novo (contra insistência) */
const RETRY_AFTER_DENY_MS = 15_000;
const MAX_BYTES = 256;

const Pos = z.number().min(0).max(1);
const Wheel = z.number().int().min(-1200).max(1200);
export const DenyReason = z.enum(['refused', 'busy', 'window', 'scene', 'no-stream', 'platform', 'failed']);
export type DenyReason = z.infer<typeof DenyReason>;

export const RemoteMsg = z.discriminatedUnion('t', [
  // quem controla → dono do PC
  z.object({ t: z.literal('req') }),
  z.object({ t: z.literal('cancel') }),
  z.object({ t: z.literal('m'), x: Pos, y: Pos }),
  z.object({ t: z.literal('b'), b: MouseButton, d: z.boolean(), x: Pos, y: Pos }),
  z.object({ t: z.literal('w'), dx: Wheel, dy: Wheel }),
  z.object({ t: z.literal('k'), c: KeyCode, d: z.boolean() }),
  z.object({ t: z.literal('r') }),
  // dono do PC → quem controla
  z.object({ t: z.literal('grant'), kb: z.boolean() }),
  z.object({ t: z.literal('deny'), r: DenyReason }),
  // qualquer lado: acabou
  z.object({ t: z.literal('end') }),
]);
export type RemoteMsg = z.infer<typeof RemoteMsg>;
export type RemoteInputMsg = Extract<RemoteMsg, { t: 'm' | 'b' | 'w' | 'k' | 'r' }>;

/** Mensagem da sala → evento para o processo principal (só as de entrada). */
export function toInputEvent(m: RemoteMsg): RemoteInputEvent | null {
  switch (m.t) {
    case 'm':
      return { type: 'move', x: m.x, y: m.y };
    case 'b':
      return { type: 'button', button: m.b, down: m.d, x: m.x, y: m.y };
    case 'w':
      return { type: 'wheel', dx: m.dx, dy: m.dy };
    case 'k':
      return { type: 'key', code: m.c, down: m.d };
    case 'r':
      return { type: 'release' };
    default:
      return null;
  }
}

export function decodeRemoteMsg(payload: Uint8Array): RemoteMsg | null {
  if (payload.byteLength > MAX_BYTES) return null;
  try {
    const r = RemoteMsg.safeParse(JSON.parse(new TextDecoder().decode(payload)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** O que a própria live permite: só a tela inteira, sem cena (a posição do mouse precisa bater com a tela). */
export type HostCheck = () => { sourceId: string } | { reason: DenyReason };

interface Peer {
  identity: string;
  name: string;
}

export interface RemoteState {
  /** quem está controlando o meu PC (e se também pelo teclado) */
  controlledBy: (Peer & { kb: boolean }) | null;
  /** quem pediu e espera a minha resposta */
  pendingFrom: Peer | null;
  /** de quem eu pedi o controle e ainda não respondeu */
  requesting: Peer | null;
  /** de quem eu estou controlando o PC (e se também pelo teclado) */
  controlling: (Peer & { kb: boolean }) | null;
}

const EMPTY: RemoteState = { controlledBy: null, pendingFrom: null, requesting: null, controlling: null };
export const useRemote = create<RemoteState>(() => EMPTY);

const DENY_TEXT: Record<DenyReason, (name: string) => string> = {
  refused: (n) => `${n} recusou o pedido de controle.`,
  busy: (n) => `${n} já está sendo controlado (ou respondendo outro pedido).`,
  window: (n) => `Só dá para controlar quando ${n} transmite a tela inteira, não uma janela.`,
  scene: (n) => `Só dá para controlar quando ${n} transmite sem cena.`,
  'no-stream': (n) => `${n} não está transmitindo a tela.`,
  platform: (n) => `O computador de ${n} não aceita controle remoto (só Windows, com o app atualizado).`,
  failed: (n) => `Não deu para começar o controle no computador de ${n}.`,
};

const END_TEXT: Record<RemoteInputStop | 'local' | 'peer' | 'idle' | 'stream', (name: string) => string | null> = {
  panic: () => 'Controle remoto encerrado pelo atalho de emergência.',
  banner: () => null,
  exit: () => 'Controle remoto encerrado: o programa de entrada fechou.',
  local: () => null,
  peer: (n) => `${n} parou de controlar o seu computador.`,
  idle: () => 'Controle remoto encerrado: ficou 10 minutos sem uso.',
  stream: () => 'Controle remoto encerrado junto com a transmissão.',
};

const toast = (kind: 'info' | 'error', text: string) => useUi.getState().toast(kind, text);

export class RemoteControl {
  private readonly deniedAt = new Map<string, number>();
  private pendingAbort: AbortController | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastInput = 0;
  private readonly offBridge: (() => void) | null;

  constructor(
    private readonly room: Room,
    private readonly check: HostCheck,
  ) {
    room.on(RoomEvent.DataReceived, this.onData);
    room.on(RoomEvent.ParticipantDisconnected, this.onLeft);
    this.offBridge = bridge?.on('remote-input-stop', (reason) => this.stopHosting(reason)) ?? null;
  }

  dispose() {
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room.off(RoomEvent.ParticipantDisconnected, this.onLeft);
    this.offBridge?.();
    this.stopHosting('local');
    this.stopControlling(true);
    this.cancelRequest();
    useRemote.setState(EMPTY);
  }

  private name(identity: string) {
    return this.room.remoteParticipants.get(identity)?.name || 'Alguém';
  }

  private send(to: string, m: RemoteMsg, reliable = true) {
    if (!this.room.remoteParticipants.has(to)) return;
    void this.room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(m)), {
        reliable,
        topic: REMOTE_TOPIC,
        destinationIdentities: [to],
      })
      .catch(() => undefined);
  }

  private readonly onLeft = (p: RemoteParticipant) => this.peerGone(p.identity);

  /** a pessoa saiu da sala */
  private peerGone(identity: string) {
    const s = useRemote.getState();
    if (s.controlledBy?.identity === identity) this.stopHosting('peer');
    if (s.pendingFrom?.identity === identity) this.pendingAbort?.abort();
    if (s.requesting?.identity === identity) {
      this.cancelRequest();
      toast('info', `${s.requesting.name} saiu da chamada antes de responder.`);
    }
    if (s.controlling?.identity === identity) {
      this.stopControlling(false);
      toast('info', `${s.controlling.name} saiu da chamada; o controle acabou.`);
    }
  }

  private readonly onData = (payload: Uint8Array, p?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== REMOTE_TOPIC || !p) return;
    const m = decodeRemoteMsg(payload);
    if (!m) return;
    const from = p.identity;
    const s = useRemote.getState();
    switch (m.t) {
      case 'req':
        void this.onRequest(from);
        return;
      case 'cancel':
        if (s.pendingFrom?.identity === from) this.pendingAbort?.abort();
        return;
      case 'grant':
        if (s.requesting?.identity !== from) return;
        this.clearRequest();
        useRemote.setState({ requesting: null, controlling: { ...s.requesting, kb: m.kb } });
        toast(
          'info',
          `Você está controlando o computador de ${s.requesting.name}${m.kb ? '' : ' (só o mouse)'}. ${REMOTE_PANIC_LABEL} para parar.`,
        );
        return;
      case 'deny':
        if (s.requesting?.identity !== from) return;
        this.clearRequest();
        useRemote.setState({ requesting: null });
        if (m.r === 'refused') this.deniedAt.set(from, Date.now());
        toast('info', DENY_TEXT[m.r](s.requesting.name));
        return;
      case 'end':
        if (s.controlledBy?.identity === from) this.stopHosting('peer');
        if (s.controlling?.identity === from) {
          this.stopControlling(false);
          toast('info', `${s.controlling.name} encerrou o controle remoto.`);
        }
        return;
      default: {
        // entrada: só de quem eu autorizei, e teclado só se eu deixei
        if (s.controlledBy?.identity !== from) return;
        if (m.t === 'k' && !s.controlledBy.kb) return;
        const ev = toInputEvent(m);
        if (!ev) return;
        this.lastInput = Date.now();
        bridge?.remoteInput.send(ev);
      }
    }
  };

  // ---------- lado de quem é controlado ----------

  private async onRequest(from: string) {
    const s = useRemote.getState();
    if (s.controlledBy || s.pendingFrom) return this.send(from, { t: 'deny', r: 'busy' });
    if (!bridge || !(await bridge.remoteInput.available())) return this.send(from, { t: 'deny', r: 'platform' });
    const first = this.check();
    if ('reason' in first) return this.send(from, { t: 'deny', r: first.reason });
    const peer = { identity: from, name: this.name(from) };
    const abort = new AbortController();
    this.pendingAbort = abort;
    useRemote.setState({ pendingFrom: peer });
    // quem está jogando em tela cheia precisa ser avisado de que há um pedido esperando
    void bridge.flashFrame();
    void bridge.notify({ title: 'Pedido de controle remoto', body: `${peer.name} quer controlar o seu computador.` });
    const choice = await askChoice(
      `${peer.name} quer controlar o seu computador pela sua transmissão.\n\nEnquanto durar, aparece uma faixa no topo da tela com o botão "Parar", e ${REMOTE_PANIC_LABEL} encerra na hora. Janelas de administrador não recebem o controle.`,
      {
        title: 'Pedido de controle remoto',
        choices: [
          { id: 'mouse', label: 'Só o mouse' },
          { id: 'all', label: 'Mouse e teclado' },
        ],
        signal: abort.signal,
      },
    );
    if (this.pendingAbort !== abort) return;
    this.pendingAbort = null;
    useRemote.setState({ pendingFrom: null });
    if (!choice) return this.send(from, { t: 'deny', r: 'refused' });
    // a live pode ter mudado enquanto a pergunta estava aberta
    const now = this.check();
    if ('reason' in now) return this.send(from, { t: 'deny', r: now.reason });
    const ok = await bridge.remoteInput.start({ sourceId: now.sourceId, controller: peer.name });
    if (!ok) return this.send(from, { t: 'deny', r: 'failed' });
    if (!this.room.remoteParticipants.has(from)) {
      void bridge.remoteInput.stop();
      return;
    }
    const kb = choice === 'all';
    useRemote.setState({ controlledBy: { ...peer, kb } });
    this.lastInput = Date.now();
    this.idleTimer = setInterval(() => {
      if (Date.now() - this.lastInput > IDLE_MS) this.stopHosting('idle');
    }, 30_000);
    this.send(from, { t: 'grant', kb });
    toast('info', `${peer.name} está controlando o seu computador${kb ? '' : ' (só o mouse)'}.`);
  }

  /** Encerra o controle do meu PC (por qualquer motivo) e avisa quem controlava. */
  stopHosting(reason: RemoteInputStop | 'local' | 'peer' | 'idle' | 'stream') {
    const s = useRemote.getState();
    this.pendingAbort?.abort();
    this.pendingAbort = null;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    if (!s.controlledBy) return;
    useRemote.setState({ controlledBy: null, pendingFrom: null });
    if (reason !== 'peer') this.send(s.controlledBy.identity, { t: 'end' });
    // o processo principal já parou nos motivos que vêm dele (atalho, faixa, programa encerrado)
    if (reason === 'local' || reason === 'peer' || reason === 'idle' || reason === 'stream')
      void bridge?.remoteInput.stop().catch(() => undefined);
    const text = END_TEXT[reason](s.controlledBy.name);
    if (text) toast('info', text);
  }

  // ---------- lado de quem controla ----------

  /** Pede para controlar o PC de quem transmite; a resposta chega pela sala. */
  request(identity: string) {
    const s = useRemote.getState();
    if (s.requesting || s.controlling) return;
    const denied = this.deniedAt.get(identity);
    if (denied && Date.now() - denied < RETRY_AFTER_DENY_MS) {
      toast('info', 'Espere um pouco antes de pedir de novo.');
      return;
    }
    if (!this.room.remoteParticipants.has(identity)) return;
    useRemote.setState({ requesting: { identity, name: this.name(identity) } });
    this.send(identity, { t: 'req' });
    this.requestTimer = setTimeout(() => {
      const cur = useRemote.getState().requesting;
      if (cur?.identity !== identity) return;
      this.cancelRequest();
      toast('info', `${cur.name} não respondeu ao pedido de controle.`);
    }, REQUEST_TIMEOUT_MS);
  }

  private clearRequest() {
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }

  cancelRequest() {
    const r = useRemote.getState().requesting;
    this.clearRequest();
    if (!r) return;
    useRemote.setState({ requesting: null });
    this.send(r.identity, { t: 'cancel' });
  }

  /** Um evento do meu mouse/teclado para o PC controlado (movimentos podem se perder; o resto chega na ordem). */
  sendInput(m: RemoteInputMsg) {
    const c = useRemote.getState().controlling;
    if (!c) return;
    this.send(c.identity, m, m.t !== 'm');
  }

  stopControlling(notify: boolean) {
    const c = useRemote.getState().controlling;
    if (!c) return;
    useRemote.setState({ controlling: null });
    if (notify) this.send(c.identity, { t: 'end' });
  }
}

let current: RemoteControl | null = null;
/** Liga o controle remoto à sala recém-conectada (a store de voz chama a cada conexão). */
export function attachRemoteControl(room: Room, check: HostCheck) {
  current?.dispose();
  current = new RemoteControl(room, check);
}
export function detachRemoteControl() {
  current?.dispose();
  current = null;
}
export const remoteControl = () => current;

/**
 * Cena do Espaço 3D (ADR-0055), fora do React: renderizador, câmera em terceira pessoa, controles (WASD), avatares
 * dos outros (posições pela rede), voz pela distância e o telão (live como textura; YouTube em CSS 3D atrás do canvas).
 * No modo edição a câmera vira livre e o editor (editor.ts) recebe os cliques.
 */
import {
  DUEL_JAB_COOLDOWN_MS,
  DUEL_RING_R,
  DUEL_STRONG_COOLDOWN_MS,
  SPACE_TOGGLE_KINDS,
  SPACE_VOICE_FAR,
  spaceVoiceGain,
  type MatchPhase,
  type SpaceLayout,
  type SportZone,
} from '@opencord/contracts';
import { buildArenaDecor } from './arena3d';
import { GameBus, type GameEvent } from './events';
import { cancelHeld, InputBus } from './input';
import { Juice, type JuiceLabel } from './juice';
import { PoolPlay, type PoolMsg } from './pool';
import { buildPoolDecor } from './pooldecor';
import { buildRaceDecor, startGrid, stepBike, fireBoost, TRACK, type Bike } from './race';
import { attackHoop, clampToHalf, GOOD_BAND, netSideOf, type PoolSeat } from './rules';
import { sfx } from './sfx';
import { chargeStep } from './sfxmap';
import { SportPlay, type RemoteBall } from './sportplay';
import { ARENAS, GOAL_X, HOOP_X, RIM_Y, type BallState } from './sports';
import type { TutorialTarget } from './tutorial';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { peers, PEER_TIMEOUT_MS } from '../../store/space';
import { Avatar, SWING_A, SWING_MS, type Pose, type SwingA } from './avatar';
import { loadDoll } from './doll';
import { actionsOf, normalizeCode, useBindings, type Action } from './bindings';
import { findInteraction, standUpSpot, type Interaction } from './interact';
import { SCREEN_H, SCREEN_W, setItemOn } from './models';
import { obstaclesOf, PLAYER_R, resolve, type Obstacles } from './physics';
import { buildWorld, THEME_LOOK, type BuiltWorld } from './world';

export interface SceneParticipant {
  identity: string;
  name: string;
  speaking: boolean;
  isLocal: boolean;
}

export interface SceneHooks {
  /** volume da voz de alguém agora (0..1), para a boca do boneco */
  audioLevel?(identity: string): number;
  /** minha posição para a rede (~10x/s andando, 1x/s parado) */
  sendPose(p: Pose & { zone: number }): void;
  /** multiplicador da voz de cada um pela distância (null = normal) */
  setGain(identity: string, g: number | null): void;
  /** quadros por segundo atuais (para a dica de desempenho) */
  onFps?(fps: number): void;
  /** o que dá para fazer agora, com a tecla da ação (null = nada ao alcance); só aparece quando dá para fazer */
  onPrompt?(p: { label: string; action: 'interact' | 'primary' } | null): void;
  /** estado do jogo que não é ação (sinuca: "Sua vez", "Vez de Ana", "Bolas rolando…"); null = nada */
  onStatus?(text: string | null): void;
  /** atalho do placar segurado (true) ou solto (false) */
  onScoreboard?(held: boolean): void;
  /** atalho de começar partida / revanche */
  onRematch?(): void;
  /** interações que não são da cena: ligar/desligar (para todos), telão, música, desafiar */
  onAction?(i: Exclude<Interaction, { kind: 'sit' }>): void;
  /** x1: soco (o servidor decide se acertou) */
  onPunch?(strong: boolean): void;
  /** Interagir quando há um convite de x1 para mim: aceitar */
  onAcceptKey?(): boolean;
  /** esportes: estado da bola para a rede e ponto marcado */
  sendBall?(zone: SportZone, b: BallState & { held: string | null; t: number }): void;
  /** ponto marcado; `by` = quem marcou (eu, quando o ponto é do meu time); `teams` = quantos de cada time na arena */
  onScore?(zone: SportZone, side: 'a' | 'b', points: number, by?: string, teams?: { a: number; b: number }): void;
  /** carga do arremesso ou da tacada (0–1; null = sem carregar) e a faixa verde do basquete (null = sem faixa) */
  onCharge?(c: number | null, band?: { lo: number; hi: number } | null): void;
  /** x1: mira travada (cursor preso no centro) ou não */
  onAimLock?(locked: boolean): void;
  /** o sistema não deixou prender o mouse (o jogo segue com arrastar para olhar) */
  onLockFailed?(): void;
  /** sinuca: bolas e vez para a rede */
  sendPool?(m: PoolMsg): void;
  /** corrida: volta, item e turbo (para o painel) e a chegada (tempo de prova) */
  onRace?(s: { lap: number; item: boolean; boost: boolean; speed: number }): void;
  onRaceFinish?(ms: number): void;
  /** atalho "Mostrar os comandos" */
  onHelp?(): void;
  /** soltou o cursor pelo botão do meio: sem menu, só a faixa para voltar */
  onFreeCursor?(): void;
}

export interface FightState {
  duelId: string;
  opponentId: string;
  ring: { x: number; z: number };
  phase: 'countdown' | 'fighting';
}

export type ScreenSource = { kind: 'video'; el: HTMLVideoElement } | { kind: 'html'; el: HTMLElement } | null;

const WALK = 3.2;
const RUN = 6.2;
const JUMP_V = 5.2;
/** giro da câmera pelo teclado (rad/s) */
const TURN_SPEED = 2.4;
const GRAVITY = 15;
const YT_PX_W = 1280;
const YT_PX_H = 720;

export class SpaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  private css: CSS3DRenderer | null = null;
  private cssScene: THREE.Scene | null = null;
  private cssObj: CSS3DObject | null = null;
  world: BuiltWorld | null = null;
  layout: SpaceLayout | null = null;
  private obstacles: Obstacles | null = null;
  readonly me: Avatar;
  private pose: Pose = { x: 0, y: 0, z: 0, ry: Math.PI, a: 0 };
  private vy = 0;
  private waveUntil = 0;
  private readonly others = new Map<string, Avatar>();
  private participants: SceneParticipant[] = [];
  private keys = new Set<string>();
  /** câmera: ângulo em torno do alvo, inclinação e distância */
  yaw = 0;
  pitch = 0.32;
  dist = 5.5;
  /** modo edição: alvo livre da câmera */
  mode: 'play' | 'edit' = 'play';
  readonly focus = new THREE.Vector3();
  private raf = 0;
  private last = performance.now();
  private lastSend = 0;
  private lastSent: Pose | null = null;
  private lastGain = 0;
  private fpsFrames = 0;
  private fpsAt = performance.now();
  private readonly ray = new THREE.Raycaster();
  private screen: ScreenSource = null;
  private videoTex: THREE.VideoTexture | null = null;
  private readonly idleScreen = new THREE.MeshBasicMaterial({ color: 0x0b0d12 });
  private readonly hole = new THREE.MeshBasicMaterial({
    color: 0x000000,
    opacity: 0,
    transparent: true,
    blending: THREE.NoBlending,
  });
  private videoMat: THREE.MeshBasicMaterial | null = null;
  private disposed = false;
  private sitting: { itemId: string; seat: { x: number; y: number; z: number; ry: number } } | null = null;
  private toggles: Record<string, boolean> = {};
  private current: Interaction | null = null;
  private promptLabel: string | null = null;
  private statusLabel: string | null = null;
  private scoreboardHeld = false;
  private lastPrompt = 0;
  private fight: FightState | null = null;
  private rings = new Map<string, THREE.Group>();
  private punchUntil = 0;
  private punchKind = 0;
  private koUntil = 0;
  private readonly lastPunch = { j: 0, s: 0 };
  private clickStart: { x: number; y: number } | null = null;
  /** 0 = sala do servidor; 1–3 = arenas */
  zone: 0 | SportZone = 0;
  private mainLayout: SpaceLayout | null = null;
  private sport: SportPlay | null = null;
  /** efeitos do jogo (ADR-0056): som, partículas, faixa de ponto e tutorial se penduram aqui */
  readonly events = new GameBus();
  /** o que a pessoa fez com os controles (tutorial e dicas, plano 2026-11-09 P4) */
  readonly inputs = new InputBus();
  /** marcador do tutorial no mundo (anel no chão e seta por cima do alvo) */
  private marker: THREE.Group | null = null;
  private markerTarget: TutorialTarget | null = null;
  private wasHolding = false;
  private lookYaw = 0;
  /** visão livre (Alt segurado): a câmera gira em volta do boneco sem mudar a frente dele; solta, volta ao lugar */
  private freeYaw = 0;
  private freePitch = 0;
  private lookAcc = 0;
  /** "reduzir movimento" do sistema (lido de novo quando muda): sem tremor, sem balanço, efeitos pela metade */
  private readonly motionQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private reducedMotion = !!this.motionQuery?.matches;
  /** sensação de impacto (plano 2026-11-09, P5): pausa, partículas, brilho, tremor, comemoração e o texto do golpe */
  readonly juice: Juice;
  private readonly shakeOff = new THREE.Vector3();
  /** golpe de esporte que estou fazendo (estado `a` 10–13) */
  private swingA: SwingA = SWING_A.kick;
  private readonly raceFx: GameEvent[] = [];
  /** desliga o som dos eventos (sfx.ts) */
  private readonly sfxOff: () => void;
  /** passo da carga já tocado (0–10) e se já entrou na faixa verde */
  private chargeTick = -1;
  private inBand = false;
  /** corrida: posição anterior de cada piloto (velocidade do motor) e a pose anterior dos outros (soco) */
  private readonly riderPrev = new Map<string, { x: number; z: number; v: number }>();
  private readonly lastA = new Map<string, number>();
  private raceCount: number | null = null;
  private decor: THREE.Group | null = null;
  private lastCharge: number | null = null;
  private swingUntil = 0;
  pool: PoolPlay | null = null;
  private bike: Bike | null = null;
  private raceInfo: { localStart: number | null; laps: number } = { localStart: null, laps: 3 };
  private raceFinished = false;
  private lastRaceHud = '';
  /** meu time nas arenas */
  team: 'a' | 'b' = 'a';
  /** fase da partida da arena atual (null = jogo livre) */
  private matchPhase: MatchPhase | null = null;
  private readonly ro: ResizeObserver;
  /** editor: recebe os eventos do canvas quando mode === 'edit' */
  editorInput: {
    down(e: PointerEvent): boolean;
    move(e: PointerEvent): void;
    up(e: PointerEvent): void;
    key(e: KeyboardEvent): boolean;
  } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly selfId: string,
    selfName: string,
    private readonly hooks: SceneHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'space3d-canvas';
    host.append(this.renderer.domElement);
    // o boneco começa a carregar já (cada avatar aparece assim que o modelo chega)
    void loadDoll().catch(() => undefined);
    this.me = new Avatar(selfId, selfName);
    this.me.hideName();
    this.scene.add(this.me.root);
    this.juice = new Juice(this.scene, { motion: this.reducedMotion ? 0 : 1 });
    this.juice.attach(this.events);
    this.sfxOff = sfx.attach(this.events, () => ({ me: this.selfId, team: this.team }));
    this.motionQuery?.addEventListener?.('change', this.onMotionChange);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('mousemove', this.onAimMove);
    document.addEventListener('mousedown', this.onMouseDownDoc);
    document.addEventListener('mouseup', this.onMouseUpDoc);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.raf = requestAnimationFrame(this.frame);
  }

  private onMotionChange = () => {
    this.reducedMotion = !!this.motionQuery?.matches;
    this.juice.motion = this.reducedMotion ? 0 : 1;
  };

  // ---------- ambiente ----------
  /** ambiente do servidor (a sala); nas arenas fica guardado para a volta */
  setLayout(l: SpaceLayout, keepPosition: boolean) {
    this.mainLayout = l;
    if (this.zone === 0) this.applyLayout(l, keepPosition);
  }

  setTeam(t: 'a' | 'b') {
    const changed = t !== this.team;
    this.team = t;
    this.me.setTeam(this.zone && this.zone !== 7 ? t : null);
    this.lastSend = 0;
    // trocou de time numa quadra: vai para a metade do time novo (nos jogos de rede a rede é parede)
    if (changed && this.zone >= 1 && this.zone <= 5) {
      this.sport?.drop(performance.now());
      this.placeOnHalf(this.zone as SportZone, t);
    }
  }

  /** fase da partida da arena atual (do servidor); null = jogo livre */
  setMatch(phase: MatchPhase | null) {
    this.matchPhase = phase;
    this.sport?.setPhase(phase);
  }

  /** começa na própria metade, virado para o ataque (azul defende o lado −x) */
  private placeOnHalf(z: SportZone, team: 'a' | 'b') {
    const side = team === 'a' ? -1 : 1;
    const a = ARENAS[z];
    this.pose = {
      x: side * Math.min(6, a.layout.width / 4),
      y: 0,
      z: 0,
      ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      a: 0,
    };
    this.yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.me.place(this.pose);
  }

  /** quantos de cada time estão na minha arena agora (eu incluído): um lado vazio é treino */
  private teamsHere(): { a: number; b: number } {
    const out = { a: 0, b: 0 };
    out[this.team]++;
    const now = performance.now();
    for (const [id, p] of peers)
      if (id !== this.selfId && p.zone === this.zone && now - p.at < PEER_TIMEOUT_MS) out[p.team === 'b' ? 'b' : 'a']++;
    return out;
  }

  /** quem está na sinuca e o time de cada um (eu incluído) */
  private seatsHere(): PoolSeat[] {
    const now = performance.now();
    const seats: PoolSeat[] = [{ id: this.selfId, team: this.team }];
    for (const [id, p] of peers)
      if (id !== this.selfId && p.zone === 6 && now - p.at < PEER_TIMEOUT_MS)
        seats.push({ id, team: p.team === 'b' ? 'b' : 'a' });
    return seats;
  }

  /** tem adversário a menos de GOOD_BAND.contestR de mim */
  private contested(): boolean {
    const now = performance.now();
    for (const [id, p] of peers)
      if (
        id !== this.selfId &&
        p.zone === this.zone &&
        now - p.at < PEER_TIMEOUT_MS &&
        p.team !== undefined &&
        p.team !== this.team &&
        Math.hypot(p.x - this.pose.x, p.z - this.pose.z) < GOOD_BAND.contestR
      )
        return true;
    return false;
  }

  private nameOf(id: string): string {
    return this.participants.find((p) => p.identity === id)?.name ?? 'alguém';
  }

  /** vai para uma arena de esporte (1–3) ou volta para a sala (0) */
  setZone(z: 0 | SportZone, team: 'a' | 'b' = this.team) {
    if (z === this.zone) return;
    this.team = team;
    this.sport?.dispose();
    this.sport = null;
    this.pool?.dispose();
    this.pool = null;
    this.bike = null;
    this.me.setBike(false);
    if (this.decor) {
      this.scene.remove(this.decor);
      this.decor.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.decor = null;
    }
    this.zone = z;
    this.fight = null;
    this.sitting = null;
    this.wasHolding = false;
    this.lastCharge = null;
    this.hooks.onCharge?.(null);
    const l = z ? ARENAS[z].layout : this.mainLayout;
    if (l) this.applyLayout(l, false);
    this.me.setTeam(z && z !== 7 ? team : null);
    this.me.setRacket(racketOf(z));
    if (z === 6 || z === 7) {
      const a = ARENAS[z];
      this.pose = { x: 0, y: 0, z: z === 6 ? 1.6 : a.layout.depth / 2 - 2, ry: Math.PI, a: 0 };
      this.yaw = 0;
      this.me.place(this.pose);
      this.decor = z === 6 ? buildPoolDecor() : buildRaceDecor();
      this.scene.add(this.decor);
      if (z === 6)
        this.pool = new PoolPlay(this.scene, this.selfId, {
          send: (m) => this.hooks.sendPool?.(m),
          score: (side, points) =>
            this.hooks.onScore?.(6, side, points, side === this.team ? this.selfId : undefined, this.teamsHere()),
          emit: (e) => this.events.emit(e),
          alive: () => this.aliveHere(),
          players: () => this.seatsHere(),
          nameOf: (id) => this.nameOf(id),
        });
      else {
        this.bike = startGrid(this.gridSlot());
        this.me.setBike(true);
        this.raceFinished = false;
        this.raceCount = null;
      }
    } else if (z) {
      this.placeOnHalf(z, team);
      this.decor = buildArenaDecor(z);
      this.scene.add(this.decor);
      this.sport = new SportPlay(
        this.scene,
        z,
        this.selfId,
        {
          sendBall: (b) => this.hooks.sendBall?.(z, b),
          score: (side, points) =>
            this.hooks.onScore?.(z, side, points, side === this.team ? this.selfId : undefined, this.teamsHere()),
          emit: (e) => this.events.emit(e),
          alive: () => this.aliveHere(),
          team: () => this.team,
          teamOf: (id) => peers.get(id)?.team,
          poseOf: (id) => (id === this.selfId ? this.pose : (peers.get(id) ?? null)),
          contested: () => this.contested(),
        },
        (id) => this.handOf(id),
        (side) => this.servePos(side),
      );
      this.sport.setPhase(this.matchPhase);
    }
    this.juice.setZone(z);
    this.juice.setDecor(this.decor);
    this.juice.setBall(this.sport?.mesh ?? null);
    this.lastSend = 0;
    this.lastPrompt = 0;
  }

  /** quem está vivo na minha zona agora (eu e quem mandou posição há pouco), para a troca de autoridade */
  private aliveHere(): string[] {
    const now = performance.now();
    const ids = [this.selfId];
    for (const [id, p] of peers)
      if (id !== this.selfId && p.zone === this.zone && now - p.at < PEER_TIMEOUT_MS) ids.push(id);
    return ids;
  }

  /** sinuca: bolas que chegaram pela rede */
  remotePool(m: PoolMsg & { by: string }) {
    this.pool?.remote(m);
  }

  /** nova partida na arena atual (bola para a saída, mesa arrumada ou nova largada fica com o app) */
  newMatch() {
    const now = performance.now();
    this.sport?.resetMatch(now);
    this.pool?.rerack(now);
  }

  /** sinuca: arrumar a mesa de novo */
  rerack() {
    this.pool?.rerack(performance.now());
  }

  /** corrida: largada (no meu relógio) — uma largada nova põe a moto de volta no grid */
  setRace(localStart: number | null, laps: number) {
    const changed = localStart !== this.raceInfo.localStart;
    this.raceInfo = { localStart, laps };
    if (changed && this.zone === 7 && localStart !== null) {
      this.bike = startGrid(this.gridSlot());
      this.raceFinished = false;
      this.raceCount = null;
    }
  }

  /** posição no grid: ordem dos ids de quem está na pista (igual em todos os apps) */
  private gridSlot(): number {
    const ids = [this.selfId, ...[...peers.entries()].filter(([, p]) => p.zone === 7).map(([id]) => id)].sort();
    return Math.max(0, ids.indexOf(this.selfId));
  }

  private stepRace(dt: number, now: number) {
    const b = this.bike!;
    const start = this.raceInfo.localStart;
    const go = start !== null && Date.now() >= start && !this.raceFinished;
    // contagem 3-2-1 e "vai" (efeito)
    if (start !== null && !this.raceFinished) {
      const left = start - Date.now();
      const n = left > 0 ? Math.ceil(left / 1000) : 0;
      if (n !== this.raceCount && n <= 3) {
        const at = { x: b.x, y: 1, z: b.z };
        if (n > 0) this.events.emit({ kind: 'countdown', n, power: 0.6, zone: 7, at });
        else if (this.raceCount !== null) this.events.emit({ kind: 'go', power: 1, zone: 7, at });
        this.raceCount = n;
      }
    }
    this.raceFx.length = 0;
    const events = stepBike(
      b,
      {
        up: this.held('forward'),
        down: this.held('back'),
        left: this.held('left'),
        right: this.held('right'),
      },
      dt,
      Date.now(),
      go,
      this.raceFx,
    );
    for (const e of this.raceFx) {
      this.events.emit(e);
      if (e.kind === 'lap' && e.lap === this.raceInfo.laps - 1)
        this.events.emit({ kind: 'finalLap', power: 1, zone: 7, at: e.at });
    }
    for (const e of events)
      if (e.kind === 'lap' && start !== null && e.lap >= this.raceInfo.laps && !this.raceFinished) {
        this.raceFinished = true;
        const ms = Date.now() - start;
        this.events.emit({ kind: 'finish', ms, power: 1, zone: 7, at: { x: b.x, y: 0.5, z: b.z } });
        this.hooks.onRaceFinish?.(ms);
      }
    this.pose = { x: b.x, y: 0.45, z: b.z, ry: b.h, a: 5 };
    this.me.place(this.pose);
    this.me.spinWheels(b.v, dt);
    sfx.engine(this.selfId, b.v, undefined, Date.now() < b.boostUntil);
    // câmera de perseguição: atrás da moto, acompanhando a direção
    const want = b.h + Math.PI;
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 4);
    this.pitch = 0.28;
    this.dist = 6;
    const hud = {
      lap: Math.min(this.raceInfo.laps, b.lap + 1),
      item: b.item,
      boost: Date.now() < b.boostUntil,
      speed: Math.round(Math.abs(b.v) * 3.6),
    };
    const key = JSON.stringify(hud);
    if (key !== this.lastRaceHud) {
      this.lastRaceHud = key;
      this.hooks.onRace?.(hud);
    }
    this.maybeSend(now);
  }

  /** bola que chegou pela rede */
  remoteBall(b: RemoteBall & { zone: number }) {
    if (this.sport && b.zone === this.zone) this.sport.remote(b);
  }

  /** tênis: a bola do saque aparece na frente de quem está mais perto do fundo daquele lado */
  private servePos(side: 'a' | 'b'): { x: number; y: number; z: number } | null {
    const onSide = (x: number) => (side === 'a' ? x < -0.5 : x > 0.5);
    const now = performance.now();
    const cands: { x: number; z: number; ry: number }[] = [];
    if (onSide(this.pose.x)) cands.push(this.pose);
    for (const p of peers.values())
      if (p.zone === this.zone && now - p.at < PEER_TIMEOUT_MS && onSide(p.x)) cands.push(p);
    const baseX = (side === 'a' ? -1 : 1) * (this.zone ? (ARENAS[this.zone].serveX ?? 11) : 11);
    const who = cands.sort((a, b) => Math.abs(a.x - baseX) - Math.abs(b.x - baseX))[0];
    if (!who) return null;
    return { x: who.x + Math.sin(who.ry) * 0.7, y: 1.2, z: who.z + Math.cos(who.ry) * 0.7 };
  }

  /**
   * Mão de alguém (onde a bola fica quando a pessoa segura): parado, nas duas mãos na frente da barriga; andando,
   * quicando no chão ao lado da mão direita; carregando o arremesso, acima da cabeça.
   */
  private handOf(id: string): { x: number; y: number; z: number } | null {
    const p = id === this.selfId ? this.pose : peers.get(id);
    if (!p) return null;
    const fx = Math.sin(p.ry);
    const fz = Math.cos(p.ry);
    if (id === this.selfId && this.sport?.charging != null)
      return { x: p.x + fx * 0.14, y: p.y + 1.45, z: p.z + fz * 0.14 };
    if (p.a === 1 || p.a === 2) {
      const ph = Math.abs(Math.sin((performance.now() / 1000) * (p.a === 2 ? 9 : 7)));
      return {
        x: p.x + fx * 0.38 - fz * 0.16,
        y: p.y + 0.14 + ph * 0.5,
        z: p.z + fz * 0.38 + fx * 0.16,
      };
    }
    return { x: p.x + fx * 0.3, y: p.y + 0.76, z: p.z + fz * 0.3 };
  }

  /** os braços de quem está com a bola vão até ela */
  private holdOf(id: string, av: Avatar) {
    const h = this.sport && this.sport.holder === id ? this.handOf(id) : null;
    if (!h) return av.setHold(null);
    const p = id === this.selfId ? this.pose : peers.get(id);
    const dribbling = !!p && (p.a === 1 || p.a === 2) && !(id === this.selfId && this.sport?.charging != null);
    // quicando, a mão fica na altura em que a bola sobe (não vai até o chão)
    av.setHold(new THREE.Vector3(h.x, dribbling ? Math.max(h.y, (p?.y ?? 0) + 0.55) : h.y, h.z), !dribbling);
  }

  private applyLayout(l: SpaceLayout, keepPosition: boolean) {
    const first = !this.layout;
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.layout = l;
    this.world = buildWorld(l);
    this.scene.add(this.world.group);
    this.obstacles = obstaclesOf(l);
    const look = THEME_LOOK[l.theme];
    this.scene.background = new THREE.Color(look.sky);
    this.scene.fog = new THREE.Fog(look.fog, look.fogNear, look.fogFar);
    if (first || !keepPosition) {
      const p = resolve(this.obstacles, l.spawn.x, l.spawn.z);
      this.pose = { x: p.x, y: 0, z: p.z, ry: Math.PI, a: 0 };
      this.yaw = 0;
      this.focus.set(0, 0, 0);
    } else {
      const p = resolve(this.obstacles, this.pose.x, this.pose.z);
      this.pose.x = p.x;
      this.pose.z = p.z;
    }
    if (this.sitting && !l.items.some((i) => i.id === this.sitting?.itemId)) this.sitting = null;
    this.me.place(this.pose);
    this.applyScreen();
    this.applyCutaway();
    this.applyToggles();
  }

  // ---------- peças que ligam/desligam ----------
  setToggles(t: Record<string, boolean>) {
    this.toggles = t;
    this.applyToggles();
    this.lastPrompt = 0;
  }

  private applyToggles() {
    const w = this.world;
    const l = this.layout;
    if (!w || !l) return;
    for (const it of l.items) {
      if (!(SPACE_TOGGLE_KINDS as readonly string[]).includes(it.kind)) continue;
      const g = w.items.get(it.id);
      if (g) setItemOn(g, this.toggles[it.id] ?? true);
    }
  }

  // ---------- x1 ----------
  setFight(f: FightState | null) {
    if (f && !this.fight) {
      this.sitting = null;
      // por cima do ombro, mais perto
      this.dist = 3.4;
      this.pitch = 0.18;
    }
    if (!f && this.fight) {
      this.dist = 5.5;
      this.pitch = 0.32;
    }
    this.fight = f;

    this.lastPrompt = 0;
  }

  /** x1: o mouse gira a câmera com o cursor preso (mira no centro) */
  get aimLocked() {
    return document.pointerLockElement === this.renderer.domElement;
  }

  private onLockChange = () => {
    if (this.aimLocked) this.lockFails = 0;
    // soltou (Esc): nada fica "segurado", nem a carga do arremesso ou da tacada
    if (!this.aimLocked) this.cancelHeld();
    this.hooks.onAimLock?.(this.aimLocked);
  };

  private onAimMove = (e: MouseEvent) => {
    if (!this.aimLocked) return;
    if (this.freeLooking) {
      this.lookAround(e.movementX * 0.0026, e.movementY * 0.002);
      return;
    }
    this.yaw -= e.movementX * 0.0026;
    this.pitch = this.fight
      ? Math.max(-0.25, Math.min(0.7, this.pitch + e.movementY * 0.002))
      : Math.max(-0.15, Math.min(1.35, this.pitch + e.movementY * 0.002));
  };

  /** ringues das lutas em andamento na chamada (todos veem) */
  setRings(list: { id: string; x: number; z: number }[]) {
    const want = new Set(list.map((r) => r.id));
    for (const [id, g] of this.rings)
      if (!want.has(id)) {
        this.scene.remove(g);
        g.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
        this.rings.delete(id);
      }
    for (const r of list) {
      if (this.rings.has(r.id)) continue;
      const g = ringMesh();
      g.position.set(r.x, 0, r.z);
      this.scene.add(g);
      this.rings.set(r.id, g);
    }
  }

  /** alguém levou um golpe (efeito); `blocked` = defendeu */
  hit(userId: string, blocked = false) {
    const av = userId === this.selfId ? this.me : this.others.get(userId);
    av?.hitReact();
    // o corpo de quem levou acende por um instante
    this.juice.flash(av?.material, 110, performance.now());
    const p = userId === this.selfId ? this.pose : peers.get(userId);
    if (p)
      this.events.emit({
        kind: 'punch',
        by: null,
        strong: false,
        landed: true,
        blocked,
        power: blocked ? 0.4 : 0.7,
        zone: this.zone,
        at: { x: p.x, y: p.y + 1.3, z: p.z },
      });
  }

  /** perdi por nocaute: fico no chão um pouco */
  knockout(ms = 3500) {
    this.koUntil = performance.now() + ms;
    const p = this.pose;
    this.events.emit({ kind: 'ko', who: this.selfId, power: 1, zone: this.zone, at: { x: p.x, y: p.y + 1, z: p.z } });
  }

  private punch(strong: boolean) {
    const f = this.fight;
    if (!f || f.phase !== 'fighting' || this.blocking) return;
    const now = performance.now();
    const k = strong ? 's' : 'j';
    if (now - this.lastPunch[k] < (strong ? DUEL_STRONG_COOLDOWN_MS : DUEL_JAB_COOLDOWN_MS)) return;
    this.lastPunch[k] = now;
    this.punchKind = strong ? 7 : 6;
    this.punchUntil = now + (strong ? 400 : 250);
    this.pose.a = this.punchKind;
    // a pose do soco sai antes do golpe (o servidor confere a posição e a mira)
    this.lastSend = 0;
    this.maybeSend(now);
    this.hooks.onPunch?.(strong);
    const p = this.pose;
    this.events.emit({
      kind: 'punch',
      by: this.selfId,
      strong,
      landed: false,
      power: strong ? 1 : 0.5,
      zone: this.zone,
      at: { x: p.x + Math.sin(p.ry) * 0.5, y: p.y + 1.3, z: p.z + Math.cos(p.ry) * 0.5 },
    });
  }

  // ---------- interação (atalho Interagir) ----------
  /** executa o que o aviso mostra: sentar/levantar aqui; o resto vai para o app */
  interact() {
    if (this.mode !== 'play') return;
    if (this.hooks.onAcceptKey?.()) return;
    if (this.fight) return;
    if (this.sitting) {
      this.standUp();
      return;
    }
    const i = this.current;
    if (!i) return;
    if (i.kind === 'sit') {
      this.sitting = { itemId: i.itemId, seat: i.seat };
      this.vy = 0;
      this.lastPrompt = 0;
      return;
    }
    this.hooks.onAction?.(i);
  }

  private standUp() {
    const st = this.sitting;
    if (!st) return;
    this.sitting = null;
    const spot = standUpSpot(st.seat);
    const p = this.obstacles ? resolve(this.obstacles, spot.x, spot.z) : spot;
    this.pose = { x: p.x, y: 0, z: p.z, ry: st.seat.ry, a: 0 };
    this.lastPrompt = 0;
  }

  private updatePrompt(now: number) {
    if (now - this.lastPrompt < 150) return;
    this.lastPrompt = now;
    const l = this.layout;
    let label: string | null = null;
    let action: 'interact' | 'primary' = 'interact';
    let status: string | null = null;
    if (this.mode !== 'play' || !l) this.current = null;
    else if (this.sport) {
      this.current = null;
      const sp = this.sport.prompt();
      label = sp?.label ?? null;
      if (sp) action = sp.action;
    } else if (this.pool) {
      // estado (de quem é a vez, bolas rolando) vai para o selo; o aviso só aparece quando dá para tacar
      this.current = null;
      label = this.pool.canShoot(this.team) ? this.pool.prompt(this.team) : null;
      status = this.pool.status(this.team);
      action = 'primary';
    } else if (this.bike) {
      this.current = null;
      label = this.bike.item ? 'Usar turbo' : null;
      action = 'primary';
    } else if (this.fight) this.current = null;
    else if (this.sitting) {
      this.current = null;
      label = 'Levantar';
    } else {
      const occupied = [...peers.values()].filter((p) => p.a === 5);
      this.current = findInteraction(l, this.pose, occupied, this.toggles);
      // alguém bem perto: desafiar para um x1 (ganha da peça)
      let near: { id: string; d: number } | null = null;
      for (const [id, p] of peers) {
        if (now - p.at > PEER_TIMEOUT_MS || p.a === 5 || p.a === 9 || p.zone !== this.zone) continue;
        const d = Math.hypot(p.x - this.pose.x, p.z - this.pose.z);
        if (d <= 1.8 && (!near || d < near.d)) near = { id, d };
      }
      if (near) {
        const who = near.id;
        const name = this.participants.find((x) => x.identity === who)?.name ?? 'alguém';
        this.current = { kind: 'duel', itemId: who, label: `Desafiar ${name} para um x1` };
      }
      label = this.current?.label ?? null;
    }
    const key = label ? `${action}:${label}` : null;
    if (key !== this.promptLabel) {
      this.promptLabel = key;
      this.hooks.onPrompt?.(label ? { label, action } : null);
      if (label) this.inputs.emit({ kind: 'ready', action });
    }
    if (status !== this.statusLabel) {
      this.statusLabel = status;
      this.hooks.onStatus?.(status);
    }
  }

  /** no editor as paredes baixam (como no The Sims) para enxergar a sala inteira */
  private applyCutaway() {
    for (const w of this.world?.walls ?? []) {
      const low = this.mode === 'edit';
      w.scale.y = low ? Math.min(1, 0.35 / Math.max(0.35, (w.geometry as THREE.BoxGeometry).parameters.height)) : 1;
      w.position.y = ((w.geometry as THREE.BoxGeometry).parameters.height * w.scale.y) / 2;
    }
  }

  // ---------- pessoas ----------
  setParticipants(list: SceneParticipant[]) {
    this.participants = list;
    const mine = list.find((p) => p.isLocal);
    this.me.setSpeaking(!!mine?.speaking);
  }

  // ---------- telão ----------
  setScreen(src: ScreenSource) {
    if (this.screen === src) return;
    this.screen = src;
    this.applyScreen();
  }

  private applyScreen() {
    if (!this.world) return;
    const screens = this.world.screens;
    this.videoTex?.dispose();
    this.videoTex = null;
    this.videoMat?.dispose();
    this.videoMat = null;
    this.removeCss();
    const src = this.screen;
    if (src?.kind === 'video') {
      this.videoTex = new THREE.VideoTexture(src.el);
      this.videoTex.colorSpace = THREE.SRGBColorSpace;
      this.videoMat = new THREE.MeshBasicMaterial({ map: this.videoTex, toneMapped: false });
      for (const s of screens) s.mesh.material = this.videoMat;
      return;
    }
    for (const s of screens) s.mesh.material = this.idleScreen;
    const main = screens.find((s) => s.kind === 'screen') ?? screens[0];
    if (src?.kind === 'html' && main) {
      // YouTube não pode virar textura (origem diferente): fica num plano CSS 3D atrás do canvas, que abre um
      // "buraco" transparente no lugar da tela; quem passa na frente continua cobrindo o vídeo
      if (!this.css) {
        this.css = new CSS3DRenderer();
        this.css.domElement.className = 'space3d-css';
        this.host.prepend(this.css.domElement);
        this.resize();
      }
      this.cssScene = new THREE.Scene();
      src.el.style.width = `${YT_PX_W}px`;
      src.el.style.height = `${YT_PX_H}px`;
      const obj = new CSS3DObject(src.el);
      main.mesh.updateWorldMatrix(true, false);
      main.mesh.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
      const k = main.kind === 'screen' ? SCREEN_W / YT_PX_W : 1.32 / YT_PX_W;
      obj.scale.set(k, (main.kind === 'screen' ? SCREEN_H : 0.74) / YT_PX_H, 1);
      this.cssScene.add(obj);
      this.cssObj = obj;
      main.mesh.material = this.hole;
    }
  }

  private removeCss() {
    if (this.cssObj) {
      this.cssObj.element.remove();
      this.cssScene?.remove(this.cssObj);
      this.cssObj = null;
    }
  }

  // ---------- entrada ----------
  private bindInput() {
    const el = this.host;
    el.tabIndex = 0;
    el.addEventListener('keydown', this.onKeyDown);
    el.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('blur', this.onBlur);
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContextMenu);
  }

  private drag: { id: number; x: number; y: number; button: number; editor: boolean } | null = null;

  /** defesa no x1: segurar Shift (ou L) */
  private get blocking() {
    return this.held('secondary');
  }

  /** ação segurada agora (tecla ou botão do mouse escolhido; as setas sempre andam) */
  private held(a: Action): boolean {
    const code = useBindings.getState().map[a];
    if (this.keys.has(code)) return true;
    const arrow = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as Partial<
      Record<Action, string>
    >;
    return !!arrow[a] && this.keys.has(arrow[a]);
  }

  /** tecla ou botão apertado (código já normalizado: `KeyW`, `Shift`, `Mouse0`…) */
  private press(code: string, repeat: boolean) {
    this.keys.add(code);
    if (this.mode !== 'play' || repeat) return;
    const now = performance.now();
    const arrow = ARROW_ACTION[code];
    if (arrow) this.inputs.emit({ kind: 'press', action: arrow });
    for (const a of actionsOf(code)) {
      this.inputs.emit({ kind: 'press', action: a });
      if (a === 'jump') {
        if (this.sitting) this.standUp();
        else if (this.pose.y <= 0.001 && !this.bike) this.vy = JUMP_V;
      } else if (a === 'wave') this.waveUntil = now + 2200;
      else if (a === 'interact') {
        // nas arenas, interagir só pega a bola (basquete); bater, tacar e turbo são a "ação"
        if (this.sport || this.pool || this.bike) {
          if (this.sport?.zone === 1 && !this.sport.holding) this.sport.press(now);
        } else this.interact();
      } else if (a === 'primary') this.primaryDown(now);
      else if (a === 'scoreboard') this.showScoreboard(true);
      else if (a === 'rematch') this.hooks.onRematch?.();
      else if (a === 'help') this.hooks.onHelp?.();
      else if (a === 'cursor') this.freeCursor();
    }
  }

  private release(code: string) {
    this.keys.delete(code);
    const acts = actionsOf(code);
    if (acts.includes('primary')) this.primaryUp(performance.now());
    if (acts.includes('scoreboard')) this.showScoreboard(false);
  }

  /** placar segurado (Tab por padrão): aparece enquanto segura */
  private showScoreboard(on: boolean) {
    if (on === this.scoreboardHeld) return;
    this.scoreboardHeld = on;
    this.hooks.onScoreboard?.(on);
  }

  /** Q/E (configuráveis) giram a câmera pelo teclado, como em todo jogo em 3ª pessoa; na moto a câmera segue a pista */
  private turnCamera(dt: number) {
    if (this.mode !== 'play' || this.bike) return;
    const t = (this.held('turnLeft') ? 1 : 0) - (this.held('turnRight') ? 1 : 0);
    if (t) this.yaw += t * TURN_SPEED * dt;
  }

  /** botões do mouse segurados (com o mouse preso na visão) */
  private leftHeld = false;
  private leftAt = 0;

  /** o sistema recusou prender o mouse: a câmera gira arrastando e os cliques vão direto (sem trava) */
  noLock = false;

  /** o último pedido de trava veio de um clique (só aí uma recusa significa "o sistema não deixa") */
  private lockByGesture = false;

  /** recusas seguidas a pedidos feitos por clique */
  private lockFails = 0;

  private onLockError = () => {
    if (this.noLock || !this.lockByGesture) return;
    // uma recusa sozinha é comum (clicar logo depois de soltar com Esc: o navegador pede ~1 s de espera); só depois de
    // várias seguidas é que o sistema realmente não deixa e o jogo passa a arrastar para olhar
    if (++this.lockFails < 3) return;
    this.noLock = true;
    this.hooks.onLockFailed?.();
  };

  /** quantas pessoas há em cada jogo agora (zona → quantidade, contando comigo) */
  zoneCounts(): Record<number, number> {
    const now = performance.now();
    const c: Record<number, number> = { [this.zone]: 1 };
    const inCall = new Set(this.participants.map((p) => p.identity));
    for (const [id, p] of peers) {
      if (id === this.selfId || !inCall.has(id) || now - p.at > PEER_TIMEOUT_MS) continue;
      c[p.zone] = (c[p.zone] ?? 0) + 1;
    }
    return c;
  }

  /** botão do meio (configurável): solta o cursor sem abrir o menu; clicar na cena (ou o botão do meio) prende de novo */
  private freeCursor() {
    if (!this.aimLocked) return;
    this.cancelHeld();
    this.hooks.onFreeCursor?.();
  }

  /** tenta de novo prender o mouse depois de ter desistido (Continuar na pausa) */
  retryLock() {
    this.noLock = false;
    this.lockFails = 0;
    this.lockPointer(true);
  }

  /** prende o mouse na visão (mexer o mouse gira a câmera, sem clicar); Esc solta */
  lockPointer(byGesture = true) {
    if (this.mode !== 'play' || this.aimLocked || this.noLock) return;
    this.lockByGesture = byGesture;
    try {
      const r = this.renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      void r?.catch?.(() => this.onLockError());
    } catch {
      /* sem gesto do usuário: o aviso "clique para jogar" pede o clique */
    }
  }

  private mouseDown(button: number) {
    this.press(`Mouse${button}`, false);
  }

  private mouseUp(button: number) {
    this.release(`Mouse${button}`);
  }

  /** a "ação" (por padrão o botão esquerdo): bater, chutar, tacar, arremessar, turbo; no x1 começa o soco */
  private primaryDown(now: number) {
    this.leftHeld = true;
    this.leftAt = now;
    if (this.bike) {
      if (fireBoost(this.bike, Date.now()))
        this.events.emit({
          kind: 'boost',
          source: 'item',
          power: 1,
          zone: 7,
          at: { x: this.bike.x, y: 0.5, z: this.bike.z },
        });
    } else if (this.pool) this.pool.press(this.team);
    else if (this.sport) this.sportPress(now);
  }

  /**
   * A ação nos esportes: o golpe sai sempre na hora (chute, raquetada de direita/esquerda pelo lado da bola, manchete),
   * acertando ou não; nos jogos de rede, o resultado ("Perfeito!", "Cedo", "Tarde", "Longe") aparece junto do boneco.
   */
  private sportPress(now: number) {
    const sport = this.sport;
    if (!sport) return;
    const r = sport.press(now);
    const z = sport.zone;
    if (z === 1) return;
    if (z === 2) this.swingA = SWING_A.kick;
    else if (z === 4) this.swingA = SWING_A.bump;
    else {
      // bola à direita do boneco = direita (forehand); à esquerda = esquerda (backhand)
      const b = sport.mesh.position;
      const right = (b.x - this.pose.x) * -Math.cos(this.pose.ry) + (b.z - this.pose.z) * Math.sin(this.pose.ry);
      this.swingA = right >= 0 ? SWING_A.forehand : SWING_A.backhand;
    }
    this.swingUntil = now + SWING_MS[this.swingA];
    this.me.strike();
    // a pose do golpe sai na hora para os outros também
    this.pose.a = this.swingA;
    this.lastSend = 0;
    if (z >= 3 && this.matchPhase !== 'countdown') {
      const label: JuiceLabel | null = r.result === 'whiff' ? 'whiff' : (r.quality ?? null);
      if (label) this.showResult(label);
    }
  }

  /** texto do resultado acima da cabeça do meu boneco */
  private showResult(label: JuiceLabel) {
    const p = this.pose;
    this.juice.label(label, { x: p.x, y: p.y + 1.75, z: p.z }, performance.now());
  }

  private primaryUp(now: number) {
    if (!this.leftHeld) return;
    this.leftHeld = false;
    // x1: clique rápido = soco rápido; segurar e soltar = soco forte
    if (this.fight) this.punch(now - this.leftAt >= 350);
    else if (this.pool) this.pool.release(now, this.team, Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw)));
    else if (this.sport) {
      const c = this.sport.charging;
      const band = this.sport.band();
      if (c !== null && band) this.inputs.emit({ kind: 'shot', good: c >= band.lo && c <= band.hi });
      const q = this.sport.release(now);
      if (q) this.showResult(q);
    }
  }

  private onMouseDownDoc = (e: MouseEvent) => {
    if (!this.aimLocked || this.mode !== 'play') return;
    e.preventDefault();
    this.mouseDown(e.button);
  };

  private onMouseUpDoc = (e: MouseEvent) => {
    if (!this.aimLocked) return;
    this.mouseUp(e.button);
  };

  private onPointerDown = (e: PointerEvent) => {
    this.host.focus({ preventScroll: true });
    // gesto: o som do jogo pode começar (o navegador não deixa antes)
    sfx.unlock();
    if (this.mode === 'play') {
      // jogando, o mouse fica preso na visão: o clique solto (sem trava) só prende de novo; com a trava, os botões
      // chegam por mousedown/mouseup no documento (onMouseDownDoc). Sem preventDefault aqui: cancelar o pointerdown
      // faz o navegador não gerar o mousedown, e os cliques do jogo não chegariam.
      if (this.noLock) {
        // sem trava: o clique já é o botão do jogo, e arrastar gira a câmera
        this.press(`Mouse${e.button}`, false);
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, editor: false };
        this.renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
      // botão do meio solto: sem a rolagem automática do Windows
      if (e.button === 1) e.preventDefault();
      if (!this.aimLocked) this.lockPointer();
      return;
    }
    if (this.mode === 'edit' && e.button === 0 && this.editorInput?.down(e)) {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: 0, editor: true };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, editor: false };
    this.clickStart = { x: e.clientX, y: e.clientY };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) {
      if (this.mode === 'edit') this.editorInput?.move(e);
      return;
    }
    if (this.drag.editor) {
      this.editorInput?.move(e);
      return;
    }
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.mode === 'edit' && (this.drag.button === 2 || this.drag.button === 1)) {
      // arrastar com o botão direito no editor: move a câmera pelo chão
      // "pegar e puxar" o chão: direita = (cos, -sin), frente = (-sin, -cos)
      const k = this.dist * 0.0022;
      this.focus.x += (-dx * Math.cos(this.yaw) - dy * Math.sin(this.yaw)) * k;
      this.focus.z += (dx * Math.sin(this.yaw) - dy * Math.cos(this.yaw)) * k;
      this.clampFocus();
      return;
    }
    if (this.freeLooking) {
      this.lookAround(dx * 0.006, dy * 0.004);
      return;
    }
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-0.15, Math.min(1.35, this.pitch + dy * 0.004));
  };

  /** Alt (configurável) segurado jogando: visão livre */
  private get freeLooking() {
    return this.mode === 'play' && this.held('freeLook');
  }

  private lookAround(dx: number, dy: number) {
    // até meia volta para cada lado (olhar para trás) e sem passar do chão nem do alto
    this.freeYaw = Math.max(-Math.PI, Math.min(Math.PI, this.freeYaw - dx));
    this.freePitch = Math.max(-0.15 - this.pitch, Math.min(1.35 - this.pitch, this.freePitch + dy));
  }

  /** soltou o Alt: a câmera volta para trás do boneco */
  private settleFreeLook(dt: number) {
    if (this.freeLooking || (this.freeYaw === 0 && this.freePitch === 0)) return;
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 12);
    this.freeYaw -= this.freeYaw * k;
    this.freePitch -= this.freePitch * k;
    if (Math.abs(this.freeYaw) < 0.002 && Math.abs(this.freePitch) < 0.002) this.freeYaw = this.freePitch = 0;
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.noLock && this.mode === 'play') this.release(`Mouse${e.button}`);
    if (this.drag?.editor) this.editorInput?.up(e);
    this.clickStart = null;
    this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const max = this.mode === 'edit' ? 45 : 12;
    this.dist = Math.max(2.2, Math.min(max, this.dist * (1 + Math.sign(e.deltaY) * 0.12)));
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    sfx.unlock();
    if (e.target !== this.host) return;
    if (this.mode === 'edit' && this.editorInput?.key(e)) {
      e.preventDefault();
      return;
    }
    // atalhos escolhidos pela pessoa (menu de pausa); Esc fica com o navegador (solta o mouse e pausa)
    const code = normalizeCode(e.code);
    if (code === 'Escape') return;
    const bound = actionsOf(code).length > 0 || code.startsWith('Arrow') || (this.mode === 'edit' && code === 'Shift');
    if (!bound) return;
    e.preventDefault();
    this.press(code, e.repeat);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.release(normalizeCode(e.code));
  };

  private onBlur = () => this.cancelHeld();

  /** nada fica segurado (Esc, outra janela, aba escondida): teclas, botão e a carga do jogo (ADR-0056) */
  private cancelHeld() {
    this.leftHeld = false;
    this.showScoreboard(false);
    cancelHeld(this.keys, [this.sport, this.pool]);
    if (this.lastCharge !== null) {
      this.lastCharge = null;
      this.hooks.onCharge?.(null);
    }
  }

  private onVisibility = () => {
    if (document.hidden) {
      // o laço para com a aba escondida: solto a bola da mão (senão ela congela para os outros) e, calado, a
      // autoridade passa para quem ficou (net/authority.ts)
      this.cancelHeld();
      this.sport?.drop(performance.now());
      // sem quadros, o motor da moto não teria quem o desligasse
      sfx.stopEngines();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf && !this.disposed) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  setMode(m: 'play' | 'edit') {
    if (this.mode === m) return;
    this.mode = m;
    this.keys.clear();
    // editar usa o cursor (arrastar peças); voltar a jogar prende o mouse de novo
    if (m === 'edit' && this.aimLocked) document.exitPointerLock();
    this.applyCutaway();
    this.sitting = null;
    this.lastPrompt = 0;
    this.updatePrompt(performance.now());
    if (m === 'edit') {
      this.focus.set(this.pose.x, 0, this.pose.z);
      this.dist = Math.max(14, this.dist);
      this.pitch = 0.9;
      this.me.root.visible = true;
    } else {
      this.dist = 5.5;
      this.pitch = 0.32;
    }
  }

  private clampFocus() {
    const l = this.layout;
    if (!l) return;
    this.focus.x = Math.max(-l.width / 2, Math.min(l.width / 2, this.focus.x));
    this.focus.z = Math.max(-l.depth / 2, Math.min(l.depth / 2, this.focus.z));
  }

  /** ponto do chão sob o cursor (editor) */
  floorPoint(e: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  /** objetos sob o cursor (editor) */
  pick(e: PointerEvent, targets: THREE.Object3D[]): THREE.Intersection[] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.intersectObjects(targets, true);
  }

  // ---------- quadro ----------
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    // pausa de impacto: o jogo (bola, bonecos, andar) para por alguns ms; câmera, efeitos e golpes continuam
    const gdt = this.mode === 'play' ? dt * this.juice.timeScale(now) : dt;
    if (this.mode === 'play') this.stepPlayer(gdt, now);
    else this.stepEditorCamera(dt);
    this.me.setVoiceLevel(this.hooks.audioLevel?.(this.selfId) ?? 0);
    this.holdOf(this.selfId, this.me);
    this.me.update(gdt, t, dt);
    this.stepOthers(gdt, t, now, dt);
    this.juice.update(dt, now);
    this.trackLook();
    this.placeMarker(t);
    this.placeCamera();
    sfx.listen({ x: this.pose.x, z: this.pose.z, yaw: this.yaw, zone: this.zone });
    if (now - this.lastGain > 200) {
      this.lastGain = now;
      this.updateGains();
    }
    this.renderer.render(this.scene, this.camera);
    if (this.css && this.cssScene) this.css.render(this.cssScene, this.camera);
    this.fpsFrames++;
    if (now - this.fpsAt > 2000) {
      this.hooks.onFps?.((this.fpsFrames * 1000) / (now - this.fpsAt));
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
  };

  private stepPlayer(dt: number, now: number) {
    this.turnCamera(dt);
    this.settleFreeLook(dt);
    let fx = 0;
    let fz = 0;
    if (this.held('forward')) fz += 1;
    if (this.held('back')) fz -= 1;
    if (this.held('right')) fx += 1;
    if (this.held('left')) fx -= 1;
    if (this.bike) {
      this.stepRace(dt, now);
      return;
    }
    if (now < this.koUntil) {
      this.pose.a = 9;
      this.pose.y = 0;
      this.me.place(this.pose);
      this.updatePrompt(now);
      this.maybeSend(now);
      return;
    }
    const moving = fx !== 0 || fz !== 0;
    // correr: segurar o botão direito (no x1 o direito é defender)
    const run = this.held('run') && !this.fight;
    if (this.sitting) {
      if (!moving) {
        // sentado: fica no assento, virado para a frente da peça
        const st = this.sitting.seat;
        this.pose = { x: st.x, y: Math.max(0, st.y - 0.14), z: st.z, ry: st.ry, a: 5 };
        this.me.place(this.pose);
        this.updatePrompt(now);
        this.maybeSend(now);
        return;
      }
      this.standUp();
    }
    if (moving) {
      const len = Math.hypot(fx, fz);
      fx /= len;
      fz /= len;
      // frente = da câmera para o avatar; direita perpendicular
      const sx = -Math.sin(this.yaw);
      const sz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const dx = sx * fz + rx * fx;
      const dz = sz * fz + rz * fx;
      const sp = (run ? RUN : WALK) * dt;
      const nx = this.pose.x + dx * sp;
      const nz = this.pose.z + dz * sp;
      let p = this.obstacles ? resolve(this.obstacles, nx, nz) : { x: nx, z: nz };
      // jogos de rede: a rede é parede, cada time fica na sua metade
      if (this.zone >= 3 && this.zone <= 5) p = { x: clampToHalf(p.x, this.team, PLAYER_R + 0.05), z: p.z };
      if (this.fight) {
        // ninguém sai do ringue durante o x1
        const r = this.fight.ring;
        const d = Math.hypot(p.x - r.x, p.z - r.z);
        const max = DUEL_RING_R - PLAYER_R;
        if (d > max) p = { x: r.x + ((p.x - r.x) / d) * max, z: r.z + ((p.z - r.z) / d) * max };
      }
      this.pose.x = p.x;
      this.pose.z = p.z;
      this.pose.ry = Math.atan2(dx, dz);
    }
    if (this.fight) {
      // lutando, o boneco olha para onde a mira aponta (a frente da câmera)
      this.pose.ry = Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    }
    if (this.pose.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.pose.y = Math.max(0, this.pose.y + this.vy * dt);
      if (this.pose.y === 0) this.vy = 0;
    }
    if (this.sport || this.pool) {
      if (this.sport) {
        this.sport.update(dt, now, { ...this.pose, moving, running: run });
        const holding = this.sport.holding;
        if (holding && !this.wasHolding) this.inputs.emit({ kind: 'grab' });
        this.wasHolding = holding;
      }
      if (this.pool) this.pool.update(dt, now, Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw)));
      const c = this.sport ? this.sport.charging : (this.pool?.charging ?? null);
      if ((c === null) !== (this.lastCharge === null) || (c !== null && Math.abs(c - (this.lastCharge ?? 0)) > 0.02)) {
        if (c !== null && c >= 0.3 && (this.lastCharge ?? 0) < 0.3) this.inputs.emit({ kind: 'charge', c });
        this.lastCharge = c;
        const band = c === null ? null : (this.sport?.band() ?? null);
        this.chargeSound(c, band);
        this.hooks.onCharge?.(c, band);
      }
    }
    if (this.fight) this.pose.a = now < this.punchUntil ? this.punchKind : this.blocking ? 8 : moving ? 1 : 0;
    else if (now < this.swingUntil) this.pose.a = this.swingA;
    else this.pose.a = this.pose.y > 0.01 ? 3 : moving ? (run ? 2 : 1) : now < this.waveUntil ? 4 : 0;
    this.me.place(this.pose);
    this.updatePrompt(now);
    this.maybeSend(now);
  }

  /** carga: um tique que sobe de tom a cada 10% e um "ding" ao entrar na faixa verde (ensina sem texto) */
  private chargeSound(c: number | null, band: { lo: number; hi: number } | null) {
    if (c === null) {
      this.chargeTick = -1;
      this.inBand = false;
      return;
    }
    const step = chargeStep(c);
    if (step > this.chargeTick) {
      this.chargeTick = step;
      if (step > 0) sfx.play('chargeTick', { zone: this.zone, gain: 0.5, pitch: 1 + step * 0.08 });
    }
    const inside = !!band && c >= band.lo && c <= band.hi;
    if (inside && !this.inBand) sfx.play('sweetSpot', { zone: this.zone, gain: 0.8 });
    this.inBand = inside;
  }

  private stepEditorCamera(dt: number) {
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (this.held('forward')) fz += 1;
    if (this.held('back')) fz -= 1;
    if (this.held('right')) fx += 1;
    if (this.held('left')) fx -= 1;
    if (fx || fz) {
      const sp = (k.has('Shift') ? 18 : 9) * dt;
      this.focus.x += (-Math.sin(this.yaw) * fz + Math.cos(this.yaw) * fx) * sp;
      this.focus.z += (-Math.cos(this.yaw) * fz - Math.sin(this.yaw) * fx) * sp;
      this.clampFocus();
    }
    this.maybeSend(performance.now());
  }

  private maybeSend(now: number) {
    const p = this.pose;
    const l = this.lastSent;
    const changed =
      !l ||
      Math.abs(l.x - p.x) > 0.01 ||
      Math.abs(l.z - p.z) > 0.01 ||
      Math.abs(l.y - p.y) > 0.01 ||
      l.a !== p.a ||
      Math.abs(l.ry - p.ry) > 0.02;
    const gap = now - this.lastSend;
    if ((changed && gap >= 100) || gap >= 1000) {
      this.lastSend = now;
      this.lastSent = { ...p };
      this.hooks.sendPose({
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        ry: round(p.ry),
        a: p.a,
        zone: this.zone,
        ...(this.zone ? { team: this.team } : {}),
      });
    }
  }

  private stepOthers(dt: number, t: number, now: number, realDt = dt) {
    const names = new Map(this.participants.map((p) => [p.identity, p]));
    for (const [id, pose] of peers) {
      const info = names.get(id);
      if (id === this.selfId || !info || now - pose.at > PEER_TIMEOUT_MS || pose.zone !== this.zone) {
        if (now - pose.at > PEER_TIMEOUT_MS) peers.delete(id);
        continue;
      }
      let av = this.others.get(id);
      if (!av) {
        av = new Avatar(id, info.name);
        av.setTarget(pose, true);
        this.others.set(id, av);
        this.scene.add(av.root);
      }
      av.setTarget(pose);
      av.setSpeaking(info.speaking);
      av.setVoiceLevel(info.speaking ? (this.hooks.audioLevel?.(id) ?? 0) : 0);
      av.setTeam(this.zone && this.zone !== 7 && pose.team ? pose.team : null);
      av.setRacket(racketOf(this.zone));
      av.setBike(this.zone === 7);
    }
    for (const [id, av] of this.others) {
      const p = peers.get(id);
      if (!p || !names.has(id) || p.zone !== this.zone) {
        this.scene.remove(av.root);
        av.dispose();
        this.others.delete(id);
        this.riderPrev.delete(id);
        this.lastA.delete(id);
        sfx.engine(id, null);
        continue;
      }
      this.holdOf(id, av);
      av.update(dt, t, realDt);
      this.othersSound(id, p, av, realDt);
    }
  }

  /** som do que os outros fazem: motor da moto de cada piloto e o vento do soco no x1 */
  private othersSound(id: string, p: Pose & { zone: number }, av: Avatar, dt: number) {
    if (this.zone === 7) {
      const at = { x: av.root.position.x, z: av.root.position.z };
      const prev = this.riderPrev.get(id);
      // velocidade pela posição mostrada (suavizada: as poses chegam ~10x/s)
      const raw = prev && dt > 0 ? Math.hypot(at.x - prev.x, at.z - prev.z) / dt : 0;
      const v = prev ? prev.v + (Math.min(40, raw) - prev.v) * Math.min(1, dt * 4) : 0;
      this.riderPrev.set(id, { ...at, v });
      sfx.engine(id, v, at);
    } else this.riderPrev.delete(id);
    const was = this.lastA.get(id);
    this.lastA.set(id, p.a);
    if ((p.a === 6 || p.a === 7) && was !== undefined && was !== p.a)
      this.events.emit({
        kind: 'punch',
        by: id,
        strong: p.a === 7,
        landed: false,
        power: p.a === 7 ? 1 : 0.5,
        zone: this.zone,
        at: { x: p.x, y: p.y + 1.3, z: p.z },
      });
  }

  private updateGains() {
    // alguém falando perto (ou eu): os efeitos do jogo abaixam
    let near = false;
    for (const p of this.participants) {
      if (!p.speaking) continue;
      if (p.isLocal) near = true;
      else {
        const pose = peers.get(p.identity);
        if (pose && pose.zone === this.zone && Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z) < SPACE_VOICE_FAR)
          near = true;
      }
      if (near) break;
    }
    sfx.duck(near);
    for (const p of this.participants) {
      if (p.isLocal) continue;
      const pose = peers.get(p.identity);
      if (!pose) {
        this.hooks.setGain(p.identity, null);
        continue;
      }
      // em outra arena (ou na sala, se estou numa arena): como se estivesse longe
      const d = pose.zone !== this.zone ? Infinity : Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z);
      this.hooks.setGain(p.identity, spaceVoiceGain(d));
    }
  }

  // ---------- tutorial (plano 2026-11-09, P4) ----------
  /** girar a câmera um bom pedaço (mouse ou Q/E) avisa o tutorial: na sinuca é mirar */
  private trackLook() {
    if (this.mode !== 'play') {
      this.lookYaw = this.yaw;
      return;
    }
    this.lookAcc += Math.abs(this.yaw - this.lookYaw);
    this.lookYaw = this.yaw;
    if (this.lookAcc < 0.6) return;
    this.lookAcc = 0;
    this.inputs.emit({ kind: 'look' });
  }

  /** o que o marcador do tutorial aponta no mundo (null = nada) */
  setTutorialTarget(t: TutorialTarget | null) {
    if (t === this.markerTarget) return;
    this.markerTarget = t;
    if (!t) {
      if (this.marker) {
        this.scene.remove(this.marker);
        this.marker.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        this.marker = null;
      }
      return;
    }
    if (!this.marker) {
      this.marker = markerMesh();
      this.scene.add(this.marker);
    }
  }

  /** onde o alvo do tutorial está agora (null = não há o que marcar) */
  private targetPos(t: TutorialTarget): { x: number; y: number; z: number; floor: number } | null {
    const atk = attackHoop(this.team);
    switch (t) {
      case 'bola': {
        if (!this.sport || this.sport.holding) return null;
        const b = this.sport.mesh.position;
        return { x: b.x, y: b.y + 0.5, z: b.z, floor: 0.02 };
      }
      case 'cesta':
        return this.zone === 1 ? { x: atk * HOOP_X, y: RIM_Y + 0.6, z: 0, floor: 0.02 } : null;
      case 'gol':
        return this.zone === 2 ? { x: atk * GOAL_X, y: 2.8, z: 0, floor: 0.02 } : null;
      case 'rede': {
        const z = this.zone;
        const net = z ? ARENAS[z].net : undefined;
        if (!z || !net) return null;
        // o lado de lá, no meio da quadra: onde a bola tem que cair
        const x = -netSideOf(this.team) * Math.min(4, (ARENAS[z].court?.hx ?? 4) / 2);
        return { x, y: net.y0 + net.h + 0.6, z: 0, floor: net.y0 + 0.02 };
      }
      case 'branca': {
        if (!this.pool) return null;
        const c = this.pool.cueBall();
        return { x: c.x, y: c.y + 0.25, z: c.z, floor: c.y - 0.02 };
      }
      case 'checkpoint': {
        const b = this.bike;
        if (!b || b.item) return null;
        const n = TRACK.pts.length;
        const next = TRACK.boxes.map((i) => ({ i, ahead: (i - b.idx + n) % n })).sort((p, q) => p.ahead - q.ahead)[0];
        const p = next ? TRACK.pts[next.i] : undefined;
        return p ? { x: p.x, y: 2.4, z: p.z, floor: 0.03 } : null;
      }
    }
  }

  private placeMarker(t: number) {
    const m = this.marker;
    if (!m) return;
    const pos = this.markerTarget && this.mode === 'play' ? this.targetPos(this.markerTarget) : null;
    m.visible = pos !== null;
    if (!pos) return;
    // na mesa de sinuca o marcador é pequeno (a branca tem 5 cm)
    const k = this.markerTarget === 'branca' ? 0.22 : 1;
    const bob = this.reducedMotion ? 0 : Math.sin(t * 4) * 0.12 * k;
    const [ring, arrow] = m.children;
    ring?.scale.setScalar(k);
    arrow?.scale.setScalar(k);
    ring?.position.set(pos.x, pos.floor, pos.z);
    arrow?.position.set(pos.x, pos.y + 0.35 * k + bob, pos.z);
    if (arrow && !this.reducedMotion) arrow.rotation.y = t * 1.5;
  }

  private placeCamera() {
    const target =
      this.mode === 'play'
        ? new THREE.Vector3(this.pose.x, this.pose.y + 1.35, this.pose.z)
        : new THREE.Vector3(this.focus.x, 0.5, this.focus.z);
    if (this.pool && this.mode === 'play' && this.pool.canShoot(this.team)) {
      // minha vez na sinuca: a câmera gira em volta da bola branca
      target.copy(this.pool.cueBall());
      target.y += 0.15;
    }
    if (this.fight && this.mode === 'play') {
      // por cima do ombro direito: a mira no centro fica livre, à frente do boneco
      target.x += Math.cos(this.yaw) * 0.6;
      target.z -= Math.sin(this.yaw) * 0.6;
      target.y += 0.15;
    }
    const yaw = this.yaw + this.freeYaw;
    const pitch = this.pitch + this.freePitch;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let d = this.dist;
    if (this.mode === 'play' && this.world) {
      // a câmera não atravessa paredes: encurta até a primeira
      this.ray.set(target, dir);
      this.ray.far = d;
      const hit = this.ray.intersectObjects(this.world.walls, false)[0];
      if (hit) d = Math.max(0.6, hit.distance - 0.25);
      this.ray.far = Infinity;
    }
    this.camera.position.copy(target).addScaledVector(dir, d);
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;
    this.camera.lookAt(target);
    // tremor do impacto (só golpe forte e ponto; zero com "reduzir movimento")
    if (this.mode === 'play' && this.juice.shake.amplitude > 0)
      this.camera.position.add(this.juice.shakeOffset(this.shakeOff));
    // perto demais: o próprio avatar some para não tampar a visão
    // (na sinuca, mirando, o próprio boneco também some para não tampar a mesa)
    const aimingPool = !!this.pool && this.mode === 'play' && this.pool.canShoot(this.team);
    this.me.root.visible = (this.mode === 'edit' || d > 1.1) && !aimingPool;
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.css?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.juice.setView(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  dispose() {
    this.disposed = true;
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.juice.dispose();
    this.sfxOff();
    sfx.stopEngines();
    this.sport?.dispose();
    this.pool?.dispose();
    this.events.clear();
    this.inputs.clear();
    this.setTutorialTarget(null);
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('mousemove', this.onAimMove);
    document.removeEventListener('mousedown', this.onMouseDownDoc);
    document.removeEventListener('mouseup', this.onMouseUpDoc);
    if (this.aimLocked) document.exitPointerLock();
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.host.removeEventListener('keyup', this.onKeyUp);
    this.host.removeEventListener('blur', this.onBlur);
    this.removeCss();
    this.css?.domElement.remove();
    for (const av of this.others.values()) av.dispose();
    this.me.dispose();
    this.world?.dispose();
    this.videoTex?.dispose();
    this.videoMat?.dispose();
    this.idleScreen.dispose();
    this.hole.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const p of this.participants) if (!p.isLocal) this.hooks.setGain(p.identity, null);
  }
}

/** as setas sempre andam (contam como a ação para o tutorial) */
const ARROW_ACTION: Partial<Record<string, Action>> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** marcador do tutorial: anel no chão e seta apontando para baixo, na cor de destaque, por cima de tudo */
function markerMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = () => new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), mat());
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 10;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), mat());
  arrow.rotation.x = Math.PI;
  arrow.renderOrder = 10;
  g.add(ring, arrow);
  return g;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** ringue do x1: círculo no chão, quatro postes e cordas */
function ringMesh(): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(DUEL_RING_R, 40),
    new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.015;
  g.add(floor);
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(DUEL_RING_R - 0.08, DUEL_RING_R, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  g.add(edge);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xd0d4dc });
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
  const corners = [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    return new THREE.Vector3(Math.cos(a) * DUEL_RING_R, 0, Math.sin(a) * DUEL_RING_R);
  });
  for (const c of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), postMat);
    post.position.set(c.x, 0.65, c.z);
    g.add(post);
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const len = a.distanceTo(b);
    for (const y of [0.7, 1.1]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), ropeMat);
      rope.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      rope.rotation.z = Math.PI / 2;
      rope.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.add(rope);
    }
  }
  g.traverse((o) => (o.raycast = () => undefined));
  return g;
}

/** raquete de cada esporte */
function racketOf(zone: number): 'tennis' | 'pingpong' | null {
  return zone === 3 ? 'tennis' : zone === 5 ? 'pingpong' : null;
}

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
  spaceVoiceGain,
  type SpaceLayout,
} from '@opencord/contracts';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { peers, PEER_TIMEOUT_MS } from '../../store/space';
import { Avatar, type Pose } from './avatar';
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
  /** minha posição para a rede (~10x/s andando, 1x/s parado) */
  sendPose(p: Pose): void;
  /** multiplicador da voz de cada um pela distância (null = normal) */
  setGain(identity: string, g: number | null): void;
  /** quadros por segundo atuais (para a dica de desempenho) */
  onFps?(fps: number): void;
  /** o que dá para fazer agora com F (null = nada ao alcance) */
  onPrompt?(p: { label: string } | null): void;
  /** interações que não são da cena: ligar/desligar (para todos), telão, música, desafiar */
  onAction?(i: Exclude<Interaction, { kind: 'sit' }>): void;
  /** x1: soco (o servidor decide se acertou) */
  onPunch?(strong: boolean): void;
  /** F quando há um convite de x1 para mim: aceitar */
  onAcceptKey?(): boolean;
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
  private lastPrompt = 0;
  private fight: FightState | null = null;
  private rings = new Map<string, THREE.Group>();
  private punchUntil = 0;
  private punchKind = 0;
  private koUntil = 0;
  private readonly lastPunch = { j: 0, s: 0 };
  private clickStart: { x: number; y: number } | null = null;
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
    this.me = new Avatar(selfId, selfName);
    this.me.hideName();
    this.scene.add(this.me.root);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- ambiente ----------
  setLayout(l: SpaceLayout, keepPosition: boolean) {
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
    if (f && !this.fight) this.sitting = null;
    this.fight = f;
    this.lastPrompt = 0;
  }

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

  /** alguém levou um golpe (efeito) */
  hit(userId: string) {
    if (userId === this.selfId) this.me.hitReact();
    else this.others.get(userId)?.hitReact();
  }

  /** perdi por nocaute: fico no chão um pouco */
  knockout(ms = 3500) {
    this.koUntil = performance.now() + ms;
  }

  private punch(strong: boolean) {
    const f = this.fight;
    if (!f || f.phase !== 'fighting' || this.keys.has('l')) return;
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
  }

  // ---------- interação (F) ----------
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
    if (this.mode !== 'play' || !l) this.current = null;
    else if (this.fight) this.current = null;
    else if (this.sitting) {
      this.current = null;
      label = 'Levantar';
    } else {
      const occupied = [...peers.values()].filter((p) => p.a === 5);
      this.current = findInteraction(l, this.pose, occupied, this.toggles);
      // alguém bem perto: desafiar para um x1 (ganha da peça)
      let near: { id: string; d: number } | null = null;
      for (const [id, p] of peers) {
        if (now - p.at > PEER_TIMEOUT_MS || p.a === 5 || p.a === 9) continue;
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
    if (label !== this.promptLabel) {
      this.promptLabel = label;
      this.hooks.onPrompt?.(label ? { label } : null);
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

  private onPointerDown = (e: PointerEvent) => {
    this.host.focus({ preventScroll: true });
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
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-0.15, Math.min(1.35, this.pitch + dy * 0.004));
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag?.editor) this.editorInput?.up(e);
    // clique sem arrastar durante o x1: esquerdo = soco rápido, direito = soco forte
    const c = this.clickStart;
    if (c && this.fight && this.mode === 'play' && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 6)
      this.punch(e.button === 2);
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
    if (e.target !== this.host) return;
    if (this.mode === 'edit' && this.editorInput?.key(e)) {
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (this.fight && this.mode === 'play' && (k === 'j' || k === 'k')) {
      e.preventDefault();
      if (!e.repeat) this.punch(k === 'k');
      return;
    }
    if (this.fight && this.mode === 'play' && k === 'l') {
      e.preventDefault();
      this.keys.add('l');
      return;
    }
    if (k === 'f' && this.mode === 'play') {
      e.preventDefault();
      if (!e.repeat) this.interact();
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift', 'e', 'q'].includes(k)) {
      e.preventDefault();
      if (k === ' ' && this.mode === 'play' && this.sitting) this.standUp();
      else if (k === ' ' && this.mode === 'play' && this.pose.y <= 0.001) this.vy = JUMP_V;
      if (k === 'e' && this.mode === 'play') this.waveUntil = performance.now() + 2200;
      this.keys.add(k);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => this.keys.clear();

  private onVisibility = () => {
    if (document.hidden) {
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
    if (this.mode === 'play') this.stepPlayer(dt, now);
    else this.stepEditorCamera(dt);
    this.me.update(dt, t);
    this.stepOthers(dt, t, now);
    this.placeCamera();
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
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz += 1;
    if (k.has('s') || k.has('arrowdown')) fz -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (now < this.koUntil) {
      this.pose.a = 9;
      this.pose.y = 0;
      this.me.place(this.pose);
      this.updatePrompt(now);
      this.maybeSend(now);
      return;
    }
    const moving = fx !== 0 || fz !== 0;
    const run = k.has('shift') && !this.fight;
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
      // lutando, fica sempre virado para o adversário
      const o = peers.get(this.fight.opponentId);
      if (o) this.pose.ry = Math.atan2(o.x - this.pose.x, o.z - this.pose.z);
    }
    if (this.pose.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.pose.y = Math.max(0, this.pose.y + this.vy * dt);
      if (this.pose.y === 0) this.vy = 0;
    }
    if (this.fight) this.pose.a = now < this.punchUntil ? this.punchKind : k.has('l') ? 8 : moving ? 1 : 0;
    else this.pose.a = this.pose.y > 0.01 ? 3 : moving ? (run ? 2 : 1) : now < this.waveUntil ? 4 : 0;
    this.me.place(this.pose);
    this.updatePrompt(now);
    this.maybeSend(now);
  }

  private stepEditorCamera(dt: number) {
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz += 1;
    if (k.has('s') || k.has('arrowdown')) fz -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (fx || fz) {
      const sp = (k.has('shift') ? 18 : 9) * dt;
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
      this.hooks.sendPose({ x: round(p.x), y: round(p.y), z: round(p.z), ry: round(p.ry), a: p.a });
    }
  }

  private stepOthers(dt: number, t: number, now: number) {
    const names = new Map(this.participants.map((p) => [p.identity, p]));
    for (const [id, pose] of peers) {
      const info = names.get(id);
      if (id === this.selfId || !info || now - pose.at > PEER_TIMEOUT_MS) {
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
    }
    for (const [id, av] of this.others) {
      const p = peers.get(id);
      if (!p || !names.has(id)) {
        this.scene.remove(av.root);
        av.dispose();
        this.others.delete(id);
        continue;
      }
      av.update(dt, t);
    }
  }

  private updateGains() {
    for (const p of this.participants) {
      if (p.isLocal) continue;
      const pose = peers.get(p.identity);
      if (!pose) {
        this.hooks.setGain(p.identity, null);
        continue;
      }
      const d = Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z);
      this.hooks.setGain(p.identity, spaceVoiceGain(d));
    }
  }

  private placeCamera() {
    const target =
      this.mode === 'play'
        ? new THREE.Vector3(this.pose.x, this.pose.y + 1.35, this.pose.z)
        : new THREE.Vector3(this.focus.x, 0.5, this.focus.z);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
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
    // perto demais: o próprio avatar some para não tampar a visão
    this.me.root.visible = this.mode === 'edit' || d > 1.1;
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
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
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

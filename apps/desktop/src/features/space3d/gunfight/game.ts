/**
 * Gunfight (zona 8, todos contra todos): o controlador. Cuida do meu jogador (movimento tático, armas, tiro, vida,
 * morrer e renascer), dos traçantes e dos efeitos, da visão em primeira pessoa, dos bots (treino) e da conversa pela
 * rede (`space:gun`). A cena (`scene.ts`) entrega as teclas, a câmera e os bonecos; a interface lê `useGunHud`.
 *
 * Rede: quem atira confere o acerto no próprio app e avisa quem levou (`hit`); quem levou confere se o tiro é possível
 * (quem atirou está na arena, vivo, com dano e cadência da arma), desconta e, se morreu, avisa todos (`die`). Cada um é
 * dono do próprio placar: conta o abate quando chega um `die` com `by` = eu, e publica abates e mortes na pose (quem
 * entra depois vê o placar certo). `restart` zera a partida de todos (só vale com a partida acabada ou sem nenhum
 * abate ainda). `die`, `spawn` e `restart` só valem de quem está na arena. Só o tiro (efeito) é volátil.
 *
 * Nada de `setTimeout`: o que acontece depois (sons da recarga, ferrolho, o golpe da faca acertar) vai para uma fila
 * com o horário, rodada no `step`; trocar de arma, morrer ou sair limpa a fila.
 */
import type { GunAct, GunId, SpaceGun } from '@opencord/contracts';
import * as THREE from 'three';
import type { GameEvent } from '../events';
import { resolve, type Obstacles } from '../physics';
import type { BotLevel } from '../bots/level';
import { GunBots, type BotShot } from './bots';
import { GunFx } from './fx';
import { GUN_BOXES, pickSpawn } from './map';
import { loadGuns, makeGun } from './models';
import { MOVE, newMove, pressCrouch, pressJump, pressRun, sliding, stepMove, type MoveState } from './movement';
import { useGunHud, type KillFeedItem, type ScoreRow } from './state';
import { Viewmodel } from './viewmodel';
import {
  BASH,
  EYE,
  FFA_TARGET,
  GUNS,
  HEAVY,
  MAX_HP,
  MELEE_DY,
  REGEN_DELAY_MS,
  REGEN_PER_S,
  RESPAWN_MS,
  WINNER_MS,
  aimDir,
  castShot,
  damageAt,
  lineOfSight,
  lookAt,
  maxDamage,
  shotInterval,
  spreadNow,
  type GunClass,
  type GunSlot,
  type Loadout,
  type Target,
  type V3,
} from './weapons';

export type GunAction = 'fire' | 'ads' | 'reload' | 'melee' | 'inspect' | 'crouch' | 'jump' | 'run' | 'view';

export interface GunPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  crouch: boolean;
  alive: boolean;
  /** abates e mortes que a pessoa publica na pose (ausente em app antigo) */
  k?: number;
  d?: number;
  /** a arma na mão (da pose; ausente em app antigo) */
  w?: GunId;
}

/** o boneco de um bot (a cena cria e desenha) */
export interface BotAvatar {
  root: THREE.Object3D;
  place(p: BotPose): void;
  /** boca da arma na mão do boneco (mundo), se ele já está com a arma */
  muzzle?(): V3 | null;
  dispose(): void;
}

export interface GunHost {
  selfId: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  obstacles: Obstacles;
  skin: number;
  /** "reduzir movimento" ligado: menos balanço e tranco */
  reducedMotion?: boolean;
  /** câmera da cena: para onde olho */
  yaw(): number;
  pitch(): number;
  /** gira a câmera (recuo): yaw e pitch somados */
  turn(dYaw: number, dPitch: number): void;
  /** direção de andar pedida (frente/trás/lados), em relação à câmera */
  wish(): { f: number; r: number };
  held(a: 'fire' | 'ads' | 'run'): boolean;
  /** as outras pessoas na arena (vivas ou não), na posição em que aparecem na tela */
  players(): GunPlayer[];
  nameOf(id: string): string;
  send(g: Omit<SpaceGun, 'channelId'>): void;
  emit(e: GameEvent): void;
  /** posição do meu boneco mudou (a cena põe o avatar e manda a pose) */
  place(p: { x: number; y: number; z: number; ry: number }): void;
  /** boca da arma do meu boneco (3ª pessoa) */
  muzzle?(): V3 | null;
  /** boca da arma do boneco de outra pessoa (mundo), se ele está na tela com a arma */
  muzzleOf?(id: string): V3 | null;
  /** um boneco atirou (eu, outra pessoa ou um bot): coice da arma na mão dele */
  shotFx?(id: string): void;
  /** o menu está aberto (mouse solto): no treino, os bots esperam */
  paused?(): boolean;
  /** acertei este boneco: brilho e tranco no corpo dele */
  hitFx?(id: string): void;
  /** um boneco para os bots (a cena cria e desenha) */
  spawnAvatar(id: string, name: string): BotAvatar;
}

export interface BotPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
  gun: { w: GunId; pitch: number; crouch: boolean; ads: boolean; alive: boolean; act?: GunAct; an?: number };
}

/** pose da arma que vai para a rede e para o meu boneco */
export interface GunPose {
  w: GunId;
  pitch: number;
  crouch: boolean;
  ads: boolean;
  alive: boolean;
  k: number;
  d: number;
  /** a última ação, com um contador (a mesma ação de novo troca o número e toca de novo) */
  act?: GunAct;
  an?: number;
}

interface Ammo {
  mag: number;
  reserve: number;
}

type JobTag = 'reload' | 'bolt' | 'melee';
interface Job {
  at: number;
  tag: JobTag;
  run(now: number): void;
}

const SLOTS: GunSlot[] = ['primary', 'secondary', 'melee'];
/** tempo para a arma descer da corrida até poder atirar (ms); na tática (arma para o alto) um pouco mais */
export const SPRINT_OUT_MS: Record<GunClass, number> = { ar: 180, smg: 140, pistol: 110, sniper: 260, knife: 0 };
const TACTICAL_OUT_K = 1.25;
/** um clique guardado vale por tanto tempo (ms): sai assim que a arma puder atirar */
const FIRE_BUFFER_MS = 320;
/** parte do recuo que fica (sobe a mira de vez); o resto é o tranco visual que volta */
const RECOIL_KEEP: Record<GunClass, number> = { ar: 0.7, smg: 0.75, pistol: 0.6, sniper: 0.3, knife: 0 };
/** com quantas pessoas de verdade na arena os bots saem (conferido a cada tanto) */
const BOT_CHECK_MS = 500;
/**
 * Cadência dos acertos que chegam: um balde por remetente que enche no ritmo da arma. Cabe uma rajada inteira chegando
 * junta (a rede e o TCP juntam pacotes): `HIT_BURST` acertos mais o que a arma dispara em `HIT_BUNCH_MS`.
 */
const HIT_BURST = 2;
const HIT_BUNCH_MS = 500;
/** acerto com a arma de antes vale até tanto depois da troca (a pose nova pode chegar antes do acerto) */
const SWAP_GRACE_MS = 1000;
/** folga do alcance do golpe (m): a posição desenhada anda atrás da de verdade */
const MELEE_SLACK = 1.5;
/** mola do tranco do recuo: passo máximo (s), limite (rad) */
const PUNCH_STEP = 1 / 120;
const PUNCH_MAX = 0.15;
/** terceira pessoa parado: o corpo só gira para a mira depois desta diferença (rad) e no máximo nesta velocidade */
const TURN_DEADZONE = 0.87;
const TURN_RATE = 10;

const TMP = new THREE.Vector3();

/** semente do sorteio: muda por pessoa e por vez que entra (ninguém cai sempre no mesmo canto) */
export function gunSeed(selfId: string, now: number): number {
  let h = 2166136261;
  for (let i = 0; i < selfId.length; i++) h = Math.imul(h ^ selfId.charCodeAt(i), 16777619);
  return (Math.abs(h ^ Math.floor(now)) % 2147483645) + 1;
}

export class GunGame {
  readonly vm: Viewmodel;
  firstPerson = true;
  private move: MoveState = newMove();
  private x = 0;
  private z = 0;
  private ry = 0;
  private hp = MAX_HP;
  private alive = false;
  private respawnAt = 0;
  private lastHurt = 0;
  private loadout: Loadout;
  private slot: GunSlot = 'primary';
  private ammo = new Map<GunId, Ammo>();
  private nextShot = 0;
  private reloadUntil = 0;
  private reloadEmpty = false;
  private drawUntil = 0;
  private meleeUntil = 0;
  private boltPending = 0;
  /** armas que atiraram e ficaram sem engatilhar (trocar de arma não pula o ferrolho) */
  private readonly needBolt = new Set<GunId>();
  private ads = 0;
  private triggerDown = false;
  private semiReady = true;
  /** clique guardado: atira assim que der (clique curto, FPS baixo, saindo da corrida) */
  private fireBufferUntil = 0;
  /** a arma ainda está descendo da corrida até tal hora */
  private readyAt = 0;
  private wasSprint = false;
  private wasTactical = false;
  private shotsInBurst = 0;
  private eyeY: number = EYE.stand;
  /** tranco visual do recuo (rad, para cima) e a mola que o traz de volta */
  private punch = 0;
  private punchV = 0;
  private readonly fx: GunFx;
  private readonly jobs: Job[] = [];
  /** placar: eu, os bots e (até a pose deles chegar) os outros */
  private readonly stats = new Map<string, { kills: number; deaths: number }>();
  private feedSeq = 0;
  private feed: KillFeedItem[] = [];
  private bots: GunBots | null = null;
  private botCheckAt = 0;
  private winner: string | null = null;
  private winnerAt = 0;
  /**
   * placar que cada pessoa publicava na hora do recomeço: até ela recomeçar e publicar outro, ele é velho e não conta
   * (sem isso, o 30 do vencedor na pose dele faz a partida acabar de novo no mesmo instante)
   */
  private readonly staleScore = new Map<string, string>();
  private lastHud = 0;
  private lastScores = 0;
  private lastScoped = false;
  /** saindo da luneta: a arma só volta à tela depois de a mira descer (sem o quadro da ocular na cara) */
  private leavingScope = false;
  /** terceira pessoa parado: o corpo está girando para a mira (as pernas dão um passinho) */
  private turning = false;
  /** a ação que vai na pose (e o contador) */
  private act: GunAct | undefined;
  private actN = 0;
  private seed: number;
  private lookPrev = { yaw: 0, pitch: 0 };
  /** balde de acertos de cada remetente (cadência) e quando cada um renasceu (a pose pode chegar depois) */
  private readonly hitBudget = new Map<string, { credit: number; at: number }>();
  private readonly spawnedAt = new Map<string, number>();
  /** a arma que cada pessoa mostra na pose, a de antes e quando trocou (para conferir o acerto) */
  private readonly armed = new Map<string, { w: GunId; prev: GunId | null; at: number }>();
  private disposed = false;

  constructor(private readonly host: GunHost) {
    this.vm = new Viewmodel(host.skin, !!host.reducedMotion);
    this.fx = new GunFx(host.scene);
    this.seed = gunSeed(host.selfId, Date.now());
    this.loadout = { ...useGunHud.getState().loadout };
    for (const id of Object.keys(GUNS) as GunId[]) this.ammo.set(id, { mag: GUNS[id].mag, reserve: GUNS[id].reserve });
    useGunHud.getState().set({
      active: true,
      firstPerson: this.firstPerson,
      feed: [],
      winner: null,
      dead: false,
      notice: null,
      // a luneta e as setas de dano de uma vez anterior não voltam com o jogo novo
      scoped: false,
      hurts: [],
    });
    void loadGuns().then(() => {
      if (this.disposed) return;
      this.respawn(performance.now());
    });
  }

  // ------------------------------------------------------------ estado

  private rand() {
    // sorteio próprio (rápido e repetível no teste)
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  get weapon(): GunId {
    return this.loadout[this.slot];
  }

  get spec() {
    return GUNS[this.weapon];
  }

  get isAlive() {
    return this.alive;
  }

  get crouching() {
    return this.move.crouch || sliding(this.move, performance.now());
  }

  get aiming() {
    return this.ads;
  }

  get eye(): V3 {
    return { x: this.x, y: this.move.y + this.eyeY, z: this.z };
  }

  /** partida acabou (alguém chegou ao alvo): tiro e bots param até recomeçar */
  get over(): boolean {
    return this.winner !== null;
  }

  /** tranco visual do recuo (rad para cima): a cena soma na câmera; a mira de verdade não muda */
  get viewPunch(): number {
    return this.punch * (this.host.reducedMotion ? 0.35 : 1);
  }

  /** a pose da arma para a rede e o meu boneco (com o meu placar) */
  pose(): GunPose {
    const me = this.stats.get(this.host.selfId);
    return {
      w: this.weapon,
      pitch: this.host.pitch(),
      crouch: this.crouching,
      ads: this.ads > 0.5,
      alive: this.alive,
      k: me?.kills ?? 0,
      d: me?.deaths ?? 0,
      ...(this.act ? { act: this.act, an: this.actN } : {}),
    };
  }

  private markAct(a: GunAct) {
    this.act = a;
    this.actN = (this.actN + 1) % 1000;
  }

  /** o estado `a` do boneco (0 parado, 1 andando, 2 correndo, 3 no ar, 9 morto, 15 deslizando) */
  anim(): number {
    if (!this.alive) return 9;
    if (sliding(this.move, performance.now())) return 15;
    if (!this.move.grounded) return 3;
    const sp = Math.hypot(this.move.vx, this.move.vz);
    if (sp < 0.3) return this.turning ? 1 : 0;
    return this.move.sprint ? 2 : 1;
  }

  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    useGunHud.getState().set({ firstPerson: on });
  }

  // ------------------------------------------------------------ fila (no lugar de setTimeout)

  private later(tag: JobTag, at: number, run: (now: number) => void) {
    this.jobs.push({ at, tag, run });
  }

  private cancelJobs(...tags: JobTag[]) {
    for (let i = this.jobs.length - 1; i >= 0; i--)
      if (!tags.length || tags.includes(this.jobs[i]!.tag)) this.jobs.splice(i, 1);
  }

  private runJobs(now: number) {
    for (let i = 0; i < this.jobs.length;) {
      const j = this.jobs[i]!;
      if (now < j.at) {
        i++;
        continue;
      }
      this.jobs.splice(i, 1);
      j.run(now);
    }
  }

  /** quantas coisas estão esperando na fila (para os testes) */
  get pending(): number {
    return this.jobs.length;
  }

  // ------------------------------------------------------------ nascer, morrer

  private respawn(now: number) {
    this.loadout = { ...useGunHud.getState().loadout };
    const enemies = [...this.host.players().filter((p) => p.alive), ...(this.bots?.alivePositions() ?? [])];
    const sp = pickSpawn(enemies, this.rand());
    this.x = sp.x;
    this.z = sp.z;
    this.ry = sp.ry;
    this.host.turn(sp.ry + Math.PI - this.host.yaw(), -this.host.pitch());
    // a câmera virou de uma vez: o balanço da arma não pode ler isso como um movimento do mouse
    this.lookPrev = { yaw: this.host.yaw(), pitch: this.host.pitch() };
    this.punch = 0;
    this.punchV = 0;
    this.move = newMove();
    this.hp = MAX_HP;
    this.alive = true;
    this.slot = 'primary';
    this.needBolt.clear();
    for (const id of Object.values(this.loadout) as GunId[])
      this.ammo.set(id, { mag: GUNS[id].mag, reserve: GUNS[id].reserve });
    this.equip(now);
    this.host.send({ kind: 'spawn', w: this.weapon });
    useGunHud.getState().set({ dead: false, killedBy: null, hp: this.hp });
  }

  private die(by: string, w: GunId, head: boolean, now: number) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.respawnAt = now + RESPAWN_MS;
    this.reloadUntil = 0;
    this.ads = 0;
    this.cancel();
    this.cancelJobs();
    // morte por bot não tem matador na rede (o id do bot não é de ninguém): vai sem `by`
    const fromBot = !!this.bots?.has(by);
    this.host.send({ kind: 'die', w, head, ...(fromBot || by === this.host.selfId ? {} : { by }) });
    this.onKill(by, this.host.selfId, w, head);
    useGunHud.getState().set({ dead: true, killedBy: by, respawnAt: Date.now() + RESPAWN_MS });
  }

  private statOf(id: string) {
    let s = this.stats.get(id);
    if (!s) this.stats.set(id, (s = { kills: 0, deaths: 0 }));
    return s;
  }

  /** alguém matou alguém: lista de abates, placar e fim da partida */
  private onKill(by: string, target: string, w: GunId, head: boolean) {
    if (this.over) return;
    if (by !== target) this.statOf(by).kills++;
    this.statOf(target).deaths++;
    this.feed = [
      {
        id: ++this.feedSeq,
        by,
        byName: this.nameOf(by),
        target,
        targetName: this.nameOf(target),
        w,
        head,
        at: Date.now(),
      },
      ...this.feed,
    ].slice(0, 6);
    this.pushScores();
  }

  private nameOf(id: string) {
    if (id === this.host.selfId) return 'Você';
    return this.bots?.nameOf(id) ?? this.host.nameOf(id);
  }

  /** o placar de agora: cada pessoa pelo que ela publica; eu e os bots pela conta daqui */
  scores(): ScoreRow[] {
    const people = new Map(this.host.players().map((p) => [p.id, p]));
    const ids = new Set<string>([this.host.selfId, ...people.keys(), ...(this.bots?.ids() ?? [])]);
    // quem saiu da arena no meio da partida continua no placar com o que fez
    for (const id of this.stats.keys()) ids.add(id);
    const rows = [...ids].map((id) => {
      const p = people.get(id);
      const local = this.stats.get(id);
      let pub = p?.k !== undefined && p.d !== undefined ? { k: p.k, d: p.d } : null;
      const stale = this.staleScore.get(id);
      if (pub && stale !== undefined) {
        if (stale === `${pub.k}:${pub.d}`) pub = null;
        else this.staleScore.delete(id);
      }
      return {
        id,
        name: this.nameOf(id),
        kills: pub ? pub.k : (local?.kills ?? 0),
        deaths: pub ? pub.d : (local?.deaths ?? 0),
        bot: !!this.bots?.has(id),
        me: id === this.host.selfId,
      };
    });
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return rows;
  }

  private pushScores(now = performance.now()) {
    if (this.over) {
      // o vencedor já recomeçou (publica um placar abaixo do alvo): recomeço junto, sem esperar a minha tela acabar
      if (this.winnerRestarted()) this.restart(now, false);
      return;
    }
    const rows = this.scores();
    const top = rows[0];
    if (top && top.kills >= FFA_TARGET) {
      this.winner = top.id;
      this.winnerAt = now;
      this.cancel();
    }
    useGunHud.getState().set({
      scores: rows,
      feed: this.feed,
      winner: this.winner ? this.nameOf(this.winner) : null,
      ...(this.winner ? { winnerAt: Date.now() } : {}),
    });
  }

  /** o vencedor (outra pessoa) publica abates abaixo do alvo, num placar que não é o velho do recomeço */
  private winnerRestarted(): boolean {
    const id = this.winner;
    if (!id || id === this.host.selfId || this.bots?.has(id)) return false;
    const p = this.host.players().find((x) => x.id === id);
    if (p?.k === undefined || p.d === undefined) return false;
    return p.k < FFA_TARGET && this.staleScore.get(id) !== `${p.k}:${p.d}`;
  }

  /** começa de novo (placar zerado, todos renascem); `broadcast` avisa os outros da arena */
  restart(now = performance.now(), broadcast = true) {
    this.stats.clear();
    this.feed = [];
    this.winner = null;
    this.staleScore.clear();
    for (const p of this.host.players())
      if (p.k !== undefined && p.d !== undefined) this.staleScore.set(p.id, `${p.k}:${p.d}`);
    this.hitBudget.clear();
    this.bots?.resetAll(now);
    if (broadcast) this.host.send({ kind: 'restart', w: this.weapon });
    this.respawn(now);
    this.pushScores(now);
  }

  // ------------------------------------------------------------ armas

  private equip(now: number) {
    const id = this.weapon;
    const m = makeGun(id);
    if (!m) return;
    // a arma de antes não tem mais o que fazer (som da recarga, ferrolho, golpe no ar)
    this.cancelJobs('reload', 'bolt', 'melee');
    this.vm.setGun(m, GUNS[id]);
    const sp = GUNS[id];
    this.drawUntil = now + (sp.cls === 'knife' ? 380 : sp.cls === 'pistol' ? 420 : 600);
    this.reloadUntil = 0;
    this.boltPending = 0;
    this.meleeUntil = 0;
    if (sp.boltMs && this.needBolt.has(id)) {
      // trocou antes de engatilhar: engatilha depois de sacar
      this.boltPending = this.drawUntil + sp.boltMs;
      this.scheduleBolt(this.drawUntil, sp.id, sp.boltMs);
    }
    this.markAct('draw');
    this.host.emit({ kind: 'gunfx', what: 'draw', w: id, power: 0.5, zone: 8, at: this.eye });
  }

  switchTo(slot: GunSlot, now = performance.now()) {
    if (!this.alive || slot === this.slot) return;
    this.slot = slot;
    this.fireBufferUntil = 0;
    this.equip(now);
  }

  cycle(dir: number, now = performance.now()) {
    const i = SLOTS.indexOf(this.slot);
    this.switchTo(SLOTS[(i + (dir > 0 ? 1 : 2)) % 3]!, now);
  }

  press(a: GunAction, now = performance.now()) {
    if (a === 'view') return this.setFirstPerson(!this.firstPerson);
    if (!this.alive || this.over) return;
    switch (a) {
      case 'fire':
        if (this.spec.cls === 'knife') {
          this.knife(now, false);
          break;
        }
        this.triggerDown = true;
        // o clique vale mesmo que o botão suba antes do próximo quadro (semi e ferrolho)
        this.fireBufferUntil = now + FIRE_BUFFER_MS;
        this.tryFire(now);
        break;
      case 'ads':
        if (this.spec.cls === 'knife') this.knife(now, true);
        break;
      case 'reload':
        this.reload(now);
        break;
      case 'melee':
        this.bash(now);
        break;
      case 'inspect':
        if (!this.vm.busy && now > this.reloadUntil) this.vm.play('inspect', this.spec.cls === 'knife' ? 2000 : 2400);
        break;
      case 'crouch': {
        const r = pressCrouch(this.move, now);
        if (r === 'slide')
          this.host.emit({ kind: 'gunfx', what: 'slide', w: this.weapon, power: 0.6, zone: 8, at: this.eye });
        break;
      }
      case 'jump':
        pressJump(this.move, now);
        break;
      case 'run':
        if (pressRun(this.move, now))
          this.host.emit({ kind: 'gunfx', what: 'tactical', w: this.weapon, power: 0.3, zone: 8, at: this.eye });
        break;
    }
  }

  release(a: GunAction) {
    if (a === 'fire') {
      this.triggerDown = false;
      this.semiReady = true;
      this.shotsInBurst = 0;
    }
  }

  /** soltou tudo sem soltar o botão (Esc, outra janela, aba escondida): o gatilho não fica preso */
  cancel() {
    this.triggerDown = false;
    this.semiReady = true;
    this.shotsInBurst = 0;
    this.fireBufferUntil = 0;
  }

  private reload(now: number) {
    const sp = this.spec;
    const am = this.ammo.get(this.weapon);
    if (!this.alive || !am || sp.cls === 'knife' || now < this.reloadUntil || am.mag >= sp.mag || am.reserve <= 0)
      return;
    this.reloadEmpty = am.mag === 0;
    const ms = this.reloadEmpty ? sp.emptyReloadMs : sp.reloadMs;
    this.reloadUntil = now + ms;
    this.move.sprint = false;
    // Kar98k: sem pente que sai; recarrega por pente-lâmina pela janela do ferrolho
    const clip = sp.id === 'kar98k';
    this.vm.play(clip ? 'reloadClip' : this.reloadEmpty ? 'reloadEmpty' : 'reload', ms);
    this.markAct('reload');
    // os sons da recarga anterior (cancelada) não tocam por cima desta
    this.cancelJobs('reload');
    const w = this.weapon;
    const fx = (what: 'magOut' | 'magIn' | 'charge' | 'boltOpen' | 'boltClose', k: number) =>
      this.later('reload', now + ms * k, () => {
        if (this.reloadUntil && this.weapon === w)
          this.host.emit({ kind: 'gunfx', what, w, power: 0.6, zone: 8, at: this.eye });
      });
    if (clip) {
      // o tutorial e as dicas contam o começo da recarga pelo `magOut`: ele sai junto com o ferrolho abrindo
      fx('magOut', 0.2);
      fx('boltOpen', 0.22);
      fx('magIn', 0.46);
      fx('magIn', 0.58);
      fx('boltClose', 0.78);
      return;
    }
    fx('magOut', 0.18);
    fx('magIn', 0.6);
    if (this.reloadEmpty) fx('charge', 0.8);
  }

  private finishReload() {
    const am = this.ammo.get(this.weapon);
    if (!am) return;
    const need = this.spec.mag - am.mag;
    const take = Math.min(need, am.reserve);
    am.mag += take;
    am.reserve -= take;
  }

  private targets(): Target[] {
    const out: Target[] = this.host
      .players()
      .filter((p) => p.alive)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, crouch: p.crouch }));
    if (this.bots) out.push(...this.bots.targets());
    return out;
  }

  /** faca (golpe rápido; `heavy` = botão direito: mais lento, mais longe) ou a coronhada com a arma */
  private knife(now: number, heavy: boolean) {
    const sp = this.spec;
    if (!sp.melee || now < this.meleeUntil || now < this.drawUntil) return;
    const ms = sp.melee.ms * (heavy ? HEAVY.ms : 1);
    this.meleeUntil = now + ms;
    // o pesado antecipa mais e estoca: o golpe chega no fim da estocada
    this.vm.play(heavy ? 'heavy' : 'melee', ms);
    this.markAct('melee');
    this.host.emit({ kind: 'gunfx', what: 'swing', w: this.weapon, power: heavy ? 0.8 : 0.6, zone: 8, at: this.eye });
    const { dmg, range } = sp.melee;
    this.later('melee', now + ms * (heavy ? 0.45 : 0.3), () =>
      this.meleeHit(sp.id, dmg, range * (heavy ? HEAVY.range : 1)),
    );
  }

  private bash(now: number) {
    if (this.spec.cls === 'knife') return this.knife(now, false);
    if (now < this.meleeUntil || now < this.drawUntil) return;
    this.meleeUntil = now + BASH.ms;
    this.reloadUntil = 0;
    this.cancelJobs('reload');
    this.vm.play('melee', BASH.ms);
    this.markAct('melee');
    this.host.emit({ kind: 'gunfx', what: 'swing', w: this.weapon, power: 0.5, zone: 8, at: this.eye });
    const w = this.weapon;
    this.later('melee', now + 160, () => this.meleeHit(w, BASH.dmg, BASH.range));
  }

  /** o golpe chega: o alvo mais perto na frente, na altura e sem parede no meio */
  private meleeHit(w: GunId, dmg: number, range: number) {
    if (!this.alive || this.weapon !== w) return;
    const yaw = this.host.yaw();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const eye = this.eye;
    let best: Target | null = null;
    let bestD = range;
    for (const t of this.targets()) {
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 1e-3) continue;
      if ((dx * fx + dz * fz) / d < 0.55) continue;
      if (Math.abs(t.y - this.move.y) > MELEE_DY) continue;
      const chest = { x: t.x, y: t.y + (t.crouch ? 0.6 : 0.85), z: t.z };
      if (!lineOfSight(eye, chest, GUN_BOXES)) continue;
      best = t;
      bestD = d;
    }
    if (!best) return;
    this.dealDamage(best.id, dmg, false, { x: best.x, y: best.y + 1, z: best.z });
  }

  /** dá para atirar agora (cadência, saque, golpe, ferrolho, corrida)? */
  private canFire(now: number): boolean {
    return (
      !this.over &&
      now >= this.nextShot &&
      now >= this.drawUntil &&
      now >= this.meleeUntil &&
      this.boltPending <= now &&
      !this.move.sprint &&
      now >= this.readyAt
    );
  }

  private tryFire(now: number) {
    if (this.spec.cls === 'knife' || !this.canFire(now)) return;
    const r = this.fire(now);
    if (r !== 'blocked') this.fireBufferUntil = 0;
  }

  /** dispara a arma (cadência, munição, recuo, dispersão, acerto) */
  private fire(now: number): 'shot' | 'dry' | 'blocked' {
    const sp = this.spec;
    const am = this.ammo.get(this.weapon);
    if (!am || sp.cls === 'knife' || !this.canFire(now)) return 'blocked';
    if (this.reloadUntil) {
      // atirar cancela a recarga só se ainda tiver bala no pente
      if (am.mag <= 0) return 'blocked';
      this.reloadUntil = 0;
      this.cancelJobs('reload');
    }
    if (am.mag <= 0) {
      // com reserva, a recarga começa (sem clique seco); sem nada, o clique seco (e a dica de trocar de arma)
      if (am.reserve <= 0) {
        // um clique por apertar (segurando, não repete)
        if (this.semiReady)
          this.host.emit({ kind: 'gunfx', what: 'dry', w: this.weapon, power: 0.5, zone: 8, at: this.eye });
        this.semiReady = false;
      }
      this.reload(now);
      return 'dry';
    }
    am.mag--;
    this.nextShot = now + shotInterval(sp);
    this.shotsInBurst++;
    this.move.sprint = false;
    this.move.tactical = false;
    this.vm.play('fire', 120);
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    let spread = spreadNow(sp, this.ads, moving, this.move.crouch);
    if (!this.move.grounded) spread *= 2;
    if (sliding(this.move, now)) spread *= 1.4;
    // a primeira bala de uma rajada vai mais certa
    if (this.shotsInBurst === 1) spread *= 0.6;
    const o = this.eye;
    const targets = this.targets();
    const aim = this.aimAngles(o, targets);
    const d = aimDir(aim.yaw, aim.pitch, spread, this.rand(), this.rand());
    const hit = castShot(o, d, targets, GUN_BOXES, 160);
    const to = { x: o.x + d.x * hit.dist, y: o.y + d.y * hit.dist, z: o.z + d.z * hit.dist };
    const muzzle = this.muzzleWorld(o, d);
    this.fx.tracer(muzzle, to, now);
    if (!this.firstPerson) this.fx.flash(muzzle, now, sp.cls === 'sniper' ? 0.42 : 0.3);
    this.host.emit({ kind: 'gunshot', by: this.host.selfId, w: this.weapon, power: 1, zone: 8, at: muzzle });
    // o coice no meu boneco (3ª pessoa)
    this.host.shotFx?.(this.host.selfId);
    this.host.send({ kind: 'fire', w: this.weapon, from: v3(muzzle), to: v3(to) });
    if (hit.target) this.dealDamage(hit.target, damageAt(sp, hit.dist, hit.head), hit.head, to);
    else this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.5, zone: 8, at: to });
    // recuo: para cima e um pouco para o lado (mais com o tempo de rajada, menos mirando e agachado). Uma parte sobe
    // a mira de vez; o resto é um tranco da câmera que volta sozinho (a sniper não perde o alvo da luneta)
    const k = (1 - this.ads * 0.35) * (this.move.crouch ? 0.8 : 1) * (1 + Math.min(this.shotsInBurst, 12) * 0.03);
    const keep = RECOIL_KEEP[sp.cls];
    const side = (this.rand() - 0.42) * 2 * sp.recoil.side;
    this.host.turn(side * k * keep, -sp.recoil.up * k * keep);
    this.punchV += sp.recoil.up * k * (1 - keep) * 60;
    if (sp.boltMs) {
      // ferrolho: a animação começa logo depois do tiro
      this.needBolt.add(sp.id);
      this.boltPending = now + sp.boltMs;
      this.scheduleBolt(now + 120, sp.id, sp.boltMs);
    }
    if (!sp.auto) this.semiReady = false;
    if (am.mag === 0 && am.reserve > 0) this.later('reload', now + 250, (t) => this.reload(t));
    return 'shot';
  }

  /** o ferrolho: abre (com a mão), fecha e a arma fica pronta */
  private scheduleBolt(at: number, id: GunId, boltMs: number) {
    const ms = Math.max(200, boltMs - 120);
    this.later('bolt', at, (t) => {
      if (this.weapon !== id || !this.alive) return;
      this.vm.play('bolt', ms);
      this.markAct('bolt');
      this.host.emit({ kind: 'gunfx', what: 'boltOpen', w: id, power: 0.6, zone: 8, at: this.eye });
      this.later('bolt', t + ms * 0.62, () =>
        this.host.emit({ kind: 'gunfx', what: 'boltClose', w: id, power: 0.6, zone: 8, at: this.eye }),
      );
      this.later('bolt', t + ms, () => this.needBolt.delete(id));
    });
  }

  /**
   * Para onde vai o tiro. Na 1ª pessoa, o olho é a câmera. Na 3ª, a câmera fica atrás e à direita: um raio da câmera
   * pelo centro da tela acha o ponto da mira (primeira parede ou alvo) e o tiro sai do olho até lá — senão as balas
   * cairiam sempre ~0,45 m à esquerda da mira.
   */
  private aimAngles(eye: V3, targets: Target[]): { yaw: number; pitch: number } {
    const yaw = this.host.yaw();
    const pitch = this.host.pitch();
    if (this.firstPerson) return { yaw, pitch };
    const cam = this.host.camera.position;
    const cd = aimDir(yaw, pitch, 0, 0, 0);
    // começa no ponto do raio da câmera que fica na altura do meu boneco (a parede atrás de mim não conta)
    const t0 = Math.max(0, (eye.x - cam.x) * cd.x + (eye.y - cam.y) * cd.y + (eye.z - cam.z) * cd.z);
    const start = { x: cam.x + cd.x * t0, y: cam.y + cd.y * t0, z: cam.z + cd.z * t0 };
    const hit = castShot(start, cd, targets, GUN_BOXES, 160);
    const p = { x: start.x + cd.x * hit.dist, y: start.y + cd.y * hit.dist, z: start.z + cd.z * hit.dist };
    if (Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) < 0.5) return { yaw, pitch };
    return lookAt(eye, p);
  }

  /** de onde o traçante sai: a boca da arma que se vê (1ª pessoa: o viewmodel projetado; 3ª: a do boneco) */
  private muzzleWorld(eye: V3, d: V3): V3 {
    const ahead = (m: number, down: number) => ({ x: eye.x + d.x * m, y: eye.y + d.y * m - down, z: eye.z + d.z * m });
    if (!this.firstPerson) return this.host.muzzle?.() ?? ahead(0.6, 0.12);
    // mirando ou na luneta: a arma está no centro da tela, o traço começa na frente do olho
    if (this.ads > 0.5) return ahead(0.7, 0.03);
    const m = this.vm.muzzleView(TMP);
    if (!m) return ahead(0.6, 0.12);
    // do espaço do viewmodel para a tela e da tela de volta para o mundo, a meio metro da câmera
    m.project(this.vm.camera);
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    m.set(m.x, m.y, 0.5).unproject(cam).sub(cam.position).normalize();
    return { x: cam.position.x + m.x * 0.55, y: cam.position.y + m.y * 0.55, z: cam.position.z + m.z * 0.55 };
  }

  /** acertei alguém: bot leva aqui; gente de verdade leva pela rede */
  private dealDamage(id: string, dmg: number, head: boolean, at: V3) {
    const kill = this.bots?.has(id)
      ? this.bots.hurt(id, dmg, this.host.selfId, this.weapon, head)
      : (this.host.send({ kind: 'hit', w: this.weapon, target: id, dmg, head }), false);
    this.host.emit({ kind: 'impact', flesh: true, head, power: 0.7, zone: 8, at });
    this.host.hitFx?.(id);
    this.host.emit({
      kind: 'gunfx',
      what: kill ? 'kill' : head ? 'headshot' : 'hitmarker',
      w: this.weapon,
      power: 0.7,
      zone: 8,
      at: this.eye,
    });
    useGunHud.getState().set({ hitAt: Date.now(), hitKill: kill, hitHead: head });
  }

  /** levei dano (de alguém da rede ou de um bot) */
  hurt(
    by: string,
    dmg: number,
    w: GunId,
    head: boolean,
    from: { x: number; z: number } | null,
    now = performance.now(),
  ) {
    if (!this.alive || this.over) return;
    this.hp -= dmg;
    this.lastHurt = now;
    this.host.emit({ kind: 'gunfx', what: 'hurt', w, power: 0.7, zone: 8, at: this.eye });
    if (from) {
      // de que lado veio, em relação a para onde olho
      const ang =
        Math.atan2(from.x - this.x, from.z - this.z) -
        Math.atan2(-Math.sin(this.host.yaw()), -Math.cos(this.host.yaw()));
      const st = useGunHud.getState();
      st.set({ hurts: [...st.hurts.filter((h) => Date.now() - h.at < 1500), { ang, at: Date.now() }] });
    }
    if (this.hp <= 0) this.die(by, w, head, now);
    else useGunHud.getState().set({ hp: Math.max(0, Math.round(this.hp)) });
  }

  // ------------------------------------------------------------ rede

  /** o acerto que chegou é possível? (quem atirou está na arena e vivo; dano e cadência da arma) */
  private hitPlausible(g: SpaceGun & { sender: string }, now: number): boolean {
    this.trackArms(now);
    const p = this.host.players().find((x) => x.id === g.sender);
    if (!p) return false;
    if (!p.alive && now - (this.spawnedAt.get(g.sender) ?? -1e9) > 1500) return false;
    const sp = GUNS[g.w];
    if (!g.dmg || g.dmg > maxDamage(sp)) return false;
    // a arma do acerto é a da pose dele (ou a de antes, trocada há pouco)
    const arm = this.armed.get(g.sender);
    if (arm && g.w !== arm.w && !(g.w === arm.prev && now - arm.at < SWAP_GRACE_MS)) return false;
    // golpe (faca, ou dano acima do que uma bala da arma faz = coronhada): só de perto
    const melee = sp.cls === 'knife' || g.dmg > Math.round(sp.dmg[0] * sp.head);
    if (melee) {
      const reach = (sp.melee ? sp.melee.range * HEAVY.range : BASH.range) + MELEE_SLACK;
      if (Math.hypot(p.x - this.x, p.z - this.z) > reach) return false;
    }
    // balde: enche no ritmo da arma (até uma rajada inteira) e cada acerto gasta 1 — acertos que a rede entregou
    // juntos valem; um fluxo acima da cadência, não
    const interval = Math.min(shotInterval(sp), 450);
    const cap = HIT_BURST + HIT_BUNCH_MS / interval;
    const b = this.hitBudget.get(g.sender) ?? { credit: cap, at: now };
    b.credit = Math.min(cap, b.credit + Math.max(0, now - b.at) / interval);
    b.at = now;
    this.hitBudget.set(g.sender, b);
    if (b.credit < 1) return false;
    b.credit -= 1;
    return true;
  }

  /** ninguém fez abate ainda (recomeçar não apaga nada de ninguém) */
  private get fresh(): boolean {
    return this.scores().every((r) => r.kills === 0);
  }

  /** guarda a arma que cada pessoa mostra (e quando trocou), para conferir de que arma vem o acerto */
  private trackArms(now: number) {
    for (const p of this.host.players()) {
      if (!p.w) continue;
      const a = this.armed.get(p.id);
      if (!a) this.armed.set(p.id, { w: p.w, prev: null, at: now });
      else if (a.w !== p.w) this.armed.set(p.id, { w: p.w, prev: a.w, at: now });
    }
  }

  /** dá para recomeçar agora sem estragar a partida dos outros (acabou, ou ninguém pontuou, ou estou sozinho) */
  get canRestart(): boolean {
    return this.over || this.host.players().length === 0 || this.fresh;
  }

  remote(g: SpaceGun & { sender: string }, now = performance.now()) {
    if (g.sender === this.host.selfId) return;
    // o servidor repassa para a chamada inteira: o que muda o placar só vale de quem está na arena
    const inArena = () => this.host.players().some((p) => p.id === g.sender);
    switch (g.kind) {
      case 'fire':
        if (g.from && g.to) {
          // o clarão e o traço saem da arma do boneco dele (na 1ª pessoa, o `from` dele é na frente do rosto)
          const a = this.host.muzzleOf?.(g.sender) ?? { x: g.from[0], y: g.from[1], z: g.from[2] };
          this.host.shotFx?.(g.sender);
          const b = { x: g.to[0], y: g.to[1], z: g.to[2] };
          this.fx.tracer(a, b, now);
          this.fx.flash(a, now, GUNS[g.w].cls === 'sniper' ? 0.42 : 0.3);
          this.host.emit({ kind: 'gunshot', by: g.sender, w: g.w, power: 1, zone: 8, at: a });
          this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: b });
        }
        break;
      case 'hit':
        if (g.target === this.host.selfId && this.hitPlausible(g, now)) {
          const p = this.host.players().find((x) => x.id === g.sender);
          this.hurt(g.sender, g.dmg!, g.w, !!g.head, p ? { x: p.x, z: p.z } : null, now);
        }
        break;
      case 'die':
        if (!inArena()) break;
        this.spawnedAt.delete(g.sender);
        this.onKill(g.by ?? g.sender, g.sender, g.w, !!g.head);
        if (g.by === this.host.selfId && !this.over) {
          // matei alguém de verdade: o marcador fica vermelho e toca o abate
          this.host.emit({ kind: 'gunfx', what: 'kill', w: g.w, power: 0.8, zone: 8, at: this.eye });
          useGunHud.getState().set({ hitAt: Date.now(), hitKill: true, hitHead: !!g.head });
        }
        break;
      case 'spawn':
        if (!inArena()) break;
        this.spawnedAt.set(g.sender, now);
        this.pushScores(now);
        break;
      case 'restart':
        // no meio de uma partida com abates, ninguém zera o placar dos outros
        if (inArena() && (this.over || this.fresh)) this.restart(now, false);
        break;
    }
  }

  // ------------------------------------------------------------ bots

  setBots(level: BotLevel | null, count: number) {
    this.bots?.dispose();
    this.bots = null;
    if (level) {
      this.bots = new GunBots(
        level,
        count,
        {
          host: this.host,
          me: () =>
            this.alive ? { id: this.host.selfId, x: this.x, y: this.move.y, z: this.z, crouch: this.crouching } : null,
          shoot: (s) => this.botShot(s),
          killed: (by, target, w, head) => this.onKill(by, target, w, head),
        },
        this.rand() * 2147483646,
      );
    }
    useGunHud.getState().set({ bot: level, botCount: count });
    // o placar contra os bots é só daqui: zera sem avisar ninguém
    this.restart(performance.now(), false);
  }

  /** alguém de verdade entrou: os bots saem (eles só existem neste app) */
  private checkBots(now: number) {
    if (!this.bots || now - this.botCheckAt < BOT_CHECK_MS) return;
    this.botCheckAt = now;
    if (this.host.players().length === 0) return;
    this.setBots(null, useGunHud.getState().botCount);
    useGunHud.getState().set({ notice: 'Alguém entrou no gunfight: os bots saíram.' });
  }

  /** um bot atirou: confere em mim e nos outros bots */
  private botShot(s: BotShot) {
    const now = performance.now();
    const targets: Target[] = [];
    if (this.alive)
      targets.push({ id: this.host.selfId, x: this.x, y: this.move.y, z: this.z, crouch: this.crouching });
    for (const t of this.bots?.targets() ?? []) if (t.id !== s.by) targets.push(t);
    const hit = castShot(s.from, s.dir, targets, GUN_BOXES, 160);
    const to = { x: s.from.x + s.dir.x * hit.dist, y: s.from.y + s.dir.y * hit.dist, z: s.from.z + s.dir.z * hit.dist };
    this.fx.tracer(s.muzzle, to, now);
    this.fx.flash(s.muzzle, now, GUNS[s.w].cls === 'sniper' ? 0.42 : 0.3);
    this.host.emit({ kind: 'gunshot', by: s.by, w: s.w, power: 1, zone: 8, at: s.muzzle });
    this.host.shotFx?.(s.by);
    if (!hit.target) {
      this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: to });
      return;
    }
    const dmg = damageAt(GUNS[s.w], hit.dist, hit.head);
    if (hit.target === this.host.selfId) this.hurt(s.by, dmg, s.w, hit.head, { x: s.from.x, z: s.from.z }, now);
    else {
      this.host.emit({ kind: 'impact', flesh: true, head: hit.head, power: 0.5, zone: 8, at: to });
      this.host.hitFx?.(hit.target);
      this.bots?.hurt(hit.target, dmg, s.by, s.w, hit.head);
    }
  }

  // ------------------------------------------------------------ quadro

  step(dt: number, now: number) {
    if (this.disposed) return;
    this.runJobs(now);
    this.checkBots(now);
    this.trackArms(now);
    // o botão não está mais apertado (soltou fora da janela, sem o evento chegar): solta o gatilho
    if (this.triggerDown && !this.host.held('fire')) this.release('fire');
    this.stepPunch(dt);
    // fim de partida: o vencedor fica na tela e a partida recomeça sozinha depois de um tempo
    if (this.over && now - this.winnerAt > WINNER_MS) this.restart(now, false);
    // morto: espera e renasce
    if (!this.alive) {
      if (this.respawnAt && now >= this.respawnAt && !this.over) this.respawn(now);
      this.stepBots(dt, now);
      this.fx.update(now, this.host.camera.position);
      this.hud(now);
      return;
    }
    const sp = this.spec;
    const yaw = this.host.yaw();
    const w = this.host.wish();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let wx = fx * w.f + rx * w.r;
    let wz = fz * w.f + rz * w.r;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    // recarregando não mira (a recarga ficaria escondida atrás da luneta)
    const adsHeld = this.host.held('ads') && sp.cls !== 'knife' && now >= this.drawUntil && !this.reloadUntil;
    const wantsFire = sp.cls !== 'knife' && (this.host.held('fire') || now < this.fireBufferUntil) && !this.over;
    const r = stepMove(
      this.move,
      { wx, wz, runHeld: this.host.held('run'), forward: w.f > 0.5, ads: adsHeld, gunK: sp.move, firing: wantsFire },
      dt,
      now,
    );
    // saiu da corrida: a arma leva um instante para descer até a linha de tiro
    if (this.wasSprint && !this.move.sprint)
      this.readyAt = now + SPRINT_OUT_MS[sp.cls] * (this.wasTactical ? TACTICAL_OUT_K : 1);
    this.wasSprint = this.move.sprint;
    this.wasTactical = this.move.tactical;
    if (r.landed && !r.bhop)
      this.host.emit({ kind: 'gunfx', what: 'land', w: this.weapon, power: 0.4, zone: 8, at: this.eye });
    const p = resolve(this.host.obstacles, this.x + r.dx, this.z + r.dz);
    // bateu na parede: a velocidade naquele eixo some
    if (Math.abs(p.x - (this.x + r.dx)) > 1e-4) this.move.vx = 0;
    if (Math.abs(p.z - (this.z + r.dz)) > 1e-4) this.move.vz = 0;
    this.x = p.x;
    this.z = p.z;
    const body = bodyYaw(this.ry, Math.atan2(fx, fz), {
      moving: Math.hypot(this.move.vx, this.move.vz) > 0.3,
      engaged: this.firstPerson || adsHeld || wantsFire || this.reloadUntil > 0 || now < this.meleeUntil,
      turning: this.turning,
      dt,
    });
    this.ry = body.ry;
    this.turning = body.turning;
    // olho: em pé, agachado ou deslizando (desce e sobe suave)
    const want = sliding(this.move, now) ? 0.62 : this.move.crouch ? EYE.crouch : EYE.stand;
    this.eyeY += (want - this.eyeY) * Math.min(1, dt * 14);
    // mira: entra no tempo da arma, sai mais rápido
    const adsRate = 1000 / Math.max(1, sp.adsMs);
    this.ads = Math.max(0, Math.min(1, this.ads + (adsHeld ? adsRate : -adsRate * 1.4) * dt));
    // recarga terminou
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.reloadUntil = 0;
      this.finishReload();
    }
    // gatilho: automática enquanto segura; semi e ferrolho uma vez por clique (o clique fica guardado um instante)
    if ((this.triggerDown || now < this.fireBufferUntil) && (sp.auto || this.semiReady)) this.tryFire(now);
    // vida volta sozinha
    if (this.hp < MAX_HP && now - this.lastHurt > REGEN_DELAY_MS)
      this.hp = Math.min(MAX_HP, this.hp + REGEN_PER_S * dt);
    this.host.place({ x: this.x, y: this.move.y, z: this.z, ry: this.ry });
    // primeira pessoa: a arma balança com o mouse, o passo e o movimento
    const look = { yaw: this.host.yaw(), pitch: this.host.pitch() };
    this.vm.update(dt, now, {
      ads: this.ads,
      moving: Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk),
      sprint: this.move.sprint,
      tactical: this.move.tactical,
      slide: sliding(this.move, now),
      crouch: this.move.crouch,
      airborne: !this.move.grounded,
      lookX: look.yaw - this.lookPrev.yaw,
      lookY: look.pitch - this.lookPrev.pitch,
    });
    this.lookPrev = look;
    this.stepBots(dt, now);
    this.fx.update(now, this.host.camera.position);
    this.hud(now);
  }

  /** os bots andam e atiram (não com a partida acabada nem com o menu aberto: é treino, ninguém mais joga) */
  private stepBots(dt: number, now: number) {
    if (!this.bots || this.over || this.host.paused?.()) return;
    this.bots.update(dt, now);
  }

  /**
   * Tranco do recuo: mola amortecida que volta em ~150 ms. Em passos de no máximo 1/120 s (Euler com passo grande
   * explode: com 50 ms por quadro o tranco crescia sem parar), com limite e sem NaN.
   */
  private stepPunch(dt: number) {
    let left = Math.max(0, Math.min(0.25, dt));
    while (left > 1e-6) {
      const h = Math.min(PUNCH_STEP, left);
      this.punchV += (-this.punch * 400 - this.punchV * 40) * h;
      this.punch += this.punchV * h;
      left -= h;
    }
    if (!Number.isFinite(this.punch) || !Number.isFinite(this.punchV)) this.punch = this.punchV = 0;
    this.punch = Math.max(-PUNCH_MAX, Math.min(PUNCH_MAX, this.punch));
  }

  /** a câmera: onde fica o olho (primeira pessoa) e o zoom da mira */
  fov(base: number): number {
    const z = this.spec.zoom;
    return base / (1 + (z - 1) * this.ads);
  }

  get scoped(): boolean {
    return this.spec.scope && this.ads > 0.85;
  }

  /** desenha a arma por cima (primeira pessoa, sem luneta; saindo da luneta, só quando a mira já desceu) */
  render(r: THREE.WebGLRenderer) {
    if (this.leavingScope && (this.ads < 0.6 || !this.spec.scope)) this.leavingScope = false;
    this.vm.render(r, this.firstPerson && this.alive && !this.scoped && !this.leavingScope);
  }

  private hud(now: number) {
    // a luneta abre e fecha no mesmo quadro em que a arma some (sem quadro vazio entre os dois)
    const scoped = this.scoped && this.alive;
    if (scoped !== this.lastScoped) {
      if (!scoped && this.alive) this.leavingScope = true;
      this.lastScoped = scoped;
      useGunHud.getState().set({ scoped, scopeAt: Date.now() });
    }
    if (now - this.lastHud < 50) return;
    this.lastHud = now;
    const am = this.ammo.get(this.weapon);
    const sp = this.spec;
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    const spread = spreadNow(sp, this.ads, moving, this.move.crouch) * (this.move.grounded ? 1 : 2);
    const fovRad = (this.host.camera.fov * Math.PI) / 180;
    const px = (Math.tan(spread) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    // o placar dos outros chega pela pose deles: confere de vez em quando
    if (now - this.lastScores > 500) {
      this.lastScores = now;
      this.pushScores(now);
      // o botão de recomeçar do menu segue a mesma regra do recomeço (`canRestart`)
      useGunHud.getState().set({ canRestart: this.canRestart });
    }
    useGunHud.getState().set({
      hp: Math.max(0, Math.round(this.hp)),
      weapon: this.weapon,
      mag: am?.mag ?? 0,
      reserve: am?.reserve ?? 0,
      reloading: this.reloadUntil > 0,
      ads: this.ads,
      spreadPx: Math.max(6, Math.min(120, px)),
      sprint: this.move.sprint,
    });
  }

  dispose() {
    this.disposed = true;
    this.jobs.length = 0;
    this.bots?.dispose();
    this.bots = null;
    this.fx.dispose();
    this.vm.dispose();
    useGunHud.getState().set({ active: false, bot: null, scoped: false });
  }
}

/**
 * Para onde o corpo olha. Andando, ou na 1ª pessoa, ou mirando/atirando/recarregando/golpeando: vira de vez para a
 * mira (a arma aponta para onde a bala vai, também para quem vê). Parado e à toa na 3ª pessoa: só gira quando a
 * diferença passa de ~50°, até ~10 rad/s, e para de girar quando fica de frente.
 */
export function bodyYaw(
  ry: number,
  aim: number,
  o: { moving: boolean; engaged: boolean; turning: boolean; dt: number },
): { ry: number; turning: boolean } {
  if (o.moving || o.engaged) return { ry: aim, turning: false };
  const d = Math.atan2(Math.sin(aim - ry), Math.cos(aim - ry));
  // começou a girar: vai até ficar de frente (não para na borda da folga)
  if (!o.turning && Math.abs(d) <= TURN_DEADZONE) return { ry, turning: false };
  const step = TURN_RATE * Math.max(0, o.dt);
  if (Math.abs(d) <= step) return { ry: aim, turning: false };
  return { ry: ry + Math.sign(d) * step, turning: true };
}

const v3 = (p: V3): [number, number, number] => [round(p.x), round(p.y), round(p.z)];
const round = (n: number) => Math.round(n * 100) / 100;

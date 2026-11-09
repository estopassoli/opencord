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
import { Casings } from './casings';
import { GunFx } from './fx';
import { applyAttachments, decodeBuild, encodeBuild, type Builds, type GunBuild } from './attachments';
import { makeBuiltGun } from './attachmodels';
import { GUN_BOXES, pickSpawn } from './map';
import { loadGuns } from './models';
import {
  MOVE,
  newMove,
  pressCrouch,
  pressJump,
  pressRun,
  sliding,
  stepMove,
  stopRun,
  type MoveState,
} from './movement';
import { kickSpring, spring, stepSpring } from './spring';
import { useGunHud, type KillFeedItem, type ScoreRow } from './state';
import { Viewmodel } from './viewmodel';
import {
  BASH,
  EYE,
  GUNS,
  HEAVY,
  MAX_HP,
  MELEE_DY,
  REGEN_DELAY_MS,
  REGEN_PER_S,
  RESPAWN_MS,
  WINNER_MS,
  MATCH_MS,
  aimDir,
  ffaTarget,
  burstNow,
  castShot,
  firstShotK,
  damageAt,
  lineOfSight,
  lookAt,
  maxDamage,
  recoilKick,
  recoilMul,
  shotIndex,
  shotInterval,
  shotSpread,
  type GunClass,
  type GunSpec,
  type GunSlot,
  type Loadout,
  type RecoilSpec,
  type ShotState,
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
  /** os acessórios da arma na mão (`encodeBuild`; ausente em app antigo ou de fábrica) */
  att?: number[];
  /** acabou de nascer e está protegido (não leva dano) */
  prot?: boolean;
  /** o alvo de abates e quantos segundos faltam na partida dele (para todos usarem o mesmo relógio) */
  ft?: number;
  fl?: number;
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
  /** altura da área 3D na tela (px): a mira em pixels sai dela (a área pode ser menor que a janela) */
  viewHeight?(): number;
  /** um boneco para os bots (a cena cria e desenha) */
  spawnAvatar(id: string, name: string): BotAvatar;
}

export interface BotPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
  gun: {
    w: GunId;
    pitch: number;
    crouch: boolean;
    ads: boolean;
    alive: boolean;
    act?: GunAct;
    an?: number;
    prot?: boolean;
    /** os acessórios do bot nesta arma */
    build?: GunBuild;
  };
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
  /** acabou de nascer: não leva dano (o boneco fica meio transparente para os outros) */
  prot?: boolean;
  /** o alvo de abates da partida e os segundos que faltam */
  ft: number;
  fl: number;
  /** os acessórios da arma na mão (`encodeBuild`), quando ela não está de fábrica */
  att?: number[];
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
/** limite do tranco da vista (rad) */
const PUNCH_MAX = 0.15;
/** tiros que podem sair num quadro só (quadro lento: a cadência não cai com o fps) */
const MAX_SHOTS_PER_FRAME = 3;
/** proteção ao nascer (ms): não leva dano até lá, ou até o primeiro tiro */
export const SPAWN_PROT_MS = 1500;
/** passada (m) andando e correndo: um som de passo a cada uma */
export const STEP_WALK = 0.55;
export const STEP_RUN = 0.8;
/** relógio da partida: o de outra pessoa só vale se estiver tanto à frente do meu (ms) */
const CLOCK_SLACK_MS = 3000;
/** terceira pessoa parado: o corpo só gira para a mira depois desta diferença (rad) e no máximo nesta velocidade */
const TURN_DEADZONE = 0.87;
const TURN_RATE = 10;

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

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
  /** os acessórios de cada arma (lidos ao nascer) e as armas já montadas (a conta de `applyAttachments`) */
  private builds: Builds;
  private readonly specs = new Map<GunId, GunSpec>();
  /** o equipamento mudou no menu: vale ao nascer, ou na hora se ninguém de verdade está na arena */
  private loadoutDirty = false;
  /** já avisou que o equipamento novo espera o renascer */
  private waitNoted = false;
  private readonly unsubLoadout: () => void;
  private slot: GunSlot = 'primary';
  private ammo = new Map<GunId, Ammo>();
  private nextShot = 0;
  private reloadUntil = 0;
  private reloadEmpty = false;
  private drawUntil = 0;
  private meleeUntil = 0;
  private boltPending = 0;
  /**
   * armas que atiraram e ficaram sem engatilhar (morrer no meio do ferrolho, por exemplo). Trocar de arma engatilha a
   * de ferrolho que estava na mão (o "quickscope e troca": voltando, ela atira depois do saque, sem o ferrolho)
   */
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
  /**
   * tiros da rajada (fração: esfria aos poucos sem atirar, ver `burstNow`) e a hora do último tiro — a hora em que ele
   * devia sair pela cadência, não a do quadro (senão, a 30 qps, a mira começava a voltar no meio da rajada)
   */
  private burstN = 0;
  private lastShotAt = -1e9;
  /**
   * O que o recuo subiu (rad, para cima) e virou (yaw) e ainda vai voltar sozinho, e a volta da arma que atirou (trocar
   * de arma não perde a volta). Puxar o mouse contra o recuo paga essa conta (a volta nunca passa do ponto em que a
   * pessoa mirou).
   */
  private readonly debt = { pitch: 0, yaw: 0 };
  private debtRc: RecoilSpec['recover'] = GUNS.m4.recoil.recover;
  /** a mira depois do último giro feito aqui (o que mudar além disso foi o mouse) */
  private aimMark = { yaw: 0, pitch: 0 };
  private eyeY: number = EYE.stand;
  /** tranco só da vista (rad): para cima, para o lado e rolagem; a mola é a da arma */
  private readonly punch = spring();
  private readonly punchYaw = spring();
  private readonly punchRoll = spring();
  private readonly fx: GunFx;
  /** estojos ejetados (meus, dos outros e dos bots), no mundo */
  private readonly casings: Casings;
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
  /** proteção ao nascer até tal hora */
  private protUntil = 0;
  /** a partida: alvo de abates, quando acaba (no tempo), quando começou e os abates do vencedor ao vencer */
  private target: number;
  private endsAt: number;
  private matchAt: number;
  private winK = 0;
  /** quem me matou e quando (a câmera da morte olha para ele) */
  private killer: string | null = null;
  private diedAt = 0;
  /** passos: o que cada um andou desde o último passo e onde estava (eu, os outros e os bots) */
  private readonly strides = new Map<string, { x: number; z: number; acc: number }>();
  private disposed = false;

  constructor(private readonly host: GunHost) {
    this.vm = new Viewmodel(!!host.reducedMotion);
    this.fx = new GunFx(host.scene);
    this.casings = new Casings(host.scene);
    this.seed = gunSeed(host.selfId, Date.now());
    this.loadout = { ...useGunHud.getState().loadout };
    this.builds = { ...useGunHud.getState().builds };
    this.unsubLoadout = useGunHud.subscribe((st, prev) => {
      if (st.loadout !== prev.loadout || st.builds !== prev.builds) this.loadoutDirty = true;
    });
    const t0 = performance.now();
    this.target = ffaTarget(1 + host.players().length);
    this.matchAt = t0;
    this.endsAt = t0 + MATCH_MS;
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
      target: this.target,
      endsAt: Date.now() + MATCH_MS,
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

  /** a arma na mão já com os acessórios */
  get spec(): GunSpec {
    return this.specOf(this.weapon);
  }

  /** uma arma do equipamento com os acessórios dela */
  private specOf(id: GunId): GunSpec {
    let sp = this.specs.get(id);
    if (!sp) {
      sp = applyAttachments(GUNS[id], this.builds[id]);
      this.specs.set(id, sp);
    }
    return sp;
  }

  /** os acessórios da arma na mão (para o meu boneco) */
  get build(): GunBuild | undefined {
    return this.builds[this.weapon];
  }

  /** o quanto está mirando agora (0–1; a sensibilidade mirando entra aos poucos) */
  get adsFrac(): number {
    return this.ads;
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

  /** tranco da vista (rad para cima): a cena soma na câmera, e o tiro sai do centro da tela que se vê */
  get viewPunch(): number {
    return this.punch.x * this.motionK;
  }

  /** tranco da vista para o lado (rad, no sentido do yaw) */
  get viewPunchYaw(): number {
    return this.punchYaw.x * this.motionK;
  }

  /** rolagem da vista (rad) */
  get viewRoll(): number {
    return this.punchRoll.x * this.motionK;
  }

  /** o que o recuo ainda vai devolver (rad para cima), para os testes */
  get recoilDebt(): number {
    return this.debt.pitch;
  }

  private get motionK() {
    return this.host.reducedMotion ? 0.35 : 1;
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
      ...(this.shielded ? { prot: true } : {}),
      ft: this.target,
      fl: Math.max(0, Math.min(600, Math.ceil((this.endsAt - performance.now()) / 1000))),
      ...this.attField(),
    };
  }

  private attKey = '';
  private attCache: number[] | undefined;
  /** os acessórios da arma na mão no formato da rede (guardado: a pose sai a cada quadro) */
  private attField(): { att?: number[] } {
    const key = `${this.weapon}:${this.builds[this.weapon] ? JSON.stringify(this.builds[this.weapon]) : ''}`;
    if (key !== this.attKey) {
      this.attKey = key;
      this.attCache = encodeBuild(this.builds[this.weapon]);
    }
    return this.attCache ? { att: this.attCache } : {};
  }

  /** acabou de nascer e ainda não atirou: não leva dano */
  get shielded(): boolean {
    return this.alive && performance.now() < this.protUntil;
  }

  /** o alvo de abates desta partida */
  get killTarget(): number {
    return this.target;
  }

  /** morto: de onde veio o tiro (a posição de quem matou, se ainda está na arena) e há quanto tempo (ms) */
  deathView(now = performance.now()): { killer: V3 | null; since: number } | null {
    if (this.alive) return null;
    const id = this.killer;
    let killer: V3 | null = null;
    if (id && id !== this.host.selfId) {
      const p = this.host.players().find((x) => x.id === id) ?? this.bots?.targets().find((t) => t.id === id);
      if (p) killer = { x: p.x, y: p.y + EYE.stand, z: p.z };
    }
    return { killer, since: now - this.diedAt };
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

  /** lê o equipamento e as montagens do menu (as armas montadas são refeitas) */
  private readLoadout() {
    const st = useGunHud.getState();
    this.loadout = { ...st.loadout };
    this.builds = { ...st.builds };
    this.specs.clear();
    this.loadoutDirty = false;
    this.waitNoted = false;
    st.set({ inHand: null });
  }

  /**
   * Mudou o equipamento no menu e ninguém de verdade está na arena (sozinho ou contra bots): troca na hora, com a
   * munição cheia, sem renascer. Com gente, só ao nascer (no meio da luta seria trocar de arma de graça).
   */
  private applyLoadoutNow(now: number) {
    if (!this.loadoutDirty || !this.alive || this.over) return;
    if (this.host.players().length > 0 && !this.shielded) {
      // a lista de armas mostra o que está na mão (não o do menu) e a pessoa fica sabendo quando o novo entra
      if (!this.waitNoted) {
        this.waitNoted = true;
        useGunHud.getState().set({
          inHand: { ...this.loadout },
          slotsAt: Date.now(),
          notice: 'Com gente na arena, o equipamento novo entra quando você renascer.',
        });
      }
      return;
    }
    const slot = this.slot;
    this.readLoadout();
    for (const id of Object.values(this.loadout) as GunId[])
      this.ammo.set(id, { mag: this.specOf(id).mag, reserve: this.specOf(id).reserve });
    this.slot = slot;
    this.needBolt.clear();
    this.resetRecoil();
    this.equip(now);
  }

  private respawn(now: number) {
    this.readLoadout();
    const enemies = [...this.host.players().filter((p) => p.alive), ...(this.bots?.alivePositions() ?? [])];
    const sp = pickSpawn(enemies, this.rand());
    this.protUntil = now + SPAWN_PROT_MS;
    this.killer = null;
    this.x = sp.x;
    this.z = sp.z;
    this.ry = sp.ry;
    this.host.turn(sp.ry + Math.PI - this.host.yaw(), -this.host.pitch());
    // a câmera virou de uma vez: o balanço da arma não pode ler isso como um movimento do mouse
    this.lookPrev = { yaw: this.host.yaw(), pitch: this.host.pitch() };
    this.resetRecoil();
    this.move = newMove();
    this.hp = MAX_HP;
    this.alive = true;
    this.slot = 'primary';
    this.needBolt.clear();
    for (const id of Object.values(this.loadout) as GunId[])
      this.ammo.set(id, { mag: this.specOf(id).mag, reserve: this.specOf(id).reserve });
    this.equip(now);
    this.host.send({ kind: 'spawn', w: this.weapon });
    useGunHud.getState().set({ dead: false, killedBy: null, killedW: null, killedHead: false, hp: this.hp });
  }

  private die(by: string, w: GunId, head: boolean, now: number) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.respawnAt = now + RESPAWN_MS;
    this.killer = by;
    this.diedAt = now;
    this.reloadUntil = 0;
    this.ads = 0;
    this.cancel();
    this.cancelJobs();
    this.debt.pitch = this.debt.yaw = 0;
    // morte por bot não tem matador na rede (o id do bot não é de ninguém): vai sem `by`
    const fromBot = !!this.bots?.has(by);
    this.host.send({ kind: 'die', w, head, ...(fromBot || by === this.host.selfId ? {} : { by }) });
    this.onKill(by, this.host.selfId, w, head);
    useGunHud
      .getState()
      .set({ dead: true, killedBy: by, killedW: w, killedHead: head, respawnAt: Date.now() + RESPAWN_MS });
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
    if (top && top.kills >= this.target) this.win(top, now);
    useGunHud.getState().set({
      scores: rows,
      feed: this.feed,
      winner: this.winner ? this.nameOf(this.winner) : null,
      ...(this.winner ? { winnerAt: Date.now() } : {}),
    });
  }

  private win(top: ScoreRow, now: number) {
    this.winner = top.id;
    this.winK = top.kills;
    this.winnerAt = now;
    this.cancel();
  }

  /**
   * Acabou o tempo: vence quem tem mais abates (empate: menos mortes, a ordem do placar). Sem nenhum abate, a partida
   * só recomeça.
   */
  private timeUp(now: number) {
    const rows = this.scores();
    const top = rows[0];
    if (!top || top.kills === 0) {
      this.restart(now, false);
      return;
    }
    this.win(top, now);
    useGunHud.getState().set({ scores: rows, feed: this.feed, winner: this.nameOf(top.id), winnerAt: Date.now() });
  }

  /** o vencedor (outra pessoa) publica menos abates do que tinha ao vencer, num placar que não é o velho do recomeço */
  private winnerRestarted(): boolean {
    const id = this.winner;
    if (!id || id === this.host.selfId || this.bots?.has(id)) return false;
    const p = this.host.players().find((x) => x.id === id);
    if (p?.k === undefined || p.d === undefined) return false;
    return p.k < this.winK && this.staleScore.get(id) !== `${p.k}:${p.d}`;
  }

  /**
   * O relógio e o alvo da partida de quem começou antes: todos terminam juntos (quem entra no meio pega o relógio de
   * quem já está jogando). Logo depois de um recomeço, a pose velha dos outros não conta.
   */
  private syncClock(now: number) {
    if (this.over || now - this.matchAt < 2500) return;
    for (const p of this.host.players()) {
      if (p.ft === undefined || p.fl === undefined || this.staleScore.has(p.id)) continue;
      const ends = now + p.fl * 1000;
      if (ends < this.endsAt - CLOCK_SLACK_MS) {
        this.endsAt = ends;
        this.target = p.ft;
      }
    }
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
    // o alvo pelo tamanho da partida agora (eu, quem está na arena e os bots) e o relógio do zero
    this.target = ffaTarget(1 + this.host.players().length + (this.bots?.ids().length ?? 0));
    this.matchAt = now;
    this.endsAt = now + MATCH_MS;
    this.winK = 0;
    this.bots?.resetAll(now);
    if (broadcast) this.host.send({ kind: 'restart', w: this.weapon });
    this.respawn(now);
    this.pushScores(now);
  }

  // ------------------------------------------------------------ armas

  /** o recuo começa do zero (renascer, trocar de arma, morrer): nada volta sozinho, nada treme */
  private resetRecoil() {
    this.burstN = 0;
    this.lastShotAt = -1e9;
    this.debt.pitch = this.debt.yaw = 0;
    for (const s of [this.punch, this.punchYaw, this.punchRoll]) s.x = s.v = 0;
    this.markAim();
  }

  private markAim() {
    this.aimMark = { yaw: this.host.yaw(), pitch: this.host.pitch() };
  }

  /** gira a mira (recuo e a volta dele) sem que isso conte como o mouse; devolve o quanto girou de verdade */
  private turnAim(dYaw: number, dPitch: number): { yaw: number; pitch: number } {
    const y0 = this.host.yaw();
    const p0 = this.host.pitch();
    this.host.turn(dYaw, dPitch);
    const d = { yaw: this.host.yaw() - y0, pitch: this.host.pitch() - p0 };
    this.aimMark.yaw += d.yaw;
    this.aimMark.pitch += d.pitch;
    return d;
  }

  private equip(now: number) {
    const id = this.weapon;
    const m = makeBuiltGun(id, this.builds[id]);
    if (!m) return;
    this.burstN = 0;
    // a volta do recuo continua (com a da arma que atirou): trocar logo depois da rajada não deixa a mira lá em cima
    // a arma de antes não tem mais o que fazer (som da recarga, ferrolho, golpe no ar)
    this.cancelJobs('reload', 'bolt', 'melee');
    const sp = this.specOf(id);
    this.vm.setGun(m, sp);
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
    // a arma de ferrolho que sai da mão fica engatilhada (a animação e os sons dela são cancelados no `equip`)
    if (this.spec.boltMs) {
      this.needBolt.delete(this.weapon);
      // a cadência das de ferrolho é o próprio ferrolho (`shotInterval`): engatilhada, quem segura o próximo tiro é
      // o saque (da outra arma agora e desta na volta)
      this.nextShot = Math.min(this.nextShot, now);
    }
    this.slot = slot;
    this.fireBufferUntil = 0;
    this.equip(now);
    // a lista do equipamento aparece um instante (o que há em 1, 2 e 3)
    useGunHud.getState().set({ slotsAt: Date.now(), slot });
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
        if (!this.vm.busy && now > this.reloadUntil) {
          this.vm.play('inspect', this.spec.cls === 'knife' ? 2000 : 2400);
          // quem vê também percebe (o boneco gira a arma)
          this.markAct('inspect');
        }
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
    // a rajada não zera ao soltar: clicando rápido, cada tiro não vale como o primeiro (ver `burstNow`)
    if (a === 'fire') {
      this.triggerDown = false;
      this.semiReady = true;
    }
  }

  /** soltou tudo sem soltar o botão (Esc, outra janela, aba escondida): o gatilho não fica preso */
  cancel() {
    this.triggerDown = false;
    this.semiReady = true;
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
    this.protUntil = 0;
    // o pesado antecipa mais e estoca: o golpe chega no fim da estocada
    this.vm.play(heavy ? 'heavy' : 'melee', ms);
    this.markAct('melee');
    this.host.emit({ kind: 'gunfx', what: 'swing', w: this.weapon, power: heavy ? 0.8 : 0.6, zone: 8, at: this.eye });
    // o rápido precisa de dois golpes; o pesado (mais lento e mais longe) derruba de uma vez
    const { dmg, heavy: heavyDmg, range } = sp.melee;
    this.later('melee', now + ms * (heavy ? 0.45 : 0.3), () =>
      this.meleeHit(sp.id, heavy ? heavyDmg : dmg, range * (heavy ? HEAVY.range : 1)),
    );
  }

  private bash(now: number) {
    if (this.spec.cls === 'knife') return this.knife(now, false);
    if (now < this.meleeUntil || now < this.drawUntil) return;
    this.meleeUntil = now + BASH.ms;
    this.protUntil = 0;
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

  private tryFire(now: number): 'shot' | 'dry' | 'blocked' {
    if (this.spec.cls === 'knife' || !this.canFire(now)) return 'blocked';
    const r = this.fire(now);
    if (r !== 'blocked') this.fireBufferUntil = 0;
    return r;
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
    // atirar tira a proteção de quem acabou de nascer
    this.protUntil = 0;
    // cadência contada do tiro anterior (não do quadro): segurando o gatilho, o atraso do quadro não se perde
    const iv = shotInterval(sp);
    const late = now - this.nextShot;
    const shotAt = late >= 0 && late < iv ? this.nextShot : now;
    this.nextShot = shotAt + iv;
    this.burstN = burstNow(sp, this.burstN, shotAt - this.lastShotAt) + 1;
    const n = Math.floor(this.burstN);
    this.lastShotAt = shotAt;
    // atirar desliga a corrida (o toque no correr precisa ser dado de novo)
    stopRun(this.move);
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    // a dispersão abre com a rajada (os tiros de antes); o primeiro tiro vai mais certo (parado)
    const spread = shotSpread(sp, this.shotState(n, moving, now));
    const o = this.eye;
    const targets = this.targets();
    const aim = this.aimAngles(o, targets);
    const d = aimDir(aim.yaw, aim.pitch, spread, this.rand(), this.rand());
    const hit = castShot(o, d, targets, GUN_BOXES, 160);
    const to = { x: o.x + d.x * hit.dist, y: o.y + d.y * hit.dist, z: o.z + d.z * hit.dist };
    const muzzle = this.muzzleWorld(o, d);
    this.fx.tracer(muzzle, to, now);
    if (!this.firstPerson && !sp.noFlash) this.fx.flash(muzzle, now, sp.cls === 'sniper' ? 0.42 : 0.3);
    this.host.emit({
      kind: 'gunshot',
      by: this.host.selfId,
      w: this.weapon,
      ...(sp.quiet ? { quiet: true } : {}),
      power: 1,
      zone: 8,
      at: muzzle,
    });
    // o coice no meu boneco (3ª pessoa)
    this.host.shotFx?.(this.host.selfId);
    this.host.send({ kind: 'fire', w: this.weapon, from: v3(muzzle), to: v3(to) });
    if (hit.target) this.dealDamage(hit.target, damageAt(sp, hit.dist, hit.head), hit.head, to);
    else {
      this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.5, zone: 8, at: to });
      if (hit.normal) this.fx.mark(to, hit.normal, now);
    }
    this.kick(n);
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

  /** o estado para a dispersão do tiro `n` (o tiro e a mira desenhada usam o mesmo) */
  private shotState(n: number, moving: number, now: number): ShotState {
    return {
      ads: this.ads,
      moving,
      crouch: this.move.crouch,
      grounded: this.move.grounded,
      sliding: sliding(this.move, now),
      scoped: this.scoped,
      n,
    };
  }

  /**
   * Recuo do tiro `n`: a mira sobe e vai para o lado pelo padrão da arma (menos mirando e agachado), e uma parte disso
   * volta sozinha depois (`stepRecoil`). Por cima, o tranco só da vista e o coice da arma na mão.
   */
  private kick(n: number) {
    const sp = this.spec;
    const rc = sp.recoil;
    const k = recoilKick(sp, n, this.rand(), this.rand());
    const mul = recoilMul(this.ads, this.move.crouch);
    const up = k.up * mul.up;
    const side = k.side * mul.side;
    // o lado do tiro (para a rolagem e o coice da arma): o do padrão; reto, alterna
    const sgn = side > 1e-6 ? 1 : side < -1e-6 ? -1 : n % 2 ? 1 : -1;
    // a conta da volta é o quanto a mira andou (olhando para o alto, ela para no limite e não pode voltar além dele)
    const moved = this.turnAim(-side, -up);
    this.debtRc = rc.recover;
    this.debt.pitch += -moved.pitch * rc.recover.frac;
    this.debt.yaw += moved.yaw * rc.recover.frac;
    // tranco da vista: menor mirando (a mira de ferro e a luneta não saem do lugar de vez)
    const first = firstShotK(sp, n);
    const pk = (1 - 0.3 * this.ads) * mul.up * first;
    const { k: sk, c: sc } = rc.punch;
    kickSpring(this.punch, sk, sc, rc.punch.up * pk);
    kickSpring(this.punchYaw, sk, sc, -side * 0.3);
    kickSpring(this.punchRoll, sk, sc, rc.punch.roll * pk * sgn);
    this.vm.fire(sgn, first);
  }

  /**
   * A volta do recuo e o mouse: o que a pessoa puxou contra o recuo desconta da conta; depois de um tempo sem atirar, o
   * resto volta sozinho (exponencial). Roda no começo do quadro, antes do tiro.
   */
  private stepRecoil(dt: number, now: number) {
    const dP = this.host.pitch() - this.aimMark.pitch;
    const dY = this.host.yaw() - this.aimMark.yaw;
    // mouse para baixo (pitch cresce) paga a subida; mouse contra o lado paga o lado
    if (dP > 0) this.debt.pitch = Math.max(0, this.debt.pitch - dP);
    if (dY * this.debt.yaw < 0)
      this.debt.yaw = Math.sign(this.debt.yaw) * Math.max(0, Math.abs(this.debt.yaw) - Math.abs(dY));
    const rc = this.debtRc;
    // segurando o gatilho de uma automática com bala, a mira não volta (nem com o quadro atrasado passando do `delay`)
    const am = this.ammo.get(this.weapon);
    const holding = this.triggerDown && this.spec.auto && !!am && am.mag > 0;
    if (!holding && now - this.lastShotAt > rc.delay && (this.debt.pitch > 1e-7 || Math.abs(this.debt.yaw) > 1e-7)) {
      const r = 1 - Math.exp(-Math.max(0, dt) / rc.tau);
      const p = this.debt.pitch * r;
      const y = this.debt.yaw * r;
      this.debt.pitch -= p;
      this.debt.yaw -= y;
      this.turnAim(-y, p);
    }
    this.markAim();
  }

  /** o ferrolho: abre (com a mão), fecha e a arma fica pronta */
  private scheduleBolt(at: number, id: GunId, boltMs: number) {
    const ms = Math.max(200, boltMs - 120);
    this.later('bolt', at, (t) => {
      if (this.weapon !== id || !this.alive) return;
      this.vm.play('bolt', ms);
      this.markAct('bolt');
      // o som segue a mão: a alavanca sobe (u ~0,15), o ferrolho vem para trás (~0,45) e fecha (~0,62)
      const fx = (what: 'boltOpen' | 'boltPull', k: number) =>
        this.later('bolt', t + ms * k, () => {
          if (this.weapon === id && this.alive)
            this.host.emit({ kind: 'gunfx', what, w: id, power: 0.6, zone: 8, at: this.eye });
        });
      fx('boltOpen', 0.15);
      fx('boltPull', 0.45);
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
    // o centro da tela com o tranco da vista: a bala vai onde a mira está desenhada. O tranco entra inteiro mesmo com
    // "reduzir movimento" (que só diminui o que a câmera mostra): a opção de acessibilidade não pode virar vantagem
    const yaw = this.host.yaw() + this.punchYaw.x;
    const pitch = this.host.pitch() - this.punch.x;
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

  /** estojo de um boneco que atirou de `from` para `to` (no ferrolho, sai quando a mão abre a culatra) */
  private ejectThird(w: GunId, from: V3, to: V3, feet: number | null, now: number) {
    const sp = GUNS[w];
    if (sp.cls === 'knife') return;
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const delay = sp.boltMs ? 120 + Math.max(200, sp.boltMs - 120) * 0.45 : 0;
    this.casings.ejectFrom(w, from, d, null, feet ?? from.y - 1.3, now, delay);
  }

  /** acertei alguém: bot leva aqui; gente de verdade leva pela rede */
  private dealDamage(id: string, dmg: number, head: boolean, at: V3) {
    // acabou de nascer: o tiro bate, mas não conta (sem marcador de acerto)
    const shielded = this.bots?.has(id) ? this.bots.shielded(id) : !!this.host.players().find((p) => p.id === id)?.prot;
    if (shielded) {
      this.host.emit({ kind: 'impact', flesh: true, head, power: 0.4, zone: 8, at });
      return;
    }
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
    if (!this.alive || this.over || now < this.protUntil) return;
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
          const who = this.host.players().find((p) => p.id === g.sender);
          // os acessórios da arma dele (da pose; a arma do tiro tem que ser a da mão)
          const sp = applyAttachments(GUNS[g.w], who?.w === g.w ? decodeBuild(g.w, who.att) : undefined);
          this.fx.tracer(a, b, now);
          if (!sp.noFlash) this.fx.flash(a, now, sp.cls === 'sniper' ? 0.42 : 0.3);
          this.ejectThird(g.w, a, b, who?.y ?? null, now);
          this.host.emit({
            kind: 'gunshot',
            by: g.sender,
            w: g.w,
            ...(sp.quiet ? { quiet: true } : {}),
            power: 1,
            zone: 8,
            at: a,
          });
          this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: b });
          this.markWall({ x: g.from[0], y: g.from[1], z: g.from[2] }, b, now);
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

  /** marca na parede no fim de um tiro que veio da rede (de onde ele saiu até onde parou) */
  private markWall(from: V3, to: V3, now: number) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.1) return;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const h = castShot(from, d, [], GUN_BOXES, len + 0.2);
    // só se o fim do tiro é mesmo uma parede (senão ele parou num corpo)
    if (h.normal && Math.abs(h.dist - len) < 0.25)
      this.fx.mark({ x: from.x + d.x * h.dist, y: from.y + d.y * h.dist, z: from.z + d.z * h.dist }, h.normal, now);
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
          shielded: () => this.shielded,
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
    const sp = applyAttachments(GUNS[s.w], s.build);
    this.fx.tracer(s.muzzle, to, now);
    if (!sp.noFlash) this.fx.flash(s.muzzle, now, sp.cls === 'sniper' ? 0.42 : 0.3);
    this.ejectThird(s.w, s.muzzle, to, this.bots?.targets().find((t) => t.id === s.by)?.y ?? null, now);
    this.host.emit({
      kind: 'gunshot',
      by: s.by,
      w: s.w,
      ...(sp.quiet ? { quiet: true } : {}),
      power: 1,
      zone: 8,
      at: s.muzzle,
    });
    this.host.shotFx?.(s.by);
    if (!hit.target) {
      this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: to });
      if (hit.normal) this.fx.mark(to, hit.normal, now);
      return;
    }
    const dmg = damageAt(sp, hit.dist, hit.head);
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
    this.applyLoadoutNow(now);
    this.trackArms(now);
    // o botão não está mais apertado (soltou fora da janela, sem o evento chegar): solta o gatilho
    if (this.triggerDown && !this.host.held('fire')) this.release('fire');
    this.stepPunch(dt);
    this.stepRecoil(dt, now);
    // fim de partida: o vencedor fica na tela e a partida recomeça sozinha depois de um tempo
    if (this.over && now - this.winnerAt > WINNER_MS) this.restart(now, false);
    // acabou o tempo da partida
    if (!this.over && now >= this.endsAt) this.timeUp(now);
    this.stepStrides(dt);
    // morto: espera e renasce
    if (!this.alive) {
      if (this.respawnAt && now >= this.respawnAt && !this.over) this.respawn(now);
      this.strides.delete(this.host.selfId);
      this.stepBots(dt, now);
      this.fx.update(now, this.host.camera.position);
      this.stepCasings(dt, now);
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
    for (let i = 0; i < MAX_SHOTS_PER_FRAME; i++) {
      if (!((this.triggerDown || now < this.fireBufferUntil) && (sp.auto || this.semiReady))) break;
      if (this.tryFire(now) !== 'shot') break;
    }
    // vida volta sozinha
    if (this.hp < MAX_HP && now - this.lastHurt > REGEN_DELAY_MS)
      this.hp = Math.min(MAX_HP, this.hp + REGEN_PER_S * dt);
    this.host.place({ x: this.x, y: this.move.y, z: this.z, ry: this.ry });
    // os meus passos (agachado e deslizando, sem som; no ar, também não)
    if (this.move.grounded && !this.move.crouch && !sliding(this.move, now))
      this.stride(this.host.selfId, this.x, this.z, this.move.sprint, this.move.tactical, 0.25);
    else this.strides.delete(this.host.selfId);
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
    this.stepCasings(dt, now);
    this.hud(now);
  }

  /**
   * Estojos: os que saíram da arma da primeira pessoa (espaço da câmera do viewmodel) vão para o mundo pela tela — o
   * ponto na mesma distância da câmera, na mesma direção da tela (as duas câmeras têm campos de visão diferentes) — com
   * a minha velocidade somada; na 3ª pessoa, saem da arma do meu boneco. Depois anda a física de todos.
   */
  private stepCasings(dt: number, now: number) {
    const ej = this.vm.ejects;
    if (ej.length) {
      const cam = this.host.camera;
      cam.updateMatrixWorld();
      const mine = { x: this.move.vx, y: 0, z: this.move.vz };
      for (const e of ej) {
        if (!this.firstPerson || !this.alive) {
          const m = this.host.muzzle?.();
          if (m)
            this.casings.ejectFrom(
              this.weapon,
              m,
              aimDir(this.host.yaw(), this.host.pitch(), 0, 0, 0),
              mine,
              this.move.y,
              now,
            );
          continue;
        }
        const dist = e.at.length();
        TMP.copy(e.at).project(this.vm.camera);
        TMP.set(TMP.x, TMP.y, 0.5).unproject(cam).sub(cam.position).normalize();
        const at = TMP.multiplyScalar(dist).add(cam.position);
        const vel = e.vel.applyQuaternion(cam.quaternion).add(TMP2.set(mine.x, 0, mine.z));
        this.casings.eject(this.weapon, at, vel, e.axis.applyQuaternion(cam.quaternion), this.move.y, now);
      }
      ej.length = 0;
    }
    this.casings.update(dt, now);
  }

  /**
   * Um passo a cada passada (0,55 m andando, 0,8 m correndo): o som de passo vai para quem ouve (o som pela distância
   * e pelo lado). `gain` é o meu (baixo) ou o dos outros (mais alto: é informação).
   */
  private stride(id: string, x: number, z: number, run: boolean, tactical: boolean, gain: number) {
    const s = this.strides.get(id);
    if (!s) {
      this.strides.set(id, { x, z, acc: 0 });
      return;
    }
    const d = Math.hypot(x - s.x, z - s.z);
    s.x = x;
    s.z = z;
    // pulo de posição (renasceu, a pose chegou de longe): não é passo
    if (d > 2) {
      s.acc = 0;
      return;
    }
    s.acc += d;
    const len = run ? STEP_RUN : STEP_WALK;
    if (s.acc < len) return;
    s.acc -= len;
    this.host.emit({
      kind: 'gunfx',
      what: 'step',
      w: this.weapon,
      by: id,
      power: Math.min(1, gain * (tactical ? 1.2 : 1)),
      zone: 8,
      at: { x, y: 0, z },
    });
  }

  /** os passos dos outros e dos bots, pelo quanto o boneco andou neste quadro (agachado, sem som) */
  private stepStrides(dt: number) {
    const seen = new Set<string>([this.host.selfId]);
    const others: { id: string; x: number; z: number; crouch: boolean }[] = [
      ...this.host.players().filter((p) => p.alive),
      ...(this.bots?.targets() ?? []),
    ];
    for (const p of others) {
      seen.add(p.id);
      const s = this.strides.get(p.id);
      const sp = s && dt > 0 ? Math.hypot(p.x - s.x, p.z - s.z) / dt : 0;
      if (p.crouch) {
        this.strides.delete(p.id);
        continue;
      }
      this.stride(p.id, p.x, p.z, sp > 3.6, sp > 5.6, 0.55);
    }
    for (const id of this.strides.keys()) if (!seen.has(id)) this.strides.delete(id);
  }

  /** os bots andam e atiram (não com a partida acabada nem com o menu aberto: é treino, ninguém mais joga) */
  private stepBots(dt: number, now: number) {
    if (!this.bots || this.over || this.host.paused?.()) return;
    this.bots.update(dt, now);
  }

  /** tranco da vista: a mola da arma (a sniper sobe muito e desce devagar; o fuzil é curto), com limite */
  private stepPunch(dt: number) {
    const { k, c } = this.spec.recoil.punch;
    for (const s of [this.punch, this.punchYaw, this.punchRoll]) {
      stepSpring(s, k, c, dt);
      s.x = Math.max(-PUNCH_MAX, Math.min(PUNCH_MAX, s.x));
    }
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
      useGunHud.getState().set({ scoped, scopeAt: Date.now(), scopeStyle: this.spec.scopeStyle ?? 'sniper' });
    }
    if (now - this.lastHud < 50) return;
    this.lastHud = now;
    const am = this.ammo.get(this.weapon);
    const sp = this.spec;
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    // a mesma conta do próximo tiro: abre com a rajada e fecha quando ela esfria
    const n = shotIndex(burstNow(sp, this.burstN, now - this.lastShotAt));
    const spread = shotSpread(sp, this.shotState(n, moving, now));
    const fovRad = (this.host.camera.fov * Math.PI) / 180;
    // a altura da área 3D (o Espaço pode ser menor que a janela)
    const pxPerRad = (this.host.viewHeight?.() || window.innerHeight) / 2 / Math.tan(fovRad / 2);
    const px = Math.tan(spread) * pxPerRad;
    // o placar dos outros chega pela pose deles: confere de vez em quando
    if (now - this.lastScores > 500) {
      this.lastScores = now;
      this.syncClock(now);
      this.pushScores(now);
      // o botão de recomeçar do menu segue a mesma regra do recomeço (`canRestart`)
      useGunHud.getState().set({
        canRestart: this.canRestart,
        target: this.target,
        endsAt: Date.now() + Math.max(0, this.endsAt - now),
      });
    }
    useGunHud.getState().set({
      hp: Math.max(0, Math.round(this.hp)),
      weapon: this.weapon,
      mag: am?.mag ?? 0,
      reserve: am?.reserve ?? 0,
      reloading: this.reloadUntil > 0,
      ads: this.ads,
      spreadPx: Math.max(6, Math.min(120, px)),
      // a luneta pula um pouco com o tranco (o retículo continua no centro da arma)
      scopeKick: scoped ? Math.tan(this.viewPunch) * pxPerRad * 0.4 : 0,
      sprint: this.move.sprint,
      // o vigor muda pouco a cada envio: em passos de 1% (a barra só aparece abaixo de cheio)
      stamina: Math.round(this.move.stamina * 100) / 100,
      shielded: this.shielded,
    });
  }

  dispose() {
    this.disposed = true;
    this.jobs.length = 0;
    this.bots?.dispose();
    this.bots = null;
    this.fx.dispose();
    this.casings.dispose();
    this.vm.dispose();
    this.unsubLoadout();
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

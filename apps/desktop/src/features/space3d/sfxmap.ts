/**
 * Som do jogo do Espaço 3D (plano 2026-11-09, P6), parte pura: que som cada `GameEvent` faz e com que ganho, e a
 * mixagem (distância, panorâmica leve, ducking e teto do volume). Sem Web Audio aqui: o motor fica em `sfx.ts`.
 * O gunfight toca gravações reais CC0 (`sfxbank.ts`, créditos em `assets/sfx/CREDITS.md`); o que não tem gravação,
 * ou cuja gravação não carregou, cai na receita sintetizada de `sfx.ts`. Nenhum som de outro jogo.
 */
import { SPACE_VOICE_FLOOR, spaceVoiceGain, type GunId } from '@opencord/contracts';
import type { At, GameEvent, GameEventKind } from './events';

export type SfxName =
  // bola
  | 'bounce'
  | 'bounceTable'
  | 'kick'
  | 'kickHard'
  | 'racket'
  | 'paddle'
  | 'spike'
  | 'shoot'
  | 'whiff'
  | 'rim'
  | 'board'
  | 'swish'
  | 'post'
  | 'wall'
  | 'netTouch'
  // sinuca
  | 'cueHit'
  | 'ballClack'
  | 'cushion'
  | 'pocket'
  // placar e fim
  | 'whistle'
  | 'scoreUs'
  | 'scoreThem'
  | 'win'
  | 'lose'
  // contagem e corrida
  | 'count'
  | 'go'
  | 'lap'
  | 'finalLap'
  | 'finish'
  | 'boostPad'
  | 'boostFire'
  | 'itemGet'
  // x1
  | 'swing'
  | 'punch'
  | 'block'
  | 'ko'
  | 'bell'
  // carga e menu
  | 'chargeTick'
  | 'sweetSpot'
  | 'uiMove'
  | 'uiOk'
  | 'uiBack'
  // gunfight
  | 'shotRifle'
  | 'shotAk'
  | 'shotSmg'
  | 'shotSniper'
  | 'shotPistol'
  | 'shotDeagle'
  | 'knifeSwing'
  | 'magOut'
  | 'magIn'
  | 'charge'
  | 'boltOpen'
  | 'boltClose'
  | 'boltPull'
  | 'dryFire'
  | 'hitmarker'
  | 'headshot'
  | 'killConfirm'
  | 'hurt'
  | 'slideFx'
  | 'land'
  | 'impactWall'
  | 'impactFlesh'
  | 'drawGun'
  | 'step'
  | 'shotFar'
  | 'shellCase';

/** um som a tocar */
export interface SfxCue {
  name: SfxName;
  /** ganho relativo 0–1 (antes da mixagem) */
  gain: number;
  /** multiplicador do tom (1 = normal) */
  pitch?: number;
  /** é informação (placar, apito, contagem): abaixa menos quando alguém fala */
  info?: boolean;
  /** varia o tom um pouco a cada vez (±fração): a rajada não soa como o mesmo som repetido */
  jitter?: number;
  /** de longe (além de `SFX_FAR_M`), toca este no lugar (o estampido abafado de longe) */
  far?: SfxName;
  /**
   * variante da gravação dentro do som (ex.: a arma no tiro, "pistol" na recarga): se o banco tem `nome:variante`,
   * toca essa gravação (e o `pitch` da família não se aplica: a gravação já é daquela arma); senão, a do nome
   */
  sample?: string;
  /** atraso (s) antes de tocar (o cartucho caindo depois do tiro) */
  delay?: number;
}

/** a partir de quantos metros o tiro de outra pessoa soa de longe */
export const SFX_FAR_M = 25;

/** de quem é o ponto: o meu time ouve "subindo", o outro "descendo" */
export interface SfxCtx {
  me: string;
  team: 'a' | 'b';
}

/** "sem som": o evento existe, mas o som dele sai de outro lugar ou não faz sentido */
export const NO_SOUND = 'sem som' as const;

type Mapper<K extends GameEventKind> = (e: Extract<GameEvent, { kind: K }>, ctx: SfxCtx) => SfxCue[];

const lin = (p: number, lo: number, hi: number) => lo + (hi - lo) * Math.max(0, Math.min(1, p));

/** tom do quique pelo tamanho da bola de cada arena (basquete grave, tênis médio, ping pong agudo) */
export const BOUNCE_PITCH: Record<number, number> = { 1: 0.8, 2: 0.7, 3: 1.35, 4: 1, 5: 2 };

/** placar: ponto do meu time sobe, do outro desce; gol e ponto de rede ganham apito; cesta, o "swish" */
function scoreCues(e: Extract<GameEvent, { kind: 'score' }>, ctx: SfxCtx): SfxCue[] {
  const out: SfxCue[] = [];
  if (e.reason === 'cesta') out.push({ name: 'swish', gain: 0.8 });
  else if (e.reason !== 'caçapa' && e.reason !== 'caiu') out.push({ name: 'whistle', gain: 0.75, info: true });
  out.push({ name: e.side === ctx.team ? 'scoreUs' : 'scoreThem', gain: 0.7, info: true });
  return out;
}

/**
 * Cada tipo de evento tem um som ou está marcado como "sem som" (o teste confere que nenhum fica de fora). O tipo
 * obriga a cobrir todo `GameEventKind`: evento novo sem entrada aqui não compila.
 */
export const SFX_MAP: { [K in GameEventKind]: Mapper<K> | typeof NO_SOUND } = {
  kick: (e) => [e.power >= 0.9 ? { name: 'kickHard', gain: 1 } : { name: 'kick', gain: lin(e.power, 0.35, 0.9) }],
  hit: (e) => {
    if (e.with === 'racket')
      return [
        { name: e.zone === 5 ? 'paddle' : 'racket', gain: lin(e.power, 0.45, 1), pitch: lin(e.power, 0.92, 1.1) },
      ];
    if (e.with === 'hip') return [{ name: 'kick', gain: lin(e.power, 0.3, 0.7) }];
    // mão: no basquete é o arremesso (sopro da bola saindo); no vôlei, a manchete/cortada
    if (e.zone === 1) return [{ name: 'shoot', gain: lin(e.power, 0.35, 0.8) }];
    return [{ name: 'spike', gain: lin(e.power, 0.45, 1) }];
  },
  whiff: () => [{ name: 'whiff', gain: 0.5 }],
  bounce: (e) =>
    e.power < 0.04
      ? []
      : e.surface === 'table'
        ? [{ name: 'bounceTable', gain: lin(e.power, 0.35, 0.9) }]
        : [
            {
              name: 'bounce',
              gain: lin(e.power, 0.25, 0.9),
              pitch: (BOUNCE_PITCH[e.zone] ?? 1) * lin(e.power, 0.95, 1.08),
            },
          ],
  surface: (e) => {
    const gain = lin(e.power, 0.3, 1);
    switch (e.surface) {
      case 'rim':
        return [{ name: 'rim', gain }];
      case 'board':
        return [{ name: 'board', gain }];
      case 'post':
        return [{ name: 'post', gain }];
      case 'net':
        return [{ name: 'netTouch', gain: lin(e.power, 0.3, 0.7) }];
      default:
        return [{ name: 'wall', gain: lin(e.power, 0.2, 0.8) }];
    }
  },
  score: scoreCues,
  pocket: (e) => [{ name: 'pocket', gain: lin(e.power, 0.5, 1) }],
  ballHit: (e) => [{ name: 'ballClack', gain: lin(e.power, 0.2, 1), pitch: lin(e.power, 0.95, 1.06) }],
  cushion: (e) => [{ name: 'cushion', gain: lin(e.power, 0.2, 0.8) }],
  cue: (e) => [{ name: 'cueHit', gain: lin(e.power, 0.4, 1) }],
  boost: (e) => [e.source === 'pad' ? { name: 'boostPad', gain: 0.7 } : { name: 'boostFire', gain: 0.85 }],
  item: () => [{ name: 'itemGet', gain: 0.6 }],
  lap: () => [{ name: 'lap', gain: 0.7, info: true }],
  finalLap: () => [{ name: 'finalLap', gain: 0.9, info: true }],
  finish: () => [{ name: 'finish', gain: 0.9, info: true }],
  punch: (e) => {
    // soco no ar: o vento do golpe (o meu sai no clique, sem esperar o servidor)
    if (!e.landed) return [{ name: 'swing', gain: e.strong ? 0.8 : 0.5 }];
    if (e.blocked) return [{ name: 'block', gain: 0.7 }];
    return [{ name: 'punch', gain: lin(e.power, 0.6, 1), pitch: e.strong ? 0.85 : 1 }];
  },
  ko: () => [{ name: 'ko', gain: 1 }],
  countdown: () => [{ name: 'count', gain: 0.7, info: true }],
  go: () => [{ name: 'go', gain: 0.85, info: true }],
  // dominar: um toque leve no pé
  control: () => [{ name: 'kick', gain: 0.3, pitch: 1.15 }],
  // drible: o vento do corpo passando (a bicicleta ainda tem o chute forte, pelo evento do chute)
  trick: (e) => [{ name: 'swing', gain: e.trick === 'bicicleta' ? 0.9 : 0.6, pitch: e.trick === 'elastico' ? 1.2 : 1 }],
  // falta: apito; desarme limpo: o choque na bola
  gunshot: (e, ctx) => {
    const mine = e.by === ctx.me;
    const shot: SfxCue = {
      name: SHOT_SOUND[e.w],
      gain: mine ? 1 : 0.9,
      pitch: SHOT_PITCH[e.w] ?? 1,
      jitter: 0.03,
      sample: e.w,
      ...(mine ? {} : { far: 'shotFar' as const }),
    };
    // o meu cartucho caindo no chão (o das facas não existe; o das snipers de ferrolho sai no ferrolho)
    if (!mine || !SHELL_AFTER_SHOT.has(e.w)) return [shot];
    return [shot, { name: 'shellCase', gain: 0.22, jitter: 0.06, delay: 0.32 }];
  },
  impact: (e) => [e.flesh ? { name: 'impactFlesh', gain: 0.6 } : { name: 'impactWall', gain: 0.45 }],
  gunfx: (e) => {
    // a corrida tática não tem som próprio (o passo já muda)
    if (e.what === 'tactical') return [];
    // passo: o ganho vem no `power` (o meu baixo, o dos outros mais alto: é informação de onde a pessoa está)
    if (e.what === 'step') return [{ name: 'step', gain: e.power, jitter: 0.08 }];
    const g: Record<string, [SfxName, number]> = {
      draw: ['drawGun', 0.5],
      magOut: ['magOut', 0.6],
      magIn: ['magIn', 0.7],
      charge: ['charge', 0.7],
      boltOpen: ['boltOpen', 0.7],
      boltClose: ['boltClose', 0.7],
      boltPull: ['boltPull', 0.55],
      dry: ['dryFire', 0.6],
      hitmarker: ['hitmarker', 0.8],
      headshot: ['headshot', 0.9],
      kill: ['killConfirm', 0.9],
      hurt: ['hurt', 0.8],
      slide: ['slideFx', 0.55],
      land: ['land', 0.4],
      swing: ['knifeSwing', 0.7],
    };
    const [name, gain] = g[e.what] ?? ['dryFire', 0.5];
    const cue: SfxCue = { name, gain, info: e.what === 'kill' || e.what === 'hitmarker' || e.what === 'headshot' };
    // recarga, ferrolho, saque e clique seco: a gravação da família da arma (pistola, SMG, AK, fuzil, ferrolho)
    if (GUN_HANDLING.has(e.what)) cue.sample = GUN_CLASS[e.w];
    // vento do golpe, passo e deslize variam um pouco: não soam como o mesmo arquivo repetido
    if (e.what === 'swing' || e.what === 'slide' || e.what === 'land') cue.jitter = 0.05;
    // o cartucho do ferrolho sai quando ele abre
    if (e.what === 'boltPull' && e.by === undefined)
      return [cue, { name: 'shellCase', gain: 0.22, jitter: 0.06, delay: 0.25 }];
    return [cue];
  },
  tackle: (e) =>
    e.foul
      ? [
          { name: 'block', gain: 0.6 },
          { name: 'whistle', gain: 0.8, info: true },
        ]
      : [{ name: 'kick', gain: 0.7, pitch: 0.9 }],
};

/** o estampido de cada arma (as facas usam o vento do golpe) */
const SHOT_SOUND: Record<GunId, SfxName> = {
  m4: 'shotRifle',
  ak47: 'shotAk',
  mp7: 'shotSmg',
  mp5: 'shotSmg',
  l115: 'shotSniper',
  m200: 'shotSniper',
  kar98k: 'shotSniper',
  m9: 'shotPistol',
  deagle: 'shotDeagle',
  karambit: 'knifeSwing',
  bayonet: 'knifeSwing',
};

/** família da arma para as gravações de manuseio (recarga, ferrolho, saque, clique seco) */
export const GUN_CLASS: Record<GunId, string> = {
  m4: 'rifle',
  ak47: 'ak',
  mp7: 'smg',
  mp5: 'smg',
  l115: 'bolt',
  m200: 'bolt',
  // a Kar98k não tem pente que sai: recarrega por pente-lâmina pela janela do ferrolho
  kar98k: 'clip',
  m9: 'pistol',
  deagle: 'pistol',
  karambit: 'knife',
  bayonet: 'knife',
};

/** sons de manuseio que têm gravação por família de arma */
const GUN_HANDLING = new Set<string>(['draw', 'magOut', 'magIn', 'charge', 'boltOpen', 'boltClose', 'boltPull', 'dry']);

/** armas cujo cartucho cai logo depois do tiro (as de ferrolho soltam o cartucho ao abrir; facas não têm) */
const SHELL_AFTER_SHOT = new Set<GunId>(['m4', 'ak47', 'mp7', 'mp5', 'm9', 'deagle']);

/** o tom de cada arma por cima do estampido da família (as três snipers e as duas SMGs não soam iguais) */
const SHOT_PITCH: Partial<Record<GunId, number>> = { kar98k: 1.12, m200: 0.9, mp7: 1.1, mp5: 0.95 };

/** sons de um evento (vazio = sem som) */
export function sfxFor(e: GameEvent, ctx: SfxCtx): SfxCue[] {
  const m = SFX_MAP[e.kind] as Mapper<GameEventKind> | typeof NO_SOUND;
  return m === NO_SOUND ? [] : m(e as Extract<GameEvent, { kind: GameEventKind }>, ctx);
}

/**
 * Um som "mais forte" corta o mais fraco que saiu junto (ex.: a última volta e a volta no mesmo quadro, o KO e o
 * soco). Quem está à esquerda tira os da direita que começaram há menos de `SUPERSEDE_MS`.
 */
export const SUPERSEDES: Partial<Record<SfxName, SfxName[]>> = {
  finalLap: ['lap'],
  finish: ['lap', 'finalLap'],
  ko: ['punch', 'block'],
  kickHard: ['kick'],
  go: ['count'],
};
export const SUPERSEDE_MS = 150;

// ---------- mixagem ----------

/** efeito longe cai até aqui (a voz fica em SPACE_VOICE_FLOOR; efeito pode ser mais baixo) */
export const SFX_FLOOR = 0.15;
/** panorâmica máxima (−1 esquerda … +1 direita): leve, só para efeitos curtos (ADR-0055, adendo) */
export const SFX_PAN_MAX = 0.5;
/** no gunfight (zona 8) o lado importa: de onde veio o tiro e o passo */
export const SFX_PAN_GUN = 0.8;
/** ducking: alguém fala perto */
export const SFX_DUCK = 0.4;
/** placar, apito e contagem abaixam menos: são informação */
export const SFX_DUCK_INFO = 0.7;
/** teto do mestre: 0,25·vol² (efeito nunca passa a voz de quem fala) */
export const SFX_MASTER = 0.25;

/** ganho pela distância: a mesma curva da voz, com piso mais baixo (0,15) */
export function sfxDistanceGain(d: number): number {
  const g = spaceVoiceGain(d);
  const k = (g - SPACE_VOICE_FLOOR) / (1 - SPACE_VOICE_FLOOR);
  return SFX_FLOOR + (1 - SFX_FLOOR) * Math.max(0, Math.min(1, k));
}

/** quem ouve: posição (o meu boneco) e para onde a câmera olha */
export interface Listener {
  x: number;
  z: number;
  /** ângulo da câmera (o mesmo `yaw` da cena: frente = (−sen, −cos)) */
  yaw: number;
  zone: number;
}

/** panorâmica pelo ângulo do som em relação à câmera, limitada a ±0,5 (±0,8 no gunfight) */
export function sfxPan(l: Listener, at: Pick<At, 'x' | 'z'>): number {
  const dx = at.x - l.x;
  const dz = at.z - l.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return 0;
  // vetor "direita" da câmera
  const side = (dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / d;
  const max = l.zone === 8 ? SFX_PAN_GUN : SFX_PAN_MAX;
  return Math.max(-max, Math.min(max, side * max));
}

/**
 * Gravação de longe soa abafada: corte do passa-baixa (Hz) pela distância (m). Até 4 m sem filtro (null); depois cai
 * exponencialmente até o piso de 1,8 kHz (o estampido distante perde o estalo e fica só o estrondo).
 */
export function sfxLowpassHz(d: number | undefined): number | null {
  if (d === undefined || !Number.isFinite(d) || d <= 4) return null;
  return Math.max(1800, 20000 * Math.exp(-(d - 4) / 22));
}

/** curva perceptual do mestre: 0,25·vol² */
export function sfxMaster(vol: number): number {
  const v = Math.max(0, Math.min(1, vol));
  return SFX_MASTER * v * v;
}

/**
 * Ganho final de um som: mestre × distância × ducking × ganho da receita, sempre ≤ 0,25·vol².
 * `d` = distância em metros (0 ou ausente = som da interface, sem distância).
 */
export function sfxMix(o: { vol: number; d?: number; ducked: boolean; info?: boolean; gain: number }): number {
  const master = sfxMaster(o.vol);
  if (master <= 0) return 0;
  const dist = o.d === undefined ? 1 : sfxDistanceGain(o.d);
  const duck = o.ducked ? (o.info ? SFX_DUCK_INFO : SFX_DUCK) : 1;
  const g = master * dist * duck * Math.max(0, Math.min(1, o.gain));
  return Math.min(master, g);
}

/** tom do motor da moto pela velocidade (m/s): marcha lenta 42 Hz até ~150 Hz na velocidade máxima com turbo */
export function enginePitch(v: number): number {
  const k = Math.max(0, Math.min(1, Math.abs(v) / 31));
  return 42 + 108 * Math.sqrt(k);
}

/** tique da carga: um a cada 10% (0–10); o tom sobe a cada passo */
export function chargeStep(c: number): number {
  return Math.max(0, Math.min(10, Math.floor(c * 10 + 1e-9)));
}

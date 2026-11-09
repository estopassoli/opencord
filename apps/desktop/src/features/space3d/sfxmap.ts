/**
 * Som do jogo do Espaço 3D (plano 2026-11-09, P6), parte pura: que som cada `GameEvent` faz e com que ganho, e a
 * mixagem (distância, panorâmica leve, ducking e teto do volume). Sem Web Audio aqui: o motor fica em `sfx.ts`.
 * Todos os sons são sintetizados por nós (receitas em `sfx.ts`); nenhum arquivo nem som de outro jogo.
 */
import { SPACE_VOICE_FLOOR, spaceVoiceGain } from '@opencord/contracts';
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
  | 'uiBack';

/** um som a tocar */
export interface SfxCue {
  name: SfxName;
  /** ganho relativo 0–1 (antes da mixagem) */
  gain: number;
  /** multiplicador do tom (1 = normal) */
  pitch?: number;
  /** é informação (placar, apito, contagem): abaixa menos quando alguém fala */
  info?: boolean;
}

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
};

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

/** panorâmica pelo ângulo do som em relação à câmera, limitada a ±0,5 */
export function sfxPan(l: Listener, at: Pick<At, 'x' | 'z'>): number {
  const dx = at.x - l.x;
  const dz = at.z - l.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return 0;
  // vetor "direita" da câmera
  const side = (dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / d;
  return Math.max(-SFX_PAN_MAX, Math.min(SFX_PAN_MAX, side * SFX_PAN_MAX));
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

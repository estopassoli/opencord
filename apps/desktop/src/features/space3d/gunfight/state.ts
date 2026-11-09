/**
 * O que a interface do gunfight mostra (o jogo escreve aqui; o React lê): vida, munição, arma, mira, luneta, marcador
 * de acerto, de onde veio o dano, lista de abates, placar, morto/renascendo, equipamento e bots.
 */
import type { GunId } from '@opencord/contracts';
import { create } from 'zustand';
import type { BotLevel } from '../bots/level';
import { loadAim, type AimSettings } from './aim';
import { DEFAULT_LOADOUT, SLOT_GUNS, type GunSlot, type Loadout } from './weapons';

export interface KillFeedItem {
  id: number;
  by: string;
  byName: string;
  target: string;
  targetName: string;
  w: GunId;
  head: boolean;
  at: number;
}

export interface ScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  bot: boolean;
  /** sou eu */
  me: boolean;
}

export interface GunHudState {
  active: boolean;
  hp: number;
  weapon: GunId;
  mag: number;
  reserve: number;
  reloading: boolean;
  /** 0–1 de transição da mira */
  ads: number;
  scoped: boolean;
  /** quando a luneta abriu ou fechou (Date.now; o escurecer da entrada) */
  scopeAt: number;
  /** dispersão atual em pixels (o tamanho da mira) */
  spreadPx: number;
  /** a luneta sobe com o tranco do tiro (px para cima) */
  scopeKick: number;
  sprint: boolean;
  /** vigor da corrida (0–1; a barra só aparece abaixo de cheio) */
  stamina: number;
  /** sensibilidade do mouse no gunfight (ver `aim.ts`) */
  aim: AimSettings;
  /** o mouse preso veio cru (sem a aceleração do sistema): sim, não dá aqui, ou ainda não se sabe */
  rawMouse: boolean | null;
  /** quando apareceu o último marcador de acerto (e se matou / foi na cabeça) */
  hitAt: number;
  hitKill: boolean;
  hitHead: boolean;
  /** de onde veio cada dano recente (ângulo relativo à câmera, rad) e quando */
  hurts: { ang: number; at: number }[];
  feed: KillFeedItem[];
  scores: ScoreRow[];
  dead: boolean;
  /** morto: quem matou, com que arma, se foi na cabeça e quando renasce */
  killedBy: string | null;
  killedW: GunId | null;
  killedHead: boolean;
  respawnAt: number;
  /** a partida: alvo de abates e quando acaba no tempo (Date.now) */
  target: number;
  endsAt: number;
  /** trocou de arma: quando (a lista 1·2·3 aparece um instante) e o espaço na mão */
  slotsAt: number;
  slot: GunSlot;
  /** acabou de nascer: protegido (não leva dano até atirar) */
  shielded: boolean;
  /** partida terminada: quem ganhou e quando (Date.now) */
  winner: string | null;
  winnerAt: number;
  firstPerson: boolean;
  loadout: Loadout;
  loadoutOpen: boolean;
  bot: BotLevel | null;
  botCount: number;
  /** aviso curto para a pessoa (os bots saíram) — a tela mostra e limpa */
  notice: string | null;
  /** dá para recomeçar a partida agora (o jogo decide: acabou, ninguém pontuou ou estou sozinho) */
  canRestart: boolean;
  set(p: Partial<GunHudState>): void;
}

const LOADOUT_KEY = 'opencord.space3d.loadout';

/** equipamento salvo (pode vir de uma versão antiga ou mexido à mão): cada espaço só aceita as armas dele */
export function validLoadout(raw: unknown): Loadout {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LOADOUT };
  for (const slot of Object.keys(SLOT_GUNS) as GunSlot[]) {
    const id = src[slot];
    const ok = SLOT_GUNS[slot].find((g) => g === id);
    if (ok) out[slot] = ok;
  }
  return out;
}

function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(LOADOUT_KEY);
    if (raw) return validLoadout(JSON.parse(raw));
  } catch {
    /* sem armazenamento (ou salvo estragado): o padrão */
  }
  return { ...DEFAULT_LOADOUT };
}
export function saveLoadout(l: Loadout) {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(l));
  } catch {
    /* sem armazenamento */
  }
}

export const useGunHud = create<GunHudState>()((set) => ({
  active: false,
  hp: 100,
  weapon: DEFAULT_LOADOUT.primary,
  mag: 0,
  reserve: 0,
  reloading: false,
  ads: 0,
  scoped: false,
  scopeAt: 0,
  spreadPx: 20,
  scopeKick: 0,
  sprint: false,
  stamina: 1,
  aim: loadAim(),
  rawMouse: null,
  hitAt: 0,
  hitKill: false,
  hitHead: false,
  hurts: [],
  feed: [],
  scores: [],
  dead: false,
  killedBy: null,
  killedW: null,
  killedHead: false,
  respawnAt: 0,
  target: 15,
  endsAt: 0,
  slotsAt: 0,
  slot: 'primary',
  shielded: false,
  winner: null,
  winnerAt: 0,
  firstPerson: true,
  loadout: loadLoadout(),
  loadoutOpen: false,
  bot: null,
  botCount: 3,
  notice: null,
  canRestart: true,
  set: (p) => set(p),
}));

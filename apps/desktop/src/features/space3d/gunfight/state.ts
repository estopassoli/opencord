/**
 * O que a interface do gunfight mostra (o jogo escreve aqui; o React lê): vida, munição, arma, mira, luneta, marcador
 * de acerto, de onde veio o dano, lista de abates, placar, morto/renascendo, equipamento e bots.
 */
import type { GunId } from '@opencord/contracts';
import { create } from 'zustand';
import type { BotLevel } from '../bots/level';
import { DEFAULT_LOADOUT, type Loadout } from './weapons';

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
  /** dispersão atual em pixels (o tamanho da mira) */
  spreadPx: number;
  sprint: boolean;
  /** quando apareceu o último marcador de acerto (e se matou / foi na cabeça) */
  hitAt: number;
  hitKill: boolean;
  hitHead: boolean;
  /** de onde veio cada dano recente (ângulo relativo à câmera, rad) e quando */
  hurts: { ang: number; at: number }[];
  feed: KillFeedItem[];
  scores: ScoreRow[];
  dead: boolean;
  /** morto: quem matou e quando renasce */
  killedBy: string | null;
  respawnAt: number;
  /** partida terminada: quem ganhou */
  winner: string | null;
  firstPerson: boolean;
  loadout: Loadout;
  loadoutOpen: boolean;
  bot: BotLevel | null;
  botCount: number;
  set(p: Partial<GunHudState>): void;
}

const LOADOUT_KEY = 'opencord.space3d.loadout';
function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(LOADOUT_KEY);
    if (raw) return { ...DEFAULT_LOADOUT, ...(JSON.parse(raw) as Partial<Loadout>) };
  } catch {
    /* sem armazenamento: o padrão */
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
  spreadPx: 20,
  sprint: false,
  hitAt: 0,
  hitKill: false,
  hitHead: false,
  hurts: [],
  feed: [],
  scores: [],
  dead: false,
  killedBy: null,
  respawnAt: 0,
  winner: null,
  firstPerson: true,
  loadout: loadLoadout(),
  loadoutOpen: false,
  bot: null,
  botCount: 3,
  set: (p) => set(p),
}));

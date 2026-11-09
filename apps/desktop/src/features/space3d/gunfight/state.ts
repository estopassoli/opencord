/**
 * O que a interface do gunfight mostra (o jogo escreve aqui; o React lê): vida, munição, arma, mira, luneta, marcador
 * de acerto, de onde veio o dano, lista de abates, placar, morto/renascendo, equipamento e bots.
 */
import type { GunId } from '@opencord/contracts';
import { create } from 'zustand';
import type { BotLevel } from '../bots/level';
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

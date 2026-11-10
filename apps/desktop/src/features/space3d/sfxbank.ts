/**
 * Banco de gravações reais do Espaço 3D (adendo de 2026-11-09 ao ADR-0055): sons gravados de verdade, todos CC0
 * (Freesound; autor, fonte e recorte de cada arquivo em `assets/sfx/CREDITS.md`), recortados, normalizados e
 * codificados em Opus mono (48 kHz). Parte pura: só diz que arquivos cada som tem. Quem baixa, decodifica e toca é
 * o motor (`sfx.ts`); sem a gravação (ainda carregando, erro de rede, sem AudioContext) ele usa a receita sintetizada.
 *
 * Chave: o nome do som (`SfxName`) ou `nome:variante` (a arma no tiro, a família da arma na recarga). A variante
 * específica é a gravação daquela arma, então o tom da família (`SHOT_PITCH`) não se aplica a ela.
 */
import type { SfxName } from './sfxmap';

// os arquivos entram no build com hash (como os .glb): em produção é um caminho relativo ao index.html (file://)
const FILES = import.meta.glob<string>('./assets/sfx/*.ogg', { query: '?url', import: 'default', eager: true });

/** url de um arquivo do banco pelo nome (sem extensão); undefined = não existe */
export function sampleUrl(file: string): string | undefined {
  return FILES[`./assets/sfx/${file}.ogg`];
}

export interface SampleSet {
  /** variações (nomes dos arquivos, sem extensão): cada toque sorteia uma, sem repetir a anterior */
  files: string[];
  /** ajuste fino do volume da gravação (1 = como foi normalizada) */
  gain?: number;
  /** zona que pede este som: entrar nela já carrega as gravações (0 = só quando tocar a primeira vez) */
  zone?: number;
}

type SampleKey = SfxName | `${SfxName}:${string}`;

const GUN = 8;
const set = (files: string[], gain = 1): SampleSet => ({ files, gain, zone: GUN });

const M4 = ['shot-m4-1', 'shot-m4-2', 'shot-m4-3'];
const AK = ['shot-ak-1', 'shot-ak-2', 'shot-ak-3'];
const MP7 = ['shot-mp7-1', 'shot-mp7-2', 'shot-mp7-3'];
const MP5 = ['shot-mp5-1', 'shot-mp5-2', 'shot-mp5-3'];
const M9 = ['shot-m9-1', 'shot-m9-2', 'shot-m9-3'];
const DEAGLE = ['shot-deagle-1', 'shot-deagle-2', 'shot-deagle-3'];

export const SAMPLE_SETS: Partial<Record<SampleKey, SampleSet>> = {
  // tiros: a família (quando a arma não tem gravação própria) e cada arma
  shotRifle: set(M4),
  'shotRifle:m4': set(M4),
  shotAk: set(AK),
  'shotAk:ak47': set(AK),
  shotSmg: set(MP7),
  'shotSmg:mp7': set(MP7),
  'shotSmg:mp5': set(MP5),
  shotSniper: set(['shot-l115']),
  'shotSniper:l115': set(['shot-l115']),
  'shotSniper:m200': set(['shot-m200']),
  'shotSniper:kar98k': set(['shot-kar98k']),
  shotPistol: set(M9),
  'shotPistol:m9': set(M9),
  shotDeagle: set(DEAGLE),
  'shotDeagle:deagle': set(DEAGLE),
  shotFar: set(['shot-far-1', 'shot-far-2', 'shot-far-3']),
  // recarga: fuzil (M4 e as de ferrolho com pente), AK, SMG e pistola
  magOut: set(['mag-out-rifle']),
  'magOut:ak': set(['mag-out-ak']),
  'magOut:smg': set(['mag-out-smg']),
  'magOut:pistol': set(['mag-out-pistol']),
  // Kar98k: o "pente sai" é o ferrolho recuando e o "entra" é o pente-lâmina empurrando os cartuchos
  'magOut:clip': set(['bolt-pull'], 0.6),
  magIn: set(['mag-in-rifle']),
  'magIn:clip': set(['mag-in-pistol'], 0.8),
  'magIn:ak': set(['mag-in-ak']),
  'magIn:smg': set(['mag-in-smg']),
  'magIn:pistol': set(['mag-in-pistol']),
  charge: set(['charge-rifle']),
  'charge:ak': set(['charge-ak-1', 'charge-ak-2']),
  'charge:smg': set(['charge-smg']),
  'charge:pistol': set(['slide-pistol']),
  boltOpen: set(['bolt-open']),
  boltPull: set(['bolt-pull']),
  boltClose: set(['bolt-close']),
  dryFire: set(['dry-rifle']),
  'dryFire:pistol': set(['dry-pistol']),
  drawGun: set(['draw-rifle']),
  'drawGun:pistol': set(['draw-pistol']),
  'drawGun:knife': set(['knife-swing-2'], 0.6),
  knifeSwing: set(['knife-swing-1', 'knife-swing-2']),
  // acerto, corpo e mundo
  impactWall: set(['impact-concrete-1', 'impact-concrete-2', 'impact-concrete-3', 'impact-metal-1', 'impact-metal-2']),
  impactFlesh: set(['impact-flesh-1', 'impact-flesh-2', 'impact-flesh-3']),
  hitmarker: set(['hitmarker']),
  headshot: set(['headshot']),
  killConfirm: set(['kill'], 0.8),
  hurt: set(['hurt']),
  step: set(['step-1', 'step-2', 'step-3', 'step-4']),
  land: set(['land']),
  slideFx: set(['slide']),
  shellCase: set(['shell-1', 'shell-2', 'shell-3']),
  // narrador: a voz (ElevenLabs) ainda não foi gravada; até lá toca a receita sintetizada. Cada chamada entra como
  // `'announcer:double': set(['call-double-kill'])` (a variante é a `StreakCall`), com o arquivo no CREDITS.md
};

/** o conjunto de um som: primeiro `nome:variante` (exato = gravação daquela variante), depois o do nome */
export function sampleSetFor(name: SfxName, variant?: string): { key: string; set: SampleSet; exact: boolean } | null {
  if (variant) {
    const key = `${name}:${variant}` as SampleKey;
    const s = SAMPLE_SETS[key];
    if (s) return { key, set: s, exact: true };
  }
  const s = SAMPLE_SETS[name];
  return s ? { key: name, set: s, exact: false } : null;
}

/** arquivos que a zona pede (carregados ao entrar nela) */
export function zoneSampleFiles(zone: number): string[] {
  const out = new Set<string>();
  for (const s of Object.values(SAMPLE_SETS)) if (s && s.zone === zone) for (const f of s.files) out.add(f);
  return [...out];
}

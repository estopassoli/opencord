/**
 * Acessórios das armas do gunfight (o armeiro do menu): o catálogo, o que cabe em cada arma, a conta de como cada um
 * muda a arma (`applyAttachments`), as barras de atributos do menu (`gunStats`), os prós e contras em texto
 * (`attachmentEffects`), a montagem salva (`validBuild`) e o formato curto que vai na pose da rede (`encodeBuild`,
 * ADR-0059). Sem three.js aqui: tudo puro e testado. Os modelos 3D ficam em `attachmodels.ts`.
 */
import type { GunId } from '@opencord/contracts';
import { GUNS, recoilKick, shotInterval, type GunSpec, type ScopeStyle } from './weapons';

export type AttSlot = 'optic' | 'muzzle' | 'under' | 'mag';
export const ATT_SLOTS: readonly AttSlot[] = ['optic', 'muzzle', 'under', 'mag'];
export const ATT_SLOT_LABEL: Record<AttSlot, string> = {
  optic: 'Mira',
  muzzle: 'Boca',
  under: 'Sob o cano',
  mag: 'Carregador',
};

/**
 * O catálogo de cada encaixe, na ordem da rede: o código de um acessório é a posição dele aqui + 1 (0 = o padrão da
 * arma). Só se acrescenta no fim — mudar a ordem troca o acessório que os apps antigos mostram.
 */
export const ATT_CODES = {
  optic: ['reddot', 'holo', 'scope3', 'pdot', 'lpvo', 'kscope'],
  muzzle: ['sup', 'comp', 'flash'],
  under: ['vgrip', 'agrip'],
  mag: ['ext'],
} as const;
export type OpticId = (typeof ATT_CODES.optic)[number];
export type MuzzleId = (typeof ATT_CODES.muzzle)[number];
export type UnderId = (typeof ATT_CODES.under)[number];
export type MagId = (typeof ATT_CODES.mag)[number];
export type AttId = OpticId | MuzzleId | UnderId | MagId;

/** a montagem de uma arma (encaixe ausente = o padrão dela) */
export interface GunBuild {
  optic?: OpticId;
  muzzle?: MuzzleId;
  under?: UnderId;
  mag?: MagId;
}
export type Builds = Partial<Record<GunId, GunBuild>>;

/** o que um acessório muda (multiplicadores: 1 = igual) */
export interface AttMods {
  /** tempo para mirar */
  ads?: number;
  /** zoom mirando (substitui o da arma) */
  zoom?: number;
  /** a mira vira luneta (tela de mira em volta), com este retículo */
  scope?: ScopeStyle;
  /** recuo para cima e para o lado (padrão, tranco da vista e coice da arma) */
  up?: number;
  side?: number;
  /** dispersão mirando */
  adsSpread?: number;
  /** distâncias em que o dano começa a cair e chega ao mínimo */
  range?: number;
  /** tamanho do pente e da reserva (arredonda) */
  mag?: number;
  /** tempo de recarga */
  reload?: number;
  /** somado à velocidade de andar */
  move?: number;
  /** tiro abafado: som baixo e curto, sem o estampido de longe */
  quiet?: boolean;
  /** sem clarão na boca */
  noFlash?: boolean;
}

export interface Attachment {
  id: AttId;
  slot: AttSlot;
  name: string;
  /** uma linha para o menu (o que é, sem números) */
  desc: string;
  mods: AttMods;
}

const A = (a: Attachment) => a;
export const ATTACHMENTS: Record<AttId, Attachment> = {
  reddot: A({
    id: 'reddot',
    slot: 'optic',
    name: 'Ponto vermelho',
    desc: 'Mira compacta com um ponto aceso no vidro: limpa e rápida de achar.',
    mods: { zoom: 1.6, ads: 1.05 },
  }),
  holo: A({
    id: 'holo',
    slot: 'optic',
    name: 'Reflexa mini',
    desc: 'Mira aberta e baixa, só um aro fino em volta do vidro: quase nada tampa a visão em volta do ponto.',
    mods: { zoom: 1.45, ads: 1.03, adsSpread: 0.9 },
  }),
  scope3: A({
    id: 'scope3',
    slot: 'optic',
    name: 'Luneta 3x',
    desc: 'Aumento fixo de 3x para a média distância. Pesa e demora mais para mirar.',
    mods: { zoom: 3, scope: 'prism', ads: 1.35, adsSpread: 0.6, move: -0.01 },
  }),
  pdot: A({
    id: 'pdot',
    slot: 'optic',
    name: 'Ponto de pistola',
    desc: 'Ponto vermelho pequeno em cima da arma: mira mais certa de longe.',
    mods: { zoom: 1.4, ads: 1.08, adsSpread: 0.8 },
  }),
  lpvo: A({
    id: 'lpvo',
    slot: 'optic',
    name: 'Luneta variável',
    desc: 'Aumento menor (2,5x) com alavanca de zoom: mira bem mais rápido, vê menos de longe.',
    mods: { zoom: 2.5, scope: 'lpvo', ads: 0.8 },
  }),
  kscope: A({
    id: 'kscope',
    slot: 'optic',
    name: 'Luneta clássica',
    desc: 'Luneta de época, longa e fina, à frente da culatra (3x, retículo de poste).',
    mods: { zoom: 3, scope: 'post', ads: 1.2, move: -0.01 },
  }),
  sup: A({
    id: 'sup',
    slot: 'muzzle',
    name: 'Supressor',
    desc: 'Abafa o tiro e esconde o clarão. O cano mais pesado perde alcance e demora a mirar.',
    mods: { quiet: true, noFlash: true, range: 0.85, ads: 1.06, up: 0.95 },
  }),
  comp: A({
    id: 'comp',
    slot: 'muzzle',
    name: 'Compensador',
    desc: 'Joga o gás para cima e segura o cano: sobe bem menos, mas escapa mais para o lado.',
    mods: { up: 0.8, side: 1.12, ads: 1.02 },
  }),
  flash: A({
    id: 'flash',
    slot: 'muzzle',
    name: 'Quebra-chamas',
    desc: 'Esconde o clarão do tiro e segura um pouco o cano de lado a lado.',
    mods: { noFlash: true, side: 0.85 },
  }),
  vgrip: A({
    id: 'vgrip',
    slot: 'under',
    name: 'Empunhadura vertical',
    desc: 'A mão de apoio fecha num punho embaixo do cano: segura o recuo, mira mais devagar.',
    mods: { up: 0.85, side: 0.9, ads: 1.08, move: -0.01 },
  }),
  agrip: A({
    id: 'agrip',
    slot: 'under',
    name: 'Empunhadura angulada',
    desc: 'Apoio inclinado à frente da mão: a arma sobe mais rápido para o rosto.',
    mods: { ads: 0.88, up: 1.04 },
  }),
  ext: A({
    id: 'ext',
    slot: 'mag',
    name: 'Carregador estendido',
    desc: 'Cabe metade a mais. Mais pesado: recarga e mira mais lentas.',
    mods: { mag: 1.5, reload: 1.15, ads: 1.06, move: -0.01 },
  }),
};

const RIFLE: Partial<Record<AttSlot, readonly AttId[]>> = {
  optic: ['reddot', 'holo', 'scope3'],
  muzzle: ['sup', 'comp', 'flash'],
  under: ['vgrip', 'agrip'],
  mag: ['ext'],
};
/** o que cabe em cada arma, por encaixe (faca: nada) */
const FOR: Record<GunId, Partial<Record<AttSlot, readonly AttId[]>>> = {
  m4: RIFLE,
  ak47: RIFLE,
  mp7: RIFLE,
  mp5: RIFLE,
  l115: { optic: ['lpvo'], muzzle: ['sup', 'comp'], mag: ['ext'] },
  m200: { optic: ['lpvo'], muzzle: ['sup'], mag: ['ext'] },
  kar98k: { optic: ['kscope'], muzzle: ['sup'] },
  m9: { optic: ['pdot'], muzzle: ['sup', 'comp'], mag: ['ext'] },
  deagle: { optic: ['pdot'], muzzle: ['comp'], mag: ['ext'] },
  karambit: {},
  bayonet: {},
};

/** os acessórios que cabem na arma, num encaixe (vazio = o encaixe não existe nela) */
export function attachmentsFor(id: GunId, slot: AttSlot): readonly AttId[] {
  return FOR[id]?.[slot] ?? [];
}

/** os encaixes que a arma tem, na ordem do menu */
export function slotsFor(id: GunId): AttSlot[] {
  return ATT_SLOTS.filter((s) => attachmentsFor(id, s).length > 0);
}

/** o nome do padrão de cada encaixe (o que a arma tem sem acessório) */
export function defaultLabel(id: GunId, slot: AttSlot): string {
  const spec = GUNS[id];
  if (slot === 'optic') return spec.scope ? 'Luneta de precisão' : 'Mira de ferro';
  if (slot === 'mag') return `Padrão (${spec.mag})`;
  return 'Nenhum';
}

/** a montagem salva (pode vir de uma versão antiga ou mexida à mão): só fica o que cabe na arma */
export function validBuild(id: GunId, raw: unknown): GunBuild {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: GunBuild = {};
  for (const slot of ATT_SLOTS) {
    const v = src[slot];
    const ok = attachmentsFor(id, slot).find((a) => a === v);
    if (ok) (out as Record<AttSlot, AttId>)[slot] = ok;
  }
  return out;
}

/** a mesma montagem? */
export function sameBuild(a: GunBuild | undefined, b: GunBuild | undefined): boolean {
  return buildKey(a) === buildKey(b);
}

/** chave curta da montagem (cache dos modelos e das imagens do menu); "" = de fábrica */
export function buildKey(b: GunBuild | undefined): string {
  if (!b) return '';
  const parts = ATT_SLOTS.map((s) => b[s] ?? '');
  return parts.some(Boolean) ? parts.join('.') : '';
}

/** a montagem de volta da chave (`buildKey`) */
export function buildFromKey(key: string): GunBuild {
  if (!key) return {};
  const parts = key.split('.');
  const raw: Partial<Record<AttSlot, string>> = {};
  ATT_SLOTS.forEach((s, i) => {
    if (parts[i]) raw[s] = parts[i];
  });
  const out: GunBuild = {};
  for (const s of ATT_SLOTS) {
    const v = raw[s];
    const ok = (ATT_CODES[s] as readonly string[]).find((x) => x === v);
    if (ok) (out as Record<AttSlot, string>)[s] = ok;
  }
  return out;
}

/** os acessórios da montagem, na ordem dos encaixes */
export function buildList(b: GunBuild | undefined): Attachment[] {
  if (!b) return [];
  const out: Attachment[] = [];
  for (const s of ATT_SLOTS) {
    const id = b[s];
    if (id) out.push(ATTACHMENTS[id]);
  }
  return out;
}

/**
 * A montagem no formato da rede (`SpaceGunPose.att`): o código de cada encaixe na ordem mira, boca, sob o cano,
 * carregador (0 = padrão), sem os zeros do fim; nada quando a arma está de fábrica.
 */
export function encodeBuild(b: GunBuild | undefined): number[] | undefined {
  if (!b) return undefined;
  const codes = ATT_SLOTS.map((s) => {
    const id = b[s];
    return id ? (ATT_CODES[s] as readonly string[]).indexOf(id) + 1 : 0;
  });
  while (codes.length && codes[codes.length - 1] === 0) codes.pop();
  return codes.length ? codes : undefined;
}

/** a montagem que veio da rede (código desconhecido ou que não cabe na arma: o padrão daquele encaixe) */
export function decodeBuild(id: GunId, att: readonly number[] | undefined): GunBuild {
  if (!att?.length) return {};
  const raw: Partial<Record<AttSlot, string>> = {};
  ATT_SLOTS.forEach((s, i) => {
    const code = att[i];
    if (!code) return;
    const name = (ATT_CODES[s] as readonly string[])[code - 1];
    if (name) raw[s] = name;
  });
  return validBuild(id, raw);
}

/** os efeitos de todos os acessórios juntos (multiplicadores multiplicam, somas somam; a mira manda no zoom) */
export function combinedMods(list: readonly Attachment[]): AttMods {
  const out: AttMods = {};
  const mul = (k: 'ads' | 'up' | 'side' | 'adsSpread' | 'range' | 'mag' | 'reload', v: number | undefined) => {
    if (v !== undefined) out[k] = (out[k] ?? 1) * v;
  };
  for (const a of list) {
    const m = a.mods;
    mul('ads', m.ads);
    mul('up', m.up);
    mul('side', m.side);
    mul('adsSpread', m.adsSpread);
    mul('range', m.range);
    mul('mag', m.mag);
    mul('reload', m.reload);
    if (m.move !== undefined) out.move = (out.move ?? 0) + m.move;
    if (m.zoom !== undefined) out.zoom = m.zoom;
    if (m.scope) out.scope = m.scope;
    if (m.quiet) out.quiet = true;
    if (m.noFlash) out.noFlash = true;
  }
  return out;
}

/**
 * A arma com a montagem: recuo (o padrão inteiro, o tranco da vista, o coice da arma e o do boneco), dispersão
 * mirando, tempo para mirar, zoom e luneta, pente e reserva, recarga, alcance do dano, velocidade, som e clarão. O
 * dano no máximo nunca muda (quem leva confere o acerto por ele, `maxDamage`). Sem acessório, a própria arma.
 */
export function applyAttachments(spec: GunSpec, build: GunBuild | undefined): GunSpec {
  const list = buildList(validBuild(spec.id, build));
  if (!list.length) return spec;
  const m = combinedMods(list);
  const up = m.up ?? 1;
  const side = m.side ?? 1;
  const r = spec.recoil;
  const magK = m.mag ?? 1;
  const out: GunSpec = {
    ...spec,
    range: [spec.range[0] * (m.range ?? 1), spec.range[1] * (m.range ?? 1)],
    mag: Math.round(spec.mag * magK),
    reserve: Math.round(spec.reserve * magK),
    reloadMs: Math.round(spec.reloadMs * (m.reload ?? 1)),
    emptyReloadMs: Math.round(spec.emptyReloadMs * (m.reload ?? 1)),
    adsMs: Math.round(spec.adsMs * (m.ads ?? 1)),
    zoom: m.zoom ?? spec.zoom,
    scope: m.scope ? true : spec.scope,
    recoil: {
      ...r,
      pattern: r.pattern.map((s) => ({
        ...s,
        up: s.up * up,
        ...(s.side !== undefined ? { side: s.side * side } : {}),
        ...(s.swing !== undefined ? { swing: s.swing * side } : {}),
      })),
      punch: { ...r.punch, up: r.punch.up * up, roll: r.punch.roll * side },
      vm: { ...r.vm, rise: r.vm.rise * up, roll: r.vm.roll * side, side: r.vm.side * side },
      body: r.body * up,
    },
    spread: { ...spec.spread, ads: spec.spread.ads * (m.adsSpread ?? 1) },
    move: Math.round((spec.move + (m.move ?? 0)) * 1000) / 1000,
    build: validBuild(spec.id, build),
  };
  if (m.scope) out.scopeStyle = m.scope;
  if (m.quiet) out.quiet = true;
  if (m.noFlash) out.noFlash = true;
  return out;
}

// ---------------------------------------------------------------- barras do menu

export type StatKey = 'damage' | 'rate' | 'range' | 'control' | 'mobility' | 'handling';
export const STAT_KEYS: readonly StatKey[] = ['damage', 'rate', 'range', 'control', 'mobility', 'handling'];
export const STAT_LABEL: Record<StatKey, string> = {
  damage: 'Dano',
  rate: 'Cadência',
  range: 'Alcance',
  control: 'Controle do recuo',
  mobility: 'Mobilidade',
  handling: 'Velocidade de mira',
};
/** rótulos curtos (cartões do equipamento) */
export const STAT_SHORT: Record<StatKey, string> = {
  damage: 'Dano',
  rate: 'Cadência',
  range: 'Alcance',
  control: 'Controle',
  mobility: 'Mobilidade',
  handling: 'Mira',
};
/** o que cada barra mede (para o leitor de tela e a dica) */
export const STAT_HINT: Record<StatKey, string> = {
  damage: 'Dano de cada tiro de perto.',
  rate: 'Tiros por minuto.',
  range: 'Até onde o dano se mantém.',
  control: 'Quanto a mira sobe e escapa na rajada.',
  mobility: 'Velocidade andando com a arma.',
  handling: 'Quão rápido a mira chega ao olho.',
};

/** as barras (0–100) de uma arma; na faca, só dano, cadência, alcance e mobilidade */
export type GunStats = Partial<Record<StatKey, number>>;

const clamp100 = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

/** subida média (graus) dos 10 primeiros tiros, com o lado pesando menos (o padrão, sem o sorteio) */
export function recoilAverage(spec: GunSpec): number {
  let sum = 0;
  for (let n = 1; n <= 10; n++) {
    const k = recoilKick(spec, n);
    sum += (k.up + Math.abs(k.side) * 0.7) * (180 / Math.PI);
  }
  return sum / 10;
}

/**
 * As barras do menu, de 0 a 100, numa escala comum a todas as armas: dano pela raiz do dano de perto (a sniper no
 * topo, o fuzil no meio), cadência pelos tiros por minuto (o ferrolho conta), alcance pela média das distâncias de
 * queda, controle pela subida média da rajada, mobilidade pela velocidade e mira pelo tempo para mirar.
 */
export function gunStats(spec: GunSpec): GunStats {
  const mobility = clamp100(((spec.move - 0.75) / 0.4) * 100);
  if (spec.cls === 'knife') {
    const m = spec.melee;
    return {
      damage: clamp100(Math.sqrt((m?.heavy ?? 0) / 150) * 100),
      rate: clamp100(((700 - (m?.ms ?? 700)) / 400) * 100),
      range: clamp100(((m?.range ?? 0) / 105) * 100 * 4),
      mobility,
    };
  }
  const rpm = 60000 / shotInterval(spec);
  return {
    damage: clamp100(Math.sqrt(spec.dmg[0] / 150) * 100),
    rate: clamp100((rpm / 1000) * 100),
    range: clamp100(((spec.range[0] + spec.range[1]) / 2 / 105) * 100),
    control: clamp100((1 - recoilAverage(spec) / 3.6) * 100),
    mobility,
    handling: clamp100((1 - (spec.adsMs - 100) / 500) * 100),
  };
}

// ---------------------------------------------------------------- prós e contras

export interface AttEffect {
  text: string;
  /** a favor (true), contra (false) ou só informação (null) */
  good: boolean | null;
}

const pct = (k: number) => `${Math.round(Math.abs(k - 1) * 100)}%`;
const dec = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');

/**
 * Os prós e contras de um acessório nesta arma, em texto (o menu mostra com o sinal e a cor; quem não vê a cor lê
 * o "mais"/"menos" no começo). Na ordem: o que é informação, os prós, os contras.
 */
export function attachmentEffects(id: AttId, spec: GunSpec): AttEffect[] {
  const m = ATTACHMENTS[id].mods;
  const info: AttEffect[] = [];
  const pros: AttEffect[] = [];
  const cons: AttEffect[] = [];
  const add = (good: boolean, text: string) => (good ? pros : cons).push({ text, good });
  if (m.zoom !== undefined) info.push({ text: `Zoom ${dec(m.zoom)}x${m.scope ? ' com luneta' : ''}`, good: null });
  if (m.quiet) add(true, 'Tiro abafado: só se ouve de perto');
  if (m.noFlash) add(true, 'Sem clarão na boca');
  if (m.up !== undefined && m.up !== 1) add(m.up < 1, `${m.up < 1 ? 'Menos' : 'Mais'} recuo vertical (${pct(m.up)})`);
  if (m.side !== undefined && m.side !== 1)
    add(m.side < 1, `${m.side < 1 ? 'Menos' : 'Mais'} recuo lateral (${pct(m.side)})`);
  if (m.adsSpread !== undefined && m.adsSpread !== 1)
    add(m.adsSpread < 1, `Mira ${m.adsSpread < 1 ? 'mais' : 'menos'} precisa (${pct(m.adsSpread)})`);
  if (m.mag !== undefined && m.mag !== 1) {
    const n = Math.round(spec.mag * m.mag);
    add(n > spec.mag, `Pente de ${spec.mag} para ${n} balas`);
  }
  if (m.ads !== undefined && m.ads !== 1)
    add(m.ads < 1, `Mira ${m.ads < 1 ? 'mais rápida' : 'mais lenta'} (${pct(m.ads)})`);
  if (m.range !== undefined && m.range !== 1)
    add(m.range > 1, `${m.range > 1 ? 'Mais' : 'Menos'} alcance do dano (${pct(m.range)})`);
  if (m.reload !== undefined && m.reload !== 1)
    add(m.reload < 1, `Recarga ${m.reload < 1 ? 'mais rápida' : 'mais lenta'} (${pct(m.reload)})`);
  if (m.move) add(m.move > 0, `${m.move > 0 ? 'Anda mais rápido' : 'Anda um pouco mais devagar'}`);
  return [...info, ...pros, ...cons];
}

/**
 * Uma montagem sorteada para um bot (`u` sorteia em [0,1)): cada encaixe tem 55% de chance de levar um acessório
 * daquela arma. Só o visual e o som mudam para quem vê; o bot usa a arma montada.
 */
export function randomBuild(id: GunId, u: () => number): GunBuild {
  const raw: Partial<Record<AttSlot, AttId>> = {};
  for (const s of ATT_SLOTS) {
    const list = attachmentsFor(id, s);
    if (!list.length || u() >= 0.55) continue;
    raw[s] = list[Math.min(list.length - 1, Math.floor(u() * list.length))];
  }
  return validBuild(id, raw);
}

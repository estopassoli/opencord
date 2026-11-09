/**
 * Espaço 3D da chamada (ADR-0055): ambiente low poly por servidor, avatares andando e voz pela distância.
 * Unidades em metros; o piso é um retângulo centrado na origem (x para a direita, z para quem olha o telão de frente).
 * Rotação `rot` em radianos em torno do eixo vertical; com rot = 0 a frente da peça aponta para +z.
 */
import { z } from 'zod';
import { Id } from './api.js';

export const SPACE_THEMES = ['lounge', 'rooftop', 'cabin', 'station', 'beach', 'arcade'] as const;
export type SpaceTheme = (typeof SPACE_THEMES)[number];

/** Catálogo de peças (modelos low poly feitos em código no app). `screen` = telão, `tv` = televisão pequena. */
export const SPACE_ITEM_KINDS = [
  'screen',
  'tv',
  'sofa',
  'armchair',
  'beanbag',
  'chair',
  'stool',
  'table',
  'coffee_table',
  'counter',
  'bookshelf',
  'plant',
  'tree',
  'palm',
  'lamp',
  'rug',
  'arcade',
  'crate',
  'fireplace',
  'speaker',
  'column',
  'bed',
] as const;
export type SpaceItemKind = (typeof SPACE_ITEM_KINDS)[number];

/** Nomes em português para o catálogo do editor. */
export const SPACE_ITEM_LABELS: Record<SpaceItemKind, string> = {
  screen: 'Telão',
  tv: 'Televisão',
  sofa: 'Sofá',
  armchair: 'Poltrona',
  beanbag: 'Puff',
  chair: 'Cadeira',
  stool: 'Banqueta',
  table: 'Mesa',
  coffee_table: 'Mesa de centro',
  counter: 'Balcão',
  bookshelf: 'Estante',
  plant: 'Planta',
  tree: 'Árvore',
  palm: 'Coqueiro',
  lamp: 'Luminária',
  rug: 'Tapete',
  arcade: 'Fliperama',
  crate: 'Caixote',
  fireplace: 'Lareira',
  speaker: 'Caixa de som',
  column: 'Coluna',
  bed: 'Cama',
};

export const SPACE_THEME_LABELS: Record<SpaceTheme, string> = {
  lounge: 'Lounge',
  rooftop: 'Terraço',
  cabin: 'Cabana',
  station: 'Estação espacial',
  beach: 'Praia',
  arcade: 'Fliperama',
};

export const SPACE_MIN_SIZE = 8;
export const SPACE_MAX_SIZE = 60;
export const SPACE_MAX_WALLS = 200;
export const SPACE_MAX_ITEMS = 300;
/** quem passa do limite de distância continua sendo ouvido com este volume (fração do normal) */
export const SPACE_VOICE_FLOOR = 0.35;
/** até aqui a voz chega cheia; a partir de SPACE_VOICE_FAR fica no piso */
export const SPACE_VOICE_NEAR = 3;
export const SPACE_VOICE_FAR = 22;

/** Volume da voz de quem está a `d` metros (1 perto, cai devagar até o piso, nunca some). */
export function spaceVoiceGain(d: number): number {
  if (!Number.isFinite(d) || d <= SPACE_VOICE_NEAR) return 1;
  if (d >= SPACE_VOICE_FAR) return SPACE_VOICE_FLOOR;
  const t = (d - SPACE_VOICE_NEAR) / (SPACE_VOICE_FAR - SPACE_VOICE_NEAR);
  // curva suave (cai mais devagar no começo): 1 → piso
  const k = 1 - t * t * (3 - 2 * t);
  return SPACE_VOICE_FLOOR + (1 - SPACE_VOICE_FLOOR) * k;
}

const Color = z.string().regex(/^#[0-9a-f]{6}$/);
const Coord = z.number().finite().min(-SPACE_MAX_SIZE).max(SPACE_MAX_SIZE);

export const SpaceWall = z.object({
  x1: Coord,
  z1: Coord,
  x2: Coord,
  z2: Coord,
  /** altura em metros (parede baixa = mureta/grade) */
  h: z.number().min(0.3).max(6),
});
export type SpaceWall = z.infer<typeof SpaceWall>;

export const SpaceItem = z.object({
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  kind: z.enum(SPACE_ITEM_KINDS),
  x: Coord,
  z: Coord,
  rot: z.number().finite().min(-7).max(7),
  color: Color.optional(),
});
export type SpaceItem = z.infer<typeof SpaceItem>;

export const SpaceLayout = z
  .object({
    v: z.literal(1),
    theme: z.enum(SPACE_THEMES),
    width: z.number().int().min(SPACE_MIN_SIZE).max(SPACE_MAX_SIZE),
    depth: z.number().int().min(SPACE_MIN_SIZE).max(SPACE_MAX_SIZE),
    floorColor: Color,
    wallColor: Color,
    walls: z.array(SpaceWall).max(SPACE_MAX_WALLS),
    items: z.array(SpaceItem).max(SPACE_MAX_ITEMS),
    spawn: z.object({ x: Coord, z: Coord }),
  })
  .superRefine((l, ctx) => {
    const hx = l.width / 2 + 0.01;
    const hz = l.depth / 2 + 0.01;
    const inside = (x: number, zz: number) => Math.abs(x) <= hx && Math.abs(zz) <= hz;
    const ids = new Set<string>();
    l.items.forEach((it, i) => {
      if (ids.has(it.id)) ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: 'id repetido' });
      ids.add(it.id);
      if (!inside(it.x, it.z)) ctx.addIssue({ code: 'custom', path: ['items', i], message: 'fora do piso' });
    });
    l.walls.forEach((w, i) => {
      if (!inside(w.x1, w.z1) || !inside(w.x2, w.z2))
        ctx.addIssue({ code: 'custom', path: ['walls', i], message: 'fora do piso' });
      if (Math.hypot(w.x2 - w.x1, w.z2 - w.z1) < 0.25)
        ctx.addIssue({ code: 'custom', path: ['walls', i], message: 'parede curta demais' });
    });
    if (!inside(l.spawn.x, l.spawn.z)) ctx.addIssue({ code: 'custom', path: ['spawn'], message: 'fora do piso' });
  });
export type SpaceLayout = z.infer<typeof SpaceLayout>;

/** Ambiente salvo (ou o gerado, se ninguém editou: `revision` 0 e `updatedAt` null). */
export const ServerSpace = z.object({
  serverId: Id,
  layout: SpaceLayout,
  revision: z.number().int().min(0),
  updatedAt: z.string().nullable(),
  updatedBy: Id.nullable(),
});
export type ServerSpace = z.infer<typeof ServerSpace>;

export const SaveSpaceRequest = z.object({
  layout: SpaceLayout,
  /** revisão em que a edição começou: se alguém salvou no meio, 409 (não sobrescreve sem ver) */
  baseRevision: z.number().int().min(0),
});

/** O que passa no telão (o mesmo para todos no espaço). */
export const SpaceScreen = z.discriminatedUnion('kind', [
  /** a live (Go Live) de alguém da chamada */
  z.object({ kind: z.literal('stream'), userId: Id }),
  /** o vídeo do "Assistir juntos" da chamada (ADR-0009) */
  z.object({ kind: z.literal('activity') }),
]);
export type SpaceScreen = z.infer<typeof SpaceScreen>;

/** Peças que se ligam e desligam (para todos da chamada); sem registro = ligada. */
export const SPACE_TOGGLE_KINDS = ['lamp', 'fireplace', 'arcade'] as const satisfies readonly SpaceItemKind[];
export const SpaceItemId = z.string().regex(/^[a-z0-9]{1,12}$/);

export const MATCH_PHASES = ['idle', 'countdown', 'playing', 'ended'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

/**
 * Partida de uma arena: `idle` (esperando o Jogar), `countdown` (3-2-1 até `startAt`), `playing` e `ended` (com o
 * vencedor). `startAt` e `endedAt` no relógio do servidor. `practice`: um lado vazio (treino, fora da classificação).
 */
export const SpaceMatch = z.object({
  phase: z.enum(MATCH_PHASES),
  startAt: z.number(),
  winner: z.enum(['a', 'b']).optional(),
  endedAt: z.number().optional(),
});
export type SpaceMatch = z.infer<typeof SpaceMatch>;

export const SpaceSession = z.object({
  channelId: Id,
  serverId: Id,
  screen: SpaceScreen.nullable(),
  /** luminárias, lareiras e fliperamas desligados/ligados nesta chamada (id da peça → ligada) */
  toggles: z.record(z.string(), z.boolean()).optional(),
  /** placar de cada arena ("1" basquete … "6" sinuca): pontos do lado A e do lado B */
  scores: z.record(z.string(), z.object({ a: z.number().int(), b: z.number().int() })).optional(),
  /** classificação de cada arena: pontos de cada pessoa ("1" → { userId: pontos }) */
  board: z.record(z.string(), z.record(z.string(), z.number().int())).optional(),
  /** corrida de moto: largada (relógio do servidor), voltas e chegada de cada um (ms de prova) */
  race: z
    .object({
      startAt: z.number(),
      laps: z.number().int(),
      results: z.array(z.object({ userId: Id, ms: z.number().int() })),
      /** quem estava na pista na largada (para o DNF) */
      racers: z.array(Id).optional(),
      /** a corrida fecha neste instante (relógio do servidor): 30 s depois da chegada do 1º */
      endsAt: z.number().optional(),
      /** fechada: quem não chegou até `endsAt` não termina (DNF) */
      closed: z.boolean().optional(),
      dnf: z.array(Id).optional(),
    })
    .nullable()
    .optional(),
  /** partida de cada arena com regra de vitória ("1" basquete … "5" ping pong); ver MATCH_RULES */
  matches: z.record(z.string(), SpaceMatch).optional(),
  updatedBy: Id.nullable(),
  revision: z.number().int(),
});
export type SpaceSession = z.infer<typeof SpaceSession>;

/** armas do gunfight (a ordem é o índice que vai na rede) */
export const GUN_IDS = [
  'm4',
  'ak47',
  'mp7',
  'mp5',
  'l115',
  'm200',
  'kar98k',
  'm9',
  'deagle',
  'karambit',
  'bayonet',
] as const;
export type GunId = (typeof GUN_IDS)[number];
export const GunId = z.enum(GUN_IDS);

export const SpaceGunPose = z.object({
  w: GunId,
  pitch: z.number().finite().min(-1.6).max(1.6),
  crouch: z.boolean(),
  ads: z.boolean(),
  alive: z.boolean(),
  /** abates e mortes desta partida: cada um publica os próprios (o placar de todos sai daqui) */
  k: z.number().int().min(0).max(999).optional(),
  d: z.number().int().min(0).max(999).optional(),
  /** a última ação da mão (os outros veem no boneco) e um contador: a mesma ação de novo troca o número */
  act: z.enum(['reload', 'melee', 'bolt', 'draw', 'inspect']).optional(),
  an: z.number().int().min(0).max(999).optional(),
  /** acabou de nascer e ainda não atirou: não leva dano (os outros veem o boneco meio transparente) */
  prot: z.boolean().optional(),
  /** a partida de quem publica: o alvo de abates e os segundos que faltam (quem entra depois usa o mesmo relógio) */
  ft: z.number().int().min(1).max(99).optional(),
  fl: z.number().int().min(0).max(600).optional(),
});
export type SpaceGunPose = z.infer<typeof SpaceGunPose>;
export type GunAct = NonNullable<SpaceGunPose['act']>;

const Vec3 = z.tuple([
  z.number().finite().min(-200).max(200),
  z.number().finite().min(-50).max(50),
  z.number().finite().min(-200).max(200),
]);
/**
 * Gunfight (zona 8, todos contra todos): o que cada um avisa aos outros. Quem atira confere o acerto no próprio app e
 * avisa quem levou (`hit`); quem levou desconta a vida e, se morreu, avisa todos (`die`). `fire` é só o efeito (tiro,
 * traçante e som, pode se perder), `spawn` é o renascer e `restart` zera a partida de todos. Só `fire` é volátil: o
 * resto muda o placar e vai com entrega garantida. `die` sem `by` = morreu sem matador da rede (bot, queda).
 */
export const SpaceGun = z.object({
  channelId: Id,
  kind: z.enum(['fire', 'hit', 'die', 'spawn', 'restart']),
  w: GunId,
  /** fire: de onde e até onde foi o tiro (traçante) */
  from: Vec3.optional(),
  to: Vec3.optional(),
  /** hit: em quem e quanto; die: quem matou */
  target: Id.optional(),
  dmg: z.number().finite().min(0).max(1000).optional(),
  head: z.boolean().optional(),
  by: Id.optional(),
});
export type SpaceGun = z.infer<typeof SpaceGun>;

/**
 * Posição de um avatar (enviada ~10x/s enquanto anda, 1x/s parado).
 * `a`: 0 parado, 1 andando, 2 correndo, 3 pulando, 4 acenando, 5 sentado,
 * 6 soco rápido, 7 soco forte, 8 defendendo, 9 nocauteado (x1); golpes de esporte (plano 2026-11-09 P5):
 * 10 chute, 11 raquetada de direita (forehand), 12 raquetada de esquerda (backhand), 13 manchete;
 * futebol (2026-11-09): 14 elástico, 15 carrinho, 16 bicicleta, 17 caído (levou falta).
 * App antigo que recebe 10–17 mostra o boneco parado.
 */
export const SpaceMove = z.object({
  channelId: Id,
  x: Coord,
  y: z.number().finite().min(0).max(10),
  z: Coord,
  ry: z.number().finite().min(-7).max(7),
  a: z.number().int().min(0).max(17),
  /** onde a pessoa está: 0 (ou ausente) a sala do servidor; 1 basquete, 2 futebol, 3 tênis, 4 vôlei, 5 ping pong,
   * 6 sinuca, 7 corrida de moto, 8 gunfight (todos contra todos) */
  zone: z.number().int().min(0).max(8).optional(),
  /** time nas arenas: a (azul, ataca +x) ou b (vermelho, ataca −x) */
  team: z.enum(['a', 'b']).optional(),
  /** gunfight: a arma na mão, a inclinação da mira (rad), agachado, mirando e vivo (para o boneco dos outros) */
  gun: SpaceGunPose.optional(),
});
export type SpaceMove = z.infer<typeof SpaceMove>;
export const SpaceLeave = z.object({ channelId: Id });

// ---------- gerador procedural (determinístico pelo id do servidor) ----------

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
    chance: (p: number) => next() < p,
  };
}

const THEME_COLORS: Record<SpaceTheme, { floor: string[]; wall: string[]; accent: string[] }> = {
  lounge: {
    floor: ['#6b4f3a', '#5a4636', '#7a5c44'],
    wall: ['#d9cbb8', '#c7d3d9', '#d6c2c9'],
    accent: ['#3f6fb5', '#c0504d', '#4f9d69', '#8d5fb8'],
  },
  rooftop: {
    floor: ['#8a8f96', '#7c858c', '#9a9184'],
    wall: ['#4a4f57', '#3d4650'],
    accent: ['#e07a3f', '#2f9e9e', '#d64f7a'],
  },
  cabin: {
    floor: ['#8b5a2b', '#7a4e26', '#9c6633'],
    wall: ['#a8743f', '#94673a'],
    accent: ['#b8432f', '#356b3c', '#c9a227'],
  },
  station: {
    floor: ['#3a4250', '#2f3744', '#444c5a'],
    wall: ['#c9d2dc', '#aeb8c4'],
    accent: ['#2fb8d6', '#e0b52f', '#e05a5a'],
  },
  beach: {
    floor: ['#e6d3a3', '#ecdcb0', '#dcc894'],
    wall: ['#f2efe6', '#e8e1cf'],
    accent: ['#2f9ecf', '#f07a5a', '#f2c94c'],
  },
  arcade: {
    floor: ['#26213a', '#1f1b30', '#2c2545'],
    wall: ['#3b3260', '#2e2850'],
    accent: ['#ff4fa3', '#3fd0ff', '#b3ff4f', '#ffd23f'],
  },
};

/** Ambiente inicial do servidor: mesmo id → mesmo ambiente; servidores diferentes → ambientes diferentes. */
export function generateSpace(serverId: string): SpaceLayout {
  const r = rng(hashSeed(serverId));
  const theme = r.pick(SPACE_THEMES);
  const pal = THEME_COLORS[theme];
  const width = r.int(9, 14) * 2;
  const depth = r.int(8, 12) * 2;
  const hx = width / 2;
  const hz = depth / 2;
  const outdoor = theme === 'rooftop' || theme === 'beach';
  const wallH = outdoor ? 1 : theme === 'station' ? 4 : 3.6;
  const walls: SpaceWall[] = [
    { x1: -hx, z1: -hz, x2: hx, z2: -hz, h: outdoor ? 4 : wallH },
    { x1: hx, z1: -hz, x2: hx, z2: hz, h: wallH },
    { x1: hx, z1: hz, x2: -hx, z2: hz, h: wallH },
    { x1: -hx, z1: hz, x2: -hx, z2: -hz, h: wallH },
  ];
  const items: SpaceItem[] = [];
  let n = 0;
  const add = (kind: SpaceItemKind, x: number, zz: number, rot = 0, color?: string) => {
    const it: SpaceItem = { id: (n++).toString(36), kind, x: round(x), z: round(zz), rot: round(rot) };
    if (color) it.color = color;
    items.push(it);
  };
  const accent = () => r.pick(pal.accent);

  // telão na parede do fundo e a plateia de frente para ele
  add('screen', 0, -hz + 0.35, 0);
  const rows = r.int(1, 2);
  const seat: SpaceItemKind =
    theme === 'arcade' || theme === 'station' ? 'beanbag' : theme === 'beach' ? 'chair' : 'sofa';
  for (let row = 0; row < rows; row++) {
    const zz = -hz + 6 + row * 2.6;
    const c = accent();
    if (seat === 'sofa') {
      add('sofa', -2.2, zz, Math.PI, c);
      add('sofa', 2.2, zz, Math.PI, c);
    } else {
      for (const x of [-3, -1, 1, 3]) add(seat, x, zz, Math.PI, accent());
    }
  }
  add('speaker', -4.2, -hz + 0.8, 0);
  add('speaker', 4.2, -hz + 0.8, 0);

  // canto de conversa com tapete e mesa de centro
  const side = r.chance(0.5) ? -1 : 1;
  const cx = side * (hx - 4.5);
  const cz = r.int(0, Math.max(0, Math.floor(hz - 6)));
  add('rug', cx, cz, 0, accent());
  add('coffee_table', cx, cz, 0);
  add('armchair', cx - 1.8, cz, Math.PI / 2, accent());
  add('armchair', cx + 1.8, cz, -Math.PI / 2, accent());
  if (!outdoor) add('lamp', cx + side * 2.6, cz - 2, 0);

  // canto do tema
  const ox = -side * (hx - 3.5);
  switch (theme) {
    case 'cabin':
      add('fireplace', -side * (hx - 0.6), cz, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      add('bookshelf', ox, hz - 0.5, Math.PI);
      add('bookshelf', ox + side * 2.2, hz - 0.5, Math.PI);
      break;
    case 'arcade':
      for (let i = 0; i < 4; i++) add('arcade', -hx + 1.5 + i * 1.6, hz - 0.8, Math.PI, accent());
      for (let i = 0; i < 3; i++) add('arcade', hx - 0.8, hz - 2 - i * 1.6, -Math.PI / 2, accent());
      break;
    case 'station':
      for (let i = 0; i < 4; i++) add('crate', ox + (i % 2) * 1.1, hz - 1 - Math.floor(i / 2) * 1.1, 0);
      add('column', -hx / 2, 0, 0);
      add('column', hx / 2, 0, 0);
      break;
    case 'beach':
      add('palm', -hx + 1.5, hz - 1.5, 0);
      add('palm', hx - 1.5, hz - 2, 0);
      add('palm', hx - 2.5, -hz + 3, 0);
      add('counter', ox, hz - 1.2, Math.PI, accent());
      for (const d of [-1.2, 0, 1.2]) add('stool', ox + d, hz - 2.3, 0, accent());
      break;
    default:
      // lounge e terraço: bar com banquetas
      add('counter', ox, hz - 1.2, Math.PI, accent());
      for (const d of [-1.2, 0, 1.2]) add('stool', ox + d, hz - 2.3, 0, accent());
      add('table', -ox * 0.3, hz - 3.5, 0);
      add('chair', -ox * 0.3 - 1, hz - 3.5, Math.PI / 2, accent());
      add('chair', -ox * 0.3 + 1, hz - 3.5, -Math.PI / 2, accent());
  }

  // plantas nos cantos e uma tv lateral de vez em quando
  const green: SpaceItemKind = outdoor ? (theme === 'beach' ? 'palm' : 'tree') : 'plant';
  for (const [x, zz] of [
    [-hx + 0.8, -hz + 0.8],
    [hx - 0.8, -hz + 0.8],
  ] as const)
    add(green, x, zz, 0);
  if (!outdoor && r.chance(0.6)) add('plant', -hx + 0.8, hz - 0.8, 0);
  if (!outdoor && r.chance(0.5)) add('tv', side * (hx - 0.3), -hz + 5, side > 0 ? -Math.PI / 2 : Math.PI / 2);

  // parede interna com passagem, em alguns ambientes fechados
  if (!outdoor && r.chance(0.5) && width >= 22) {
    const wx = -side * (hx - 8);
    walls.push({ x1: wx, z1: hz, x2: wx, z2: hz - 3.5, h: wallH });
  }

  return SpaceLayout.parse({
    v: 1,
    theme,
    width,
    depth,
    floorColor: r.pick(pal.floor),
    wallColor: r.pick(pal.wall),
    walls,
    items,
    spawn: { x: 0, z: round(hz - 3) },
  });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- x1 no soco ----------
export const DUEL_HP = 100;
export const DUEL_JAB = 8;
export const DUEL_STRONG = 16;
/** defendendo, o golpe tira só esta fração */
export const DUEL_BLOCK = 0.25;
export const DUEL_JAB_COOLDOWN_MS = 420;
export const DUEL_STRONG_COOLDOWN_MS = 1100;
/** alcance do soco (centro a centro) */
export const DUEL_REACH = 1.5;
/** o soco precisa estar virado para o adversário (meio ângulo, em radianos) */
export const DUEL_AIM = 1.2;
export const DUEL_RING_R = 3.5;
export const DUEL_COUNTDOWN_MS = 3000;
export const DUEL_FIGHT_MS = 90_000;
export const DUEL_INVITE_MS = 20_000;

export const SpaceDuel = z.object({
  id: z.string(),
  channelId: Id,
  /** quem desafiou e quem foi desafiado */
  a: Id,
  b: Id,
  status: z.enum(['pending', 'countdown', 'fighting', 'ended']),
  hp: z.record(z.string(), z.number()),
  ring: z.object({ x: z.number(), z: z.number() }),
  /** relógio do servidor (ms): fim do convite (pending), início da luta (countdown), fim da luta (fighting) */
  until: z.number(),
  winner: Id.nullable(),
  reason: z.enum(['ko', 'time', 'forfeit', 'declined', 'expired', 'left']).nullable(),
  /** último golpe que acertou (para o efeito de impacto) */
  lastHit: z.object({ by: Id, on: Id, dmg: z.number(), blocked: z.boolean(), at: z.number() }).nullable(),
  serverNow: z.number(),
});
export type SpaceDuel = z.infer<typeof SpaceDuel>;

/** Dano de um golpe que acertou. */
export function duelDamage(strong: boolean, blocking: boolean): number {
  const base = strong ? DUEL_STRONG : DUEL_JAB;
  return blocking ? Math.round(base * DUEL_BLOCK) : base;
}

/** O soco de `a` (virado para `a.ry`) alcança `b`? */
export function duelReaches(a: { x: number; z: number; ry: number }, b: { x: number; z: number }, slack = 0): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > DUEL_REACH + slack) return false;
  if (d < 0.2) return true;
  let diff = Math.atan2(dx, dz) - a.ry;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= DUEL_AIM;
}

// ---------- esportes (arenas do espaço) ----------
export const SPORT_ZONES = {
  basketball: 1,
  soccer: 2,
  tennis: 3,
  volleyball: 4,
  pingpong: 5,
  pool: 6,
  race: 7,
} as const;
export type SportZone = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const SPORT_LABELS: Record<SportZone, string> = {
  1: 'Basquete',
  2: 'Futebol',
  3: 'Tênis',
  4: 'Vôlei',
  5: 'Ping pong',
  6: 'Sinuca',
  7: 'Corrida de moto',
};

export const SPACE_BALL_EVENTS = ['tackle', 'foul', 'carretilha', 'elastico', 'bicicleta'] as const;
export const SpaceBallEvent = z.object({ kind: z.enum(SPACE_BALL_EVENTS), on: Id.nullable() });
export type SpaceBallEvent = z.infer<typeof SpaceBallEvent>;

/**
 * Bola de uma arena: quem tocou por último simula e manda (~10x/s); os outros seguem.
 * `held`: quem está com a bola na mão (basquete).
 */
export const SpaceBall = z.object({
  channelId: Id,
  zone: z.number().int().min(1).max(7),
  x: z.number().finite().min(-80).max(80),
  y: z.number().finite().min(-5).max(40),
  z: z.number().finite().min(-80).max(80),
  vx: z.number().finite().min(-60).max(60),
  vy: z.number().finite().min(-60).max(60),
  vz: z.number().finite().min(-60).max(60),
  held: Id.nullable(),
  /** quem mandou por último e quando (ms, relógio de quem mandou): desempata quem é a autoridade */
  t: z.number().finite(),
  /**
   * futebol: o lance que acabou de acontecer (vai uma vez, junto do estado): desarme ou falta em `on`, ou o drible de
   * quem mandou. API antiga descarta.
   */
  ev: SpaceBallEvent.optional(),
});
export type SpaceBall = z.infer<typeof SpaceBall>;

export const SpaceScore = z.object({
  channelId: Id,
  zone: z.number().int().min(1).max(7),
  side: z.enum(['a', 'b']),
  points: z.number().int().min(1).max(3),
  /** quem marcou (para a classificação); precisa estar na chamada */
  by: Id.optional(),
  /** quantos de cada time o app vê na arena (o servidor confere com as posições; um lado vazio = treino) */
  teams: z.object({ a: z.number().int().min(0).max(99), b: z.number().int().min(0).max(99) }).optional(),
});

/** Sinuca: as 16 bolas (0 = branca) [x, z, encaçapada 0/1], de quem é a vez e se ainda estão rolando. */
export const SpacePool = z.object({
  channelId: Id,
  balls: z
    .array(
      z.tuple([z.number().finite().min(-5).max(5), z.number().finite().min(-5).max(5), z.number().int().min(0).max(1)]),
    )
    .max(16),
  turn: z.enum(['a', 'b']),
  /** de quem é a vez (pessoa, em rodízio entre os times); sem isto, vale o time (`turn`) */
  turnId: z.string().min(1).max(64).optional(),
  moving: z.boolean(),
  /** contador de tacadas: a mais nova manda (como a posse da bola) */
  t: z.number().int().min(0),
});
export type SpacePool = z.infer<typeof SpacePool>;

export const RACE_LAPS = 3;
/** prova mínima plausível (anti-trapaça grosseira): uma volta não sai em menos de 8 s (a pista tem ~355 m) */
export const RACE_MIN_LAP_MS = 8_000;
export const RACE_COUNTDOWN_MS = 4000;

/** a corrida fecha este tempo depois da chegada do 1º; quem não chegou fica como DNF */
export const RACE_CLOSE_MS = 30_000;

// ---------- partidas: alvo, fim e vencedor ----------
/** arenas com partida (alvo e vencedor); sinuca e corrida têm a própria regra */
export type MatchZone = 1 | 2 | 3 | 4 | 5;
export const MATCH_COUNTDOWN_MS = 3000;

export interface MatchRule {
  /** pontos para vencer */
  target: number;
  /** diferença mínima para vencer (2 = "vence por 2") */
  winBy: number;
  /** tempo de jogo (ms); acabou com placar diferente, vence quem está na frente; empatado, o próximo ponto vence */
  timeMs: number | null;
  /** o menor ponto de um lance (basquete: cesta de 2), para o match point */
  step: number;
  /** empate no fim do tempo: gol de ouro (o próximo ponto vence) */
  golden?: boolean;
}

export const MATCH_RULES: Record<MatchZone, MatchRule> = {
  1: { target: 21, winBy: 1, timeMs: 180_000, step: 2, golden: true },
  2: { target: 5, winBy: 1, timeMs: 180_000, step: 1, golden: true },
  3: { target: 7, winBy: 2, timeMs: null, step: 1 },
  4: { target: 15, winBy: 2, timeMs: null, step: 1 },
  5: { target: 11, winBy: 2, timeMs: null, step: 1 },
};

export function isMatchZone(zone: number): zone is MatchZone {
  return zone === 1 || zone === 2 || zone === 3 || zone === 4 || zone === 5;
}

/** Texto curto da regra ("até 11, vence por 2", "21 pontos ou 3 min"). */
export function matchRuleLabel(zone: MatchZone): string {
  const r = MATCH_RULES[zone];
  const unit = zone === 2 ? 'gols' : 'pontos';
  if (r.timeMs) return `${r.target} ${unit} ou ${Math.round(r.timeMs / 60000)} min`;
  return r.winBy > 1 ? `até ${r.target}, vence por ${r.winBy}` : `até ${r.target}`;
}

/**
 * Quem venceu (ou null, se a partida continua). `elapsedMs` = tempo de jogo desde o VAI.
 * Alvo: chegou ao alvo com a diferença mínima. Tempo: esgotado com placar diferente vence quem está na frente; empatado,
 * segue até o próximo ponto (gol de ouro).
 */
export function matchWinner(zone: MatchZone, score: { a: number; b: number }, elapsedMs = 0): 'a' | 'b' | null {
  const r = MATCH_RULES[zone];
  const lead: 'a' | 'b' | null = score.a > score.b ? 'a' : score.b > score.a ? 'b' : null;
  if (!lead) return null;
  const top = Math.max(score.a, score.b);
  if (top >= r.target && Math.abs(score.a - score.b) >= r.winBy) return lead;
  if (r.timeMs !== null && elapsedMs >= r.timeMs) return lead;
  return null;
}

/** `side` vence com o próximo ponto? (o selo MATCH POINT) */
export function isMatchPoint(
  zone: MatchZone,
  score: { a: number; b: number },
  side: 'a' | 'b',
  elapsedMs = 0,
): boolean {
  if (matchWinner(zone, score, elapsedMs)) return false;
  const step = MATCH_RULES[zone].step;
  const next = { ...score, [side]: score[side] + step };
  return matchWinner(zone, next, elapsedMs) === side;
}

/** Fase de agora: a contagem vira `playing` sozinha quando passa do `startAt` (relógio do servidor). */
export function matchPhase(m: SpaceMatch | undefined, now: number): MatchPhase {
  if (!m) return 'idle';
  if (m.phase === 'countdown' && now >= m.startAt) return 'playing';
  return m.phase;
}

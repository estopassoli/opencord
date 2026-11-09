import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DUEL_JAB,
  DUEL_STRONG,
  duelDamage,
  duelReaches,
  generateSpace,
  GUN_IDS,
  SPACE_THEMES,
  SPACE_VOICE_FLOOR,
  SpaceLayout,
  isMatchPoint,
  MATCH_RULES,
  matchPhase,
  matchRuleLabel,
  matchWinner,
  SpaceBall,
  SpaceMove,
  SpaceSession,
  spaceVoiceGain,
} from './space.js';

describe('Espaço 3D: gerador procedural', () => {
  it('mesmo servidor → mesmo ambiente; servidores diferentes → ambientes diferentes', () => {
    const id = randomUUID();
    expect(generateSpace(id)).toEqual(generateSpace(id));
    const many = Array.from({ length: 40 }, () => JSON.stringify(generateSpace(randomUUID())));
    expect(new Set(many).size).toBe(40);
  });

  it('todo ambiente gerado é válido, tem telão e usa vários temas', () => {
    const themes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const l = generateSpace(randomUUID());
      expect(SpaceLayout.safeParse(l).success).toBe(true);
      expect(l.items.filter((it) => it.kind === 'screen')).toHaveLength(1);
      themes.add(l.theme);
    }
    expect(themes.size).toBe(SPACE_THEMES.length);
  });
});

describe('Espaço 3D: voz pela distância', () => {
  it('cheia de perto, cai devagar e nunca passa do piso', () => {
    expect(spaceVoiceGain(0)).toBe(1);
    expect(spaceVoiceGain(3)).toBe(1);
    expect(spaceVoiceGain(500)).toBe(SPACE_VOICE_FLOOR);
    let prev = 1;
    for (let d = 3; d <= 30; d += 0.5) {
      const g = spaceVoiceGain(d);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(SPACE_VOICE_FLOOR);
      prev = g;
    }
    // a 10 m ainda se ouve bem mais que o piso
    expect(spaceVoiceGain(10)).toBeGreaterThan(0.7);
  });
});

describe('Espaço 3D: validação', () => {
  it('recusa posição absurda', () => {
    const id = randomUUID();
    expect(SpaceMove.safeParse({ channelId: id, x: 1, y: 0, z: 1, ry: 0, a: 1 }).success).toBe(true);
    expect(SpaceMove.safeParse({ channelId: id, x: 1e9, y: 0, z: 1, ry: 0, a: 1 }).success).toBe(false);
    // golpes de esporte e lances do futebol (10–17) valem; além disso, não
    expect(SpaceMove.safeParse({ channelId: id, x: 1, y: 0, z: 1, ry: 0, a: 17 }).success).toBe(true);
    expect(SpaceMove.safeParse({ channelId: id, x: 1, y: 0, z: 1, ry: 0, a: 18 }).success).toBe(false);
  });

  it('gunfight: os acessórios da arma vão na pose (até 4 códigos pequenos; app antigo sem o campo continua valendo)', () => {
    const base = { channelId: randomUUID(), x: 1, y: 0, z: 1, ry: 0, a: 1, zone: 8 };
    const gun = { w: 'm4', pitch: 0, crouch: false, ads: false, alive: true };
    expect(SpaceMove.safeParse({ ...base, gun }).success).toBe(true);
    const ok = SpaceMove.safeParse({ ...base, gun: { ...gun, att: [1, 1, 0, 1] } });
    expect(ok.success && ok.data.gun?.att).toEqual([1, 1, 0, 1]);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: [] } }).success).toBe(true);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: [1, 1, 1, 1, 1] } }).success).toBe(false);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: [16] } }).success).toBe(false);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: [-1] } }).success).toBe(false);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: [1.5] } }).success).toBe(false);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, att: 'reddot' } }).success).toBe(false);
  });

  it('gunfight: as armas novas valem na pose e as antigas mantêm a ordem (índice da rede)', () => {
    const base = { channelId: randomUUID(), x: 1, y: 0, z: 1, ry: 0, a: 1, zone: 8 };
    const gun = { pitch: 0, crouch: false, ads: false, alive: true };
    for (const w of ['rs9', 'msmc', 'mcx', 'scarl', 'mpx', 'automag3', 'aks74u', 'pdw', 'sv98', 'ballista', 'bfr'])
      expect(SpaceMove.safeParse({ ...base, gun: { ...gun, w } }).success).toBe(true);
    for (const w of ['stg44', 'rhino']) expect(SpaceMove.safeParse({ ...base, gun: { ...gun, w } }).success).toBe(true);
    // facas novas: no fim da lista (as de antes mantêm o índice)
    expect(GUN_IDS.slice(-4)).toEqual(['balisong', 'kabar', 'bowie', 'kukri']);
    expect(GUN_IDS.indexOf('rhino')).toBe(23);
    for (const w of ['balisong', 'kabar', 'bowie', 'kukri'])
      expect(SpaceMove.safeParse({ ...base, gun: { ...gun, w } }).success).toBe(true);
    expect(SpaceMove.safeParse({ ...base, gun: { ...gun, w: 'gepard' } }).success).toBe(false);
    expect(GUN_IDS.slice(0, 11)).toEqual([
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
    ]);
  });

  it('bola do futebol leva o lance uma vez (desarme, falta, drible)', () => {
    const base = { channelId: randomUUID(), zone: 2, x: 0, y: 0.2, z: 0, vx: 0, vy: 0, vz: 0, held: null, t: 3 };
    const on = randomUUID();
    expect(SpaceBall.safeParse({ ...base, ev: { kind: 'foul', on } }).success).toBe(true);
    expect(SpaceBall.safeParse({ ...base, ev: { kind: 'bicicleta', on: null } }).success).toBe(true);
    expect(SpaceBall.safeParse({ ...base, ev: { kind: 'gol', on: null } }).success).toBe(false);
    expect(SpaceBall.safeParse(base).success).toBe(true);
  });
});

describe('x1 no soco: regras', () => {
  it('alcance e mira', () => {
    const me = { x: 0, z: 0, ry: 0 }; // olhando para +z
    expect(duelReaches(me, { x: 0, z: 1.2 })).toBe(true);
    expect(duelReaches(me, { x: 0, z: 2.5 })).toBe(false);
    expect(duelReaches(me, { x: 0, z: -1 })).toBe(false); // de costas
    expect(duelReaches(me, { x: 1, z: 0.6 })).toBe(true); // de lado, dentro do ângulo
  });
  it('defesa reduz o dano', () => {
    expect(duelDamage(false, false)).toBe(DUEL_JAB);
    expect(duelDamage(true, false)).toBe(DUEL_STRONG);
    expect(duelDamage(true, true)).toBe(Math.round(DUEL_STRONG / 4));
  });
});

describe('Espaço 3D: partidas com alvo e vencedor (P2)', () => {
  it('ping pong: até 11, vence por 2', () => {
    expect(matchWinner(5, { a: 11, b: 9 })).toBe('a');
    expect(matchWinner(5, { a: 11, b: 10 })).toBeNull();
    expect(matchWinner(5, { a: 13, b: 11 })).toBe('a');
    expect(matchWinner(5, { a: 9, b: 11 })).toBe('b');
  });

  it('tênis 7 e vôlei 15, os dois vencendo por 2; sem tempo, o relógio não decide', () => {
    expect(matchWinner(3, { a: 7, b: 5 })).toBe('a');
    expect(matchWinner(3, { a: 7, b: 6 })).toBeNull();
    expect(matchWinner(4, { a: 15, b: 13 })).toBe('a');
    expect(matchWinner(4, { a: 15, b: 14 }, 10 * 60_000)).toBeNull();
  });

  it('basquete: 21 pontos ou 3 min', () => {
    expect(matchWinner(1, { a: 21, b: 20 })).toBe('a');
    expect(matchWinner(1, { a: 20, b: 18 })).toBeNull();
    expect(matchWinner(1, { a: 8, b: 10 }, MATCH_RULES[1].timeMs!)).toBe('b');
    expect(matchWinner(1, { a: 10, b: 10 }, MATCH_RULES[1].timeMs!)).toBeNull();
  });

  it('futebol: 5 gols, ou o tempo esgotado com placar diferente; empatado, gol de ouro', () => {
    expect(matchWinner(2, { a: 5, b: 4 })).toBe('a');
    expect(matchWinner(2, { a: 2, b: 1 }, 179_999)).toBeNull();
    expect(matchWinner(2, { a: 2, b: 1 }, 180_000)).toBe('a');
    expect(matchWinner(2, { a: 1, b: 1 }, 200_000)).toBeNull();
    expect(matchWinner(2, { a: 1, b: 2 }, 200_000)).toBe('b');
    // empate no tempo: qualquer gol decide, então os dois estão em match point
    expect(isMatchPoint(2, { a: 1, b: 1 }, 'a', 200_000)).toBe(true);
    expect(isMatchPoint(2, { a: 1, b: 1 }, 'b', 200_000)).toBe(true);
  });

  it('match point certo nos jogos que vencem por 2', () => {
    expect(isMatchPoint(5, { a: 10, b: 9 }, 'a')).toBe(true);
    expect(isMatchPoint(5, { a: 10, b: 10 }, 'a')).toBe(false);
    expect(isMatchPoint(5, { a: 11, b: 10 }, 'a')).toBe(true);
    expect(isMatchPoint(5, { a: 11, b: 10 }, 'b')).toBe(false);
    expect(isMatchPoint(5, { a: 9, b: 9 }, 'a')).toBe(false);
    expect(isMatchPoint(3, { a: 6, b: 5 }, 'a')).toBe(true);
    expect(isMatchPoint(4, { a: 14, b: 14 }, 'b')).toBe(false);
    // partida decidida não tem match point
    expect(isMatchPoint(5, { a: 11, b: 5 }, 'a')).toBe(false);
    // basquete: uma cesta de 2 fecha
    expect(isMatchPoint(1, { a: 19, b: 0 }, 'a')).toBe(true);
    expect(isMatchPoint(1, { a: 18, b: 0 }, 'a')).toBe(false);
  });

  it('a contagem vira "playing" sozinha depois do startAt', () => {
    expect(matchPhase(undefined, 0)).toBe('idle');
    expect(matchPhase({ phase: 'countdown', startAt: 1000 }, 999)).toBe('countdown');
    expect(matchPhase({ phase: 'countdown', startAt: 1000 }, 1000)).toBe('playing');
    expect(matchPhase({ phase: 'ended', startAt: 1000, winner: 'a' }, 9999)).toBe('ended');
    expect(matchRuleLabel(5)).toBe('até 11, vence por 2');
    expect(matchRuleLabel(2)).toBe('5 gols ou 3 min');
  });

  it('sessão antiga, sem matches nem os campos novos, continua válida; os campos novos são opcionais', () => {
    const old = {
      channelId: randomUUID(),
      serverId: randomUUID(),
      screen: null,
      scores: { '1': { a: 2, b: 0 } },
      race: { startAt: 1, laps: 3, results: [] },
      updatedBy: null,
      revision: 3,
    };
    expect(SpaceSession.safeParse(old).success).toBe(true);
    expect(SpaceSession.parse(old).matches).toBeUndefined();
    const next = {
      ...old,
      race: { ...old.race, racers: [], endsAt: 5, closed: true, dnf: [] },
      matches: { '5': { phase: 'ended', startAt: 1, winner: 'a', endedAt: 2 } },
    };
    expect(SpaceSession.safeParse(next).success).toBe(true);
    expect(SpaceSession.safeParse({ ...old, matches: { '5': { phase: 'pausa', startAt: 1 } } }).success).toBe(false);
  });
});

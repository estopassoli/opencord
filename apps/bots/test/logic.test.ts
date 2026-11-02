import { describe, expect, it } from 'vitest';
import { betOutcome, robOutcome } from '../src/bots/dankmineiro.js';
import { AUTOMOD_DEFAULTS, checkMessage } from '../src/bots/dinamo.js';
import { slugify } from '../src/bots/tiquete.js';
import { gainFor, levelFor, xpToNext } from '../src/bots/you6.js';
import { formatDuration, parseDuration, pickRandom } from '../src/shared.js';
import { Store } from '../src/store.js';

describe('YOU6: curva de XP', () => {
  it('níveis sobem com XP crescente por nível', () => {
    expect(xpToNext(0)).toBe(100);
    expect(xpToNext(1)).toBe(150);
    expect(levelFor(0)).toEqual({ level: 0, into: 0, need: 100 });
    expect(levelFor(100).level).toBe(1);
    expect(levelFor(249).level).toBe(1);
    expect(levelFor(250).level).toBe(2);
    expect(levelFor(250).into).toBe(0);
  });
  it('ganho por mensagem fica entre 15 e 25', () => {
    expect(gainFor(() => 0)).toBe(15);
    expect(gainFor(() => 0.999)).toBe(25);
  });
});

describe('Dínamo: automod', () => {
  const s = { ...AUTOMOD_DEFAULTS, words: ['bobão'], blockLinks: true, flood: { max: 3, windowS: 10 } };
  it('palavra proibida ignora acento e maiúsculas', () => {
    expect(checkMessage('seu BOBAO', s, [])).toBe('palavra proibida');
    expect(checkMessage('bom dia', s, [])).toBeNull();
  });
  it('links só quando ligado', () => {
    expect(checkMessage('vem https://x.y', s, [])).toBe('link');
    expect(checkMessage('vem www.x.com', { ...s, blockLinks: false }, [])).toBeNull();
  });
  it('flood conta só a janela', () => {
    const now = 100_000;
    expect(checkMessage('oi', s, [now - 1000, now - 2000, now - 3000], now)).toBe('flood');
    expect(checkMessage('oi', s, [now - 1000, now - 20_000, now - 30_000], now)).toBeNull();
  });
});

describe('Carlos: tempo e sorteio', () => {
  it('parseDuration aceita s/m/h/d e rejeita o resto', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2 h')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('45s')).toBe(45_000);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
    expect(formatDuration(90_000)).toBe('2 min');
  });
  it('pickRandom não repete e respeita o limite', () => {
    const out = pickRandom(['a', 'b', 'c'], 5, () => 0);
    expect(out).toEqual(['a', 'b', 'c']);
    expect(pickRandom([], 2)).toEqual([]);
  });
});

describe('Dank Mineiro: chances', () => {
  it('aposta dobra com 45 %', () => {
    expect(betOutcome(100, () => 0.1)).toBe(100);
    expect(betOutcome(100, () => 0.9)).toBe(-100);
  });
  it('roubo falha com multa de 20 %', () => {
    expect(robOutcome(500, 1000, () => 0.9)).toEqual({ ok: false, delta: -100 });
    const ok = robOutcome(500, 1000, () => 0.1);
    expect(ok.ok).toBe(true);
    expect(ok.delta).toBeGreaterThanOrEqual(100);
  });
});

describe('Tíquete: nome do canal', () => {
  it('slug sem acento, minúsculo, curto', () => {
    expect(slugify('João Víctor!')).toBe('joao-victor');
    expect(slugify('   ')).toBe('pessoa');
  });
});

describe('Store (SQLite em memória)', () => {
  it('kv por namespace e tabelas prontas', () => {
    const s = new Store(':memory:');
    expect(s.get('x', 'g1', { a: 1 })).toEqual({ a: 1 });
    s.set('x', 'g1', { a: 2 });
    expect(s.get('x', 'g1', { a: 1 })).toEqual({ a: 2 });
    s.db.prepare('INSERT INTO xp (guild, user, xp, last_at) VALUES (?, ?, ?, ?)').run('g', 'u', 10, 0);
    expect((s.db.prepare('SELECT xp FROM xp WHERE guild = ? AND user = ?').get('g', 'u') as { xp: number }).xp).toBe(
      10,
    );
    s.close();
  });
});

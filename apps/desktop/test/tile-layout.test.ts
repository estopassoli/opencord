import { describe, expect, it } from 'vitest';
import { bestTileWidth } from '../src/features/voice/tileLayout';

describe('bestTileWidth', () => {
  it('um quadro ocupa o limite da altura em 16:9', () => {
    expect(bestTileWidth(1600, 450, 1, 8)).toBe(800);
  });
  it('dois quadros lado a lado numa área larga; empilhados numa quadrada', () => {
    expect(bestTileWidth(2000, 600, 2, 0)).toBe(1000);
    expect(bestTileWidth(1000, 1000, 2, 0)).toBe(888);
  });
  it('sete quadros numa área 16:9 usam 3 colunas', () => {
    const w = bestTileWidth(1200, 675, 7, 8);
    expect(w).toBe(Math.floor(((675 - 16) / 3) * (16 / 9)));
  });
  it('área vazia ou sem quadros dá zero', () => {
    expect(bestTileWidth(0, 500, 3)).toBe(0);
    expect(bestTileWidth(500, 500, 0)).toBe(0);
  });
});

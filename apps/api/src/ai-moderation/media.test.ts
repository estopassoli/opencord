import { describe, expect, it } from 'vitest';
import { framesFor } from './media.js';

describe('quadros por vídeo (moderação por IA)', () => {
  it('1 quadro a cada 10 s, entre 4 e 10; sem duração conhecida usa 4', () => {
    expect(framesFor(null)).toBe(4);
    expect(framesFor(5)).toBe(4);
    expect(framesFor(45)).toBe(5);
    expect(framesFor(90)).toBe(9);
    expect(framesFor(600)).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import { fmt, peaksOf } from '../src/features/chat/VoiceNote';

describe('mensagem de voz: forma de onda e tempo', () => {
  it('divide as amostras em barras e normaliza pelo pico maior', () => {
    const s = new Float32Array(400);
    for (let i = 0; i < 100; i++) s[i] = 0.25;
    for (let i = 300; i < 400; i++) s[i] = -0.5;
    const p = peaksOf(s, 4);
    expect(p).toEqual([0.5, 0, 0, 1]);
  });
  it('sem amostras: barras zeradas; silêncio total não divide por zero', () => {
    expect(peaksOf(new Float32Array(0), 3)).toEqual([0, 0, 0]);
    expect(peaksOf(new Float32Array(10), 2)).toEqual([0, 0]);
  });
  it('formata m:ss', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(65.4)).toBe('1:05');
    expect(fmt(300)).toBe('5:00');
  });
});

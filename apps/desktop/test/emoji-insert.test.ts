import { describe, expect, it } from 'vitest';
import { insertAtCaret } from '../src/components/EmojiButton';
import data from '../src/lib/emoji-data.json';

const box = (start: number, end = start) => ({ selectionStart: start, selectionEnd: end }) as HTMLTextAreaElement;

describe('inserir emoji na caixa de texto', () => {
  it('põe o emoji no cursor e o cursor depois dele', () => {
    expect(insertAtCaret(box(3), 'Oi tudo', '😀')).toEqual({ next: 'Oi 😀tudo', caret: 5 });
  });
  it('troca o trecho selecionado', () => {
    expect(insertAtCaret(box(3, 7), 'Oi tudo bem', '👋')).toEqual({ next: 'Oi 👋 bem', caret: 5 });
  });
  it('sem caixa, vai para o fim', () => {
    expect(insertAtCaret(null, 'Oi', '🎉').next).toBe('Oi🎉');
  });
  it('personalizado ganha espaço para não grudar na palavra', () => {
    expect(insertAtCaret(box(2), 'Oi', ':galo:').next).toBe('Oi :galo: ');
    expect(insertAtCaret(box(3), 'Oi ', ':galo:').next).toBe('Oi :galo: ');
  });
});

describe('lista de emojis', () => {
  it('tem nome em português e só grupos conhecidos', () => {
    const rows = data as unknown as [string, string, string, number][];
    expect(rows.length).toBeGreaterThan(1500);
    expect(rows.find((r) => r[0] === '😀')?.[1]).toBe('rosto risonho');
    expect(new Set(rows.map((r) => r[3]))).not.toContain(2);
  });
});

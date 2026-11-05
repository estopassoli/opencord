import { describe, expect, it } from 'vitest';
import { emojiPicker, onlyCustomEmojis, parseEmojiToken, resolveShortcodes } from '../src/lib/customEmoji';

const gato = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', name: 'gato', animated: false };
const dança = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', name: 'danca', animated: true };
const pick = emojiPicker([gato], [[dança]]);

describe('emojis personalizados', () => {
  it('troca :nome: pelo token, fora de código e sem mexer em tokens prontos', () => {
    expect(resolveShortcodes('oi :gato: e :danca:', pick)).toBe(`oi <:gato:${gato.id}> e <a:danca:${dança.id}>`);
    expect(resolveShortcodes('`:gato:` :nada:', pick)).toBe('`:gato:` :nada:');
    const ready = `<:gato:${gato.id}>`;
    expect(resolveShortcodes(ready, pick)).toBe(ready);
    expect(resolveShortcodes(':GATO:', pick)).toBe(`<:gato:${gato.id}>`);
  });

  it('lê o token e reconhece mensagem só de emojis', () => {
    expect(parseEmojiToken(`<a:danca:${dança.id}>`)).toEqual(dança);
    expect(parseEmojiToken('👍')).toBeNull();
    expect(onlyCustomEmojis(`<:gato:${gato.id}> <a:danca:${dança.id}>`)).toBe(true);
    expect(onlyCustomEmojis(`oi <:gato:${gato.id}>`)).toBe(false);
  });

  it('o servidor aberto ganha de outro servidor com o mesmo nome', () => {
    const outro = { ...gato, id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d' };
    expect(emojiPicker([gato], [[outro]])('gato')?.id).toBe(gato.id);
  });
});

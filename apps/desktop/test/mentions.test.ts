import { describe, expect, it } from 'vitest';
import { mentionAt, mentionsAsText, resolveMentions, suggestMentions } from '../src/lib/mentions';

const blessed = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01', username: 'blessed', displayName: 'Blessed' };
const idk = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02', username: 'idk', displayName: 'idk' };
const ana = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03',
  username: 'ana.silva',
  displayName: 'Ana Silva',
  nickname: 'Aninha',
};
const joao = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a04', username: 'jp', displayName: 'João' };
const all = [blessed, idk, ana, joao];
const tok = (u: { id: string }) => `<@${u.id}>`;

describe('menções no compositor', () => {
  it('acha o @ em edição no cursor, sem pegar e-mail, URL nem código', () => {
    expect(mentionAt('Bora jogar sexta @bl', 20)).toEqual({ start: 17, end: 20, query: 'bl' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    // cursor no meio da palavra: substitui a palavra toda
    expect(mentionAt('oi @blessed tudo', 6)).toEqual({ start: 3, end: 11, query: 'bl' });
    expect(mentionAt('mail a@b.com', 12)).toBeNull();
    expect(mentionAt('https://x.com/@ana', 18)).toBeNull();
    expect(mentionAt('`@ana', 5)).toBeNull();
    expect(mentionAt('oi @ana e', 9)).toBeNull();
  });

  it('sugere por usuário, apelido ou nome, sem acento e com @everyone quando pode', () => {
    expect(suggestMentions('bl', all).map((s) => s.label)).toEqual(['Blessed']);
    expect(suggestMentions('anin', all)[0]).toMatchObject({ kind: 'user', id: ana.id, insert: '@ana.silva ' });
    expect(suggestMentions('silva', all).map((s) => s.label)).toEqual(['Aninha']);
    expect(suggestMentions('joao', all).map((s) => s.label)).toEqual(['João']);
    // sem nada digitado, mantém a ordem recebida (quem falou por último primeiro) e não repete
    expect(suggestMentions('', [idk, blessed, idk]).map((s) => s.label)).toEqual(['idk', 'Blessed']);
    expect(suggestMentions('ev', all, { everyone: true }).map((s) => s.kind)).toEqual(['everyone']);
    expect(suggestMentions('ev', all)).toEqual([]);
    expect(suggestMentions('', all, { everyone: true, limit: 3 }).map((s) => s.kind)).toEqual([
      'user',
      'user',
      'everyone',
    ]);
  });

  it('troca @nome pelo token ao enviar (o caso do print: @blessed e @Idk)', () => {
    expect(resolveMentions('Bora jogar sexta @blessed', all)).toBe(`Bora jogar sexta ${tok(blessed)}`);
    expect(resolveMentions('@Idk', all)).toBe(tok(idk));
    expect(resolveMentions('fala @ana.silva.', all)).toBe(`fala ${tok(ana)}.`);
    expect(resolveMentions('(@aninha) e @joão', all)).toBe(`(${tok(ana)}) e ${tok(joao)}`);
  });

  it('deixa como está: desconhecido, @everyone, e-mail, código e token pronto', () => {
    expect(resolveMentions('@ninguem @everyone a@blessed.com', all)).toBe('@ninguem @everyone a@blessed.com');
    expect(resolveMentions('`@blessed` @blessed', all)).toBe(`\`@blessed\` ${tok(blessed)}`);
    expect(resolveMentions(`oi ${tok(idk)}`, all)).toBe(`oi ${tok(idk)}`);
    // nome de exibição repetido entre duas pessoas: ambíguo, não marca ninguém
    const outra = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05', username: 'b2', displayName: 'Blessed' };
    const bless2 = { ...blessed, username: 'bless' };
    expect(resolveMentions('@Blessed', [bless2, outra])).toBe('@Blessed');
  });

  it('na edição o token volta a @usuario e o caminho de ida e volta preserva a menção', () => {
    const body = `Bora ${tok(blessed)} e ${tok(ana)}. \`${tok(idk)}\` x${tok(joao)}`;
    const text = mentionsAsText(body, all);
    expect(text).toBe(`Bora @blessed e @ana.silva. \`${tok(idk)}\` x${tok(joao)}`);
    expect(resolveMentions(text, all)).toBe(body);
  });
});

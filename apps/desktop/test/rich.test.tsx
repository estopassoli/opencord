import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRich } from '../src/features/chat/rich';

const renderText = (t: string) =>
  render(<div data-testid="r">{renderRich(t, (id) => (id.startsWith('0') ? 'Ana' : 'x'))}</div>).getByTestId('r');

describe('renderRich (sem innerHTML)', () => {
  it('HTML/script é exibido como texto, nunca interpretado', () => {
    const el = renderText('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(el.querySelector('img, script')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('apenas links http(s) viram âncoras; javascript: não', () => {
    const el = renderText('veja https://exemplo.com/a?b=1. e javascript:alert(1)');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://exemplo.com/a?b=1');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(el.textContent).toContain('javascript:alert(1)');
  });
  it('formatação e menções', () => {
    const el = renderText('**negrito** *it* `code` <@01a18609-c3c2-70d3-8869-93ae42dcc504>');
    expect(el.querySelector('strong')?.textContent).toBe('negrito');
    expect(el.querySelector('em')?.textContent).toBe('it');
    expect(el.querySelector('code')?.textContent).toBe('code');
    expect(el.querySelector('.mention')?.textContent).toBe('@Ana');
  });
  it('markdown no meio do texto', () => {
    const el = renderText('__sub__ ~~ris~~ ***ambos*** _it_ snake_case_nome ||segredo|| \\*literal\\*');
    expect(el.querySelector('u')?.textContent).toBe('sub');
    expect(el.querySelector('s')?.textContent).toBe('ris');
    expect(el.querySelector('strong > em')?.textContent).toBe('ambos');
    expect([...el.querySelectorAll('em')].map((e) => e.textContent)).toContain('it');
    expect(el.textContent).toContain('snake_case_nome');
    expect(el.querySelector('.md-spoiler')?.textContent).toBe('segredo');
    expect(el.textContent).toContain('*literal*');
  });
  it('link com texto só para http(s), mostrando o destino', () => {
    const el = renderText('[site](https://exemplo.com) e [ruim](javascript:alert(1))');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('site');
    expect(links[0]?.getAttribute('data-tip')).toBe('https://exemplo.com');
  });
  it('blocos: títulos, citação, listas, código e subtexto', () => {
    const el = renderText(
      '# Título\n## Sub\n> citado\n> **mais**\n- um\n- dois\n1. a\n2. b\n-# pequeno\n```js\nconst x = 1 **2**;\n<b>\n```\nfim',
    );
    expect(el.querySelector('h3')?.textContent).toBe('Título');
    expect(el.querySelector('h4')?.textContent).toBe('Sub');
    expect(el.querySelector('blockquote')?.textContent).toBe('citadomais');
    expect([...el.querySelectorAll('ul > li')].map((l) => l.textContent)).toEqual(['um', 'dois']);
    expect([...el.querySelectorAll('ol > li')].map((l) => l.textContent)).toEqual(['a', 'b']);
    expect(el.querySelector('.md-sub')?.textContent).toBe('pequeno');
    // dentro do bloco de código nada é formatado nem interpretado
    expect(el.querySelector('pre code')?.textContent).toBe('const x = 1 **2**;\n<b>');
    expect(el.querySelector('pre strong, pre b')).toBeNull();
    expect(el.textContent?.endsWith('fim')).toBe(true);
  });
});

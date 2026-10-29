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
});

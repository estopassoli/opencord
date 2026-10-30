import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, avatarColor, Icon, ICON_NAMES, initials } from './index.js';

describe('Icon', () => {
  it('renderiza um svg do Hugeicons e é decorativo sem label', () => {
    const { container } = render(<Icon name="microphone" />);
    const span = container.querySelector('.oc-icon') as HTMLElement;
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.querySelectorAll('svg')).toHaveLength(1);
  });
  it('com label vira role=img; active vira data-attr; microfone desligado tem ícone próprio', () => {
    const { getByRole, container } = render(<Icon name="microphone" label="Microfone mutado" active slashed />);
    const img = getByRole('img', { name: 'Microfone mutado' });
    expect(img.dataset.active).toBe('true');
    // o microfone desligado usa o ícone dedicado, sem o traço diagonal
    expect(img.dataset.slashed).toBeUndefined();
    const on = container.ownerDocument.createElement('div');
    on.innerHTML = render(<Icon name="microphone" />).container.innerHTML;
    expect(img.querySelector('svg')?.innerHTML).not.toBe(on.querySelector('svg')?.innerHTML);
  });
  it('outros ícones desligados ganham o traço diagonal', () => {
    const { container } = render(<Icon name="speaker" slashed />);
    expect((container.querySelector('.oc-icon') as HTMLElement).dataset.slashed).toBe('true');
  });
  it('todos os nomes renderizam', () => {
    for (const n of ICON_NAMES) expect(() => render(<Icon name={n} />)).not.toThrow();
  });
});

describe('Avatar', () => {
  it('iniciais e cor determinística', () => {
    expect(initials('Ana Souza')).toBe('AS');
    expect(initials('bob')).toBe('BO');
    expect(avatarColor('x')).toBe(avatarColor('x'));
    const { getByText, container } = render(<Avatar id="1" name="Ana" status="dnd" />);
    // status: texto para leitores de tela e dica do app (data-tip), sem o title nativo
    expect(getByText('Não perturbe')).toBeTruthy();
    expect(container.querySelector('[data-tip="Não perturbe"]')).toBeTruthy();
  });
});

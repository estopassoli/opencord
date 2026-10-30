import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, avatarColor, Icon, ICON_NAMES, initials } from './index.js';

describe('Icon', () => {
  it('renderiza outline e solid sobrepostos e é decorativo sem label', () => {
    const { container } = render(<Icon name="microphone" />);
    const span = container.querySelector('.oc-icon') as HTMLElement;
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.querySelectorAll('svg.oc-icon-outline')).toHaveLength(1);
    expect(span.querySelectorAll('svg.oc-icon-solid')).toHaveLength(1);
  });
  it('com label vira role=img; active e slashed viram data-attrs', () => {
    const { getByRole } = render(<Icon name="microphone" label="Microfone mutado" active slashed />);
    const img = getByRole('img', { name: 'Microfone mutado' });
    expect(img.dataset.active).toBe('true');
    expect(img.dataset.slashed).toBe('true');
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

import type { Badge, InstanceInfo } from '@opencord/contracts';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProfileBadges, UserBadges } from '../src/components/UserBadges';
import { useData } from '../src/store/data';

const badge = (id: string, name: string, extra: Partial<Badge> = {}): Badge => ({
  id,
  name,
  description: '',
  icon: 'star',
  color: null,
  imageKey: null,
  ...extra,
});
const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190a000-0000-7000-8000-00000000000b';
const C = '0190a000-0000-7000-8000-00000000000c';
const D = '0190a000-0000-7000-8000-00000000000d';

describe('insígnias', () => {
  beforeEach(() => {
    useData.setState({
      instance: {
        badges: [
          badge(A, 'Testador'),
          badge(B, 'Fundador'),
          badge(C, 'Artista', { icon: 'nao-existe' }),
          badge(D, 'DJ'),
        ],
      } as InstanceInfo,
      details: {},
      friends: [],
    });
  });

  it('mostra até 3 ícones na ordem do catálogo e o resto como +N; id desconhecido é ignorado', () => {
    const { getAllByRole, getByText } = render(
      <UserBadges userId="u1" fallback={[D, C, B, A, '0190a000-0000-7000-8000-0000000000ff']} />,
    );
    expect(getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual([
      'Insígnia: Testador',
      'Insígnia: Fundador',
      'Insígnia: Artista',
    ]);
    expect(getByText('+1').getAttribute('data-tip')).toBe('DJ');
  });

  it('com destaque escolhido, mostra só as escolhidas (até 3); o resto vai para o +N', () => {
    const { getAllByRole, getByText } = render(
      <UserBadges userId="u1" fallback={[A, B, C, D]} featuredFallback={[D, B]} />,
    );
    expect(getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual([
      'Insígnia: Fundador',
      'Insígnia: DJ',
    ]);
    expect(getByText('+2').getAttribute('data-tip')).toBe('Testador, Artista');
  });

  it('perfil lista o verificado e as insígnias com nome; sem nenhuma não mostra nada', () => {
    const { getByText } = render(<ProfileBadges userId="u1" fallback={[B]} verified />);
    expect(getByText('Verificado')).toBeTruthy();
    expect(getByText('Fundador')).toBeTruthy();
    const empty = render(<ProfileBadges userId="u2" fallback={[]} />);
    expect(empty.container.innerHTML).toBe('');
  });
});

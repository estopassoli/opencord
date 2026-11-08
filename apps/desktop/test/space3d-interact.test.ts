import type { SpaceLayout } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { distanceToItem, findInteraction, standUpSpot } from '../src/features/space3d/interact';

const room = (items: SpaceLayout['items']): SpaceLayout => ({
  v: 1,
  theme: 'lounge',
  width: 20,
  depth: 20,
  floorColor: '#6b4f3a',
  wallColor: '#d9cbb8',
  walls: [],
  items,
  spawn: { x: 0, z: 0 },
});

describe('Espaço 3D: interação', () => {
  const l = room([
    { id: 'sofa', kind: 'sofa', x: 0, z: 0, rot: 0 },
    { id: 'lamp', kind: 'lamp', x: 6, z: 0, rot: 0 },
    { id: 'tv', kind: 'tv', x: -6, z: 0, rot: 0 },
    { id: 'spk', kind: 'speaker', x: 0, z: 6, rot: 0 },
    { id: 'rug', kind: 'rug', x: 0, z: -6, rot: 0 },
  ]);

  it('longe de tudo: nada', () => {
    expect(findInteraction(l, { x: 3, z: 3 }, [], {})).toBeNull();
    expect(findInteraction(l, { x: 0, z: -6 }, [], {})).toBeNull(); // tapete não interage
  });

  it('perto do sofá: senta no lugar livre mais perto, virado para a frente do sofá', () => {
    const i = findInteraction(l, { x: 0.6, z: 1.2 }, [], {});
    expect(i).toMatchObject({ kind: 'sit', itemId: 'sofa', label: 'Sentar no sofá' });
    if (i?.kind !== 'sit') throw new Error('esperava sentar');
    expect(i.seat.x).toBeCloseTo(0.55);
    // o lugar da direita está ocupado: vai para o outro
    const j = findInteraction(l, { x: 0.6, z: 1.2 }, [{ x: 0.55, z: 0.12 }], {});
    if (j?.kind !== 'sit') throw new Error('esperava sentar');
    expect(j.seat.x).toBeCloseTo(-0.55);
    // os dois ocupados: nada a fazer
    expect(
      findInteraction(
        l,
        { x: 0.6, z: 1.2 },
        [
          { x: 0.55, z: 0.12 },
          { x: -0.55, z: 0.12 },
        ],
        {},
      ),
    ).toBeNull();
  });

  it('luminária liga/desliga conforme o estado da chamada; tv abre o telão; caixa de som abre a música', () => {
    expect(findInteraction(l, { x: 6, z: 1 }, [], {})).toMatchObject({
      kind: 'toggle',
      on: true,
      label: 'Apagar a luminária',
    });
    expect(findInteraction(l, { x: 6, z: 1 }, [], { lamp: false })).toMatchObject({
      on: false,
      label: 'Acender a luminária',
    });
    expect(findInteraction(l, { x: -6, z: 1 }, [], {})).toMatchObject({ kind: 'screen' });
    expect(findInteraction(l, { x: 0, z: 7 }, [], {})).toMatchObject({ kind: 'music' });
  });

  it('peça girada: alcance e lugar acompanham a rotação', () => {
    const r = room([{ id: 's', kind: 'sofa', x: 0, z: 0, rot: Math.PI / 2 }]);
    // girado 90°, a frente aponta para +x
    expect(distanceToItem(r.items[0]!, 1.2, 0)).toBeLessThan(1);
    const i = findInteraction(r, { x: 1.3, z: 0.5 }, [], {});
    if (i?.kind !== 'sit') throw new Error('esperava sentar');
    expect(i.seat.ry).toBeCloseTo(Math.PI / 2);
    const up = standUpSpot(i.seat);
    expect(up.x).toBeGreaterThan(i.seat.x + 0.8);
  });
});

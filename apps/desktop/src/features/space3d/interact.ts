/**
 * Interação com as peças do Espaço 3D (ADR-0055): chegar perto e apertar F (ou clicar no aviso).
 * - assentos (sofá, poltrona, cadeira, banqueta, puff, cama): senta no lugar livre mais perto;
 * - luminária, lareira e fliperama: liga/desliga para todos da chamada;
 * - telão e televisão: escolher o que passa; caixa de som: abrir a música.
 * Funções puras: a cena chama `findInteraction` a cada quadro e executa o resultado.
 */
import { SPACE_ITEM_LABELS, type SpaceItem, type SpaceItemKind, type SpaceLayout } from '@opencord/contracts';
import { ITEM_SPECS } from './models';

/** lugares de cada assento, no espaço da peça (frente = +z); `y` = altura do assento */
export const SEATS: Partial<Record<SpaceItemKind, { x: number; z: number; y: number }[]>> = {
  sofa: [
    { x: -0.55, z: 0.12, y: 0.56 },
    { x: 0.55, z: 0.12, y: 0.56 },
  ],
  armchair: [{ x: 0, z: 0.1, y: 0.56 }],
  chair: [{ x: 0, z: 0.02, y: 0.51 }],
  stool: [{ x: 0, z: 0, y: 0.8 }],
  beanbag: [{ x: 0, z: 0.05, y: 0.45 }],
  bed: [
    { x: -0.38, z: 0.3, y: 0.6 },
    { x: 0.38, z: 0.3, y: 0.6 },
  ],
};

const TOGGLE_LABEL: Partial<Record<SpaceItemKind, [string, string]>> = {
  lamp: ['Acender a luminária', 'Apagar a luminária'],
  fireplace: ['Acender a lareira', 'Apagar a lareira'],
  arcade: ['Ligar o fliperama', 'Desligar o fliperama'],
};

export type Interaction =
  | { kind: 'sit'; itemId: string; label: string; seat: { x: number; y: number; z: number; ry: number } }
  | { kind: 'toggle'; itemId: string; label: string; on: boolean }
  | { kind: 'screen'; itemId: string; label: string }
  | { kind: 'music'; itemId: string; label: string };

/** alcance: distância do avatar até a borda da peça */
export const REACH = 1.1;

function toLocal(it: SpaceItem, x: number, z: number) {
  const c = Math.cos(it.rot);
  const s = Math.sin(it.rot);
  const lx = x - it.x;
  const lz = z - it.z;
  return { x: lx * c - lz * s, z: lx * s + lz * c };
}

function toWorld(it: SpaceItem, x: number, z: number) {
  const c = Math.cos(it.rot);
  const s = Math.sin(it.rot);
  return { x: it.x + x * c + z * s, z: it.z - x * s + z * c };
}

/** distância do ponto até o retângulo da peça (0 se estiver dentro) */
export function distanceToItem(it: SpaceItem, x: number, z: number): number {
  const sp = ITEM_SPECS[it.kind];
  const p = toLocal(it, x, z);
  const dx = Math.max(0, Math.abs(p.x) - sp.w / 2);
  const dz = Math.max(0, Math.abs(p.z) - sp.d / 2);
  return Math.hypot(dx, dz);
}

function interactionOf(
  it: SpaceItem,
  me: { x: number; z: number },
  occupied: { x: number; z: number }[],
  toggles: Record<string, boolean>,
): Interaction | null {
  const seats = SEATS[it.kind];
  if (seats) {
    const free = seats
      .map((s) => ({ ...toWorld(it, s.x, s.z), y: s.y }))
      .filter((s) => !occupied.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 0.35))
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    if (!free) return null;
    const name = SPACE_ITEM_LABELS[it.kind].toLowerCase();
    const label =
      it.kind === 'bed'
        ? 'Sentar na cama'
        : it.kind === 'beanbag'
          ? 'Sentar no puff'
          : `Sentar ${it.kind === 'chair' || it.kind === 'armchair' || it.kind === 'stool' ? 'na' : 'no'} ${name}`;
    return { kind: 'sit', itemId: it.id, label, seat: { ...free, ry: it.rot } };
  }
  const tl = TOGGLE_LABEL[it.kind];
  if (tl) {
    const on = toggles[it.id] ?? true;
    return { kind: 'toggle', itemId: it.id, label: on ? tl[1] : tl[0], on };
  }
  if (it.kind === 'screen' || it.kind === 'tv')
    return { kind: 'screen', itemId: it.id, label: 'Escolher o que passa no telão' };
  if (it.kind === 'speaker') return { kind: 'music', itemId: it.id, label: 'Tocar música' };
  return null;
}

/** A peça com que dá para interagir agora (a mais perto ao alcance), ou null. */
export function findInteraction(
  l: SpaceLayout,
  me: { x: number; z: number },
  occupied: { x: number; z: number }[],
  toggles: Record<string, boolean>,
): Interaction | null {
  let best: { d: number; i: Interaction } | null = null;
  for (const it of l.items) {
    const d = distanceToItem(it, me.x, me.z);
    if (d > REACH || (best && d >= best.d)) continue;
    const i = interactionOf(it, me, occupied, toggles);
    if (i) best = { d, i };
  }
  return best?.i ?? null;
}

/** onde fica de pé ao levantar: um passo à frente do assento */
export function standUpSpot(seat: { x: number; z: number; ry: number }) {
  return { x: seat.x + Math.sin(seat.ry) * 0.9, z: seat.z + Math.cos(seat.ry) * 0.9 };
}

/**
 * Disposição da gravação da chamada (ADR-0023), parte pura: com transmissão de tela, ela ocupa o palco e as pessoas
 * ficam numa coluna à direita; sem, as pessoas dividem o quadro em grade.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  people: string[];
  screens: string[];
}

export interface Layout {
  screens: { id: string; rect: Rect }[];
  people: { id: string; rect: Rect }[];
}

const GAP = 8;

function grid(ids: string[], area: Rect, aspect = 16 / 9): { id: string; rect: Rect }[] {
  const n = ids.length;
  if (!n) return [];
  // escolhe o número de colunas que deixa os quadros maiores
  let best = { cols: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let w = (area.w - GAP * (cols - 1)) / cols;
    let h = w / aspect;
    if (h * rows + GAP * (rows - 1) > area.h) {
      h = (area.h - GAP * (rows - 1)) / rows;
      w = h * aspect;
    }
    if (w > best.w) best = { cols, w, h };
  }
  const rows = Math.ceil(n / best.cols);
  const totalH = rows * best.h + (rows - 1) * GAP;
  const out: { id: string; rect: Rect }[] = [];
  ids.forEach((id, i) => {
    const row = Math.floor(i / best.cols);
    const inRow = Math.min(best.cols, n - row * best.cols);
    const rowW = inRow * best.w + (inRow - 1) * GAP;
    out.push({
      id,
      rect: {
        x: Math.round(area.x + (area.w - rowW) / 2 + (i % best.cols) * (best.w + GAP)),
        y: Math.round(area.y + (area.h - totalH) / 2 + row * (best.h + GAP)),
        w: Math.round(best.w),
        h: Math.round(best.h),
      },
    });
  });
  return out;
}

export function layoutCall(input: LayoutInput, width: number, height: number): Layout {
  const full: Rect = { x: GAP, y: GAP, w: width - 2 * GAP, h: height - 2 * GAP };
  if (!input.screens.length) return { screens: [], people: grid(input.people, full) };
  // transmissões à esquerda (78%), pessoas numa coluna à direita
  const sideW = input.people.length ? Math.round(full.w * 0.22) : 0;
  const stage: Rect = { ...full, w: full.w - (sideW ? sideW + GAP : 0) };
  const side: Rect = { x: stage.x + stage.w + GAP, y: full.y, w: sideW, h: full.h };
  return {
    screens: grid(input.screens, stage),
    people: sideW ? grid(input.people, side).map((p, i, all) => ({ ...p, rect: column(side, i, all.length) })) : [],
  };
}

/** coluna de quadros 16:9 de cima para baixo, centralizada na vertical */
function column(area: Rect, i: number, n: number): Rect {
  let w = area.w;
  let h = w / (16 / 9);
  if (h * n + GAP * (n - 1) > area.h) {
    h = (area.h - GAP * (n - 1)) / n;
    w = h * (16 / 9);
  }
  const total = h * n + GAP * (n - 1);
  return {
    x: Math.round(area.x + (area.w - w) / 2),
    y: Math.round(area.y + (area.h - total) / 2 + i * (h + GAP)),
    w: Math.round(w),
    h: Math.round(h),
  };
}

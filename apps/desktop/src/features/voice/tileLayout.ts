/**
 * Grade de quadros 16:9 da chamada: escolhe o número de colunas que deixa cada quadro o maior possível
 * dentro da área (largura × altura), como uma galeria. As linhas são centralizadas pelo CSS (flex-wrap),
 * então a última linha incompleta fica no meio.
 */
export function bestTileWidth(width: number, height: number, count: number, gap = 8, ratio = 16 / 9): number {
  if (count <= 0 || width <= 0 || height <= 0) return 0;
  let best = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    const byHeight = ((height - gap * (rows - 1)) / rows) * ratio;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return Math.floor(best);
}

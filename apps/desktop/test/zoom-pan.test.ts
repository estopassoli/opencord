import { describe, expect, it } from 'vitest';
import { clampView, zoomAt } from '../src/features/voice/ZoomPan';

describe('zoom na transmissão', () => {
  it('aproxima mirando no cursor e mantém a imagem cobrindo o quadro', () => {
    // quadro 1000×500; zoom 2× no centro: o centro continua no centro
    const v = zoomAt({ s: 1, x: 0, y: 0 }, 2, 500, 250, 1000, 500);
    expect(v).toEqual({ s: 2, x: -500, y: -250 });
    // no canto superior esquerdo: o canto fica parado
    expect(zoomAt({ s: 1, x: 0, y: 0 }, 2, 0, 0, 1000, 500)).toEqual({ s: 2, x: 0, y: 0 });
    // arrastar além da borda é contido
    expect(clampView({ s: 2, x: 300, y: -900 }, 1000, 500)).toEqual({ s: 2, x: 0, y: -500 });
    // afastar abaixo de 100% volta ao normal
    expect(zoomAt(v, 0.1, 10, 10, 1000, 500)).toEqual({ s: 1, x: 0, y: 0 });
    // limite de 8×
    expect(zoomAt({ s: 7, x: 0, y: 0 }, 2, 0, 0, 1000, 500).s).toBe(8);
  });
});

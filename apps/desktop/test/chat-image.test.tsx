import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatImage, fitBox } from '../src/features/chat/ChatImage';

describe('imagem do chat', () => {
  it('encaixa na caixa máxima mantendo a proporção, sem ampliar imagem pequena', () => {
    expect(fitBox(4000, 3000, 400, 320)).toEqual({ width: 400, height: 300 });
    expect(fitBox(1000, 2000, 400, 320)).toEqual({ width: 160, height: 320 });
    expect(fitBox(120, 80, 400, 320)).toEqual({ width: 120, height: 80 });
  });

  it('reserva o espaço com skeleton, mostra ao carregar e avisa quando falha', () => {
    const { container, getByAltText, getByText } = render(
      <ChatImage src="/x.png" alt="foto" width={800} height={600} maxWidth={400} maxHeight={320} />,
    );
    const box = container.querySelector('.chat-img') as HTMLElement;
    expect(box.dataset.state).toBe('loading');
    expect(box.style.width).toBe('400px');
    fireEvent.load(getByAltText('foto'));
    expect(box.dataset.state).toBe('ready');

    const failed = render(<ChatImage src="/y.png" alt="outra" maxWidth={400} maxHeight={320} />);
    fireEvent.error(failed.getByAltText('outra'));
    expect(getByText('Não foi possível carregar a imagem')).toBeTruthy();
  });
});

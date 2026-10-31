import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { describeCrash, ErrorBoundary } from '../src/components/ErrorBoundary';

let fail = true;
function Boom() {
  if (fail) throw new Error('Minified React error #310; visit https://react.dev/errors/310');
  return <p>ok</p>;
}

describe('tela de erro', () => {
  it('traduz o erro minificado do React', () => {
    expect(describeCrash(new Error('Minified React error #310; visit …'))).toMatch(/ordem interna.*React #310/);
    expect(describeCrash(new Error('falhou'))).toBe('falhou');
  });
  it('erro numa área mostra o aviso só nela e "Tentar de novo" volta a mostrar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fail = true;
    render(
      <div>
        <p>resto do app</p>
        <ErrorBoundary area="esta mensagem">
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('resto do app')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Não deu para mostrar esta mensagem/);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(screen.getByText('ok')).toBeTruthy();
  });
  it('erro geral: recarregar e copiar detalhes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fail = true;
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Algo deu errado' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar detalhes' })).toBeTruthy();
  });
});

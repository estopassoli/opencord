import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker, hexToHsv, hsvToHex } from './ColorPicker.js';

describe('ColorPicker', () => {
  it('converte hex ↔ HSV sem perder a cor', () => {
    for (const c of ['#ff0000', '#00ff00', '#0000ff', '#e8dcc4', '#141416', '#ffffff', '#000000'])
      expect(hsvToHex(hexToHsv(c)!)).toBe(c);
    expect(hexToHsv('E8DCC4')).not.toBeNull();
    expect(hexToHsv('#zzz')).toBeNull();
  });

  it('digitar um hex válido avisa a cor; abrir o painel e usar uma cor pronta também', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = render(
      <ColorPicker label="Fundo" value="#141416" presets={['#e8dcc4']} onChange={onChange} />,
    );
    const input = getByLabelText('Fundo');
    fireEvent.change(input, { target: { value: '#e8dcc' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '#E8DCC4' } });
    expect(onChange).toHaveBeenLastCalledWith('#e8dcc4');
    fireEvent.click(getByLabelText('Abrir seletor de cor'));
    expect(getByRole('dialog', { name: 'Seletor de cor' })).toBeTruthy();
    fireEvent.click(getByLabelText('#e8dcc4'));
    expect(onChange).toHaveBeenLastCalledWith('#e8dcc4');
    // teclado no matiz muda a cor
    fireEvent.keyDown(getByLabelText('Matiz'), { key: 'ArrowRight', shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0]).not.toBe('#e8dcc4');
  });
});

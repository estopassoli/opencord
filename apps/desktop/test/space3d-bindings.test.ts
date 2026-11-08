import { beforeEach, describe, expect, it } from 'vitest';
import { actionsOf, codeLabel, DEFAULT_BINDINGS, normalizeCode, useBindings } from '../src/features/space3d/bindings';

describe('Espaço 3D: atalhos', () => {
  beforeEach(() => useBindings.getState().reset());

  it('padrão: Shift corre, Espaço pula, esquerdo é a ação', () => {
    expect(DEFAULT_BINDINGS).toMatchObject({
      run: 'Shift',
      jump: 'Space',
      primary: 'Mouse0',
      interact: 'KeyF',
      wave: 'KeyE',
    });
    expect(actionsOf('ShiftRight')).toEqual(['run']);
    expect(actionsOf('Space')).toEqual(['jump']);
    expect(codeLabel('Space')).toBe('Espaço');
    expect(codeLabel('KeyW')).toBe('W');
    expect(normalizeCode('ControlLeft')).toBe('Control');
  });

  it('trocar para uma tecla em uso troca as duas ações; vale botão do mouse; Esc não', () => {
    useBindings.getState().set('jump', 'KeyF');
    expect(useBindings.getState().map.jump).toBe('KeyF');
    expect(useBindings.getState().map.interact).toBe('Space');
    useBindings.getState().set('run', 'Mouse2');
    expect(useBindings.getState().map.run).toBe('Mouse2');
    expect(useBindings.getState().map.secondary).toBe('Shift');
    useBindings.getState().set('wave', 'Escape');
    expect(useBindings.getState().map.wave).toBe('KeyE');
  });

  it('fica salvo e um valor estragado volta ao padrão', async () => {
    useBindings.getState().set('jump', 'KeyJ');
    expect(JSON.parse(localStorage.getItem('opencord.space3d.bindings')!).jump).toBe('KeyJ');
    localStorage.setItem('opencord.space3d.bindings', '{"jump": 5, "run": "Escape", "wave": "KeyQ"}');
    const { vi } = await import('vitest');
    vi.resetModules();
    const fresh = await import('../src/features/space3d/bindings');
    expect(fresh.useBindings.getState().map).toMatchObject({ jump: 'Space', run: 'Shift', wave: 'KeyQ' });
  });
});

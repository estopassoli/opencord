import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionsOf,
  codeLabel,
  DEFAULT_BINDINGS,
  fromSaved,
  normalizeCode,
  useBindings,
} from '../src/features/space3d/bindings';

describe('Espaço 3D: atalhos', () => {
  beforeEach(() => useBindings.getState().reset());

  it('padrão: Shift corre, Espaço pula, esquerdo é a ação', () => {
    expect(DEFAULT_BINDINGS).toMatchObject({
      run: 'Shift',
      jump: 'Space',
      primary: 'Mouse0',
      interact: 'KeyF',
      wave: 'KeyG',
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
    expect(useBindings.getState().map.wave).toBe('KeyG');
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

  it('Q/E giram a câmera, Tab mostra o placar, R revanche, X recusa; nenhum padrão colide', () => {
    expect(DEFAULT_BINDINGS).toMatchObject({
      turnLeft: 'KeyQ',
      turnRight: 'KeyE',
      scoreboard: 'Tab',
      rematch: 'KeyR',
      decline: 'KeyX',
    });
    const codes = ACTIONS.map((a) => DEFAULT_BINDINGS[a]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(actionsOf('KeyQ')).toEqual(['turnLeft']);
    expect(actionsOf('KeyE')).toEqual(['turnRight']);
  });

  it('mapa salvo antes das teclas novas: E padrão antigo do aceno vira câmera; escolha da pessoa é mantida', () => {
    const old = {
      forward: 'KeyW',
      back: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'Shift',
      jump: 'Space',
      wave: 'KeyE',
      interact: 'KeyF',
      primary: 'Mouse0',
      secondary: 'Mouse2',
    };
    const m = fromSaved(old);
    expect(m.wave).toBe('KeyG');
    expect(m.turnRight).toBe('KeyE');
    // a pessoa tinha posto o pulo no R: a revanche vai para uma tecla livre, sem roubar o R
    const m2 = fromSaved({ ...old, jump: 'KeyR' });
    expect(m2.jump).toBe('KeyR');
    expect(m2.rematch).not.toBe('KeyR');
    const codes = ACTIONS.map((a) => m2[a]);
    expect(new Set(codes).size).toBe(codes.length);
    // mapa já com as ações novas: E escolhido para acenar continua (e as duas não colidem)
    const full = { ...DEFAULT_BINDINGS, wave: 'KeyE', turnRight: 'KeyG' };
    expect(fromSaved(full)).toMatchObject({ wave: 'KeyE', turnRight: 'KeyG' });
  });
});

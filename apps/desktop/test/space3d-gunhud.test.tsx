/** Gunfight: o painel de comandos e a interface montam na zona 8 (a tela caía no `ControlsPanel`). */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('AudioWorkletNode', class {});
const { ControlsPanel, controlRows } = await import('../src/features/space3d/GameHud');
const { GunHud, GunMatchPanel } = await import('../src/features/space3d/gunfight/GunHud');
const { useGunHud } = await import('../src/features/space3d/gunfight/state');

describe('gunfight: interface', () => {
  it('o painel de comandos tem as linhas do gunfight (e não quebra na zona 8)', () => {
    expect(controlRows(8, false).length).toBeGreaterThan(5);
    const { container } = render(<ControlsPanel zone={8} fighting={false} open onToggle={() => undefined} />);
    expect(container.textContent).toContain('Atirar');
    expect(container.textContent).toContain('Recarregar');
    expect(container.textContent).toContain('deslizar');
  });

  it('a tela do vencedor mostra o placar final e como jogar de novo', () => {
    useGunHud.getState().set({
      active: true,
      winner: 'Você',
      winnerAt: Date.now(),
      scores: [{ id: 'a', name: 'Você', kills: 30, deaths: 2, bot: false, me: true }],
    });
    const { container } = render(<GunHud />);
    expect(container.textContent).toContain('Você venceu!');
    expect(container.textContent).toContain('jogar de novo');
    expect(container.querySelector('.gf-score tr[data-me="true"]')).not.toBeNull();
    // sem role=status solto: a leitura é pela região viva única
    expect(container.querySelector('[role="status"]')).toBeNull();
    useGunHud.getState().set({ active: false, winner: null, scores: [] });
  });

  it('com bots e gente na arena, "Tirar os bots" continua lá', () => {
    useGunHud.getState().set({ bot: 'facil' });
    const { container } = render(
      <GunMatchPanel others={1} onBots={() => undefined} onRestart={() => undefined} onView={() => undefined} />,
    );
    expect(container.textContent).toContain('Tirar os bots');
    expect(container.querySelector('h2')?.textContent).toBe('Esta partida');
    useGunHud.getState().set({ bot: null });
  });

  it('o botão de recomeçar segue o `canRestart` do jogo (com gente e abates, não aparece)', () => {
    useGunHud.getState().set({ canRestart: false });
    const panel = (others: number) => (
      <GunMatchPanel others={others} onBots={() => undefined} onRestart={() => undefined} onView={() => undefined} />
    );
    const { container, rerender } = render(panel(1));
    expect(container.textContent).not.toContain('Recomeçar');
    // o jogo deixou (alguém venceu, ou ninguém pontuou ainda)
    useGunHud.getState().set({ canRestart: true });
    rerender(panel(1));
    expect(container.textContent).toContain('Recomeçar a partida para todos');
    // sozinho (ou com bots), recomeça quando quiser
    rerender(panel(0));
    expect(container.textContent).toContain('Recomeçar a partida');
  });

  it('clicar no nível de bot que já vale não recomeça o treino', () => {
    useGunHud.getState().set({ bot: 'medio' });
    const onBots = vi.fn();
    const { getByRole } = render(
      <GunMatchPanel others={0} onBots={onBots} onRestart={() => undefined} onView={() => undefined} />,
    );
    getByRole('button', { name: 'Médio' }).click();
    expect(onBots).not.toHaveBeenCalled();
    getByRole('button', { name: 'Difícil' }).click();
    expect(onBots).toHaveBeenCalledWith('dificil', expect.any(Number));
    useGunHud.getState().set({ bot: null });
  });

  it('sem munição nenhuma, a dica diz para trocar de arma', () => {
    useGunHud.getState().set({ active: true, weapon: 'm4', mag: 0, reserve: 0, reloading: false, dead: false });
    const { container } = render(<GunHud />);
    expect(container.textContent).toContain('Sem munição');
    expect(container.textContent).toContain('pistola');
    useGunHud.getState().set({ active: false, mag: 30, reserve: 90 });
  });
});

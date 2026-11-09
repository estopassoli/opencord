import { generateSpace } from '@opencord/contracts';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('AudioWorkletNode', class {});
// sem WebGL no jsdom: a cena vira um objeto falso (com o barramento de eventos de verdade)
const sceneRef = vi.hoisted(() => ({
  current: null as {
    events: import('../src/features/space3d/events').GameBus;
    inputs: import('../src/features/space3d/input').InputBus;
  } | null,
}));
vi.mock('../src/features/space3d/scene', async () => {
  const { GameBus } = await vi.importActual<typeof import('../src/features/space3d/events')>(
    '../src/features/space3d/events',
  );
  const { InputBus } = await vi.importActual<typeof import('../src/features/space3d/input')>(
    '../src/features/space3d/input',
  );
  return {
    SpaceScene: class {
      events = new GameBus();
      inputs = new InputBus();
      constructor() {
        sceneRef.current = this;
      }
      setLayout() {}
      setParticipants() {}
      setScreen() {}
      setToggles() {}
      setFight() {}
      setRings() {}
      hit() {}
      knockout() {}
      setZone() {}
      remoteBall() {}
      setTeam() {}
      newMatch() {}
      lockPointer() {}
      retryLock() {}
      zoneCounts() {
        return {};
      }
      setRace() {}
      setMatch() {}
      rerack() {}
      remotePool() {}
      interact() {}
      setMode() {}
      setTutorialTarget() {}
      dispose() {}
    },
  };
});

const SERVER = '0190a000-0000-7000-8000-0000000000aa';
const CHANNEL = '0190a000-0000-7000-8000-0000000000bb';

describe('Espaço 3D: tela', () => {
  it('renderiza numa chamada com gente sem entrar em ciclo de atualizações', async () => {
    const { useData } = await import('../src/store/data');
    const { useVoice } = await import('../src/store/voice');
    const { useSpace } = await import('../src/store/space');
    const { SpaceView } = await import('../src/features/space3d/SpaceView');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    useVoice.setState({
      participants: ['me', 'a', 'b'].map((id) => ({
        identity: id,
        name: id,
        isLocal: id === 'me',
        speaking: false,
        micMuted: false,
        hasCamera: false,
        hasScreen: id === 'a',
        screenAudio: false,
        watchingScreen: false,
        quality: 'good' as const,
      })),
    });
    useSpace.setState({
      openChannelId: CHANNEL,
      spaces: {
        [SERVER]: { serverId: SERVER, layout: generateSpace(SERVER), revision: 0, updatedAt: null, updatedBy: null },
      },
    });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const r = render(<SpaceView channelId={CHANNEL} serverId={SERVER} />);
    // alguém começa a falar: a lista muda e a tela acompanha
    act(() => {
      useVoice.setState((s) => ({ participants: s.participants.map((p) => ({ ...p, speaking: p.identity === 'b' })) }));
    });
    expect(r.getAllByText(/Espaço 3D/).length).toBeGreaterThan(0);
    // com o mouse solto, o menu do jogo aparece com os jogos
    expect(r.getByRole('dialog', { name: 'Menu do jogo' })).toBeTruthy();
    expect(errors.filter((e) => String(e).includes('185') || String(e).includes('Maximum update'))).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('Espaço 3D: controles do telão', () => {
  it('quem pôs o vídeo pula e arrasta; os outros só pausam para si, volume e legendas', async () => {
    const { useData } = await import('../src/store/data');
    const { useSpace } = await import('../src/store/space');
    const { useActivity } = await import('../src/store/activity');
    const { SpaceView } = await import('../src/features/space3d/SpaceView');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    useSpace.setState({
      openChannelId: CHANNEL,
      spaces: {
        [SERVER]: { serverId: SERVER, layout: generateSpace(SERVER), revision: 0, updatedAt: null, updatedBy: null },
      },
      session: { channelId: CHANNEL, serverId: SERVER, screen: { kind: 'activity' }, updatedBy: 'me', revision: 1 },
    });
    const state = (startedBy: string) => ({
      kind: 'youtube' as const,
      channelId: CHANNEL,
      serverId: SERVER,
      videoId: 'dQw4w9WgXcQ',
      title: 'Vídeo',
      author: null,
      startedBy,
      updatedBy: startedBy,
      playing: true,
      positionSec: 10,
      updatedAt: Date.now(),
      serverNow: Date.now(),
      revision: 1,
    });
    useActivity.setState({ state: state('me') });
    const r = render(<SpaceView channelId={CHANNEL} serverId={SERVER} />);
    expect(r.getByLabelText('Pausar para todos')).toBeTruthy();
    expect(r.getByLabelText('Avançar 10 segundos')).toBeTruthy();
    expect(r.getByLabelText('Desligar legendas')).toBeTruthy();
    act(() => useActivity.setState({ state: state('outra-pessoa') }));
    expect(r.getByLabelText('Pausar só para você')).toBeTruthy();
    expect(r.queryByLabelText('Avançar 10 segundos')).toBeNull();
    expect(r.getByLabelText('Posição do vídeo').getAttribute('aria-disabled')).toBe('true');
    r.unmount();
  });
});

describe('Espaço 3D: x1 no soco', () => {
  it('convite com aceitar/recusar; luta com barras de vida, controles e resultado', async () => {
    const { useData } = await import('../src/store/data');
    const { useSpace } = await import('../src/store/space');
    const { useVoice } = await import('../src/store/voice');
    const { DuelHud } = await import('../src/features/space3d/DuelHud');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    useVoice.setState({
      participants: [
        { identity: 'me', name: 'Erick' },
        { identity: 'tu', name: 'tulio' },
      ] as never,
    });
    const base = {
      id: 'd1',
      channelId: CHANNEL,
      a: 'tu',
      b: 'me',
      ring: { x: 0, z: 0 },
      winner: null,
      reason: null,
      lastHit: null,
      serverNow: Date.now(),
    };
    useSpace.setState({
      openChannelId: CHANNEL,
      duelOffset: 0,
      duels: { d1: { ...base, status: 'pending', hp: { tu: 100, me: 100 }, until: Date.now() + 20_000 } },
    });
    const r = render(<DuelHud />);
    expect(r.getByText(/te desafiou para um x1/)).toBeTruthy();
    // teclas desenhadas pelo atalho escolhido (nada de "(F)" escrito à mão)
    expect(r.getByRole('button', { name: /Aceitar/ }).textContent).toContain('F');
    expect(r.getByRole('button', { name: /Recusar/ }).textContent).toContain('X');

    act(() =>
      useSpace.setState({
        duels: { d1: { ...base, status: 'fighting', hp: { tu: 76, me: 100 }, until: Date.now() + 60_000 } },
      }),
    );
    expect(r.getByLabelText('Vida de tulio').getAttribute('aria-valuenow')).toBe('76');
    expect(r.getByText('Desistir')).toBeTruthy();
    // lutando: mira no centro e os controles com as teclas do mapa
    expect(r.container.querySelector('.space3d-crosshair')).toBeTruthy();
    expect(r.getByText(/soco forte/)).toBeTruthy();
    expect(r.queryByRole('button', { name: /Aceitar/ })).toBeNull();

    act(() =>
      useSpace.setState({
        duels: {
          d1: { ...base, status: 'ended', hp: { tu: 0, me: 40 }, until: Date.now(), winner: 'me', reason: 'ko' },
        },
      }),
    );
    expect(r.getByText('Erick venceu por nocaute')).toBeTruthy();
    // quem lutou pode pedir revanche
    const challenge = vi.fn(async () => {});
    useSpace.setState({ challenge });
    fireEvent.click(r.getByRole('button', { name: /Revanche/ }));
    expect(challenge).toHaveBeenCalledWith('tu');
    r.unmount();
  });
});

describe('Espaço 3D: convite de x1 por tecla', () => {
  it('Interagir aceita e Recusar recusa, mesmo com o foco fora da cena', async () => {
    const { useData } = await import('../src/store/data');
    const { useSpace } = await import('../src/store/space');
    const { DuelHud } = await import('../src/features/space3d/DuelHud');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    const answerDuel = vi.fn(async () => {});
    useSpace.setState({
      duelOffset: 0,
      answerDuel,
      duels: {
        d2: {
          id: 'd2',
          channelId: CHANNEL,
          a: 'tu',
          b: 'me',
          ring: { x: 0, z: 0 },
          winner: null,
          reason: null,
          lastHit: null,
          serverNow: Date.now(),
          status: 'pending',
          hp: { tu: 100, me: 100 },
          until: Date.now() + 20_000,
        },
      },
    });
    const r = render(<DuelHud />);
    fireEvent.keyDown(window, { code: 'KeyX' });
    expect(answerDuel).toHaveBeenCalledWith('d2', false);
    fireEvent.keyDown(window, { code: 'KeyF' });
    expect(answerDuel).toHaveBeenCalledWith('d2', true);
    r.unmount();
  });
});

describe('Espaço 3D: HUD da partida', () => {
  const setup = async (zone: number, extra: Record<string, unknown> = {}) => {
    const { useData } = await import('../src/store/data');
    const { useVoice } = await import('../src/store/voice');
    const { useSpace } = await import('../src/store/space');
    const { useAnnounce } = await import('../src/features/space3d/MatchHud');
    const { SpaceView } = await import('../src/features/space3d/SpaceView');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    useVoice.setState({
      participants: [
        { identity: 'me', name: 'Erick' },
        { identity: 'ana', name: 'Ana' },
      ] as never,
    });
    useAnnounce.setState({ text: '', n: 0 });
    useSpace.setState({
      openChannelId: CHANNEL,
      zone,
      team: 'a',
      duels: {},
      editing: false,
      spaces: {
        [SERVER]: { serverId: SERVER, layout: generateSpace(SERVER), revision: 0, updatedAt: null, updatedBy: null },
      },
      session: { channelId: CHANNEL, serverId: SERVER, screen: null, updatedBy: 'me', revision: 1, ...extra },
    });
    const r = render(<SpaceView channelId={CHANNEL} serverId={SERVER} />);
    return { r, useSpace };
  };

  it('com o mouse solto numa arena, Jogar está no menu (aba Esta partida) e chama a partida', async () => {
    const { r, useSpace } = await setup(5, { scores: { '5': { a: 0, b: 0 } } });
    const startMatch = vi.fn(async () => {});
    useSpace.setState({ startMatch });
    const menu = r.getByRole('dialog', { name: 'Menu do jogo' });
    expect(menu.textContent).toContain('Esta partida');
    expect(menu.textContent).toContain('Menu — a partida continua');
    expect(menu.textContent).toContain('até 11, vence por 2');
    fireEvent.click(r.getByRole('button', { name: /^jogar/i }));
    expect(startMatch).toHaveBeenCalledWith(5);
    r.unmount();
  });

  it('em jogo, Zerar fica desabilitado; no fim, a tela mostra o vencedor e a Revanche', async () => {
    const now = Date.now();
    const { r, useSpace } = await setup(5, {
      scores: { '5': { a: 10, b: 4 } },
      matches: { '5': { phase: 'playing', startAt: now - 10_000 } },
    });
    expect(r.getByRole('button', { name: /zerar/i }).getAttribute('aria-disabled')).toBe('true');
    const resetScore = vi.fn(async () => {});
    useSpace.setState({ resetScore });
    fireEvent.click(r.getByRole('button', { name: /zerar/i }));
    expect(resetScore).not.toHaveBeenCalled();
    // fechar o menu com Esc: a tela de fim fica à vista
    act(() => {
      useSpace.setState({
        session: {
          ...useSpace.getState().session!,
          scores: { '5': { a: 11, b: 4 } },
          board: { '5': { ana: 7, me: 4 } },
          matches: { '5': { phase: 'ended', startAt: now - 10_000, winner: 'a', endedAt: now } },
        },
      });
    });
    fireEvent.keyDown(r.getByRole('dialog', { name: 'Menu do jogo' }), { key: 'Escape' });
    expect(r.queryByRole('dialog', { name: 'Menu do jogo' })).toBeNull();
    const end = r.getByRole('region', { name: 'Fim de partida' });
    expect(end.textContent).toContain('Azul venceu!');
    expect(end.textContent).toContain('Destaque: Ana');
    const startMatch = vi.fn(async () => {});
    useSpace.setState({ startMatch });
    fireEvent.click(r.getByRole('button', { name: /Revanche/ }));
    expect(startMatch).toHaveBeenCalledWith(5);
    r.unmount();
  });

  it('ponto com bola fora: faixa com o motivo, anunciada uma única vez', async () => {
    const { r } = await setup(5, { scores: { '5': { a: 0, b: 0 } } });
    act(() => {
      sceneRef.current!.events.emit({
        kind: 'score',
        side: 'b',
        points: 1,
        by: 'ana',
        reason: 'fora',
        power: 1,
        zone: 5,
        at: { x: 0, y: 0, z: 0 },
      });
    });
    const banner = r.container.querySelector('.space3d-banner')!;
    expect(banner.textContent).toContain('PONTO DO VERMELHO');
    expect(banner.textContent).toContain('bola fora');
    expect(banner.textContent).toContain('Ana');
    const live = r.getByTestId('space3d-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent!.match(/bola fora/g)).toHaveLength(1);
    // ponto de outra zona não aparece
    act(() => {
      sceneRef.current!.events.emit({
        kind: 'score',
        side: 'a',
        points: 2,
        by: null,
        reason: 'cesta',
        power: 1,
        zone: 1,
        at: { x: 0, y: 0, z: 0 },
      });
    });
    expect(r.container.querySelector('.space3d-banner')!.textContent).toContain('bola fora');
    r.unmount();
  });
});

describe('Espaço 3D: texto da faixa de ponto', () => {
  it('cesta, gol, rede e caçapa', async () => {
    const { scoreBanner } = await import('../src/features/space3d/MatchHud');
    expect(scoreBanner({ zone: 1, side: 'a', points: 2, reason: 'cesta' }, 'Ana')).toEqual({
      title: 'CESTA! +2',
      detail: 'Ana',
    });
    expect(scoreBanner({ zone: 2, side: 'a', points: 1, reason: 'gol' }, null).title).toBe('GOL DO AZUL!');
    expect(scoreBanner({ zone: 3, side: 'b', points: 1, reason: 'dois quiques' }, null)).toEqual({
      title: 'PONTO DO VERMELHO',
      detail: 'quicou duas vezes',
    });
    expect(scoreBanner({ zone: 4, side: 'a', points: 1, reason: 'não passou' }, null).detail).toBe(
      'não passou da rede',
    );
    expect(scoreBanner({ zone: 6, side: 'b', points: 1, reason: 'caçapa' }, 'Ana').detail).toBe('Ana · Vermelho');
  });
});

describe('Espaço 3D: tutorial de primeira vez', () => {
  const fresh = async () => {
    const { LEARNED_KEY } = await import('../src/features/space3d/tutorial');
    const { useTutorial } = await import('../src/features/space3d/TutorialHud');
    const { useBindings } = await import('../src/features/space3d/bindings');
    localStorage.removeItem(LEARNED_KEY);
    useTutorial.getState().reload();
    useBindings.getState().reset();
    return { useTutorial, useBindings, LEARNED_KEY };
  };

  it('na primeira entrada mostra o 1º passo com a tecla do mapa; trocar o atalho troca a tecla; a ação avança', async () => {
    const { useBindings } = await fresh();
    const { GameBus } = await import('../src/features/space3d/events');
    const { InputBus } = await import('../src/features/space3d/input');
    const { TutorialHud } = await import('../src/features/space3d/TutorialHud');
    const events = new GameBus();
    const inputs = new InputBus();
    const onTarget = vi.fn();
    const r = render(<TutorialHud game="1" events={events} inputs={inputs} me="me" team="a" onTarget={onTarget} />);
    const tut = r.getByTestId('space3d-tutorial');
    expect(tut.textContent).toContain('Faça a bola passar pela cesta do outro time.');
    const now = () => tut.querySelector('[aria-current="step"]')!;
    expect(now().textContent).toContain('Chegue na bola e pegue');
    expect(now().querySelector('kbd')?.textContent).toBe('F');
    expect(onTarget).toHaveBeenLastCalledWith('bola');
    act(() => useBindings.getState().set('interact', 'KeyT'));
    expect(now().querySelector('kbd')?.textContent).toBe('T');
    // evento de outra zona não conta; pegar a bola conta
    act(() => events.emit({ kind: 'kick', by: 'me', power: 1, zone: 2, at: { x: 0, y: 0, z: 0 } }));
    expect(now().textContent).toContain('Chegue na bola');
    act(() => inputs.emit({ kind: 'grab' }));
    expect(now().textContent).toContain('Segure para carregar o arremesso');
    expect(onTarget).toHaveBeenLastCalledWith('cesta');
    r.unmount();
  });

  it('o passo não fecha por tempo, só pela ação; no fim grava o aprendido e não volta', async () => {
    const { LEARNED_KEY } = await fresh();
    vi.useFakeTimers();
    try {
      const { InputBus } = await import('../src/features/space3d/input');
      const { TutorialHud } = await import('../src/features/space3d/TutorialHud');
      const inputs = new InputBus();
      const r = render(<TutorialHud game="0" events={null} inputs={inputs} me="me" team="a" />);
      act(() => void vi.advanceTimersByTime(10 * 60_000));
      expect(r.getByTestId('space3d-tutorial').textContent).toContain('Ande');
      act(() => {
        inputs.emit({ kind: 'press', action: 'forward' });
        inputs.emit({ kind: 'press', action: 'run' });
        inputs.emit({ kind: 'press', action: 'jump' });
      });
      expect(r.queryByTestId('space3d-tutorial')).toBeNull();
      expect(JSON.parse(localStorage.getItem(LEARNED_KEY)!).done).toContain('0');
      r.rerender(<TutorialHud game="1" events={null} inputs={inputs} me="me" team="a" />);
      r.rerender(<TutorialHud game="0" events={null} inputs={inputs} me="me" team="a" />);
      expect(r.queryByTestId('space3d-tutorial')).toBeNull();
      r.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Pular fecha; Como jogar no menu reabre o tutorial do jogo', async () => {
    const { useTutorial } = await fresh();
    const { useData } = await import('../src/store/data');
    const { useVoice } = await import('../src/store/voice');
    const { useSpace } = await import('../src/store/space');
    const { SpaceView } = await import('../src/features/space3d/SpaceView');
    useData.setState({ me: { id: 'me', displayName: 'Erick' } as never });
    useVoice.setState({ participants: [{ identity: 'me', name: 'Erick' }] as never });
    useSpace.setState({
      openChannelId: CHANNEL,
      zone: 1,
      team: 'a',
      duels: {},
      editing: false,
      spaces: {
        [SERVER]: { serverId: SERVER, layout: generateSpace(SERVER), revision: 0, updatedAt: null, updatedBy: null },
      },
      session: { channelId: CHANNEL, serverId: SERVER, screen: null, updatedBy: 'me', revision: 1 },
    });
    const r = render(<SpaceView channelId={CHANNEL} serverId={SERVER} />);
    // com o menu aberto o tutorial espera (não cobre o menu)
    const menu = r.getByRole('dialog', { name: 'Menu do jogo' });
    expect(r.queryByTestId('space3d-tutorial')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(r.getByTestId('space3d-tutorial').textContent).toContain('Chegue na bola e pegue');
    // o painel de comandos começa recolhido
    expect(r.getByRole('button', { name: /comandos/i }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(r.getByRole('button', { name: 'Pular tutorial' }));
    expect(r.queryByTestId('space3d-tutorial')).toBeNull();
    expect(useTutorial.getState().learned.done).toContain('1');
    // Esc com o mouse solto abre o menu; Como jogar refaz o tutorial
    fireEvent.keyDown(r.container.querySelector('.space3d-host')!, { key: 'Escape' });
    fireEvent.click(r.getByRole('button', { name: 'Como jogar' }));
    expect(useTutorial.getState().active).toEqual({ key: '1', step: 0 });
    const again = r.queryByRole('dialog', { name: 'Menu do jogo' });
    if (again) fireEvent.keyDown(again, { key: 'Escape' });
    expect(r.getByTestId('space3d-tutorial').textContent).toContain('Chegue na bola e pegue');
    r.unmount();
  });

  it('depois do tutorial, a dica aparece no momento certo, uma vez por vez, e no máximo 2 vezes', async () => {
    const { useTutorial } = await fresh();
    vi.useFakeTimers();
    try {
      const { GameBus } = await import('../src/features/space3d/events');
      const { TutorialHud, HINT_MS } = await import('../src/features/space3d/TutorialHud');
      act(() => {
        useTutorial.getState().enter('7');
        useTutorial.getState().skip();
      });
      const events = new GameBus();
      const r = render(<TutorialHud game="7" events={events} inputs={null} me="me" team="a" />);
      const item = () => events.emit({ kind: 'item', power: 0.6, zone: 7, at: { x: 0, y: 0, z: 0 } });
      expect(r.queryByTestId('space3d-tip')).toBeNull();
      act(item);
      expect(r.getByTestId('space3d-tip').textContent).toContain('Turbo guardado');
      // usou o turbo: some na hora
      act(() => events.emit({ kind: 'boost', source: 'item', power: 1, zone: 7, at: { x: 0, y: 0, z: 0 } }));
      expect(r.queryByTestId('space3d-tip')).toBeNull();
      act(item);
      expect(r.getByTestId('space3d-tip')).toBeTruthy();
      act(() => void vi.advanceTimersByTime(HINT_MS + 10));
      expect(r.queryByTestId('space3d-tip')).toBeNull();
      act(item);
      expect(r.queryByTestId('space3d-tip')).toBeNull();
      expect(useTutorial.getState().learned.hints['race-item']).toBe(2);
      r.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('o painel de comandos abre pelo botão e fica lembrado', async () => {
    const { useTutorial, LEARNED_KEY } = await fresh();
    const { ControlsPanel } = await import('../src/features/space3d/GameHud');
    const Panel = () => {
      const open = useTutorial((t) => t.learned.panel);
      return (
        <ControlsPanel zone={1} fighting={false} open={open} onToggle={() => useTutorial.getState().togglePanel()} />
      );
    };
    const r = render(<Panel />);
    const btn = r.getByRole('button', { name: /comandos/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toContain('H');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem(LEARNED_KEY)!).panel).toBe(true);
    r.unmount();
  });
});

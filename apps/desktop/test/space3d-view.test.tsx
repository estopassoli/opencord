import { generateSpace } from '@opencord/contracts';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('AudioWorkletNode', class {});
// sem WebGL no jsdom: a cena vira um objeto falso
vi.mock('../src/features/space3d/scene', () => ({
  SpaceScene: class {
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
    setRace() {}
    rerack() {}
    remotePool() {}
    interact() {}
    setMode() {}
    dispose() {}
  },
}));

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
    expect(r.getByText(/Espaço 3D/)).toBeTruthy();
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
    expect(r.getByText('Aceitar (F)')).toBeTruthy();

    act(() =>
      useSpace.setState({
        duels: { d1: { ...base, status: 'fighting', hp: { tu: 76, me: 100 }, until: Date.now() + 60_000 } },
      }),
    );
    expect(r.getByLabelText('Vida de tulio').getAttribute('aria-valuenow')).toBe('76');
    expect(r.getByText('Desistir')).toBeTruthy();
    // lutando: mira no centro e aviso para travar a mira com um clique
    expect(r.container.querySelector('.space3d-crosshair')).toBeTruthy();
    expect(r.getByText('Clique na tela para travar a mira')).toBeTruthy();
    expect(r.getByText(/segure e solte: soco forte/)).toBeTruthy();
    expect(r.queryByText('Aceitar (F)')).toBeNull();

    act(() =>
      useSpace.setState({
        duels: {
          d1: { ...base, status: 'ended', hp: { tu: 0, me: 40 }, until: Date.now(), winner: 'me', reason: 'ko' },
        },
      }),
    );
    expect(r.getByText('Erick venceu por nocaute')).toBeTruthy();
    r.unmount();
  });
});

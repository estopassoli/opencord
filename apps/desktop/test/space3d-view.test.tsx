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

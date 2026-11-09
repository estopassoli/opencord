import type { SpaceSession } from '@opencord/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CH = '01a1bc36-0000-7000-8000-0000000000c1';
const SV = '01a1bc36-0000-7000-8000-0000000000a1';
const state: { session: SpaceSession | null } = { session: null };
const command = vi.fn(async (name: string) => {
  if (name === 'space:get') return state.session;
  if (name === 'space:duel:get') return [];
  return state.session;
});

vi.mock('../src/store/session', () => ({
  useSession: { getState: () => ({ realtime: { command, sendVolatile: vi.fn() } }) },
  api: () => ({
    request: vi.fn(async () => ({ serverId: SV, layout: null, revision: 0, updatedAt: null, updatedBy: null })),
  }),
  describeError: (e: unknown) => String(e),
}));

const { useSpace } = await import('../src/store/space');

const session = (over: Partial<SpaceSession> = {}): SpaceSession => ({
  channelId: CH,
  serverId: SV,
  screen: null,
  updatedBy: null,
  revision: 1,
  ...over,
});

describe('Espaço 3D: estado do espaço (store)', () => {
  beforeEach(() => {
    useSpace.getState().close();
    command.mockClear();
  });

  it('abrir com uma corrida antiga: o mesmo estado chegando depois não abre contagem (assiste até a próxima)', async () => {
    state.session = session({ race: { startAt: 1000, laps: 3, results: [] } });
    await useSpace.getState().open(CH, SV);
    expect(useSpace.getState().raceKey).toBe(1000);
    useSpace.getState().applySession(session({ revision: 2, race: { startAt: 1000, laps: 3, results: [] } }));
    expect(useSpace.getState().raceLocalStart).toBeNull();
    // largada nova: a contagem começa no meu relógio
    useSpace.getState().applySession(session({ revision: 3, race: { startAt: 9000, laps: 3, results: [] } }));
    expect(useSpace.getState().raceLocalStart).not.toBeNull();
    // fechar limpa a chave e a largada
    useSpace.getState().close();
    expect(useSpace.getState().raceKey).toBeNull();
    expect(useSpace.getState().raceLocalStart).toBeNull();
  });

  it('partida nova em contagem: guarda o VAI no meu relógio, só uma vez por contagem', async () => {
    state.session = session();
    await useSpace.getState().open(CH, SV);
    const before = Date.now();
    useSpace.getState().applySession(session({ revision: 2, matches: { '5': { phase: 'countdown', startAt: 50 } } }));
    const go = useSpace.getState().matchLocalStart['5']!;
    expect(go).toBeGreaterThanOrEqual(before + 2900);
    useSpace.getState().applySession(session({ revision: 3, matches: { '5': { phase: 'countdown', startAt: 50 } } }));
    expect(useSpace.getState().matchLocalStart['5']).toBe(go);
  });

  it('reconectar com o espaço aberto busca a sessão e os duelos de novo', async () => {
    state.session = session();
    await useSpace.getState().open(CH, SV);
    command.mockClear();
    state.session = session({ revision: 7, scores: { '1': { a: 4, b: 2 } } });
    await useSpace.getState().refresh();
    expect(command.mock.calls.map((c) => c[0])).toEqual(['space:get', 'space:duel:get']);
    expect(useSpace.getState().session?.scores?.['1']).toEqual({ a: 4, b: 2 });
  });

  it('com o espaço fechado, reconectar não busca nada', async () => {
    await useSpace.getState().refresh();
    expect(command).not.toHaveBeenCalled();
  });
});

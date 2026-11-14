import { defaultUserSettings, type UserSettings } from '@opencord/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shakeWindow = vi.fn(async () => undefined);
const notify = vi.fn(async () => undefined);
const flashFrame = vi.fn(async () => undefined);
vi.mock('../src/lib/bridge', () => ({ bridge: { shakeWindow, notify, flashFrame } }));
const playNudge = vi.fn();
vi.mock('../src/lib/sounds', () => ({ playNudge }));
const hides = { sounds: false };
vi.mock('../src/lib/streamer', () => ({ streamerHides: () => hides }));

const { receiveNudge, resetNudgeGap } = await import('../src/lib/nudge');
const { useData } = await import('../src/store/data');
const { useUi } = await import('../src/store/ui');

const toast = vi.fn();
const settings = (patch: Partial<UserSettings['notifications']> = {}): UserSettings => {
  const s = defaultUserSettings();
  return { ...s, notifications: { ...s.notifications, soundVolume: 0.6, ...patch } };
};
const ev = { fromUserId: 'u1', fromName: 'Bia' };

describe('"Chamar atenção" no app de quem recebe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNudgeGap();
    hides.sounds = false;
    delete document.documentElement.dataset.nudge;
    delete document.documentElement.dataset.motion;
    useUi.setState({ toast });
    useData.setState({ settings: settings(), myStatus: 'online' });
  });

  it('treme a interface e a janela, toca o aviso no volume escolhido e mostra quem chamou', () => {
    expect(receiveNudge(ev, 10_000)).toBe('shown');
    expect(document.documentElement.dataset.nudge).toBe('true');
    expect(shakeWindow).toHaveBeenCalledTimes(1);
    expect(playNudge).toHaveBeenCalledWith(0.6);
    expect(toast).toHaveBeenCalledWith('info', 'Bia está chamando sua atenção!');
    // várias chamadas juntas: uma a cada 2,5 s
    expect(receiveNudge(ev, 11_000)).toBe('ignored');
    expect(receiveNudge(ev, 12_600)).toBe('shown');
  });

  it('desligado nas configurações: ignora; Não perturbe: só o aviso, sem tremer nem tocar', () => {
    useData.setState({ settings: settings({ nudges: false }) });
    expect(receiveNudge(ev, 10_000)).toBe('ignored');
    expect(toast).not.toHaveBeenCalled();

    useData.setState({ settings: settings(), myStatus: 'dnd' });
    expect(receiveNudge(ev, 20_000)).toBe('quiet');
    expect(shakeWindow).not.toHaveBeenCalled();
    expect(playNudge).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('info', 'Bia chamou sua atenção.');
  });

  it('reduzir animações: não treme; modo streamer escondendo sons: não toca', () => {
    document.documentElement.dataset.motion = 'reduced';
    hides.sounds = true;
    expect(receiveNudge(ev, 10_000)).toBe('shown');
    expect(document.documentElement.dataset.nudge).toBeUndefined();
    expect(shakeWindow).not.toHaveBeenCalled();
    expect(playNudge).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });
});

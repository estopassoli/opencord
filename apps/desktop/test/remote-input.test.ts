import { describe, expect, it } from 'vitest';
import { inputLine, RemoteInputEvent, RemoteInputStartArgs, SCANCODES } from '../electron/shared/remote-input';
import { decodeRemoteMsg, toInputEvent } from '../src/voice/remote-control';

const rect = { x: 1920, y: 0, width: 2560, height: 1440 };

describe('controle remoto: eventos → comandos do oc-input', () => {
  it('converte a posição relativa para o pixel do monitor da live', () => {
    expect(inputLine({ type: 'move', x: 0, y: 0 }, rect)).toEqual(['m 1920 0']);
    expect(inputLine({ type: 'move', x: 1, y: 1 }, rect)).toEqual(['m 4479 1439']);
    expect(inputLine({ type: 'move', x: 0.5, y: 0.5 }, rect)).toEqual(['m 3200 720']);
  });

  it('clique move antes de apertar; rodinha e teclas viram linhas próprias', () => {
    expect(inputLine({ type: 'button', button: 'right', down: true, x: 0, y: 0 }, rect)).toEqual(['m 1920 0', 'b 2 1']);
    expect(inputLine({ type: 'wheel', dx: 0, dy: -120 }, rect)).toEqual(['w 0 -120']);
    expect(inputLine({ type: 'key', code: 'ArrowLeft', down: true }, rect)).toEqual(['k 75 1 1']);
    expect(inputLine({ type: 'key', code: 'KeyA', down: false }, rect)).toEqual(['k 30 0 0']);
    expect(inputLine({ type: 'release' }, rect)).toEqual(['r']);
  });

  it('só aceita teclas da tabela e posições de 0 a 1', () => {
    expect(RemoteInputEvent.safeParse({ type: 'key', code: 'KeyA', down: true }).success).toBe(true);
    expect(RemoteInputEvent.safeParse({ type: 'key', code: 'Power', down: true }).success).toBe(false);
    expect(RemoteInputEvent.safeParse({ type: 'move', x: 1.5, y: 0 }).success).toBe(false);
    expect(RemoteInputEvent.safeParse({ type: 'wheel', dx: 0, dy: 5000 }).success).toBe(false);
  });

  it('o controle só começa com uma tela (não uma janela)', () => {
    expect(RemoteInputStartArgs.safeParse({ sourceId: 'screen:0:0', controller: 'Ana' }).success).toBe(true);
    expect(RemoteInputStartArgs.safeParse({ sourceId: 'window:123:0', controller: 'Ana' }).success).toBe(false);
  });

  it('scancodes estendidos marcam o prefixo E0', () => {
    expect(SCANCODES.ControlRight).toEqual([0x1d, true]);
    expect(SCANCODES.ControlLeft).toEqual([0x1d, false]);
  });
});

describe('controle remoto: mensagens da sala', () => {
  const enc = (m: unknown) => new TextEncoder().encode(JSON.stringify(m));

  it('decodifica as mensagens válidas e descarta o resto', () => {
    expect(decodeRemoteMsg(enc({ t: 'req' }))).toEqual({ t: 'req' });
    expect(decodeRemoteMsg(enc({ t: 'grant', kb: false }))).toEqual({ t: 'grant', kb: false });
    expect(decodeRemoteMsg(enc({ t: 'deny', r: 'window' }))).toEqual({ t: 'deny', r: 'window' });
    expect(decodeRemoteMsg(enc({ t: 'k', c: 'Enter', d: true }))).toEqual({ t: 'k', c: 'Enter', d: true });
    expect(decodeRemoteMsg(enc({ t: 'k', c: 'Sleep', d: true }))).toBeNull();
    expect(decodeRemoteMsg(enc({ t: 'boom' }))).toBeNull();
    expect(decodeRemoteMsg(new TextEncoder().encode('{nope'))).toBeNull();
    expect(decodeRemoteMsg(new Uint8Array(1000))).toBeNull();
  });

  it('só as mensagens de entrada viram eventos para o processo principal', () => {
    expect(toInputEvent({ t: 'm', x: 0.25, y: 0.5 })).toEqual({ type: 'move', x: 0.25, y: 0.5 });
    expect(toInputEvent({ t: 'b', b: 'left', d: true, x: 0, y: 0 })).toEqual({
      type: 'button',
      button: 'left',
      down: true,
      x: 0,
      y: 0,
    });
    expect(toInputEvent({ t: 'r' })).toEqual({ type: 'release' });
    expect(toInputEvent({ t: 'req' })).toBeNull();
    expect(toInputEvent({ t: 'end' })).toBeNull();
  });
});

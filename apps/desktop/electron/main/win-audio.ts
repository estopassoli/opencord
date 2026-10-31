/**
 * Som de cada saída de áudio do Windows para os clipes (ADR-0024). O Chromium só grava o dispositivo padrão; fones com
 * duas saídas ("Game" e "Chat"/"Voice") deixavam a outra de fora. O `oc-audio.exe` (native/win-audio, WASAPI
 * loopback) lista as saídas e grava cada uma; o PCM (float32 estéreo 48 kHz) vai para a janela em pedaços.
 */
import { app, type WebContents } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { WinAudioOutput } from '../shared/ipc';

const exe = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'oc-audio.exe')
    : path.join(app.getAppPath(), 'resources', 'win', 'oc-audio.exe');

export const winAudioAvailable = () => process.platform === 'win32' && existsSync(exe());

export function listOutputs(): Promise<WinAudioOutput[]> {
  if (!winAudioAvailable()) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(exe(), ['list'], { timeout: 5000, windowsHide: true, encoding: 'utf8' }, (err, out) => {
      if (err) return resolve([]);
      try {
        const list = JSON.parse(out) as WinAudioOutput[];
        resolve(Array.isArray(list) ? list.filter((d) => typeof d.id === 'string' && typeof d.name === 'string') : []);
      } catch {
        resolve([]);
      }
    });
  });
}

const running = new Map<string, ChildProcess>();
/** 8 bytes por quadro estéreo float32 */
const FRAME = 8;

export function startOutput(id: string, to: WebContents, channel: string): boolean {
  if (!winAudioAvailable() || running.has(id)) return running.has(id);
  const child = spawn(exe(), ['capture', id], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  running.set(id, child);
  let rest: Buffer = Buffer.alloc(0);
  child.stdout.on('data', (b: Buffer) => {
    const all = rest.length ? Buffer.concat([rest, b]) : b;
    const whole = all.length - (all.length % FRAME);
    rest = all.subarray(whole);
    if (!whole || to.isDestroyed()) return;
    // cópia própria: o Buffer do Node pode ser uma fatia de um bloco compartilhado
    to.send(channel, { id, pcm: new Uint8Array(all.subarray(0, whole)) });
  });
  const done = () => {
    if (running.get(id) === child) running.delete(id);
  };
  child.on('exit', done);
  child.on('error', done);
  return true;
}

export function stopOutput(id: string) {
  const child = running.get(id);
  if (!child) return;
  running.delete(id);
  // fechar o stdin pede para parar; se não parar, encerra
  child.stdin?.end();
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 2000).unref();
}

export function stopAllOutputs() {
  for (const id of [...running.keys()]) stopOutput(id);
}

/**
 * Clipes (ADR-0022), lado do processo principal: escolhe a tela a capturar (a do jogo: a principal) e grava o arquivo
 * pronto em Vídeos\OpenCord. O vídeo em si é codificado e guardado na memória pela janela (WebCodecs).
 */
import { app, desktopCapturer, screen, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClipSaveArgs } from '../shared/ipc';
import { selectSource } from './capture';

export const clipsDir = () => path.join(app.getPath('videos'), 'OpenCord');

/** Autoriza a próxima captura: tela principal + som do computador. */
export async function prepareClipCapture(): Promise<boolean> {
  const primary = String(screen.getPrimaryDisplay().id);
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const src = screens.find((s) => s.display_id === primary) ?? screens[0];
  if (!src) return false;
  selectSource({ sourceId: src.id, systemAudio: true });
  return true;
}

// caracteres proibidos em nomes de arquivo do Windows (e de controle)
const safe = (s: string) =>
  [...s]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch))
    .join('')
    .trim() || 'Clipe';
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export async function saveClip(a: ClipSaveArgs): Promise<string> {
  const dir = clipsDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safe(a.game)} ${stamp(new Date())}.mp4`);
  await writeFile(file, a.data);
  return file;
}

export function revealClip(file: string) {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(clipsDir())) throw new Error('fora da pasta de clipes');
  shell.showItemInFolder(resolved);
}

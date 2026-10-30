import { _electron as electron, expect, test } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Modos de uso da placa de vídeo (Configurações → Sobre → Desempenho). O que importa em cada modo:
 * - o antigo "ui-software" (disable-gpu-compositing) saiu: o status da GPU dizia "vídeo enabled", mas a live codificava
 *   em software (OpenH264) e decodificava em FFmpeg (medido no golive-fps). Quem o tinha salvo volta a "full";
 * - off: sem aceleração nenhuma; o formato antigo { hardwareAcceleration: false } continua significando "off".
 */
async function launchWith(prefs: object) {
  const dir = path.join(__dirname, 'results', 'gpu-mode');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'app-prefs.json'), JSON.stringify(prefs));
  const app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${dir}`],
    cwd: path.join(__dirname, '..'),
  });
  await app.firstWindow();
  // o status só fica definitivo depois que o processo da GPU sobe e a janela pinta: lê várias vezes por até 15 s
  const read = () =>
    app.evaluate(({ app: a }) => ({
      accel: a.isHardwareAccelerationEnabled(),
      gpu: a.getGPUFeatureStatus() as unknown as Record<string, string>,
    }));
  let status = await read();
  for (let i = 0; i < 30 && !/^enabled/.test(status.gpu.video_encode ?? ''); i++) {
    await new Promise((r) => setTimeout(r, 500));
    status = await read();
  }
  await app.close();
  return status;
}

test('modo antigo ui-software volta a usar a placa de vídeo para tudo', async () => {
  const s = await launchWith({ gpuMode: 'ui-software' });
  expect(s.accel).toBe(true);
  expect(s.gpu.gpu_compositing).toMatch(/^enabled/);
  expect(s.gpu.video_encode).toMatch(/^enabled/);
});

test('full: tudo na GPU', async () => {
  const s = await launchWith({ gpuMode: 'full' });
  expect(s.gpu.gpu_compositing).toMatch(/^enabled/);
  expect(s.gpu.video_encode).toMatch(/^enabled/);
});

test('formato antigo desligado continua sem aceleração', async () => {
  const s = await launchWith({ hardwareAcceleration: false });
  console.warn('GPU_OFF', JSON.stringify(s));
  expect(s.accel).toBe(false);
});

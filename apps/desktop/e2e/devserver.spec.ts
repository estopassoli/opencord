import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';

// Valida o modo dev: Electron carregando o renderer do Vite (OPENCORD_DEV_URL), com HMR.
test('modo dev carrega o renderer do Vite', async () => {
  test.skip(!process.env.OPENCORD_DEV_URL, 'defina OPENCORD_DEV_URL');
  const app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${path.join(__dirname, 'results', 'dev-profile')}`],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, OPENCORD_DEV_URL: process.env.OPENCORD_DEV_URL ?? '' },
  });
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/localhost:5173/);
  await expect(page.getByRole('heading', { name: /Entrar no|Bem-vindo|Amigos/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  const bridge = await page.evaluate(() => typeof (window as unknown as { opencord?: unknown }).opencord);
  expect(bridge).toBe('object');
  await app.close();
});

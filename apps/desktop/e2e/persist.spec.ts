/**
 * Login permanece: fechar e reabrir o app (várias vezes) volta direto para dentro, sem pedir apelido.
 * Cobre a rotação do refresh a cada abertura e o StrictMode do modo dev (efeitos rodam duas vezes).
 */
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { joinWithNickname, uniqueNick } from './helpers';

const servers = (page: Page) => page.getByRole('navigation', { name: 'Servidores' });

async function launch(dir: string, devUrl?: string) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dir}`],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, OPENCORD_DEV_URL: devUrl ?? '' },
  });
  return { app, page: await app.firstWindow() };
}

test('fechar e reabrir mantém a sessão (app empacotado)', async () => {
  const dir = path.join(__dirname, 'results', 'persist-profile');
  rmSync(dir, { recursive: true, force: true });
  const nick = uniqueNick('Persist');
  let { app, page } = await launch(dir);
  await joinWithNickname(page, nick);
  await app.close();
  for (let i = 0; i < 3; i++) {
    ({ app, page } = await launch(dir));
    await expect(servers(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Apelido')).toHaveCount(0);
    await expect(page.locator('.user-dock-names strong')).toHaveText(nick);
    await app.close();
  }
});

test('modo dev (StrictMode): recarregar não desloga', async () => {
  test.skip(!process.env.OPENCORD_DEV_URL, 'defina OPENCORD_DEV_URL');
  const dir = path.join(__dirname, 'results', 'persist-dev-profile');
  rmSync(dir, { recursive: true, force: true });
  const { app, page } = await launch(dir, process.env.OPENCORD_DEV_URL);
  await joinWithNickname(page, uniqueNick('PersistDev'));
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await expect(servers(page)).toBeVisible({ timeout: 20_000 });
  }
  await app.close();
});

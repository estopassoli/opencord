/**
 * Atualização "avisar e baixar": com um instalador mais novo publicado no servidor, o app baixa e mostra
 * "Atualização pronta" na barra de título. O instalador aqui é falso e NUNCA é executado (o teste não clica).
 * Requer a API de dev com DOWNLOADS_DIR apontando para `release/` do app (ver .env de dev).
 */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { API, joinWithNickname, uniqueNick } from './helpers';

const FAKE = path.join(__dirname, '..', 'release', 'OpenCord-Setup-9.9.9-x64.exe');
const NEWER = path.join(__dirname, '..', 'release', 'OpenCord-Setup-9.9.10-x64.exe');
let app: ElectronApplication | undefined;

test.afterAll(async () => {
  await app?.close();
  rmSync(FAKE, { force: true });
  rmSync(NEWER, { force: true });
});

test('versão nova publicada → baixa e mostra "Atualização pronta"', async () => {
  writeFileSync(FAKE, Buffer.alloc(64 * 1024, 1));
  const dir = path.join(__dirname, 'results', 'update-profile');
  rmSync(dir, { recursive: true, force: true });
  app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${dir}`],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, OPENCORD_UPDATE_SERVER: API, OPENCORD_UPDATE_DELAY_MS: '500' },
  });
  const page = await app.firstWindow();
  await joinWithNickname(page, uniqueNick('Upd'));
  // a primeira verificação pode ter rodado antes do login: força outra com o servidor já salvo
  await page.evaluate(() =>
    (window as unknown as { opencord: { updates: { check(): Promise<unknown> } } }).opencord.updates.check(),
  );
  const btn = page.getByRole('button', { name: /^Atualização pronta! .* 9\.9\.9$/ });
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.hover();
  await page.screenshot({ path: path.join(__dirname, 'results', '40-atualizacao-pronta.png') });
  // o instalador baixado tem o tamanho anunciado pelo servidor
  const temp = await app.evaluate(({ app: a }) => a.getPath('temp'));
  const dl = (v: string) => path.join(temp, 'opencord-update', v, `OpenCord-Setup-${v}-x64.exe`);
  expect(statSync(dl('9.9.9')).size).toBe(64 * 1024);

  // saiu outra versão enquanto a anterior esperava o clique: o app troca para a mais nova (relato real: 0.2.9 → 0.2.10)
  writeFileSync(NEWER, Buffer.alloc(32 * 1024, 2));
  await page.evaluate(() =>
    (window as unknown as { opencord: { updates: { check(): Promise<unknown> } } }).opencord.updates.check(),
  );
  await expect(page.getByRole('button', { name: /^Atualização pronta! .* 9\.9\.10$/ })).toBeVisible({
    timeout: 20_000,
  });
  expect(statSync(dl('9.9.10')).size).toBe(32 * 1024);
  expect(existsSync(dl('9.9.9'))).toBe(false);
  // clicar abre o diálogo com as novidades e a escolha; Cancelar não instala nada
  await page.getByRole('button', { name: /^Atualização pronta! .* 9\.9\.10$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Atualização 9.9.10' });
  await expect(dialog.getByRole('button', { name: 'Atualizar' })).toBeVisible();
  await page.screenshot({ path: path.join(__dirname, 'results', '41-dialogo-atualizacao.png') });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
});

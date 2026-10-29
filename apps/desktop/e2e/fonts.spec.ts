/**
 * Importar fonte: arquivos do computador do usuário viram uma família utilizável, persistem só neste perfil
 * e arquivos que não são fonte são recusados. Fixture: Inter (SIL OFL 1.1) renomeada.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { joinWithNickname, shot, uniqueNick } from './helpers';

const FIX = path.join(__dirname, 'fixtures');
const DIR = path.join(__dirname, 'results', 'fonts-profile');
let app: ElectronApplication;
let page: Page;

const launch = async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${DIR}`], cwd: path.join(__dirname, '..') });
  page = await app.firstWindow();
};
const openAppearance = async () => {
  await page.getByRole('button', { name: 'Configurações do usuário' }).click();
  await page.getByRole('dialog').getByRole('tab', { name: 'Aparência' }).click();
  return page.getByRole('dialog');
};
const fontVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font').trim());

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => app?.close());

test('importa, usa, persiste ao reabrir e remove', async () => {
  rmSync(DIR, { recursive: true, force: true });
  await launch();
  await joinWithNickname(page, uniqueNick('Fonts'));
  let dialog = await openAppearance();

  // arquivo que não é fonte é recusado com mensagem clara
  await dialog.locator('input[type="file"]').setInputFiles(path.join(FIX, 'falsa.ttf'));
  await dialog.getByRole('button', { name: 'Importar e usar' }).click();
  await expect(dialog.getByText(/não é uma fonte WOFF2, WOFF, TTF ou OTF/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await dialog.locator('input[type="file"]').setInputFiles(path.join(FIX, 'FonteTeste-Bold.woff2'));
  await expect(dialog.getByLabel('Nome da fonte importada')).toHaveValue('FonteTeste');
  await dialog.getByLabel('Nome da fonte importada').fill('Fonte Teste E2E');
  await dialog.getByRole('button', { name: 'Importar e usar' }).click();
  await expect(dialog.getByRole('list', { name: 'Fontes importadas' })).toContainText('Fonte Teste E2E');
  await expect.poll(fontVar).toMatch(/^"Fonte Teste E2E"/);
  expect(await page.evaluate(() => document.fonts.check('700 16px "Fonte Teste E2E"'))).toBe(true);
  await expect(dialog.getByText(/não foi encontrada/)).toHaveCount(0);
  await page.screenshot({ path: shot('fonts-imported') });
  await app.close();

  // reabrir: a fonte continua registrada e em uso
  await launch();
  await expect(page.getByRole('navigation', { name: 'Servidores' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('700 16px "Fonte Teste E2E"'))).toBe(true);
  await expect.poll(fontVar).toMatch(/^"Fonte Teste E2E"/);

  dialog = await openAppearance();
  await dialog.getByRole('button', { name: 'Remover Fonte Teste E2E' }).click();
  await expect(dialog.getByRole('list', { name: 'Fontes importadas' })).toHaveCount(0);
  await expect.poll(fontVar).not.toMatch(/Fonte Teste E2E/);
  await page.keyboard.press('Escape');
});

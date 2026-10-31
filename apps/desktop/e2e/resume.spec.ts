import { _electron as electron, expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { FLAGS, joinVoice, joinWithNickname, uniqueNick } from './helpers';

/** Fechar o app numa chamada e abrir de novo: oferece "Reconectar" e volta para a mesma chamada. */
const dir = path.join(__dirname, 'results', 'resume');
const open = () =>
  electron.launch({ args: ['.', '--mute-audio', `--user-data-dir=${dir}`, ...FLAGS], cwd: path.join(__dirname, '..') });

test('reabrir o app oferece voltar para a chamada em que eu estava', async () => {
  test.setTimeout(120_000);
  rmSync(dir, { recursive: true, force: true });
  let app = await open();
  let page = await app.firstWindow();
  await joinWithNickname(page, uniqueNick('Volta'));
  await joinVoice(page);
  // fecha sem sair da chamada (como fechar o app pelo menu)
  await app.close();

  app = await open();
  page = await app.firstWindow();
  const resume = page.getByRole('region', { name: 'Voltar para a chamada' });
  await expect(resume).toContainText('Você estava em Sala', { timeout: 30_000 });
  await page.screenshot({ path: path.join(__dirname, 'results', 'resume-call.png') });
  await resume.getByRole('button', { name: 'Reconectar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Voz conectada' })).toBeVisible({ timeout: 25_000 });
  await expect(resume).toHaveCount(0);
  // sair pelo botão: na próxima abertura não oferece mais
  await page
    .locator('.dock')
    .getByRole('button', { name: /Desconectar|Sair da chamada/ })
    .first()
    .click();
  await app.close();
  app = await open();
  page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: 'Servidores' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByRole('region', { name: 'Voltar para a chamada' })).toHaveCount(0);
  await app.close();
});

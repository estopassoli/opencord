/**
 * Ícones (Hugeicons, só contorno): o traço engrossa no hover (inclusive com o ícone aninhado em wrapper),
 * e animações de diálogo zeradas quando "Reduzir movimento" está ligado.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { joinWithNickname, shot, uniqueNick } from './helpers';

let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const dir = path.join(__dirname, 'results', 'motion-profile');
  rmSync(dir, { recursive: true, force: true });
  app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${dir}`],
    cwd: path.join(__dirname, '..'),
  });
  page = await app.firstWindow();
  await joinWithNickname(page, uniqueNick('Motion'));
});
test.afterAll(async () => app?.close());

/** Espessura final (após a transição) do traço do primeiro ícone do elemento (Hugeicons: só contorno). */
async function stroke(sel: string) {
  await page.waitForTimeout(400);
  return page
    .locator(sel)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el.querySelector('.oc-icon svg path')!).strokeWidth));
}

test('ícones engrossam o traço no hover', async () => {
  const targets = [
    'button[aria-label="Configurações do usuário"]',
    'button[aria-label="Criar um servidor"]',
    'button[aria-label="Escolher microfone"]',
  ];
  await page.mouse.move(1, 1);
  // a troca tem transição (~120 ms): espera o estado final em vez de medir no instante do hover
  for (const sel of targets) {
    await expect.poll(() => stroke(sel), { message: `${sel} em repouso` }).toBe(1.5);
    await page.hover(sel);
    await expect.poll(() => stroke(sel), { message: `${sel} no hover` }).toBe(2.2);
    await page.mouse.move(1, 1);
  }
  // ícone dentro de wrapper (span) dentro do botão também engrossa
  const nested = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Configurações do usuário"]')!;
    const icon = b.querySelector('.oc-icon')!;
    const wrap = document.createElement('span');
    icon.replaceWith(wrap);
    wrap.append(icon);
    return true;
  });
  expect(nested).toBe(true);
  // a mutação do DOM pode chegar depois do primeiro mousemove: reapresenta o hover até estabilizar
  await expect
    .poll(async () => {
      await page.mouse.move(1, 1);
      await page.hover('button[aria-label="Configurações do usuário"]');
      return stroke('button[aria-label="Configurações do usuário"]');
    })
    .toBe(2.2);
});

test('diálogo anima a entrada e respeita "Reduzir movimento"', async () => {
  await page.click('button[aria-label="Criar um servidor"]');
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const dur = await dialog.evaluate((d) => getComputedStyle(d).transitionDuration);
  expect(dur).not.toMatch(/^0s/);
  await expect.poll(() => dialog.evaluate((d) => getComputedStyle(d).opacity)).toBe('1');
  await page.screenshot({ path: shot('motion-dialog') });
  await page.keyboard.press('Escape');

  await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduced'));
  await page.click('button[aria-label="Criar um servidor"]');
  const reduced = await page.locator('dialog[open]').evaluate((d) => getComputedStyle(d).transitionDuration);
  expect(reduced.split(',').every((t) => parseFloat(t) < 0.001)).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.documentElement.removeAttribute('data-motion'));
});

test('aparência: destaque, fundo, cantos e fonte personalizáveis', async () => {
  const css = (v: string) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
  expect(await css('--brand')).toBe('#4d56fd');

  await page.getByRole('button', { name: 'Configurações do usuário' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Aparência' }).click();

  await dialog.getByRole('radio', { name: 'Cor #ef4f4f' }).click();
  await expect.poll(() => css('--brand')).toBe('#ef4f4f');
  await dialog.getByLabel('Código da cor').fill('#14a3a3');
  await expect.poll(() => css('--brand')).toBe('#14a3a3');

  await dialog.getByRole('radio', { name: /OLED/ }).click();
  await expect.poll(() => css('--chat')).toBe('#0b0b0c');

  const slider = dialog.getByRole('slider', { name: 'Cantos arredondados' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => css('--radius-scale')).toBe('0');

  await dialog.getByRole('combobox', { name: 'Fonte' }).click();
  await page.getByRole('option', { name: 'Georgia' }).click();
  await expect.poll(() => css('--font')).toMatch(/^"Georgia"/);
  await page.screenshot({ path: shot('appearance-custom') });

  await dialog.getByRole('button', { name: 'Restaurar aparência padrão' }).click();
  await expect.poll(() => css('--brand')).toBe('#4d56fd');
  await expect.poll(() => css('--radius-scale')).toBe('1');
  await page.keyboard.press('Escape');
});

/**
 * Layout de celular (versão web, ≤ 768 px): conteúdo em tela cheia, navegação e membros em gavetas,
 * gestos de deslizar, configurações utilizáveis e nenhuma rolagem horizontal.
 * Roda no Edge contra o renderer servido pelo Vite (OPENCORD_WEB_URL, padrão http://localhost:5173).
 */
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { shot, uniqueNick } from './helpers';

const URL = process.env.OPENCORD_WEB_URL ?? 'http://localhost:5173';
let browser: Browser;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  page = await ctx.newPage();
  const ok = await page
    .goto(URL)
    .then(() => true)
    .catch(() => false);
  test.skip(!ok, `servidor web indisponível em ${URL}`);
  await page.getByRole('button', { name: 'Utilizar apenas apelido (dados ficam neste navegador)' }).click();
  await page.getByLabel('Apelido').fill(uniqueNick('Mob'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir menu de servidores e canais' })).toBeVisible({
    timeout: 15_000,
  });
});
test.afterAll(async () => browser?.close());

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const onScreen = (sel: string) =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right > 1 && r.left < innerWidth - 1;
  });
const menu = () => page.getByRole('button', { name: 'Abrir menu de servidores e canais' });

async function swipe(fromX: number, toX: number, y = 400) {
  await page.evaluate(
    ([a, b, yy]) => {
      const t = (x: number) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: yy });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t(a)], changedTouches: [t(a)] }));
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(b)] }));
    },
    [fromX, toX, y] as const,
  );
  await page.waitForTimeout(350);
}

test('conteúdo em tela cheia e gaveta fechada ao entrar', async () => {
  expect(await overflow()).toBe(0);
  const content = await page.locator('#main-content').boundingBox();
  expect(content?.width).toBe(390);
  expect(await onScreen('.sidebar')).toBe(false);
  expect(await page.locator('#mobile-nav').evaluate((e) => (e as HTMLElement).inert)).toBe(true);
  await page.screenshot({ path: shot('mobile-01-home') });
});

test('menu abre a navegação; escolher um canal fecha e mostra o chat', async () => {
  await menu().click();
  await expect.poll(() => onScreen('.sidebar')).toBe(true);
  expect(await page.locator('#main-content').evaluate((e) => (e as HTMLElement).inert)).toBe(true);
  // trocar de servidor no rail mantém a gaveta aberta
  await page.getByRole('navigation', { name: 'Servidores' }).getByRole('button').nth(1).click();
  await page.waitForTimeout(300);
  expect(await onScreen('.sidebar')).toBe(true);
  await page.screenshot({ path: shot('mobile-02-nav') });
  await page.locator('.sidebar').getByRole('button', { name: /geral/ }).first().click();
  await expect.poll(() => onScreen('.sidebar')).toBe(false);
  const composer = await page.locator('.composer').boundingBox();
  expect(composer && composer.width).toBeGreaterThan(330);
  expect(await overflow()).toBe(0);
  await page.screenshot({ path: shot('mobile-03-chat') });
});

test('membros em gaveta à direita; tocar fora fecha', async () => {
  await page.getByRole('button', { name: 'Mostrar membros' }).click();
  await expect.poll(() => onScreen('.members')).toBe(true);
  await page.screenshot({ path: shot('mobile-04-members') });
  await page.getByRole('button', { name: 'Fechar painel' }).click({ position: { x: 20, y: 400 } });
  await expect.poll(() => onScreen('.members')).toBe(false);
});

test('deslizar da borda abre e deslizar de volta fecha', async () => {
  await swipe(8, 220);
  await expect.poll(() => onScreen('.sidebar')).toBe(true);
  await swipe(300, 60);
  await expect.poll(() => onScreen('.sidebar')).toBe(false);
  // rolagem vertical (gesto inclinado) não abre a gaveta
  await page.evaluate(() => {
    const t = (x: number, y: number) => new Touch({ identifier: 2, target: document.body, clientX: x, clientY: y });
    window.dispatchEvent(new TouchEvent('touchstart', { touches: [t(10, 200)], changedTouches: [t(10, 200)] }));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(90, 500)] }));
  });
  await page.waitForTimeout(350);
  expect(await onScreen('.sidebar')).toBe(false);
});

test('configurações: abas em faixa horizontal, conteúdo sem estourar', async () => {
  await menu().click();
  await page.getByRole('button', { name: 'Configurações do usuário' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Aparência' }).click();
  const tabs = await dialog.getByRole('tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(Math.max(...tabs) - Math.min(...tabs)).toBeLessThan(4); // mesma linha
  expect(await overflow()).toBe(0);
  const panelRight = await dialog.locator('[role="tabpanel"]').evaluate((e) => e.getBoundingClientRect().right);
  expect(panelRight).toBeLessThanOrEqual(390);
  await page.screenshot({ path: shot('mobile-05-settings') });
  await page.getByRole('button', { name: 'Fechar (Esc)' }).click();
  await expect(dialog).toHaveCount(0);
});

test('telas menores e paisagem não estouram', async () => {
  for (const [w, h] of [
    [360, 740],
    [320, 640],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    expect(await overflow(), `${w}×${h}`).toBe(0);
    // deitado também usa o layout de celular (conteúdo em tela cheia, sem barra de título)
    expect(await page.locator('#main-content').evaluate((e) => e.getBoundingClientRect().width), `${w}×${h}`).toBe(w);
    await page.screenshot({ path: shot(`mobile-06-${w}x${h}`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
});

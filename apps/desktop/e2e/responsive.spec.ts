/**
 * Responsividade: redimensiona a janela real do Electron e verifica overflow/sobreposição em telas-chave.
 * Tamanhos: mínimo da janela (940×600), notebooks (1280×720/800), Full HD e QHD.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { joinWithNickname, uniqueNick } from './helpers';

const SIZES: [number, number][] = [
  [940, 600],
  [1280, 720],
  [1280, 800],
  [1920, 1080],
  [2560, 1440],
];
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const dir = path.join(__dirname, 'results', 'responsive-profile');
  rmSync(dir, { recursive: true, force: true });
  app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${dir}`],
    cwd: path.join(__dirname, '..'),
  });
  page = await app.firstWindow();
  await joinWithNickname(page, uniqueNick('Resp'));
});
test.afterAll(async () => app?.close());

async function resize(w: number, h: number) {
  await app.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.unmaximize();
      win?.setContentSize(cw as number, ch as number);
    },
    [w, h],
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(w);
  await page.waitForTimeout(150);
}

/** Problemas de layout detectados no DOM atual (vazio = ok). */
async function layoutProblems(): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 1) out.push(`rolagem horizontal: ${doc.scrollWidth} > ${innerWidth}`);
    for (const h of document.querySelectorAll<HTMLElement>('.chat-header')) {
      const hr = h.getBoundingClientRect();
      for (const el of h.querySelectorAll<HTMLElement>(':scope > *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        // filhos podem estar dentro de um contêiner com rolagem (abas); o contêiner em si não pode sair do cabeçalho
        if (r.right > hr.right + 1 || r.bottom > hr.bottom + 1)
          out.push(
            `cabeçalho estoura: ${el.className || el.tagName} (${Math.round(r.right)} > ${Math.round(hr.right)})`,
          );
      }
    }
    // contêineres de conteúdo não podem ter rolagem horizontal interna (campos espremidos/estourando)
    for (const el of document.querySelectorAll<HTMLElement>(
      '.settings-panel, .home-body, .chat-scroll, .sidebar-scroll, .oc-field',
    )) {
      if (el.scrollWidth > el.clientWidth + 1)
        out.push(`rolagem horizontal interna: ${el.className} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    // campos lado a lado não podem se sobrepor
    const fields = [...document.querySelectorAll<HTMLElement>('.oc-field')]
      .map((f) => f.getBoundingClientRect())
      .filter((r) => r.width > 0);
    for (let i = 0; i < fields.length; i++)
      for (let j = i + 1; j < fields.length; j++) {
        const a = fields[i] as DOMRect;
        const b = fields[j] as DOMRect;
        const inside =
          (a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom) ||
          (b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom);
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        if (overlap && !inside) out.push(`campos sobrepostos em (${Math.round(a.left)},${Math.round(a.top)})`);
      }
    for (const t of document.querySelectorAll<HTMLElement>('.tab')) {
      if (t.getBoundingClientRect().height > 40) out.push(`aba quebrou linha: "${t.textContent}"`);
    }
    const add = document.querySelector('.tab-accent')?.getBoundingClientRect();
    const act = document.querySelector('.activity');
    if (add && act && getComputedStyle(act).display !== 'none') {
      const ar = act.getBoundingClientRect();
      if (add.right > ar.left + 1 && add.right <= ar.right) out.push('"Adicionar amigo" sobrepõe "Em atividade"');
    }
    return out;
  });
}

for (const [w, h] of SIZES) {
  test(`${w}×${h}: amigos, chat, voz e configurações sem overflow`, async () => {
    await resize(w, h);
    // Amigos
    await page.getByRole('button', { name: 'Mensagens diretas' }).click();
    await expect(
      page
        .getByRole('heading', { name: 'Amigos', level: 2 })
        .or(page.getByRole('tab', { name: 'Online' }))
        .first(),
    ).toBeVisible();
    expect(await layoutProblems(), 'amigos').toEqual([]);
    await page.screenshot({ path: path.join(__dirname, 'results', `resp-${w}x${h}-amigos.png`) });
    // Chat
    await page.getByRole('button', { name: 'OpenCord' }).first().click();
    await page.getByRole('button', { name: 'geral' }).click();
    await expect(page.getByRole('textbox', { name: /Conversar em #geral/ })).toBeVisible();
    expect(await layoutProblems(), 'chat').toEqual([]);
    await page.screenshot({ path: path.join(__dirname, 'results', `resp-${w}x${h}-chat.png`) });
    // Sala de voz (sem entrar)
    await page
      .getByRole('button', { name: 'Sala' })
      .first()
      .evaluate((b) => b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await page.keyboard.press('Escape');
    // Configurações em tela cheia
    await page.getByRole('button', { name: 'Configurações do usuário' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Voz e vídeo' }).click();
    // tela cheia de verdade: ocupa a largura da janela (regressão: ficou presa em 520 px);
    // espera a animação de entrada (escala) terminar antes de medir
    await expect.poll(async () => Math.abs(((await dialog.boundingBox())?.width ?? 0) - w) <= 2).toBe(true);
    const close = await page.getByRole('button', { name: 'Fechar (Esc)' }).boundingBox();
    expect(close && close.x + close.width <= w).toBe(true);
    expect(await layoutProblems(), 'configurações').toEqual([]);
    await page.screenshot({ path: path.join(__dirname, 'results', `resp-${w}x${h}-config.png`) });
    await page.keyboard.press('Escape');
  });
}

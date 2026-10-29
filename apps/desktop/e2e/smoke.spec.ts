import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';

const API = process.env.OPENCORD_API ?? 'http://localhost:3000';
const NICK = `Smoke ${Date.now().toString(36).slice(-5)}`;
const shots = (name: string) => path.join(__dirname, 'results', `${name}.png`);

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // perfil isolado e limpo a cada execução: não toca na sessão real do usuário
  rmSync(path.join(__dirname, 'results', 'profile'), { recursive: true, force: true });
  app = await electron.launch({
    args: ['.', '--mute-audio', `--user-data-dir=${path.join(__dirname, 'results', 'profile')}`],
    cwd: path.join(__dirname, '..'),
  });
  page = await app.firstWindow();
  // diagnóstico: recarregamentos/crash do renderer derrubam a sessão em memória
  page.on(
    'framenavigated',
    (f) => f === page.mainFrame() && console.warn('NAV', new Date().toISOString(), f.url().slice(-40)),
  );
  page.on('crash', () => console.warn('CRASH', new Date().toISOString()));
  page.on('pageerror', (e) => console.warn('PAGEERROR', e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && console.warn('CONSOLE', m.text().slice(0, 200)));
});
test.afterAll(async () => {
  await app?.close();
});

test('janela segura: sem Node no renderer e bridge mínima exposta', async () => {
  const info = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridgeKeys: Object.keys((window as unknown as { opencord: object }).opencord).sort(),
  }));
  expect(info.require).toBe('undefined');
  expect(info.process).toBe('undefined');
  expect(info.bridgeKeys).toEqual([
    'appInfo',
    'capture',
    'flashFrame',
    'focusWindow',
    'notify',
    'on',
    'openExternal',
    'secure',
    'setBadge',
    'setShortcuts',
    'setTrayVoiceState',
    'updates',
  ]);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w?.webContents.getLastWebPreferences();
    return { sandbox: p?.sandbox, contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration };
  });
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
});

test('IPC rejeita argumentos inválidos', async () => {
  const err = await page.evaluate(async () => {
    try {
      await (
        window as unknown as { opencord: { capture: { select(a: unknown): Promise<void> } } }
      ).opencord.capture.select({ sourceId: '../../etc', systemAudio: true });
      return 'aceitou';
    } catch (e) {
      return String(e);
    }
  });
  expect(err).not.toBe('aceitou');
});

test('entrar só com apelido → servidor padrão → canal → enviar mensagem', async () => {
  // tela padrão: login e senha, sem endereço do servidor; link para entrar só com apelido embaixo
  await expect(page.getByRole('heading', { name: /^Entrar no / })).toBeVisible();
  await expect(page.getByLabel('Apelido ou e-mail')).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await expect(page.getByLabel('Endereço do servidor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar conta' })).toBeVisible();
  await expect(page.getByText(/convite/i)).toHaveCount(0);
  await page.screenshot({ path: shots('01-entrar-login') });
  await page.getByRole('button', { name: 'Utilizar apenas apelido (dados ficam neste computador)' }).click();
  // só o apelido, sem senha
  await expect(page.getByRole('heading', { name: 'Entrar só com apelido' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Já tenho conta' })).toBeVisible();
  await page.screenshot({ path: shots('01-entrar-apelido') });
  await page.getByLabel('Apelido').fill(NICK);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Servidores' })).toBeVisible({ timeout: 15_000 });
  // o app abre na linha do tempo de Novidades
  await expect(page.getByRole('heading', { name: 'Novidades', exact: true })).toBeVisible();
  await page.screenshot({ path: shots('02-home') });
  await page.getByRole('button', { name: 'OpenCord' }).first().click();
  await expect(page.getByRole('heading', { name: 'geral', exact: true })).toBeVisible();
  const text = `Olá do E2E ${Date.now()}`;
  await page.getByRole('textbox', { name: /Conversar em #geral/ }).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log').getByText(text)).toBeVisible({ timeout: 10_000 });
  // sem duplicata otimista após a confirmação
  await expect(page.getByRole('log').getByText(text)).toHaveCount(1, { timeout: 3_000 });
  await page.screenshot({ path: shots('03-chat') });
});

test('perfil: cartão abre por cima do chat e inteiro na janela (avatar da mensagem e lista de membros)', async () => {
  const check = async () => {
    const card = page.getByRole('dialog', { name: /^Perfil de / });
    await expect(card).toBeVisible();
    const ok = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      // o elemento visível no centro do cartão precisa ser o próprio cartão (nada por cima dele)
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 2));
      return { inside, onTop: Boolean(top && el.contains(top)) };
    });
    expect(ok).toEqual({ inside: true, onTop: true });
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
  };
  await page.getByRole('log').locator('.avatar-btn').last().click();
  await check();
  const memberRow = page.locator('.members .member-row').first();
  if (await memberRow.isVisible()) {
    await memberRow.click();
    await page.screenshot({ path: shots('07-perfil-membros') });
    await check();
  }
});

test('explorar: o oficial aparece verificado e há campo para convite', async () => {
  await page.getByRole('button', { name: 'Explorar servidores' }).click();
  const dialog = page.getByRole('dialog', { name: 'Explorar servidores' });
  await expect(dialog.getByText('OpenCord')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Servidor oficial verificado' }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abrir' }).first()).toBeVisible();
  await dialog.getByLabel('Código ou link do convite').fill('AAAAAAAAAA');
  await dialog.getByRole('button', { name: 'Ver convite' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('apelido já em uso é recusado com mensagem clara', async () => {
  const r = await fetch(`${API}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: NICK.toUpperCase() }),
  });
  expect(r.status).toBe(409);
});

test('captura: lista monitores e janelas com miniaturas', async () => {
  const sources = await page.evaluate(() =>
    (
      window as unknown as { opencord: { capture: { listSources(): Promise<{ kind: string; thumbnail: string }[]> } } }
    ).opencord.capture.listSources(),
  );
  expect(sources.filter((s) => s.kind === 'screen').length).toBeGreaterThan(0);
  expect(sources.every((s) => s.thumbnail.startsWith('data:image/png'))).toBe(true);
});

test('Ctrl+K: seletor rápido abre, filtra e navega para o canal', async () => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Ir para…' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('ger');
  await expect(dialog.getByRole('option').first()).toContainText('geral');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'geral', exact: true })).toBeVisible();
});

test('menu de contexto: botão direito na mensagem e navegação por teclado', async () => {
  const msg = page.getByRole('log').locator('article').last();
  await msg.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Ações da mensagem' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Responder' })).toBeVisible();
  await page.screenshot({ path: shots('05-context-menu') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('rail: item ativo tem pílula alta e tooltip aparece no hover', async () => {
  const active = page.locator('.rail-li[data-active="true"] .rail-pill').first();
  await expect.poll(async () => active.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Explorar servidores' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Explorar servidores');
});

test('seta para cima no composer vazio edita a última mensagem própria', async () => {
  const box = page.getByRole('textbox', { name: /Conversar em #geral/ });
  await box.click();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('textbox', { name: 'Editar mensagem' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('configurações abrem e trocam de aba por teclado', async () => {
  await page.getByRole('button', { name: 'Configurações do usuário' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tablist')).toBeVisible();
  await dialog.getByRole('tab').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  // tela cheia: ocupa a janela e fecha com Esc
  const box = await dialog.boundingBox();
  const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  expect(box?.width).toBeGreaterThanOrEqual(vp.width - 2);
  await expect(page.getByRole('button', { name: 'Fechar (Esc)' })).toBeVisible();
  // seletor próprio dentro do diálogo modal: a lista abre por cima e aceita clique (regressão top layer)
  await dialog.getByRole('tab', { name: 'Voz e vídeo' }).click();
  const combo = dialog.getByRole('combobox', { name: /Codec preferido/i });
  await combo.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await page.screenshot({ path: shots('06-select-aberto') });
  await listbox.getByRole('option', { name: 'VP9' }).click();
  await expect(combo).toContainText('VP9');
  // volta ao padrão para não afetar outros testes
  await combo.click();
  await page.getByRole('listbox').getByRole('option', { name: 'H.264' }).click();
  await expect(combo).toContainText('H.264');
  await page.screenshot({ path: shots('04-settings') });
  await page.keyboard.press('Escape');
});

test('barra de título: só os botões voltar/avançar ficam fora da área de arrastar', async () => {
  // relato real: à esquerda do título não arrastava (o contêiner "no-drag" ocupava toda a 1ª coluna)
  const nav = await page.locator('.titlebar-nav').boundingBox();
  const bar = await page.locator('.titlebar').boundingBox();
  expect(nav && bar).toBeTruthy();
  expect(nav!.width).toBeLessThan(80);
  expect(nav!.width).toBeLessThan(bar!.width / 10);
});

test('categoria recolhida esconde os canais (inclusive de voz) e expande de novo', async () => {
  await page.getByRole('button', { name: 'OpenCord' }).first().click();
  const toggle = page.locator('.cat-toggle').filter({ hasText: /voz/i });
  const sala = page.locator('.channel-row').filter({ hasText: 'Sala' });
  await expect(sala).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sala).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(sala).toBeVisible();
});

test('botão direito no espaço livre da lista de canais abre o menu da lista', async () => {
  // espaço livre logo abaixo da última categoria (o rodapé da lista fica sob o painel do usuário)
  const last = (await page.locator('.sidebar-scroll .cat').last().boundingBox())!;
  const box = { x: last.x, width: last.width, y: last.y + last.height + 24, height: 0 };
  await page.mouse.click(box.x + box.width / 2, box.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Opções da lista de canais' });
  await expect(menu).toBeVisible();
  // convidado (sem gerenciar canais) não vê "Criar canal"
  await expect(menu.getByRole('menuitem', { name: 'Criar canal' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Recolher todas as categorias' }).click();
  await expect(page.locator('.channel-row').filter({ hasText: 'Sala' })).toHaveCount(0);
  const lastCollapsed = (await page.locator('.sidebar-scroll .cat').last().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, lastCollapsed.y + lastCollapsed.height + 24, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Expandir todas as categorias' }).click();
  await expect(page.locator('.channel-row').filter({ hasText: 'Sala' })).toBeVisible();
});

test('criar servidor → importar do Discord: formulário, aviso do que vem e erro de link inválido', async () => {
  await page.getByRole('button', { name: 'Criar um servidor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar servidor' });
  await dialog.getByRole('tab', { name: 'Importar do Discord' }).click();
  await expect(dialog.getByText(/Mensagens, membros, emojis e arquivos não/)).toBeVisible();
  // link fora do padrão: a API recusa sem chamar o Discord
  await dialog.getByLabel('Link do modelo do servidor').fill('https://exemplo.invalido/abc');
  await dialog.getByRole('button', { name: 'Ver prévia' }).click();
  await expect(dialog.getByRole('alert')).toContainText('link de modelo inválido');
  await page.screenshot({ path: shots('05-importar-discord') });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Novidades: linha do tempo pelo item da página inicial', async () => {
  await page.getByRole('button', { name: 'Mensagens diretas' }).first().click();
  await page.getByRole('navigation', { name: 'Início' }).getByRole('button', { name: 'Novidades' }).click();
  await expect(page.getByRole('heading', { name: 'Novidades', exact: true })).toBeVisible();
  await expect(page.locator('.timeline-item').first()).toBeVisible();
  await page.screenshot({ path: shots('06-novidades') });
});

test('foto de perfil: envia em Minha conta, aparece no painel do usuário e pode ser removida', async () => {
  await page.getByRole('button', { name: 'Configurações do usuário' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('tab', { name: 'Minha conta' }).click();
  await dialog.getByLabel('Escolher foto de perfil').setInputFiles(path.join(__dirname, 'fixtures', 'avatar-azul.png'));
  await expect(dialog.getByRole('button', { name: 'Trocar foto' })).toBeVisible({ timeout: 10_000 });
  const img = dialog.locator('.avatar-picker .oc-avatar-img');
  await expect(img).toHaveAttribute('src', /\/avatars\/[0-9a-f-]{36}-(webp|png)$/);
  // a imagem carrega de verdade do servidor
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
  await page.screenshot({ path: shots('07-foto-perfil') });
  // GIF pequeno vai original (animado): a URL termina em -gif e a imagem carrega
  await dialog
    .getByLabel('Escolher foto de perfil')
    .setInputFiles(path.join(__dirname, 'fixtures', 'avatar-animado.gif'));
  await expect(img).toHaveAttribute('src', /-gif$/, { timeout: 10_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(32);
  await dialog.getByRole('button', { name: 'Remover' }).click();
  await expect(dialog.getByRole('button', { name: 'Enviar foto' })).toBeVisible();
  await expect(dialog.locator('.avatar-picker .oc-avatar-img')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

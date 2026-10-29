/**
 * E2E de voz/vídeo/Go Live com DUAS instâncias reais do app, dois usuários e a SFU LiveKit de dev.
 * Silencioso por construção: dispositivos falsos do Chromium e `--mute-audio` (nenhum som sai pelos alto-falantes).
 * Limitação: mesma máquina e mesma rede (não substitui o teste manual em dois PCs/redes distintas).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { joinVoice, joinWithNickname, json, launch, login, OWNER, shot, uniqueNick, writeTone, TONE } from './helpers';

let A: { app: ElectronApplication; page: Page };
let B: { app: ElectronApplication; page: Page };
let B_NICK = '';
let bobId = '';
let ownerToken: string;
let serverId: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  writeTone(TONE);
  const owner = await json<{ user: { id: string }; tokens: { accessToken: string } }>('POST', '/auth/login', {
    login: OWNER.email,
    password: OWNER.password,
  });
  ownerToken = owner.tokens.accessToken;
  const servers = await json<{ id: string; name: string }[]>('GET', '/servers', undefined, ownerToken);
  serverId = (servers.find((s) => s.name === 'OpenCord') ?? servers[0])!.id;
  B_NICK = uniqueNick('Bob');
  A = await launch('voice-a');
  B = await launch('voice-b');
  await login(A.page, OWNER.email, OWNER.password);
  // B entra só com apelido (fluxo padrão, sem conta)
  await joinWithNickname(B.page, B_NICK);
  const detail = await json<{ members: { user: { id: string; displayName: string } }[] }>(
    'GET',
    `/servers/${serverId}`,
    undefined,
    ownerToken,
  );
  bobId = detail.members.find((m) => m.user.displayName === B_NICK)?.user.id ?? '';
  expect(bobId).not.toBe('');
});

test.afterAll(async () => {
  await A?.app.close();
  await B?.app.close();
  // limpeza: remove o usuário de teste do servidor
  if (bobId)
    await json('DELETE', `/servers/${serverId}/members/${bobId}`, undefined, ownerToken).catch(() => undefined);
});

test('dois usuários entram na mesma sala e se veem; indicador de fala acende', async () => {
  const t0 = Date.now();
  await joinVoice(A.page);
  const joinMs = Date.now() - t0;
  await joinVoice(B.page);
  // cada um vê dois participantes no palco
  // outras pessoas reais podem estar na sala (ex.: o usuário testando): verificar pelos nomes, não pelo total
  await expect(A.page.locator('.stage-grid .tile').filter({ hasText: B_NICK })).toBeVisible({ timeout: 15_000 });
  await expect(B.page.locator('.stage-grid .tile').filter({ hasText: 'Proprietário' })).toBeVisible({
    timeout: 15_000,
  });
  // áudio de B chega de fato em A (bytes recebidos crescendo)
  const diag = () =>
    A.page.evaluate(() =>
      (
        window as unknown as {
          __opencordDiag: () => Promise<{ media: { remotes: { identity: string; bytesReceived: number | null }[] } }>;
        }
      ).__opencordDiag(),
    );
  const d1 = await diag();
  await A.page.waitForTimeout(2000);
  const d2 = await diag();
  console.warn(
    'DIAG',
    JSON.stringify({
      a: d2,
      b: await B.page.evaluate(() =>
        (window as unknown as { __opencordDiag: () => Promise<unknown> }).__opencordDiag(),
      ),
    }),
  );
  // supressão de ruído ligada por padrão: o microfone publica pela trilha do RNNoise
  const local = (d2 as unknown as { media: { local: { noiseFilter: string | null } } }).media.local;
  expect(local.noiseFilter).toBe('rnnoise');
  const bytes = (d: typeof d1) => d.media.remotes.find((r) => r.identity === bobId)?.bytesReceived ?? 0;
  expect(bytes(d2) - bytes(d1)).toBeGreaterThan(1000);
  // regressão: bytes chegavam mas ninguém anexava a trilha a um <audio>, então nada tocava (relato do usuário)
  const playing = (p: Page) =>
    p.evaluate(
      () =>
        [...document.querySelectorAll('audio')].filter(
          (el) =>
            !el.paused &&
            el.srcObject instanceof MediaStream &&
            el.srcObject.getAudioTracks().some((t) => t.readyState === 'live'),
        ).length,
    );
  await expect.poll(() => playing(A.page), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(() => playing(B.page), { timeout: 10_000 }).toBeGreaterThan(0);
  // o microfone falso gera um tom periódico: o indicador de fala de B deve acender em A
  await expect(A.page.locator('.tile[data-speaking="true"]').filter({ hasText: B_NICK })).toBeVisible({
    timeout: 20_000,
  });
  await A.page.screenshot({ path: shot('10-voice-two-users') });
  // regressão: participante novo aparece com o apelido na sidebar (não "Alguém")
  await expect(A.page.locator('.voice-member').filter({ hasText: B_NICK })).toBeVisible({ timeout: 10_000 });
  // pessoa na voz é clicável: clique abre o perfil (com "Em voz"); botão direito abre o menu de ações
  const bob = A.page.locator('.voice-member').filter({ hasText: B_NICK });
  await bob.click();
  const card = A.page.getByRole('dialog', { name: `Perfil de ${B_NICK}` });
  await expect(card).toBeVisible();
  await expect(card.getByText('Em voz')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Abrir chamada de voz' })).toBeVisible();
  await A.page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await bob.click({ button: 'right' });
  const menu = A.page.getByRole('menu', { name: 'Ações do membro' });
  await expect(menu.getByRole('menuitem', { name: 'Perfil' })).toBeVisible();
  await expect(menu.getByRole('slider')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Desconectar' })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /Silenciar voz no servidor/ })).toBeVisible();
  await A.page.screenshot({ path: shot('11-menu-pessoa-voz') });
  const mute = menu.getByRole('menuitemcheckbox', { name: /^Silenciar Só para você/ });
  await expect(mute).toHaveAttribute('aria-checked', 'false');
  await mute.click();
  await bob.click({ button: 'right' });
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Silenciar Só para você/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemcheckbox', { name: /^Silenciar Só para você/ }).click();

  // Cargos ›: submenu com os cargos do servidor; marcar aplica na hora (e o menu continua aberto)
  const role = await json<{ id: string }>(
    'POST',
    `/servers/${serverId}/roles`,
    { name: `Moderação E2E ${Date.now() % 10000}`, color: '#e74c3c', permissions: 0 },
    ownerToken,
  );
  try {
    await bob.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Cargos' }).hover();
    const roleItem = A.page
      .getByRole('menu', { name: 'Cargos' })
      .getByRole('menuitemcheckbox', { name: /Moderação E2E/ });
    await expect(roleItem).toHaveAttribute('aria-checked', 'false');
    await A.page.screenshot({ path: shot('18-menu-cargos') });
    await roleItem.click();
    await expect(roleItem).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => {
        const d = await json<{ members: { user: { id: string }; roleIds: string[] }[] }>(
          'GET',
          `/servers/${serverId}`,
          undefined,
          ownerToken,
        );
        return d.members.find((m) => m.user.id === bobId)?.roleIds ?? [];
      })
      .toContain(role.id);
    await roleItem.click();
    await expect(roleItem).toHaveAttribute('aria-checked', 'false');
    await A.page.keyboard.press('Escape');
  } finally {
    await json('DELETE', `/roles/${role.id}`, undefined, ownerToken).catch(() => undefined);
  }
  // regressão: o botão de tela cheia não pode ficar por cima do botão de sair (relato do usuário)
  const hang = await A.page.locator('.call-hangup').boundingBox();
  const full = await A.page.locator('.call-fullscreen').boundingBox();
  expect(hang && full).toBeTruthy();
  if (hang && full) {
    const overlap = !(
      full.x >= hang.x + hang.width ||
      full.x + full.width <= hang.x ||
      full.y >= hang.y + hang.height ||
      full.y + full.height <= hang.y
    );
    expect(overlap).toBe(false);
    expect(full.x).toBeGreaterThan(hang.x + hang.width);
  }
  // efeitos sonoros disparam (o processo está com --mute-audio: nada sai nos alto-falantes)
  const soundsA = await A.page.evaluate(() =>
    (window as unknown as { __opencordSounds: () => string[] }).__opencordSounds(),
  );
  console.warn('SOUNDS_A', JSON.stringify(soundsA));
  expect(soundsA).toEqual(expect.arrayContaining(['join', 'peerJoin']));
  // tela inicial (Amigos): card "Em atividade" com o canal, quem está nele e o botão para abrir a chamada
  await A.page.getByRole('button', { name: 'Mensagens diretas' }).first().click();
  // a coluna "Em atividade" só aparece em janelas largas
  await A.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1700, height: 900 }),
  );
  await A.page.getByRole('navigation', { name: 'Início' }).getByRole('button', { name: 'Amigos' }).click();
  const now = A.page.locator('.now-card').filter({ hasText: 'Sala' });
  await expect(now).toBeVisible({ timeout: 10_000 });
  await expect(now).toContainText(B_NICK);
  await A.page.screenshot({ path: shot('17-em-atividade') });
  await now.getByRole('button', { name: 'Abrir chamada' }).click();
  await expect(A.page.locator('.stage-grid, .stage-focus').first()).toBeVisible();
  await A.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1280, height: 800 }),
  );
  // o evento de resize chega depois; menus abertos fecham com resize: espera estabilizar
  await expect.poll(() => A.page.evaluate(() => window.outerWidth)).toBeLessThan(1400);
  await A.page.waitForTimeout(400);
  test.info().annotations.push({ type: 'join-ms', description: String(joinMs) });
});

test('dono: botão direito no espaço livre da lista oferece criar canal e categoria', async () => {
  // botão direito no próprio contêiner da lista (espaço livre, fora de canais/categorias)
  const list = (await A.page.locator('.sidebar-scroll').boundingBox())!;
  await A.page
    .locator('.sidebar-scroll')
    .dispatchEvent('contextmenu', { clientX: list.x + 40, clientY: list.y + list.height / 2, button: 2 });
  const menu = A.page.getByRole('menu', { name: 'Opções da lista de canais' });
  await expect(menu.getByRole('menuitem', { name: 'Criar canal' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Criar categoria' }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Criar categoria' });
  await expect(dialog.getByLabel('Nome da categoria')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
});

test('cartão de voz: status, 4 ações e atalhos funcionam', async () => {
  const dock = A.page.locator('.voice-dock');
  await expect(dock.getByText('Voz conectada')).toBeVisible();
  await expect(dock.locator('.dock-action')).toHaveCount(4);
  await dock.screenshot({ path: shot('13-cartao-voz') });
  const noise = dock.getByRole('button', { name: 'Supressão de ruído' });
  const before = await noise.getAttribute('aria-pressed');
  await noise.click();
  await expect(noise).not.toHaveAttribute('aria-pressed', before ?? 'true');
  await noise.click();
  await expect(noise).toHaveAttribute('aria-pressed', before ?? 'true');
  await dock.getByRole('button', { name: 'Configurações de voz' }).click();
  await expect(A.page.getByRole('dialog').getByRole('tab', { name: 'Voz e vídeo' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await A.page.keyboard.press('Escape');
});

test('mute é refletido para o outro participante', async () => {
  await B.page.locator('.dock').getByRole('button', { name: 'Silenciar microfone', exact: true }).click();
  await expect(
    A.page.locator('.tile').filter({ hasText: B_NICK }).getByRole('img', { name: 'Microfone desligado' }),
  ).toBeVisible({ timeout: 10_000 });
  await B.page.locator('.dock').getByRole('button', { name: 'Ativar microfone', exact: true }).click();
  expect(
    await B.page.evaluate(() => (window as unknown as { __opencordSounds: () => string[] }).__opencordSounds()),
  ).toEqual(expect.arrayContaining(['mute', 'unmute']));
  await expect(
    A.page.locator('.tile').filter({ hasText: B_NICK }).getByRole('img', { name: 'Microfone desligado' }),
  ).toHaveCount(0, { timeout: 10_000 });
});

test('câmera: B liga e A recebe vídeo', async () => {
  await B.page.locator('.dock').getByRole('button', { name: 'Câmera', exact: true }).click();
  const video = A.page.locator('.tile').filter({ hasText: B_NICK }).locator('video');
  await expect(video).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await B.page.locator('.dock').getByRole('button', { name: 'Câmera', exact: true }).click();
});

test('Go Live: A transmite a tela com áudio do sistema; B assiste; parar encerra para B', async () => {
  await A.page.locator('.dock').getByRole('button', { name: 'Transmitir', exact: true }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Transmitir' });
  await expect(dialog.getByRole('listbox').getByRole('option').first()).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('listbox').getByRole('option').first().hover();
  await A.page.screenshot({ path: shot('11-golive-picker') });
  // regressão (bugs visuais): miniaturas de tamanhos variados e nomes longos não deformam a grade
  const layout = await dialog.locator('.golive-grid').evaluate((grid) => {
    const g = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll('.golive-card')].map((c) => c.getBoundingClientRect());
    const thumbs = [...grid.querySelectorAll('.golive-thumb')].map((t) => Math.round(t.getBoundingClientRect().height));
    return {
      n: cards.length,
      widths: [...new Set(cards.map((c) => Math.round(c.width)))],
      thumbHeights: [...new Set(thumbs)],
      overflow: cards.some((c) => c.right > g.right + 1 || c.left < g.left - 1),
    };
  });
  console.warn('PICKER_LAYOUT', JSON.stringify(layout));
  expect(layout.widths.length).toBeLessThanOrEqual(1);
  expect(layout.thumbHeights.length).toBeLessThanOrEqual(1);
  expect(layout.overflow).toBe(false);
  await dialog.getByRole('tab', { name: 'Tela inteira' }).click();
  // um clique no card já inicia a transmissão
  await dialog.getByRole('listbox').getByRole('option').first().click();
  // `live` só após confirmação da SFU
  await expect(A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // estado derivado do webhook da SFU chega ao outro cliente (AO VIVO na sidebar)
  await expect(B.page.locator('.voice-member').filter({ hasText: 'Proprietário' }).locator('.live-pill')).toBeVisible({
    timeout: 15_000,
  });
  await B.page.getByRole('button', { name: 'Assistir', exact: true }).click();
  const v = B.page.locator('.tile-stream video');
  await expect
    .poll(async () => v.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  const streamInfo = await B.page.locator('.tile-stream .tile-label').innerText();
  expect(streamInfo).not.toContain('sem áudio');
  await B.page.screenshot({ path: shot('12-golive-watching') });
  // regressão (piscadas na live): mudanças na chamada (mute, fala) não podem reanexar/esvaziar o vídeo
  await v.evaluate((el: HTMLVideoElement & { __emptied?: number; __src?: MediaProvider | null }) => {
    el.__emptied = 0;
    el.__src = el.srcObject;
    el.addEventListener('emptied', () => (el.__emptied = (el.__emptied ?? 0) + 1));
  });
  const muteBtn = A.page.locator('.dock').getByRole('button', { name: /^(Silenciar|Ativar) microfone$/ });
  for (let i = 0; i < 4; i++) {
    await muteBtn.click();
    await A.page.waitForTimeout(600);
  }
  const flicker = await v.evaluate((el: HTMLVideoElement & { __emptied?: number; __src?: MediaProvider | null }) => ({
    emptied: el.__emptied,
    sameSource: el.srcObject === el.__src,
  }));
  expect(flicker).toEqual({ emptied: 0, sameSource: true });
  // métricas do publisher (encoder/fps) visíveis em A
  await expect(A.page.locator('.stream-stats')).toHaveAttribute('title', /Transmitindo \d+×\d+/, { timeout: 10_000 });
  const stats = (await A.page.locator('.stream-stats').getAttribute('title')) ?? '';
  test.info().annotations.push({ type: 'publisher-stats', description: stats });

  // os dois transmitindo (relato real): B abre a própria live, que vai para o destaque; a de A fica na faixa
  await B.page.locator('.dock').getByRole('button', { name: 'Transmitir', exact: true }).click();
  const bDialog = B.page.getByRole('dialog', { name: 'Transmitir' });
  await bDialog.getByRole('tab', { name: 'Tela inteira' }).click();
  await bDialog.getByRole('listbox').getByRole('option').first().click();
  await expect(B.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const aInStrip = B.page
    .locator('.stage-strip')
    .getByRole('button', { name: /Assistir a transmissão de Proprietário/ });
  await expect(aInStrip).toBeVisible({ timeout: 10_000 });
  await aInStrip.click();
  await expect(B.page.locator('.stage-header')).toContainText('Proprietário está transmitindo');
  // botão direito na live do amigo: volume da transmissão (só para mim)
  await B.page.locator('.tile-stream[data-large="true"]').click({ button: 'right' });
  const menu = B.page.getByRole('menu', { name: /Transmissão de Proprietário/ });
  await expect(menu.getByRole('slider')).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /Silenciar transmissão/ })).toBeVisible();
  await B.page.screenshot({ path: shot('16-menu-volume-live') });
  await menu.getByRole('menuitemcheckbox', { name: /Silenciar transmissão/ }).click();
  await B.page.locator('.tile-stream[data-large="true"]').click({ button: 'right' });
  await expect(menu.getByRole('menuitemcheckbox', { name: /Silenciar transmissão/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await B.page.keyboard.press('Escape');
  await B.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();

  await A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(B.page.locator('.tile-stream')).toHaveCount(0, { timeout: 15_000 });
});

test('Assistir juntos: A abre um vídeo por link, B entra, pausa sincroniza e encerrar some para os dois', async () => {
  // processo com --mute-audio: o vídeo toca mudo
  // botão "Atividades" abre o painel; o YouTube é uma das atividades
  await A.page.getByRole('button', { name: 'Atividades' }).click();
  const panel = A.page.getByRole('dialog', { name: 'Atividades' });
  await expect(panel).toBeVisible();
  await A.page.screenshot({ path: shot('14-atividades') });
  await panel.getByRole('button', { name: /YouTube/ }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Assistir juntos' });
  await dialog.getByLabel(/Link/).fill('https://youtu.be/jNQXAC9IVRw');
  await dialog.getByRole('button', { name: 'Assistir juntos' }).click();
  // A já entra assistindo, em destaque
  await expect(A.page.locator('.tile-activity[data-large="true"] iframe')).toBeVisible({ timeout: 15_000 });
  await expect(A.page.locator('.tile-activity iframe')).toHaveAttribute('src', /youtube\.com\/embed\/jNQXAC9IVRw/);
  // B: indicador na barra lateral e capa com "Assistir"
  await expect(B.page.locator('.activity-hint')).toBeVisible({ timeout: 10_000 });
  await B.page.locator('.tile-activity').getByRole('button', { name: 'Assistir', exact: true }).click();
  const bFrame = B.page.locator('.tile-activity iframe');
  await expect(bFrame).toBeVisible();
  // o player do YouTube responde ao nosso controle (postMessage funcionando no app): a duração aparece
  await expect(B.page.locator('.yt-time')).toContainText('/', { timeout: 30_000 });
  await B.page.screenshot({ path: shot('15-assistir-juntos') });
  // B não é o dono: não encerra nem troca o vídeo; pausa só para si e volta alcançando o dono
  await expect(B.page.getByRole('button', { name: 'Encerrar para todos' })).toHaveCount(0);
  await expect(B.page.getByRole('button', { name: 'Trocar vídeo' })).toHaveCount(0);
  await B.page.locator('.tile-activity').hover();
  await B.page.locator('.yt-bar').getByRole('button', { name: 'Pausar só para você' }).click();
  await expect(B.page.locator('.yt-bar').getByRole('button', { name: /Voltar a assistir/ })).toBeAttached();
  // o dono segue tocando
  await expect(A.page.locator('.yt-bar').getByRole('button', { name: 'Pausar para todos' })).toBeAttached();
  await B.page
    .locator('.yt-bar')
    .getByRole('button', { name: /Voltar a assistir/ })
    .click();
  await expect(B.page.locator('.yt-bar').getByRole('button', { name: 'Pausar só para você' })).toBeAttached();
  // A (dono) pausa para todos → B vê "Pausado por Proprietário"
  await A.page.locator('.tile-activity').hover();
  await A.page.locator('.yt-bar').getByRole('button', { name: 'Pausar para todos' }).click();
  await expect(B.page.locator('.yt-bar').getByRole('button', { name: 'Pausado por Proprietário' })).toBeAttached({
    timeout: 10_000,
  });
  // encerrar para todos
  await A.page.locator('.tile-activity').hover();
  await A.page.getByRole('button', { name: 'Encerrar para todos' }).click();
  await expect(A.page.locator('.tile-activity')).toHaveCount(0);
  await expect(B.page.locator('.tile-activity')).toHaveCount(0, { timeout: 10_000 });
  await expect(B.page.locator('.activity-hint')).toHaveCount(0);
});

test('fechar a janela vai para a bandeja e a chamada continua (P11)', async () => {
  await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await A.page.waitForTimeout(4000);
  const state = await A.app.evaluate(({ BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().length,
    visible: BrowserWindow.getAllWindows()[0]?.isVisible(),
  }));
  expect(state).toEqual({ windows: 1, visible: false });
  const diag = await A.page.evaluate(() =>
    (
      window as unknown as { __opencordDiag: () => Promise<{ machine: string; media: { remotes: unknown[] } }> }
    ).__opencordDiag(),
  );
  expect(diag.machine).toBe('connected');
  expect(diag.media.remotes.length).toBeGreaterThanOrEqual(1);
  // B continua vendo A na sala
  await expect(B.page.locator('.stage-grid .tile').filter({ hasText: 'Proprietário' })).toBeVisible();
  await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
});

test('kick revoga a voz de B ativamente', async () => {
  await json('DELETE', `/servers/${serverId}/members/${bobId}`, undefined, ownerToken);
  await expect(
    B.page.getByText(/removido do servidor|desconectado da chamada|removido da chamada/).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(A.page.locator('.stage-grid .tile').filter({ hasText: B_NICK })).toHaveCount(0, { timeout: 15_000 });
  await A.page.locator('.dock').getByRole('button', { name: 'Sair da chamada', exact: true }).click();
});

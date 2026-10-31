/**
 * E2E de voz/vídeo/Go Live com DUAS instâncias reais do app, dois usuários e a SFU LiveKit de dev.
 * Silencioso por construção: dispositivos falsos do Chromium e `--mute-audio` (nenhum som sai pelos alto-falantes).
 * Limitação: mesma máquina e mesma rede (não substitui o teste manual em dois PCs/redes distintas).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
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
  // hover no servidor: cartão com quem está em voz (avatares de A e B)
  await A.page
    .getByRole('navigation', { name: 'Servidores' })
    .getByRole('button', { name: /^OpenCord/ })
    .hover();
  const serverCard = A.page.getByRole('tooltip').locator('.server-card');
  await expect(serverCard.locator('.server-card-avatars .oc-avatar')).toHaveCount(2, { timeout: 5_000 });
  await expect(serverCard).toContainText('2 em voz');
  await A.page.screenshot({ path: shot('03a-cartao-servidor') });
  await A.page.mouse.move(800, 400);
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

test('imagem do servidor: dono envia e a barra de servidores dos dois mostra na hora', async () => {
  await A.page.locator('.server-name').click();
  const dialog = A.page.locator('dialog[open]');
  await dialog
    .getByLabel('Escolher imagem do servidor')
    .setInputFiles(path.join(__dirname, 'fixtures', 'avatar-azul.png'));
  await A.page
    .getByRole('dialog', { name: 'Recortar imagem do servidor' })
    .getByRole('button', { name: 'Aplicar' })
    .click();
  await expect(dialog.getByRole('button', { name: 'Trocar imagem' })).toBeVisible({ timeout: 10_000 });
  const railA = A.page.getByRole('navigation', { name: 'Servidores' }).getByRole('button', { name: /^OpenCord/ });
  const railB = B.page.getByRole('navigation', { name: 'Servidores' }).getByRole('button', { name: /^OpenCord/ });
  await expect(railA.locator('img.server-icon-img')).toHaveAttribute('src', /\/server-icons\//);
  await expect(railB.locator('img.server-icon-img')).toHaveAttribute('src', /\/server-icons\//, { timeout: 10_000 });
  await expect.poll(() => railB.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
  // regressão (imagem oval na barra): a imagem ocupa o botão quadrado de 48 px
  const box = await railB.locator('img').boundingBox();
  console.warn('RAIL_ICON', JSON.stringify(box));
  expect(Math.round(box!.width)).toBe(48);
  expect(Math.round(box!.height)).toBe(48);
  await A.page.screenshot({ path: shot('19-imagem-servidor') });
  await dialog.getByRole('button', { name: 'Remover' }).click();
  await expect(railB.locator('img')).toHaveCount(0, { timeout: 10_000 });
  await A.page.keyboard.press('Escape');
});

test('cartão de voz: status, supressão de ruído no topo e 4 ações (câmera, tela, atividades, efeitos)', async () => {
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
  // atividades pelo cartão: leva ao palco e abre o painel
  await dock.getByRole('button', { name: 'Atividades' }).click();
  await expect(A.page.getByRole('dialog', { name: 'Atividades' })).toBeVisible();
  await A.page.keyboard.press('Escape');
  await expect(A.page.getByRole('dialog', { name: 'Atividades' })).toHaveCount(0);
});

test('dispositivo de saída escolhido continua valendo ao entrar de novo na chamada (como ao reabrir o app)', async () => {
  // saídas reais da máquina (a flag de dispositivo falso só troca as entradas)
  const outs = await A.page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter(
        (d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications',
      )
      .map((d) => ({ id: d.deviceId, label: d.label })),
  );
  test.skip(outs.length === 0, 'máquina sem saída de áudio além da padrão');
  const target = outs[0]!;
  await A.page.getByRole('button', { name: 'Configurações do usuário' }).first().click();
  const settings = A.page.getByRole('dialog', { name: 'Configurações do usuário' });
  await settings.getByRole('tab', { name: 'Voz e vídeo' }).click();
  await settings.getByRole('combobox', { name: 'Dispositivo de saída' }).click();
  await A.page
    .getByRole('option', { name: new RegExp(target.label.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .first()
    .click();
  await A.page.keyboard.press('Escape');
  // sair e entrar de novo: sala e AudioContext novos (o caminho em que o LiveKit perdia a saída escolhida)
  await A.page.locator('.voice-dock').getByRole('button', { name: 'Sair da chamada' }).click();
  await joinVoice(A.page);
  const sink = () =>
    A.page.evaluate(async () => {
      const d =
        (await (
          window as unknown as { __opencordDiag: () => Promise<{ media?: { outputSink?: unknown } }> }
        ).__opencordDiag()) ?? {};
      return d.media?.outputSink ?? null;
    });
  await expect.poll(sink, { timeout: 10_000 }).toBe(target.id);
  // volta ao padrão para não afetar os outros testes
  await A.page.getByRole('button', { name: 'Configurações do usuário' }).first().click();
  await settings.getByRole('tab', { name: 'Voz e vídeo' }).click();
  await settings.getByRole('combobox', { name: 'Dispositivo de saída' }).click();
  await A.page.getByRole('option', { name: 'Padrão do sistema' }).click();
  await A.page.keyboard.press('Escape');
});

test('perfil completo e "adicionar amigos à conversa" a partir da pessoa na chamada', async () => {
  await A.page.locator('.voice-member').filter({ hasText: B_NICK }).first().click();
  await A.page.getByRole('button', { name: 'Perfil completo' }).click();
  const prof = A.page.getByRole('dialog', { name: `Perfil de ${B_NICK}` });
  await expect(prof.getByText('Membro desde')).toBeVisible({ timeout: 10_000 });
  await prof.getByRole('tab', { name: /servidor(es)? em comum/ }).click();
  await expect(prof.getByRole('button', { name: /OpenCord/ })).toBeVisible();
  await A.page.screenshot({ path: shot('15a-perfil-completo') });
  // Mensagem abre a DM; no topo, "adicionar amigos à conversa"
  await prof.getByRole('button', { name: 'Mensagem' }).click();
  await expect(prof).toHaveCount(0);
  await A.page.getByRole('button', { name: 'Adicionar amigos à conversa' }).click();
  const add = A.page.getByRole('dialog', { name: 'Adicionar amigos à conversa' });
  await expect(add.getByLabel('Buscar amigos')).toBeVisible();
  await add.getByRole('button', { name: 'Cancelar' }).click();
  // volta à chamada para os próximos testes (pelo cartão "Voz conectada")
  await A.page.locator('.voice-dock .voice-dock-where').click();
  await expect(A.page.locator('.stage-grid')).toBeVisible();
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
  // regressão: clique logo após trocar de aba (cards surgindo embaixo do cursor) não transmite nada
  await dialog.getByRole('tab', { name: 'Tela inteira' }).click();
  await dialog.getByRole('listbox').getByRole('option').first().click();
  await A.page.waitForTimeout(800);
  await expect(dialog).toBeVisible();
  await expect(A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toHaveCount(0);
  // depois de a lista assentar, o clique vale
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
  // prévia (ADR-0012): antes de assistir, B vê a miniatura enviada por A pela sala do LiveKit
  const preview = B.page.locator('.tile-stream .stream-preview');
  await expect(preview).toBeVisible({ timeout: 15_000 });
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
  await B.page.screenshot({ path: shot('12a-golive-preview') });
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
    await expect(A.page.locator('.golive-grid[aria-busy]')).toHaveCount(0, { timeout: 15_000 });
    await A.page.waitForTimeout(600);
  }
  const flicker = await v.evaluate((el: HTMLVideoElement & { __emptied?: number; __src?: MediaProvider | null }) => ({
    emptied: el.__emptied,
    sameSource: el.srcObject === el.__src,
  }));
  expect(flicker).toEqual({ emptied: 0, sameSource: true });
  // métricas do publisher (encoder/fps) visíveis em A
  await expect(A.page.locator('.stream-stats')).toHaveAttribute('data-tip', /Transmitindo \d+×\d+/, {
    timeout: 10_000,
  });
  const stats = (await A.page.locator('.stream-stats').getAttribute('data-tip')) ?? '';
  test.info().annotations.push({ type: 'publisher-stats', description: stats });

  // os dois transmitindo (relato real): B abre a própria live, que vai para o destaque; a de A fica na faixa
  await B.page.locator('.dock').getByRole('button', { name: 'Transmitir', exact: true }).click();
  const bDialog = B.page.getByRole('dialog', { name: 'Transmitir' });
  await bDialog.getByRole('tab', { name: 'Tela inteira' }).click();
  // trava contra clique acidental: cards só aceitam clique 0,5 s depois de aparecer/trocar de aba
  await expect(B.page.locator('.golive-grid[aria-busy]')).toHaveCount(0, { timeout: 15_000 });
  await B.page.waitForTimeout(600);
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
  // "Em atividade": a prévia da live de A (publicada na API) aparece na tela inicial; um clique volta à live em destaque
  await B.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1700, height: 900 }),
  );
  await B.page.getByRole('button', { name: 'Mensagens diretas' }).first().click();
  await B.page.getByRole('navigation', { name: 'Início' }).getByRole('button', { name: 'Amigos' }).click();
  const nowStream = B.page.locator('.now-stream').filter({ hasText: 'Proprietário' });
  await expect(nowStream.locator('img')).toBeVisible({ timeout: 15_000 });
  await B.page.screenshot({ path: shot('16a-em-atividade-previa') });
  await nowStream.click();
  await expect(B.page.locator('.stage-header')).toContainText('Proprietário está transmitindo', { timeout: 10_000 });
  await B.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();

  await A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(B.page.locator('.tile-stream')).toHaveCount(0, { timeout: 15_000 });
});

test('Efeitos sonoros: A envia um som pelo painel da chamada, toca e B ouve; aparece nas configurações do servidor', async () => {
  await A.page.locator('.voice-dock').getByRole('button', { name: 'Efeitos sonoros' }).click();
  const board = A.page.getByRole('dialog', { name: 'Efeitos sonoros' });
  await board.getByRole('button', { name: 'Adicionar som' }).click();
  const up = A.page.getByRole('dialog', { name: 'Enviar um som' });
  await up.getByLabel('Escolher arquivo de áudio').setInputFiles(path.join(__dirname, 'fixtures', 'efeito-curto.wav'));
  await expect(up.getByText('0.50 s')).toBeVisible();
  // nome único por execução: sons de rodadas anteriores continuam no servidor de teste
  const soundName = `Bip ${Date.now().toString(36).slice(-5)}`;
  await up.getByLabel('Nome do som').fill(soundName);
  await up.getByRole('button', { name: 'Enviar' }).click();
  await expect(up).toHaveCount(0, { timeout: 10_000 });
  const bip = board.getByRole('region', { name: 'OpenCord' }).getByRole('button', { name: `Tocar ${soundName}` });
  await expect(bip).toBeVisible();
  await A.page.screenshot({ path: shot('14c-efeitos-sonoros') });
  const heard = () =>
    B.page.evaluate(() => (window as unknown as { __opencordSoundsHeard: () => number }).__opencordSoundsHeard());
  const before = await heard();
  await bip.click();
  await expect.poll(heard, { timeout: 10_000 }).toBe(before + 1);
  await A.page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);
});

test('Música na chamada: A abre e vira DJ, B ouve; só o DJ controla, B pausa só para si', async () => {
  // processo com --mute-audio: toca mudo
  await A.page.locator('.call-controls').getByRole('button', { name: 'Atividades' }).click();
  await A.page
    .getByRole('dialog', { name: 'Atividades' })
    .getByRole('button', { name: /Música/ })
    .click();
  const playerA = A.page.getByRole('region', { name: 'Música da chamada' });
  await playerA.getByLabel(/Adicionar música/).fill('https://music.youtube.com/watch?v=jNQXAC9IVRw&si=x');
  await playerA.getByRole('button', { name: 'Adicionar' }).click();
  // A já ouve: player oficial visível no cartão
  await expect(playerA.locator('.music-video iframe')).toBeVisible({ timeout: 15_000 });
  // B vê o convite e entra
  const pillB = B.page.locator('.music-pill');
  await expect(pillB).toBeVisible({ timeout: 10_000 });
  await pillB.getByRole('button', { name: 'Ouvir' }).click();
  const playerB = B.page.getByRole('region', { name: 'Música da chamada' });
  await expect(playerB.locator('.music-video iframe')).toBeVisible();
  // A adiciona outra: a fila de B mostra 2
  await playerA.getByLabel(/Adicionar música/).fill('https://youtu.be/M7lc1UVf-VE');
  await playerA.getByRole('button', { name: 'Adicionar' }).click();
  await expect(playerB.getByRole('button', { name: /Fila \(2\)/ })).toBeVisible({ timeout: 10_000 });
  await A.page.screenshot({ path: shot('14b-musica') });
  // minimizar (só capa, nome e tempo): o player do YouTube é o MESMO elemento (a música não reinicia)
  await playerA.locator('.music-video iframe').evaluate((el) => (el.dataset.mark = 'antes'));
  await playerA.getByRole('button', { name: 'Minimizar o player' }).click();
  const mini = playerA.locator('.music-mini');
  await expect(mini).toBeVisible();
  await expect(mini.locator('img')).toBeVisible();
  await expect(mini).toContainText(/\d+:\d{2} \//);
  await expect(playerA.getByLabel(/Adicionar música/)).toHaveCount(0);
  expect(await playerA.locator('.music-video iframe').getAttribute('data-mark')).toBe('antes');
  await A.page.screenshot({ path: shot('14c-musica-minimizada') });
  await mini.click();
  await expect(playerA.getByLabel(/Adicionar música/)).toBeVisible();
  expect(await playerA.locator('.music-video iframe').getAttribute('data-mark')).toBe('antes');
  // sair do palco (outro canal) não desmonta o player: segue tocando, minimizado no canto; clicar volta à chamada
  await A.page.locator('.sidebar').getByRole('button', { name: /geral/ }).first().click();
  const away = A.page.locator('.music-player[data-away="true"]');
  await expect(away.locator('.music-mini')).toBeVisible();
  expect(await away.locator('.music-video iframe').getAttribute('data-mark')).toBe('antes');
  await away.locator('.music-mini').click();
  await expect(playerA.getByLabel(/Adicionar música/)).toBeVisible();
  expect(await playerA.locator('.music-video iframe').getAttribute('data-mark')).toBe('antes');
  // B ouve: vê quem é o DJ e o campo de adicionar à fila, mas não os controles do grupo; pausa só para si
  await expect(playerB.getByText(/^DJ: /)).toBeVisible();
  await expect(playerB.getByRole('button', { name: 'Pausar para todos' })).toHaveCount(0);
  await expect(playerB.getByLabel(/Adicionar música/)).toBeVisible();
  await expect(playerB.getByRole('button', { name: /Tirar .* da fila/ })).toHaveCount(0);
  await playerB.getByRole('button', { name: 'Pausar só para mim' }).click();
  await expect(playerB.getByRole('button', { name: 'Voltar ao vivo' })).toBeVisible();
  await expect(playerA.getByRole('button', { name: 'Pausar para todos' })).toBeVisible(); // A segue tocando
  // o DJ pausa para todos: A vê pausado
  await playerA.getByRole('button', { name: 'Pausar para todos' }).click();
  await expect(playerA.getByRole('button', { name: 'Tocar para todos' })).toBeVisible({ timeout: 10_000 });
  // encerrar some para os dois
  await playerA.getByRole('button', { name: 'Encerrar a música para todos' }).click();
  await expect(playerA).toHaveCount(0);
  await expect(B.page.locator('.music-player, .music-pill')).toHaveCount(0, { timeout: 10_000 });
});

test('Assistir juntos: A abre um vídeo por link, B entra, pausa sincroniza e encerrar some para os dois', async () => {
  // processo com --mute-audio: o vídeo toca mudo
  // botão "Atividades" abre o painel; o YouTube é uma das atividades
  await A.page.locator('.call-controls').getByRole('button', { name: 'Atividades' }).click();
  const panel = A.page.getByRole('dialog', { name: 'Atividades' });
  await expect(panel).toBeVisible();
  await A.page.screenshot({ path: shot('14-atividades') });
  await panel.getByRole('button', { name: /^Assistir juntos/ }).click();
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

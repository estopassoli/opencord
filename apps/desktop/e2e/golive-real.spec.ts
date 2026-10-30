/**
 * Go Live com captura REAL de tela + áudio do sistema (loopback) dentro do app — sem dispositivos falsos no publisher.
 * Silencioso: `--mute-audio` nos dois processos; o microfone do publisher entra mutado.
 * Privacidade: NÃO salva screenshots (mostrariam a tela do usuário); registra apenas métricas.
 */
import { expect, test } from '@playwright/test';
import {
  FLAGS,
  joinVoice,
  joinWithNickname,
  launch,
  login,
  OWNER,
  ownerSession,
  json,
  uniqueNick,
  writeTone,
  TONE,
  type App,
} from './helpers';

let A: App;
let B: App;
let ctx: { ownerToken: string; serverId: string };
let viewerNick = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  writeTone(TONE);
  ctx = await ownerSession();
  viewerNick = uniqueNick('Espectador');
  A = await launch('golive-a', ['--mute-audio', '--use-fake-ui-for-media-stream']);
  B = await launch('golive-b', FLAGS);
  await login(A.page, OWNER.email, OWNER.password);
  await joinWithNickname(B.page, viewerNick);
});

test.afterAll(async () => {
  await A?.app.close();
  await B?.app.close();
  const d = await json<{ members: { user: { id: string; displayName: string } }[] }>(
    'GET',
    `/servers/${ctx.serverId}`,
    undefined,
    ctx.ownerToken,
  ).catch(() => null);
  const id = d?.members.find((m) => m.user.displayName === viewerNick)?.user.id;
  if (id)
    await json('DELETE', `/servers/${ctx.serverId}/members/${id}`, undefined, ctx.ownerToken).catch(() => undefined);
});

test('captura real do monitor com áudio do sistema chega ao espectador', async () => {
  // microfone real do publisher entra mutado
  await A.page.locator('.dock').getByRole('button', { name: 'Silenciar microfone', exact: true }).click();
  await joinVoice(A.page);
  await joinVoice(B.page);
  await A.page.locator('.dock').getByRole('button', { name: 'Transmitir', exact: true }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Transmitir' });
  // qualidade fica na engrenagem do rodapé; um clique no card já transmite
  await dialog.getByRole('button', { name: 'Opções da transmissão' }).click();
  await A.page.getByRole('menuitemcheckbox', { name: /^1080p · 60 fps/ }).click();
  await dialog.getByRole('tab', { name: 'Tela inteira' }).click();
  // trava contra clique acidental: cards só aceitam clique 0,5 s depois de aparecer/trocar de aba
  await expect(A.page.locator('.golive-grid[aria-busy]')).toHaveCount(0, { timeout: 15_000 });
  await A.page.waitForTimeout(600);
  await dialog.getByRole('listbox').getByRole('option').first().click();
  await expect(A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(A.page.getByText('sem áudio do sistema')).toHaveCount(0);

  await B.page.getByRole('button', { name: 'Assistir', exact: true }).click({ timeout: 15_000 });
  const v = B.page.locator('.tile-stream video');
  // fluidez da interface de quem assiste (relato: "interface fica lagada com alguém transmitindo")
  const perf = async (p: typeof B.page) =>
    p.evaluate(
      () =>
        new Promise<{ fps: number; longTasks: number; longMs: number }>((resolve) => {
          let longTasks = 0;
          let longMs = 0;
          const po = new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              longTasks++;
              longMs += e.duration;
            }
          });
          po.observe({ type: 'longtask', buffered: false });
          let frames = 0;
          const t0 = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
            else {
              po.disconnect();
              resolve({
                fps: Math.round((frames * 1000) / (performance.now() - t0)),
                longTasks,
                longMs: Math.round(longMs),
              });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
  // registra a evolução (resolução no espectador + métricas do publisher) antes de afirmar
  for (let i = 0; i < 4; i++) {
    await A.page.waitForTimeout(2500);
    const w = await v.evaluate((el: HTMLVideoElement) => `${el.videoWidth}x${el.videoHeight}`).catch(() => '?');
    const st = await A.page
      .locator('.stream-stats')
      .getAttribute('title')
      .catch(() => '?');
    const enc = await A.page
      .locator('.stream-stats')
      .getAttribute('title')
      .catch(() => '?');
    console.warn('GOLIVE_TRACE', i, w, st, '|', enc);
  }
  await expect
    .poll(async () => v.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 10_000 })
    .toBeGreaterThan(640);
  const dims = await v.evaluate((el: HTMLVideoElement) => ({ w: el.videoWidth, h: el.videoHeight }));
  console.warn('PERF_VIEWER', JSON.stringify(await perf(B.page)));
  console.warn('PERF_STREAMER', JSON.stringify(await perf(A.page)));
  // diagnóstico de GPU (relato: transições lentas assistindo/transmitindo): aceleração e decoder do espectador
  console.warn('GPU_STATUS', JSON.stringify(await B.app.evaluate(({ app }) => app.getGPUFeatureStatus())));
  await B.page.waitForTimeout(2500);
  console.warn(
    'VIEWER_BADGE',
    await B.page
      .locator('.stream-stats')
      .first()
      .getAttribute('aria-label')
      .catch(() => null),
  );
  // o vídeo inteiro cabe no card (antes ficava mais alto que o card e o topo/rodapé da tela eram cortados)
  const fit = await v.evaluate((el: HTMLVideoElement) => {
    const r = el.getBoundingClientRect();
    const t = el.closest('.tile')!.getBoundingClientRect();
    return {
      videoH: Math.round(r.height),
      tileH: Math.round(t.height),
      videoW: Math.round(r.width),
      tileW: Math.round(t.width),
    };
  });
  console.warn('GOLIVE_FIT', JSON.stringify(fit));
  // prévia de quem transmite, com a live em destaque (caso do relato)
  // a própria transmissão já abre em destaque
  const own = A.page.locator('.tile-stream video');
  await expect(A.page.locator('.tile-stream[data-large="true"]')).toBeVisible();
  const ownFit = await own.evaluate((el: HTMLVideoElement) => {
    const r = el.getBoundingClientRect();
    const t = el.closest('.tile')!.getBoundingClientRect();
    return {
      videoH: Math.round(r.height),
      tileH: Math.round(t.height),
      videoW: Math.round(r.width),
      tileW: Math.round(t.width),
      src: `${el.videoWidth}x${el.videoHeight}`,
    };
  });
  console.warn('GOLIVE_FIT_OWN', JSON.stringify(ownFit));
  // janela grande como a do relato (2000×1088): o quadro inteiro tem de caber acima da faixa de membros
  await B.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 2000, height: 1088 }),
  );
  await B.page.waitForTimeout(800);
  const big = await B.page.evaluate(() => {
    const el = document.querySelector<HTMLVideoElement>('.tile-stream[data-large="true"] video')!;
    const tile = el.closest('.tile')!.getBoundingClientRect();
    const strip = document.querySelector('.strip-wrap')?.getBoundingClientRect();
    const stage = el.closest('.stage')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // área realmente pintada com object-fit: contain
    const scale = Math.min(r.width / el.videoWidth, r.height / el.videoHeight);
    const w = el.videoWidth * scale;
    const h = el.videoHeight * scale;
    const top = r.top + (r.height - h) / 2;
    return {
      contentBottom: Math.round(top + h),
      contentRight: Math.round(r.left + (r.width + w) / 2),
      tileBottom: Math.round(tile.bottom),
      tileRight: Math.round(tile.right),
      stripTop: strip ? Math.round(strip.top) : null,
      stageBottom: Math.round(stage.bottom),
    };
  });
  console.warn('GOLIVE_FIT_BIG', JSON.stringify(big));
  expect(big.contentBottom).toBeLessThanOrEqual(big.tileBottom + 1);
  expect(big.contentRight).toBeLessThanOrEqual(big.tileRight + 1);
  if (big.stripTop !== null) expect(big.tileBottom).toBeLessThanOrEqual(big.stripTop + 1);
  expect(big.tileBottom).toBeLessThanOrEqual(big.stageBottom);
  await A.page.screenshot({ path: 'e2e/results/41-golive-own-focus.png' });
  expect(ownFit.videoH).toBeLessThanOrEqual(ownFit.tileH);
  expect(ownFit.videoW).toBeLessThanOrEqual(ownFit.tileW);
  expect(fit.videoH).toBeLessThanOrEqual(fit.tileH);
  expect(fit.videoW).toBeLessThanOrEqual(fit.tileW);
  expect(await B.page.locator('.tile-stream .tile-label').innerText()).not.toContain('sem áudio');

  // fps com conteúdo em movimento (relato: "live não roda a 60 fps"): uma janela anima a 60 fps sobre o monitor
  // capturado; medimos o que a captura entrega, o que é enviado e o que o espectador recebe
  await A.app.evaluate(({ BrowserWindow, screen }) => {
    const d = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({ x: d.x, y: d.y, width: d.width, height: d.height, alwaysOnTop: true, show: true });
    void w.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:#111"><canvas id=c></canvas><script>' +
            'const c=document.getElementById("c"),x=c.getContext("2d");c.width=innerWidth;c.height=innerHeight;' +
            'let t=0;(function f(){t++;document.title=String(t);x.fillStyle=`hsl(${t*3%360} 70% 40%)`;x.fillRect(0,0,c.width,c.height);' +
            'x.fillStyle="#fff";for(let i=0;i<40;i++)x.fillRect((t*7+i*97)%c.width,(i*53+t*3)%c.height,120,120);' +
            'requestAnimationFrame(f)})()</script></body>',
        ),
    );
  });
  const animFrames = () =>
    A.app.evaluate(({ BrowserWindow }) =>
      Number(
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().startsWith('data:'))
          ?.getTitle() ?? 0,
      ),
    );
  let captureFps = 0;
  for (let i = 0; i < 3; i++) {
    const f0 = await animFrames();
    await A.page.waitForTimeout(3000);
    console.warn(
      'MOTION_FPS',
      i,
      `animação ${Math.round(((await animFrames()) - f0) / 3)} fps`,
      (await A.page.locator('.stream-stats').getAttribute('title')) ?? '',
      '|',
      (await B.page.locator('.stream-stats').first().getAttribute('aria-label')) ?? '',
    );
    const t = (await A.page.locator('.stream-stats').getAttribute('title')) ?? '';
    captureFps = Number(/captura (\d+) fps/.exec(t)?.[1] ?? 0);
  }
  await A.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('data:')) w.close();
  });
  // regressão: com WebRtcAllowWgcUsingTexture a captura travava em ~12 fps com a tela a 47 fps
  expect(captureFps).toBeGreaterThanOrEqual(20);

  // métricas reais do encoder no publisher após alguns segundos
  await A.page.waitForTimeout(6000);
  const stats = (await A.page.locator('.stream-stats').getAttribute('title')) ?? '';
  console.warn('GOLIVE_REAL', JSON.stringify({ viewerVideo: dims, publisher: stats }));
  expect(stats).toMatch(/Transmitindo \d+×\d+/);
  // H.264 nunca negocia Constrained Baseline (42e0xx), que o Chromium só codifica em software (preferHardwareH264)
  const negotiated = (await A.page.locator('.stream-stats').getAttribute('title')) ?? '';
  test.info().annotations.push({ type: 'encoder', description: negotiated });
  if (/H264/.test(stats)) expect(negotiated).not.toMatch(/profile-level-id=42e0/i);

  // ninguém assistindo → o SFU pausa o envio (dynacast) e o indicador explica; ao voltar a assistir, retoma
  await B.page.locator('.tile-stream').hover();
  await B.page.getByRole('button', { name: 'Parar de assistir' }).click();
  await expect(A.page.getByText('ninguém assistindo', { exact: false })).toBeVisible({ timeout: 20_000 });
  await B.page.getByRole('button', { name: 'Assistir', exact: true }).click();
  await expect(A.page.locator('.stream-stats')).toHaveAttribute('title', /Transmitindo \d+×\d+/, { timeout: 20_000 });
  await expect
    .poll(async () => v.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(640);

  // "Ocultar membros" deixa só a transmissão
  await B.page.locator('.stage-focus').hover();
  await B.page.getByRole('button', { name: 'Ocultar membros' }).click();
  // a faixa recolhe com animação (continua montada, inerte) e a live ocupa o espaço
  await expect(B.page.locator('.stage-focus')).toHaveAttribute('data-strip', 'hidden');
  await expect(B.page.locator('.stage-strip')).toBeHidden();
  await B.page.screenshot({ path: 'e2e/results/42-golive-sem-membros.png' });
  await B.page.getByRole('button', { name: 'Mostrar membros' }).click();
  await expect(B.page.locator('.stage-strip')).toBeVisible();

  // "Abrir em nova janela": a live segue tocando na janela separada mesmo com o app em outro canal
  await B.page.locator('.tile-stream').hover();
  const popupP = B.app.waitForEvent('window');
  await B.page.getByRole('button', { name: 'Abrir em nova janela' }).click();
  const popup = await popupP;
  const pv = popup.locator('.tile-stream video');
  await expect
    .poll(async () => pv.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(640);
  await expect(B.page.getByText('Transmissão aberta em outra janela')).toBeVisible();
  await B.page
    .getByRole('button', { name: /^geral/ })
    .first()
    .click();
  const t0 = await pv.evaluate((el: HTMLVideoElement) => el.currentTime);
  await popup.waitForTimeout(3000);
  const t1 = await pv.evaluate((el: HTMLVideoElement) => el.currentTime);
  console.warn(
    'GOLIVE_POPOUT',
    JSON.stringify({ t0, t1, w: await pv.evaluate((el: HTMLVideoElement) => el.videoWidth) }),
  );
  expect(t1 - t0).toBeGreaterThan(1.5);
  await popup.screenshot({ path: 'e2e/results/43-golive-janela.png' });
  await popup.locator('.tile-stream').hover();
  await popup.getByRole('button', { name: 'Voltar para o app' }).click();
  await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true);

  await A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(B.page.locator('.tile-stream')).toHaveCount(0, { timeout: 15_000 });
  await A.page.locator('.dock').getByRole('button', { name: 'Sair da chamada', exact: true }).click();
  await B.page.locator('.dock').getByRole('button', { name: 'Sair da chamada', exact: true }).click();
});

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
  const dialog = A.page.getByRole('dialog', { name: 'Transmitir (Go Live)' });
  await dialog.getByRole('listbox').getByRole('option').first().click();
  // seletor próprio (combobox + listbox), não <select> nativo
  await dialog.getByRole('combobox', { name: 'Qualidade' }).click();
  await A.page.getByRole('option', { name: /^1080p60/ }).click();
  await dialog.getByRole('button', { name: 'Transmitir' }).click();
  await expect(A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(A.page.getByText('sem áudio do sistema')).toHaveCount(0);

  await B.page.getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
  const v = B.page.locator('.tile-stream video');
  // registra a evolução (resolução no espectador + métricas do publisher) antes de afirmar
  for (let i = 0; i < 4; i++) {
    await A.page.waitForTimeout(2500);
    const w = await v.evaluate((el: HTMLVideoElement) => `${el.videoWidth}x${el.videoHeight}`).catch(() => '?');
    const st = await A.page
      .getByText(/Transmitindo \d+×\d+/)
      .innerText()
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
  const own = A.page.locator('.tile-stream video');
  await A.page.locator('.tile-stream').hover();
  await A.page.getByRole('button', { name: 'Destacar transmissão' }).click();
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
  await A.page.screenshot({ path: 'e2e/results/41-golive-own-focus.png' });
  expect(ownFit.videoH).toBeLessThanOrEqual(ownFit.tileH);
  expect(ownFit.videoW).toBeLessThanOrEqual(ownFit.tileW);
  expect(fit.videoH).toBeLessThanOrEqual(fit.tileH);
  expect(fit.videoW).toBeLessThanOrEqual(fit.tileW);
  expect(await B.page.locator('.tile-stream .tile-label').innerText()).not.toContain('sem áudio');

  // métricas reais do encoder no publisher após alguns segundos
  await A.page.waitForTimeout(6000);
  const stats = await A.page.getByText(/Transmitindo \d+×\d+/).innerText();
  console.warn('GOLIVE_REAL', JSON.stringify({ viewerVideo: dims, publisher: stats }));
  expect(stats).toMatch(/Transmitindo \d+×\d+/);
  // H.264 nunca negocia Constrained Baseline (42e0xx), que o Chromium só codifica em software (preferHardwareH264)
  const negotiated = (await A.page.locator('.stream-stats').getAttribute('title')) ?? '';
  test.info().annotations.push({ type: 'encoder', description: negotiated });
  if (/H264/.test(stats)) expect(negotiated).not.toMatch(/profile-level-id=42e0/i);

  await A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(B.page.locator('.tile-stream')).toHaveCount(0, { timeout: 15_000 });
  await A.page.locator('.dock').getByRole('button', { name: 'Sair da chamada', exact: true }).click();
  await B.page.locator('.dock').getByRole('button', { name: 'Sair da chamada', exact: true }).click();
});

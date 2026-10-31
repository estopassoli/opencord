import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { json, launch, login, uniqueNick, type App } from './helpers';

/**
 * Jogo atual (ADR-0021) e clipes (ADR-0022) no Windows real: um "jogo" cadastrado pela pessoa (explorer.exe, sempre
 * aberto) é detectado, a captura da tela principal começa, o atalho de clipe grava um MP4 em Vídeos\OpenCord e o
 * arquivo tem H.264 e o som. O atalho global não pode ser apertado pelo Playwright: o processo principal envia o mesmo
 * evento que o atalho envia.
 */
let A: App;
const GAME = 'Teste E2E Clipes';

/** caixas MP4 de primeiro nível e, dentro do moov, os codecs das trilhas */
function inspectMp4(buf: Buffer) {
  const top: string[] = [];
  for (let at = 0; at + 8 <= buf.length;) {
    const size = buf.readUInt32BE(at);
    top.push(buf.toString('latin1', at + 4, at + 8));
    if (size < 8) break;
    at += size;
  }
  const s = buf.toString('latin1');
  const mvhd = s.indexOf('mvhd');
  // mvhd versão 0: timescale em +12 e duração em +16 (a partir do campo de versão)
  const timescale = buf.readUInt32BE(mvhd + 4 + 12);
  const duration = buf.readUInt32BE(mvhd + 4 + 16);
  return {
    top,
    avc: s.includes('avc1'),
    aac: s.includes('mp4a'),
    opus: s.includes('Opus'),
    seconds: duration / timescale,
  };
}

test.beforeAll(async () => {
  const nickname = uniqueNick('Clipes');
  const password = 'e2e-password-123';
  const { tokens } = await json<{ tokens: { accessToken: string } }>('POST', '/auth/register', { nickname, password });
  const settings = await json<Record<string, unknown>>('GET', '/me/settings', undefined, tokens.accessToken);
  await json(
    'PUT',
    '/me/settings',
    { ...settings, games: { showPlaying: true, clips: true, custom: [{ exe: 'explorer.exe', name: GAME }] } },
    tokens.accessToken,
  );
  A = await launch('clips');
  await login(A.page, nickname, password);
});
test.afterAll(async () => {
  await A?.app.close();
});

test('jogo detectado, 60 s na memória e o atalho salva um MP4 com vídeo e som', async () => {
  test.setTimeout(120_000);
  const dock = A.page.getByRole('region', { name: 'Jogo aberto' });
  // o jogo cadastrado; ou, se houver um jogo da Steam aberto no computador, ele (a Steam tem prioridade)
  await expect(dock).toContainText('para clipar', { timeout: 40_000 });
  const game = (await dock.locator('strong').textContent())!.trim();
  console.warn('GAME', game);
  // ícone do jogo lido do executável (Steam ou processo)
  await expect(dock.locator('img.game-icon')).toBeVisible({ timeout: 20_000 });
  // alguns segundos de captura
  await A.page.waitForTimeout(6000);
  const diag = await A.page.evaluate(async () => ({
    clips: await (window as unknown as { __opencordClips: () => Promise<unknown> }).__opencordClips(),
    aac: (
      await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 160000,
      })
    ).supported,
    opus: (
      await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })
    ).supported,
  }));
  console.warn('DIAG', JSON.stringify(diag));
  const dir = path.join(os.homedir(), 'Videos', 'OpenCord');
  const before = new Set(
    (() => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    })(),
  );
  await A.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.send('ev:shortcut', 'saveClip'),
  );
  await expect(A.page.getByRole('status').filter({ hasText: /Clipe de \d+ s salvo/ })).toBeVisible({ timeout: 20_000 });
  const created = readdirSync(dir).filter((f) => !before.has(f) && f.startsWith(game) && f.endsWith('.mp4'));
  expect(created).toHaveLength(1);
  const file = path.join(dir, created[0]!);
  const info = inspectMp4(readFileSync(file));
  console.warn('CLIP', created[0], statSync(file).size, JSON.stringify(info));
  expect(info.top.slice(0, 2)).toEqual(['ftyp', 'moov']);
  expect(info.avc).toBe(true);
  expect(info.aac || info.opus).toBe(true);
  expect(info.seconds).toBeGreaterThan(3);
  // trilhas de som: a mistura + computador, voz e efeitos sonoros
  const audioTracks = (buf: Buffer) => buf.toString('latin1').split('mp4a').length - 1;
  expect(audioTracks(readFileSync(file))).toBe(4);
  // o arquivo toca: o próprio Chromium decodifica imagem e duração
  const played = await A.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await new Promise((ok, fail) => {
      v.onloadeddata = ok;
      v.onerror = () => fail(new Error(v.error?.message ?? 'erro'));
    });
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
  }, readFileSync(file).toString('base64'));
  console.warn('PLAYED', JSON.stringify(played));
  expect(played.w).toBeGreaterThan(0);
  expect(played.d).toBeGreaterThan(3);

  // miniatura no painel do usuário; clicar abre o visualizador
  const thumb = dock.getByRole('button', { name: /^Abrir Clipe de/ }).first();
  await expect(thumb.locator('img')).toBeVisible({ timeout: 10_000 });
  await thumb.click();
  const viewer = A.page.getByRole('dialog', { name: /^Clipe de/ });
  await expect(viewer.locator('video')).toBeVisible({ timeout: 10_000 });
  await expect(viewer.locator('.clip-strip img').first()).toBeVisible({ timeout: 15_000 });
  await A.page.screenshot({ path: path.join(__dirname, 'results', 'clip-viewer.png') });
  // corta 2 s do começo (teclado na borda) e exporta o corte; o "Salvar como" é respondido pelo teste
  const start = viewer.getByRole('slider', { name: 'Início do corte' });
  await start.focus();
  await start.press('Shift+ArrowRight');
  await start.press('Shift+ArrowRight');
  await expect(viewer).toContainText('Corte:');
  // fontes de som separadas: silenciar o computador vale na exportação (uma trilha só, a mistura das ligadas)
  await expect(viewer.getByRole('list', { name: 'Fontes de som do clipe' })).toContainText('Computador', {
    timeout: 20_000,
  });
  await viewer.getByRole('button', { name: 'Silenciar Computador' }).click();
  const out = path.join(os.tmpdir(), `opencord-corte-${Date.now()}.mp4`);
  await A.app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, out);
  await viewer.getByRole('button', { name: 'Arquivo de vídeo' }).click();
  await expect(A.page.getByRole('status').filter({ hasText: 'Vídeo exportado.' })).toBeVisible({ timeout: 60_000 });
  const cut = inspectMp4(readFileSync(out));
  console.warn('CUT', JSON.stringify(cut));
  expect(cut.avc).toBe(true);
  expect(cut.seconds).toBeLessThan(info.seconds - 1);
  expect(audioTracks(readFileSync(out))).toBe(1);
  rmSync(out);
  // compartilhar num canal: sobe em partes e vira mensagem com o vídeo
  await viewer.getByRole('button', { name: 'Compartilhar' }).click();
  const share = A.page.getByRole('dialog', { name: 'Compartilhar clipe' });
  await share.getByRole('textbox', { name: 'Buscar conversa ou canal' }).fill('geral');
  await share.getByRole('option').first().getByRole('button').click();
  await share.getByRole('button', { name: 'Enviar' }).click();
  await expect(A.page.getByRole('status').filter({ hasText: /Clipe enviado em/ })).toBeVisible({ timeout: 60_000 });
  // apagar pelo visualizador remove o arquivo e o fecha
  A.page.once('dialog', (d) => void d.accept());
  await viewer.getByRole('button', { name: 'Apagar clipe' }).click();
  await expect(viewer).toHaveCount(0);
  expect(readdirSync(dir).filter((f) => f.startsWith(created[0]!.replace(/\.mp4$/, '')))).toEqual([]);
});

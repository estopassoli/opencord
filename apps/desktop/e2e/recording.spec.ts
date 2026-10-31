import { expect, test } from '@playwright/test';
import {
  shot as shotPath,
  joinVoice,
  joinWithNickname,
  json,
  launch,
  OWNER,
  TONE,
  uniqueNick,
  writeTone,
  type App,
} from './helpers';

/**
 * Gravação da chamada (ADR-0023) no Windows real: A entra na chamada, grava ~10 s (selo GRAVANDO), para, e a
 * gravação pronta (24 h) baixa por link assinado como um MP4 fragmentado com H.264 e áudio que o Chromium toca.
 */
let A: App;
let ownerToken = '';
let channelId = '';

test.beforeAll(async () => {
  writeTone(TONE);
  const owner = await json<{ tokens: { accessToken: string } }>('POST', '/auth/login', {
    login: OWNER.email,
    password: OWNER.password,
  });
  ownerToken = owner.tokens.accessToken;
  const servers = await json<{ id: string; name: string }[]>('GET', '/servers', undefined, ownerToken);
  const serverId = (servers.find((s) => s.name === 'OpenCord') ?? servers[0])!.id;
  const detail = await json<{ channels: { id: string; name: string; kind: string }[] }>(
    'GET',
    `/servers/${serverId}`,
    undefined,
    ownerToken,
  );
  channelId = detail.channels.find((c) => c.kind === 'voice' && c.name === 'Sala')!.id;
  A = await launch('recording');
  await joinWithNickname(A.page, uniqueNick('Grava'));
});
test.afterAll(async () => {
  await A?.app.close();
});

test('grava a chamada, mostra GRAVANDO a todos e a gravação baixa e toca', async () => {
  test.setTimeout(150_000);
  await joinVoice(A.page);
  await A.page.getByRole('button', { name: 'Gravar a chamada' }).click();
  await A.page.getByRole('button', { name: 'Começar a gravar' }).click();
  await expect(A.page.locator('.rec-badge')).toContainText('GRAVANDO', { timeout: 15_000 });
  await A.page.waitForTimeout(10_000);
  await A.page.getByRole('button', { name: 'Parar de gravar' }).click();
  await expect(A.page.getByRole('status').filter({ hasText: 'Gravação encerrada' })).toBeVisible({ timeout: 30_000 });
  await expect(A.page.locator('.rec-badge')).toHaveCount(0);
  const listBtn = A.page.getByRole('button', { name: /^Gravações \(\d+\)$/ });
  await expect(listBtn).toBeVisible();
  // a lista abre por cima do palco (antes ficava atrás do card da transmissão)
  await listBtn.click();
  const popup = A.page.getByRole('dialog', { name: 'Gravações da chamada' });
  await expect(popup).toBeVisible();
  const top = await popup.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    let chain = '';
    for (let e: Element | null = hit; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      chain += ` < ${e.tagName.toLowerCase()}.${[...e.classList].join('.')}[z=${cs.zIndex},pos=${cs.position},ov=${cs.overflow}]`;
    }
    let mine = '';
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      mine += ` < ${e.tagName.toLowerCase()}.${[...e.classList].join('.')}[z=${cs.zIndex},pos=${cs.position},ov=${cs.overflow},cont=${cs.contain},tr=${cs.transform}]`;
    }
    return { ok: Boolean(hit && el.contains(hit)), chain, mine };
  });
  expect(top.ok).toBe(true);
  await A.page.screenshot({ path: shotPath('rec-lista') });
  await listBtn.click();

  const list = await json<{ ready: { id: string; durationMs: number; sizeBytes: number }[] }>(
    'GET',
    `/voice/channels/${channelId}/recordings`,
    undefined,
    ownerToken,
  );
  const rec = list.ready[0]!;
  console.warn('REC', JSON.stringify(rec));
  expect(rec.durationMs).toBeGreaterThan(8000);
  const { url } = await json<{ url: string }>('POST', `/recordings/${rec.id}/link`, undefined, ownerToken);
  const res = await fetch(url.replace(/^https?:\/\/[^/]+/, process.env.OPENCORD_API ?? 'http://localhost:3000'));
  expect(res.status).toBe(200);
  const buf = Buffer.from(await res.arrayBuffer());
  const s = buf.toString('latin1');
  console.warn(
    'MP4',
    buf.length,
    JSON.stringify({
      moof: s.includes('moof'),
      avc: s.includes('avc1'),
      aac: s.includes('mp4a'),
      opus: s.includes('Opus'),
    }),
  );
  expect(s.slice(4, 8)).toBe('ftyp');
  expect(s.includes('moof') && s.includes('avc1')).toBe(true);
  expect(s.includes('mp4a') || s.includes('Opus')).toBe(true);
  const played = await A.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await new Promise((ok, fail) => {
      v.onloadeddata = ok;
      v.onerror = () => fail(new Error(v.error?.message ?? 'erro'));
    });
    // vai ao fim para ler a duração real (MP4 fragmentado)
    v.currentTime = 1e6;
    await new Promise((ok) => setTimeout(ok, 500));
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration, end: v.currentTime };
  }, buf.toString('base64'));
  console.warn('PLAYED', JSON.stringify(played));
  expect(played.w).toBe(1920);
  expect(played.h).toBe(1080);
  expect(Math.max(played.end, Number.isFinite(played.d) ? played.d : 0)).toBeGreaterThan(7);
  // limpeza: apaga a gravação de teste
  await json('DELETE', `/recordings/${rec.id}`, undefined, ownerToken).catch(() => undefined);
});

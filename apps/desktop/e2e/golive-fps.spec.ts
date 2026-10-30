/**
 * Fluidez da live de 1080p60, etapa por etapa. Na tela de quem transmite roda um padrão determinístico a 60 quadros
 * distintos por segundo, com o número do quadro em 16 blocos (bits). Quem assiste lê esse número em cada quadro
 * apresentado (requestVideoFrameCallback), então contamos quadros DISTINTOS exibidos, não só decodificados.
 * Etapas medidas por diferença de contadores: conteúdo → captura → composição (cena) → codificação → envio →
 * recepção → decodificação/descarte → apresentação. Silencioso; sem screenshots (só métricas).
 */
import { expect, test, type Page } from '@playwright/test';
import { FLAGS, joinVoice, joinWithNickname, launch, login, OWNER, uniqueNick, type App } from './helpers';

let A: App;
let B: App;
/** processo só do padrão (faz o papel do jogo) */
let C: App;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // OC_FPS_ARGS: flags extras do Chromium em quem transmite (comparar caminhos de captura)
  const extra = (process.env.OC_FPS_ARGS ?? '').split(' ').filter(Boolean);
  A = await launch('golive-fps-a', ['--mute-audio', '--use-fake-ui-for-media-stream', ...extra]);
  B = await launch('golive-fps-b', [...FLAGS, ...(process.env.OC_FPS_B_ARGS ?? '').split(' ').filter(Boolean)]);
  for (const [n, x] of [
    ['A', A],
    ['B', B],
  ] as const)
    x.page.on('console', (m) => m.type() === 'error' && console.warn('PAGEERROR', n, m.text().slice(0, 900)));
  await login(A.page, OWNER.email, OWNER.password);
  await joinWithNickname(B.page, uniqueNick('Espectador'));
  C = await launch('golive-fps-c', ['--mute-audio']);
});

test.afterAll(async () => {
  await A?.app.close();
  await B?.app.close();
  await C?.app.close();
});

/**
 * Padrão: barras em movimento + círculo + 16 blocos com o número do quadro; troca de quadro a cada 1/60 s.
 * OC_FPS_HEAVY=1: o fundo vira uma textura detalhada (ruído em blocos de 2 px, determinístico) que se move e muda de
 * escala a cada quadro, perto de folhagem/grama de jogo; exige bem mais bitrate que as barras lisas.
 */
const HEAVY = process.env.OC_FPS_HEAVY === '1';
const PATTERN =
  '<body style="margin:0;overflow:hidden;background:#000"><canvas id=c></canvas><script>' +
  'const c=document.getElementById("c"),x=c.getContext("2d",{alpha:false});c.width=innerWidth;c.height=innerHeight;' +
  'const W=c.width,H=c.height;let n=0;const t0=performance.now();const heavy=' +
  String(HEAVY) +
  ';let tex=null;if(heavy){const tc=document.createElement("canvas");tc.width=tc.height=512;const tx=tc.getContext("2d");' +
  'let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;' +
  'for(let yy=0;yy<512;yy+=2)for(let xx=0;xx<512;xx+=2){tx.fillStyle=`hsl(${80+rnd()*60} ${40+rnd()*40}% ${15+rnd()*45}%)`;tx.fillRect(xx,yy,2,2);}' +
  'tex=x.createPattern(tc,"repeat");}' +
  '(function f(){const k=Math.floor((performance.now()-t0)/(1000/60));if(k!==n){n=k;document.title=String(n);' +
  'if(heavy){x.save();const sc=1+0.25*Math.sin(n/40);x.setTransform(sc,0,0,sc,-(n*7)%512,-(n*3)%512);x.fillStyle=tex;' +
  'x.fillRect(0,0,W/sc+1024,H/sc+1024);x.restore();}else{' +
  'for(let i=0;i<24;i++){x.fillStyle=`hsl(${(i*15+n*2)%360} 60% ${30+(i%3)*12}%)`;x.fillRect(((i*W/24+n*6)%W),0,W/24+1,H);}}' +
  'x.fillStyle="#fff";x.beginPath();x.arc((n*9)%W,H/2+Math.sin(n/20)*H/4,H/10,0,7);x.fill();' +
  'x.fillStyle="#808080";x.fillRect(0,0,W*0.52,H*0.1);' +
  'for(let b=0;b<16;b++){x.fillStyle=(n>>b)&1?"#fff":"#000";x.fillRect(W*(0.02+b*0.03),H*0.03,W*0.025,H*0.04);}}' +
  'requestAnimationFrame(f)})()</script></body>';

/** Abre o padrão em tela cheia num monitor (sem moldura, por cima de tudo). */
const openPattern = (app: App, d: Rect) =>
  app.app.evaluate(
    ({ BrowserWindow }, [html, b]) => {
      const w = new BrowserWindow({ ...b, frame: false, alwaysOnTop: true, show: true });
      void w.loadURL('data:text/html,' + encodeURIComponent(html));
    },
    [PATTERN, d] as const,
  );

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Monitor que a live está capturando de fato (pelo deviceId da trilha capturada, que é o id da fonte do
 * desktopCapturer) e um outro qualquer. A ordem do seletor não é a do Windows: com 3 monitores, "a primeira tela"
 * do seletor não era a primeira da lista do sistema, e o padrão ia para um monitor que a live não mostrava.
 */
const displays = async () => {
  const deviceId = String(((await pipeline(A.page))?.captureSettings as { deviceId?: string } | null)?.deviceId ?? '');
  return A.app.evaluate(async ({ desktopCapturer, screen }, id) => {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    const src = srcs.find((x) => x.id === id);
    const all = screen.getAllDisplays();
    const cap = all.find((d) => String(d.id) === src?.display_id) ?? null;
    const other = all.find((d) => d.id !== cap?.id) ?? null;
    return { deviceId: id, captured: cap?.bounds ?? null, other: other?.workArea ?? null };
  }, deviceId);
};

/**
 * O padrão roda em OUTRO processo (um terceiro app, só com ele), como um jogo: no mesmo processo de quem transmite ele
 * disputaria o processo de GPU com a captura e o codificador. OC_FPS_PATTERN=A para o caso no mesmo processo.
 */
const PATTERN_APP = () => (process.env.OC_FPS_PATTERN === 'A' ? A : C);

/** Número do quadro de cada janela do padrão (para o fps do conteúdo). */
const patternFrames = () =>
  PATTERN_APP().app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().startsWith('data:'))
      .map((w) => Number(w.getTitle()) || 0),
  );

type Pipe = Record<string, Record<string, number | string | null> | number | null>;
const pipeline = (p: Page) =>
  p.evaluate(async () => {
    const d = await (
      window as unknown as { __opencordDiag: () => Promise<{ media?: { pipeline?: unknown } }> }
    ).__opencordDiag();
    return (d?.media?.pipeline ?? null) as Pipe | null;
  });

/** No espectador: lê o número do quadro em cada quadro apresentado do vídeo da live. */
const installReader = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as { __fpsReader?: { presented: number; distinct: number; skipped: number } };
    const v = document.querySelector<HTMLVideoElement>('.tile-stream video');
    if (!v) return false;
    const r = { presented: 0, distinct: 0, skipped: 0, last: -1, sample: '' };
    w.__fpsReader = r;
    const cv = document.createElement('canvas');
    cv.width = 520;
    cv.height = 8;
    const cx = cv.getContext('2d', { willReadFrequently: true })!;
    const tick = () => {
      r.presented++;
      const W = v.videoWidth;
      const H = v.videoHeight;
      if (W && H) {
        // faixa dos blocos (y no meio deles) reduzida para 520×8: bloco b fica em x = (0.02+b*0.03+0.0125)/0.52*520
        cx.drawImage(v, 0, H * 0.045, W * 0.52, H * 0.01, 0, 0, 520, 8);
        const px = cx.getImageData(0, 4, 520, 1).data;
        let n = 0;
        for (let b = 0; b < 16; b++) {
          const xx = Math.round(((0.02 + b * 0.03 + 0.0125) / 0.52) * 520);
          if (px[xx * 4]! > 128) n |= 1 << b;
        }
        if (r.presented % 120 === 1)
          r.sample = Array.from(
            { length: 16 },
            (_, b) => px[Math.round(((0.02 + b * 0.03 + 0.0125) / 0.52) * 520) * 4],
          ).join(',');
        if (n !== r.last) {
          if (r.last >= 0) {
            const gap = (n - r.last + 65536) % 65536;
            if (gap > 1 && gap < 600) r.skipped += gap - 1;
          }
          r.distinct++;
          r.last = n;
        }
      }
      v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
    return true;
  });
const reader = (p: Page) =>
  p.evaluate(
    () =>
      (window as unknown as { __fpsReader?: { presented: number; distinct: number; skipped: number } }).__fpsReader ??
      null,
  );

const num = (o: unknown, k: string) => {
  const v = (o as Record<string, unknown> | null | undefined)?.[k];
  return typeof v === 'number' ? v : 0;
};

/**
 * Latência real de interação em quem transmite: cliques de verdade (Playwright) e o Event Timing do Chromium,
 * que mede do evento até a tela ser pintada de novo (inclui o atraso do compositor/GPU, não só o JavaScript).
 */
async function uiLatency(label: string) {
  await A.page.evaluate(() => {
    const w = window as unknown as { __evt: number[] };
    w.__evt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'pointerup' || e.name === 'click') w.__evt.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  const btn = A.page.locator('.dock').getByRole('button', { name: /^(Silenciar|Ativar) microfone$/ });
  for (let i = 0; i < 10; i++) {
    await btn.click();
    await A.page.waitForTimeout(250);
  }
  await A.page.waitForTimeout(500);
  const d = await A.page.evaluate(() => (window as unknown as { __evt: number[] }).__evt);
  const sorted = [...d].sort((a, b) => a - b);
  console.warn(
    'UI_LAT',
    label,
    JSON.stringify({
      slowEvents: d.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
    }),
  );
}

async function startLive(bitrate: string, scene: 'Sem cena' | 'Só a tela') {
  await A.page.locator('.dock').getByRole('button', { name: 'Transmitir', exact: true }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Transmitir' });
  await dialog.getByRole('button', { name: 'Opções da transmissão' }).click();
  await A.page.getByRole('menuitemcheckbox', { name: /^1080p · 60 fps/ }).click();
  await dialog.getByRole('button', { name: 'Opções da transmissão' }).click();
  await A.page.getByRole('menuitemcheckbox', { name: new RegExp(`^${bitrate} Mbps`) }).click();
  await dialog.getByRole('button', { name: /^Cena:/ }).click();
  await A.page.getByRole('menuitemcheckbox', { name: new RegExp(`^${scene}`) }).click();
  await dialog.getByRole('tab', { name: 'Tela inteira' }).click();
  await expect(A.page.locator('.golive-grid[aria-busy]')).toHaveCount(0, { timeout: 15_000 });
  await A.page.waitForTimeout(600);
  await dialog.getByRole('listbox').getByRole('option').first().click();
  await expect(A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // na segunda live quem assiste pode já estar assistindo (volta sozinho); só clica se o botão aparecer
  await B.page
    .getByRole('button', { name: 'Assistir', exact: true })
    .click({ timeout: 8_000 })
    .catch(() => undefined);
  await expect.poll(() => installReader(B.page), { timeout: 15_000 }).toBe(true);
}

async function stopLive() {
  await A.page.locator('.dock').getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(B.page.locator('.tile-stream')).toHaveCount(0, { timeout: 15_000 });
}

/** Mede uma janela de `secs` segundos e devolve as taxas por etapa (quadros/s). */
async function measure(label: string, secs: number) {
  const c0 = await patternFrames();
  const a0 = await pipeline(A.page);
  const b0 = await pipeline(B.page);
  const r0 = await reader(B.page);
  await A.page.waitForTimeout(secs * 1000);
  const c1 = await patternFrames();
  const a1 = await pipeline(A.page);
  const b1 = await pipeline(B.page);
  const r1 = await reader(B.page);
  const dt = (num(a1, 't') - num(a0, 't')) / 1000;
  const rate = (x0: unknown, x1: unknown, k: string) => Math.round(((num(x1, k) - num(x0, k)) / dt) * 10) / 10;
  const enc = num(a1?.outbound, 'framesEncoded') - num(a0?.outbound, 'framesEncoded') || 1;
  const dec = num(b1?.inbound, 'framesDecoded') - num(b0?.inbound, 'framesDecoded') || 1;
  const row = {
    label,
    content: c1.map((f, i) => Math.round(((f - (c0[i] ?? 0)) / dt) * 10) / 10),
    captureSettings: a1?.captureSettings,
    publishedSettings: a1?.publishedSettings,
    sender: a1?.sender,
    sourceFps: rate(a0?.source, a1?.source, 'frames'),
    compositorWritten: rate(a0?.compositor, a1?.compositor, 'written'),
    compositorScreenIn: rate(a0?.compositor, a1?.compositor, 'screenIn'),
    encoded: rate(a0?.outbound, a1?.outbound, 'framesEncoded'),
    sent: rate(a0?.outbound, a1?.outbound, 'framesSent'),
    encodeMsPerFrame:
      Math.round(((num(a1?.outbound, 'totalEncodeTime') - num(a0?.outbound, 'totalEncodeTime')) / enc) * 1000 * 10) /
      10,
    sentMbps: Math.round(((num(a1?.outbound, 'bytesSent') - num(a0?.outbound, 'bytesSent')) * 8) / dt / 1e5) / 10,
    targetMbps: Math.round(num(a1?.outbound, 'targetBitrate') / 1e5) / 10,
    availMbps: Math.round(num(a1?.uplink, 'availableOutgoingBitrate') / 1e5) / 10,
    limitation: (a1?.outbound as Record<string, unknown> | null)?.qualityLimitationReason,
    limitationDurations: (a1?.outbound as Record<string, unknown> | null)?.qualityLimitationDurations,
    sentRes: `${num(a1?.outbound, 'frameWidth')}x${num(a1?.outbound, 'frameHeight')}`,
    encoder: (a1?.outbound as Record<string, unknown> | null)?.encoderImplementation,
    codec: a1?.codec,
    received: rate(b0?.inbound, b1?.inbound, 'framesReceived'),
    decoded: rate(b0?.inbound, b1?.inbound, 'framesDecoded'),
    dropped: rate(b0?.inbound, b1?.inbound, 'framesDropped'),
    decodeMsPerFrame:
      Math.round(((num(b1?.inbound, 'totalDecodeTime') - num(b0?.inbound, 'totalDecodeTime')) / dec) * 1000 * 10) / 10,
    recvRes: `${num(b1?.inbound, 'frameWidth')}x${num(b1?.inbound, 'frameHeight')}`,
    lostPkts: num(b1?.inbound, 'packetsLost') - num(b0?.inbound, 'packetsLost'),
    jitterMs: Math.round(num(b1?.inbound, 'jitter') * 1000),
    freezes: num(b1?.inbound, 'freezeCount') - num(b0?.inbound, 'freezeCount'),
    rttMs: Math.round(num(a1?.uplink, 'currentRoundTripTime') * 1000),
    presented: r0 && r1 ? Math.round(((r1.presented - r0.presented) / dt) * 10) / 10 : null,
    distinct: r0 && r1 ? Math.round(((r1.distinct - r0.distinct) / dt) * 10) / 10 : null,
    skippedContent: r0 && r1 ? r1.skipped - r0.skipped : null,
    readerLast: (r1 as { last?: number } | null)?.last,
    readerSample: (r1 as { sample?: string } | null)?.sample,
  };
  // fluidez da interface de quem transmite: quadros desenhados por segundo, tarefas longas e atraso de timers
  const ui = await A.page.evaluate(
    () =>
      new Promise<{ rafFps: number; longTasks: number; longMs: number; maxLateMs: number }>((resolve) => {
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
        let maxLate = 0;
        let expected = performance.now() + 50;
        const id = setInterval(() => {
          maxLate = Math.max(maxLate, performance.now() - expected);
          expected = performance.now() + 50;
        }, 50);
        const t0 = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
          else {
            po.disconnect();
            clearInterval(id);
            resolve({
              rafFps: Math.round((frames * 1000) / (performance.now() - t0)),
              longTasks,
              longMs: Math.round(longMs),
              maxLateMs: Math.round(maxLate),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  const cpu = await A.app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .filter((m) => m.cpu.percentCPUUsage > 1)
      .map((m) => `${m.type}:${Math.round(m.cpu.percentCPUUsage)}%`)
      .join(' '),
  );
  console.warn('UI_A', label, JSON.stringify(ui), cpu);
  console.warn('FPS_ROW', JSON.stringify(row));
  return row;
}

test('1080p60: medição por etapa (direta e com cena, bitrates)', async () => {
  test.setTimeout(420_000);
  await A.page.locator('.dock').getByRole('button', { name: 'Silenciar microfone', exact: true }).click();
  await joinVoice(A.page);
  await joinVoice(B.page);
  await uiLatency('sem live');
  const rows = [];
  let patternOpen = false;
  // OC_FPS_PHASES="12:Sem cena,20:Só a tela" limita as fases (diagnóstico rápido)
  const all = [
    ['12', 'Sem cena'],
    ['20', 'Sem cena'],
    ['12', 'Só a tela'],
  ] as const;
  const phases = process.env.OC_FPS_PHASES
    ? all.filter(([b, sc]) => process.env.OC_FPS_PHASES!.split(',').includes(`${b}:${sc}`))
    : all;
  for (const [bitrate, scene] of phases) {
    await startLive(bitrate, scene);
    if (!patternOpen) {
      const disp = await displays();
      console.warn('DISPLAYS', JSON.stringify(disp));
      expect(disp.captured, 'monitor capturado identificado').toBeTruthy();
      await openPattern(PATTERN_APP(), disp.captured!);
      // quem assiste fica em outro monitor, descoberto (janela coberta tem a apresentação de vídeo estrangulada)
      if (disp.other)
        await B.app.evaluate(({ BrowserWindow }, r) => {
          const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('data:'));
          main?.setBounds(r);
        }, disp.other);
      patternOpen = true;
      const c0 = await patternFrames();
      await A.page.waitForTimeout(3000);
      const c1 = await patternFrames();
      console.warn('CONTENT', JSON.stringify(c1.map((f, i) => Math.round((f - (c0[i] ?? 0)) / 3))));
    }
    await A.page.waitForTimeout(8000);
    rows.push(await measure(`${scene} ${bitrate} Mbps`, 10));
    rows.push(await measure(`${scene} ${bitrate} Mbps (2)`, 10));
    await uiLatency(`live ${scene} ${bitrate} (vendo a própria live)`);
    if (rows.length === 2) {
      // mesma live, mas quem transmite olha um canal de texto (nenhum vídeo na tela)
      await A.page.getByRole('button', { name: /geral/ }).first().click();
      await A.page.waitForTimeout(1500);
      await uiLatency(`live ${scene} ${bitrate} (canal de texto)`);
      await A.page.getByRole('button', { name: 'Sala' }).first().click();
    }
    if (rows.length === 2) {
      // diagnóstico num clique (selo de quem assiste): mede 5 s e copia
      await B.app.evaluate(({ clipboard }) => clipboard.writeText(''));
      await B.page.locator('.stream-stats').first().click();
      await expect
        .poll(() => B.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 15_000 })
        .toContain('"decodedFps"');
      console.warn(
        'DIAG_COPIADO',
        (await B.app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\s+/g, ' '),
      );
    }
    await stopLive();
  }
  await PATTERN_APP().app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('data:')) w.close();
  });
  expect(rows.length).toBe(phases.length * 2);
});

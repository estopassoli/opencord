/**
 * Fluidez do hover na lista de canais (relato: "o hover não acompanha o cursor", sem live). Move o mouse de verdade
 * pela lista e grava um trace do Chromium (CDP) para somar o custo por etapa de renderização durante o movimento.
 */
import { expect, test } from '@playwright/test';
import { launch, login, OWNER, type App } from './helpers';

let A: App;

test.beforeAll(async () => {
  // OC_HOVER_ARGS: flags do Chromium para comparar caminhos gráficos (ex.: --disable-gpu)
  A = await launch('ui-hover', ['--mute-audio', ...(process.env.OC_HOVER_ARGS ?? '').split(' ').filter(Boolean)]);
  await login(A.page, OWNER.email, OWNER.password);
});
test.afterAll(async () => A?.app.close());

test('hover na lista de canais: custo por quadro', async () => {
  test.setTimeout(90_000);
  // OC_HOVER_DISPLAY=n: janela no monitor n (comparar taxas de atualização)
  if (process.env.OC_HOVER_DISPLAY) {
    const info = await A.app.evaluate(({ BrowserWindow, screen }, idx) => {
      const d = screen.getAllDisplays()[Number(idx)]!;
      BrowserWindow.getAllWindows()[0]!.setBounds({
        x: d.workArea.x + 50,
        y: d.workArea.y + 50,
        width: 1280,
        height: 800,
      });
      return `${d.bounds.width}x${d.bounds.height}@${d.displayFrequency}Hz`;
    }, process.env.OC_HOVER_DISPLAY);
    console.warn('HOVER_DISPLAY', info);
    await A.page.waitForTimeout(800);
  }
  // OC_HOVER_CSS: CSS extra para isolar o que pesa (diagnóstico)
  if (process.env.OC_HOVER_CSS) await A.page.addStyleTag({ content: process.env.OC_HOVER_CSS });
  await A.page.waitForTimeout(500);
  const rows = A.page.locator('.channel-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const n = Math.min(await rows.count(), 8);
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push(await rows.nth(i).boundingBox());
  // Event Timing: do evento de hover até a tela ser apresentada de novo (inclui compositor e GPU)
  await A.page.evaluate(() => {
    const w = window as unknown as { __hov: number[]; __hovAll: number };
    w.__hov = [];
    w.__hovAll = 0;
    document.addEventListener('pointerover', () => w.__hovAll++, true);
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'pointerover') w.__hov.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  const cdp = await A.page.context().newCDPSession(A.page);
  const events: {
    name: string;
    dur?: number;
    ph: string;
    ts: number;
    id?: string;
    id2?: { local?: string };
    cat?: string;
    args?: Record<string, unknown>;
  }[] = [];
  cdp.on('Tracing.dataCollected', (d: { value: typeof events }) => events.push(...d.value));
  const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink,benchmark,graphics.pipeline,viz,gpu,gpu.service,gpu.angle,skia,disabled-by-default-viz.gpu_compositor,disabled-by-default-gpu.service,disabled-by-default-gpu.dawn',
    transferMode: 'ReportEvents',
  });
  // vai e volta pela lista por ~3 s, como quem passeia o mouse pelos canais
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    for (const b of [...boxes, ...[...boxes].reverse()]) {
      if (!b) continue;
      await A.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    }
  }
  const anims = await A.page.evaluate(() =>
    document.getAnimations().map((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      const desc = t ? `${t.tagName.toLowerCase()}.${String(t.className).split(' ').slice(0, 2).join('.')}` : '?';
      const name = (a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName ?? a.constructor.name;
      return `${a.constructor.name}:${name}@${desc}`;
    }),
  );
  const count = new Map<string, number>();
  for (const k of anims) count.set(k, (count.get(k) ?? 0) + 1);
  console.warn('ANIMS_ATIVAS', JSON.stringify([...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)));
  await cdp.send('Tracing.end');
  await done;
  const sum = new Map<string, { ms: number; n: number; max: number }>();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const k = e.name;
    const cur = sum.get(k) ?? { ms: 0, n: 0, max: 0 };
    cur.ms += e.dur / 1000;
    cur.n++;
    cur.max = Math.max(cur.max, e.dur / 1000);
    sum.set(k, cur);
  }
  const top = [...sum.entries()]
    .filter(([k]) =>
      /^(UpdateLayoutTree|Layout|Paint|PrePaint|Layerize|Commit|FunctionCall|EventDispatch|RunTask|ParseHTML|HitTest|ProfileCall|v8\.callFunction|TimerFire|FireAnimationFrame|ScheduleStyleRecalculation|RasterTask|Rasterize|UpdateLayer|CompositeLayers|ProduceFrame|BeginMainThreadFrame|BeginFrame|DrawFrame|PaintImage|Decode Image)$/.test(
        k,
      ),
    )
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 16)
    .map(([k, v]) => `${k}: ${Math.round(v.ms)}ms total, ${v.n}x, máx ${Math.round(v.max * 10) / 10}ms`);
  await A.page.waitForTimeout(500);
  const hov = await A.page.evaluate(() => {
    const w = window as unknown as { __hov: number[]; __hovAll: number };
    const d = [...w.__hov].sort((a, b) => a - b);
    return {
      hovers: w.__hovAll,
      over16ms: d.length,
      median: d[Math.floor(d.length / 2)] ?? 0,
      p90: d[Math.floor(d.length * 0.9)] ?? 0,
      max: d.at(-1) ?? 0,
    };
  });
  console.warn(
    'HOVER_LAT',
    process.env.OC_HOVER_ARGS || '(padrão)',
    process.env.OC_HOVER_CSS ?? '',
    JSON.stringify(hov),
  );
  // etapas do pipeline de quadros (eventos assíncronos b/e do PipelineReporter e afins): média por etapa
  const open = new Map<string, number>();
  const stages = new Map<string, { ms: number; n: number }>();
  for (const e of events) {
    if (e.ph !== 'b' && e.ph !== 'e') continue;
    if (!/graphics\.pipeline|benchmark|viz/.test(e.cat ?? '')) continue;
    const key = `${e.name}|${e.id ?? e.id2?.local ?? ''}`;
    if (e.ph === 'b') open.set(key, e.ts);
    else {
      const t = open.get(key);
      if (t === undefined) continue;
      open.delete(key);
      const cur = stages.get(e.name) ?? { ms: 0, n: 0 };
      cur.ms += (e.ts - t) / 1000;
      cur.n++;
      stages.set(e.name, cur);
    }
  }
  console.warn(
    'PIPELINE',
    '\n' +
      [...stages.entries()]
        .filter(([, v]) => v.n > 5)
        .sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n)
        .slice(0, 25)
        .map(([k, v]) => `${k}: média ${Math.round((v.ms / v.n) * 10) / 10}ms (${v.n}x)`)
        .join('\n'),
  );
  // operações completas (X) de categorias de GPU/viz, por tempo total: onde o quadro passa os ~16 ms
  const gpuOps = new Map<string, { ms: number; n: number; max: number }>();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur || !/gpu|viz|skia|disabled-by-default-viz/.test(e.cat ?? '')) continue;
    const cur = gpuOps.get(e.name) ?? { ms: 0, n: 0, max: 0 };
    cur.ms += e.dur / 1000;
    cur.n++;
    cur.max = Math.max(cur.max, e.dur / 1000);
    gpuOps.set(e.name, cur);
  }
  console.warn(
    'GPU_OPS',
    '\n' +
      [...gpuOps.entries()]
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 25)
        .map(
          ([k, v]) =>
            `${k}: ${Math.round(v.ms)}ms total, ${v.n}x, média ${Math.round((v.ms / v.n) * 100) / 100}ms, máx ${Math.round(v.max * 10) / 10}ms`,
        )
        .join('\n'),
  );
  console.warn('HOVER_TRACE', `${(Date.now() - t0) / 1000}s`, '\n' + top.join('\n'));
  expect(top.length).toBeGreaterThan(0);
  // regressão: com a sobreposição nativa (titleBarOverlay) quase todo hover passava de 16 ms (mediana 64 ms)
  if (!process.env.OC_HOVER_ARGS && !process.env.OC_HOVER_CSS) {
    expect(hov.hovers).toBeGreaterThan(200);
    expect(hov.over16ms / Math.max(1, hov.hovers)).toBeLessThan(0.1);
  }
});

test('minimizar, maximizar/restaurar e fechar desenhados pelo app', async () => {
  const state = () =>
    A.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return { max: w.isMaximized(), min: w.isMinimized(), visible: w.isVisible() };
    });
  const bar = A.page.locator('.titlebar');
  await bar.getByRole('button', { name: 'Maximizar' }).click();
  await expect.poll(state).toMatchObject({ max: true });
  await bar.getByRole('button', { name: 'Restaurar' }).click();
  await expect.poll(state).toMatchObject({ max: false });
  await bar.getByRole('button', { name: 'Minimizar' }).click();
  await expect.poll(state).toMatchObject({ min: true });
  await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.restore());
  // fechar esconde na bandeja (o app segue rodando), como o botão nativo fazia
  await bar.getByRole('button', { name: 'Fechar' }).click();
  await expect.poll(state).toMatchObject({ visible: false });
});

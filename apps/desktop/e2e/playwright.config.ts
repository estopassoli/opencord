import { defineConfig } from '@playwright/test';

// E2E do Electron empacotado (pasta preparada por scripts/stage-windows.mjs). Requer API/LiveKit de dev rodando.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'results/report.json' }]],
  outputDir: 'results/artifacts',
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // caminhos relativos: o renderer empacotado é carregado via file:// pelo Electron
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, target: 'chrome140' },
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'], setupFiles: ['test/setup.ts'] },
});

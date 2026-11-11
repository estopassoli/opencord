import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));

/**
 * overlay.html: o MESMO HTML do overlay do Electron (apps/desktop/electron/main/overlay.ts), extraído no build. Lá o
 * estado chega por `window.overlay.onState` (preload); aqui por um evento do Tauri.
 */
function overlayPage(): Plugin {
  return {
    name: 'opencord-overlay-page',
    generateBundle() {
      const src = readFileSync(`${desktop}electron/main/overlay.ts`, 'utf8');
      const m = /const HTML = `([\s\S]*?)`;/.exec(src);
      if (!m?.[1]) throw new Error('HTML do overlay não encontrado em overlay.ts');
      const shim =
        '<script>window.overlay={onState:function(cb){var T=window.__TAURI__;T.event.listen("overlay:state",function(e){cb(e.payload)}).then(function(){return T.core.invoke("overlay_state")}).then(function(s){if(s)cb(s)})}}</script>';
      const html = m[1]
        // o IPC do Tauri no Windows vai por http://ipc.localhost
        .replace("default-src 'none';", "default-src 'none'; connect-src ipc: http://ipc.localhost;")
        .replace('</title>', `</title>${shim}`);
      this.emitFile({ type: 'asset', fileName: 'overlay.html', source: html });
    },
  };
}

export default defineConfig({
  plugins: [react(), overlayPage()],
  base: './',
  // a interface é a do app Electron: mesmos arquivos públicos e variáveis de ambiente
  publicDir: `${desktop}public`,
  envDir: desktop,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    rollupOptions: { input: { index: 'index.html', banner: 'banner.html' } },
  },
  server: { port: 5174, strictPort: true, fs: { allow: ['..', '../..'] } },
});

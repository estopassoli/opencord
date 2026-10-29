// Empacota main e preload em CommonJS (o preload com sandbox exige um único arquivo sem imports externos).
// Os PNGs do logotipo (resources/icons, gerados por scripts/make-icons.mjs) entram no main como data URL.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
  loader: { '.png': 'dataurl' },
};
await build({ ...common, entryPoints: ['electron/main/index.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload/index.ts'], outfile: 'dist-electron/preload.cjs' });

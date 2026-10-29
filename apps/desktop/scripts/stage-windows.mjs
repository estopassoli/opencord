// Copia o build (dist + dist-electron) para uma pasta no Windows, onde o Electron/electron-builder do Windows roda.
// Uso (WSL): node scripts/stage-windows.mjs [destino]   — padrão: %LOCALAPPDATA%/OpenCordDev/app
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const localAppData =
  process.env.WIN_LOCALAPPDATA ?? execSync('cmd.exe /c echo %LOCALAPPDATA%', { cwd: '/mnt/c' }).toString().trim();
const winPath = (p) => p.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
const dest = process.argv[2] ?? path.join(winPath(localAppData), 'OpenCordDev', 'app');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

mkdirSync(dest, { recursive: true });
for (const d of ['dist', 'dist-electron', 'build', 'resources'])
  rmSync(path.join(dest, d), { recursive: true, force: true });
cpSync('dist', path.join(dest, 'dist'), { recursive: true });
cpSync('dist-electron', path.join(dest, 'dist-electron'), { recursive: true });
cpSync('resources', path.join(dest, 'resources'), { recursive: true });
cpSync('electron-builder.yml', path.join(dest, 'electron-builder.yml'));
cpSync('e2e', path.join(dest, 'e2e'), { recursive: true });
writeFileSync(
  path.join(dest, 'package.json'),
  JSON.stringify(
    {
      name: 'opencord-desktop',
      productName: 'OpenCord',
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      main: 'dist-electron/main.cjs',
      private: true,
      scripts: {
        start: 'electron .',
        dist: 'electron-builder --win --config electron-builder.yml',
        e2e: 'playwright test -c e2e',
      },
      devDependencies: {
        electron: pkg.devDependencies.electron,
        'electron-builder': '26.17.0',
        '@playwright/test': '1.64.1',
      },
    },
    null,
    2,
  ),
);
console.log(`staged → ${dest}`);

// Modo dev no Windows (rodar no WSL): copia main/preload para a pasta do Windows e abre o Electron
// carregando a interface do Vite (http://localhost:5173) — salvar arquivos em src/ recarrega a interface na hora.
// Mudanças em electron/ (main/preload) exigem rodar este comando de novo.
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const devUrl = process.env.OPENCORD_DEV_URL ?? 'http://localhost:5173';
const localAppData = execSync('cmd.exe /c echo %LOCALAPPDATA%', { cwd: '/mnt/c' }).toString().trim();
const winDir = path.join(
  localAppData.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/'),
  'OpenCordDev',
  'app',
);
const electronExe = path.join(winDir, 'node_modules/electron/dist/electron.exe');
if (!existsSync(electronExe)) {
  console.error(
    'Electron não instalado no Windows. Rode antes: pnpm --filter @opencord/desktop build && pnpm --filter @opencord/desktop stage:win\n' +
      'e no Windows: cd %LOCALAPPDATA%\\OpenCordDev\\app && npm install && node node_modules\\electron\\install.js',
  );
  process.exit(1);
}
mkdirSync(path.join(winDir, 'dist-electron'), { recursive: true });
cpSync('dist-electron', path.join(winDir, 'dist-electron'), { recursive: true });

const ok = await fetch(devUrl).then(
  (r) => r.ok,
  () => false,
);
if (!ok) console.warn(`Aviso: ${devUrl} não respondeu. Inicie o Vite: pnpm --filter @opencord/desktop dev:renderer`);

console.log(`Abrindo Electron (Windows) com OPENCORD_DEV_URL=${devUrl} …`);
// perfil separado do app "normal" para não misturar sessões
spawn(
  'cmd.exe',
  [
    '/c',
    `cd /d %LOCALAPPDATA%\\OpenCordDev\\app && set OPENCORD_DEV_URL=${devUrl}&& node_modules\\electron\\dist\\electron.exe . --user-data-dir=%LOCALAPPDATA%\\OpenCordDev\\dev-profile`,
  ],
  {
    cwd: '/mnt/c',
    stdio: 'inherit',
  },
).on('exit', (code) => process.exit(code ?? 0));

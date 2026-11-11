// Compila o protótipo em Tauri no Windows a partir do WSL (como o dev:win do apps/desktop):
// 1. interface com o Vite (aqui no WSL) → dist/;
// 2. copia src-tauri, dist e os auxiliares nativos (oc-audio.exe, oc-input.exe) para %LOCALAPPDATA%\OpenCordTauri\src
//    (o cargo no Windows não compila direto de \\wsl$);
// 3. no Windows: `cargo build --release` (padrão) ou, com --bundle, o instalador NSIS pelo CLI do Tauri.
// Precisa no Windows: Rust (rustup, alvo x86_64-pc-windows-msvc) e Visual Studio Build Tools com o SDK do Windows.
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = process.argv.includes('--bundle');
const skipVite = process.argv.includes('--skip-vite');

// mesmo servidor embutido do app Electron publicado (desktop.yml)
const env = {
  ...process.env,
  VITE_OPENCORD_SERVER_URL: process.env.VITE_OPENCORD_SERVER_URL ?? 'https://api.opencord.pro',
};
if (!skipVite) execSync('pnpm exec vite build', { cwd: root, stdio: 'inherit', env });

const win = (cmd) => execFileSync('cmd.exe', ['/c', cmd], { cwd: '/mnt/c', encoding: 'utf8' }).trim();
const localAppData = win('echo %LOCALAPPDATA%');
const profile = win('echo %USERPROFILE%');
// TAURI_VARIANT=teste: cópia de teste (outra pasta, outro identificador e nome: dados e sessão separados do app de
// verdade), para testar contra um servidor local
const variant = process.env.TAURI_VARIANT ?? '';
const stageWin = `${localAppData}\\OpenCordTauri\\${variant || 'src'}`;
const stage = execFileSync('wslpath', ['-u', stageWin], { encoding: 'utf8' }).trim();

mkdirSync(stage, { recursive: true });
// o target/ fica no Windows entre uma compilação e outra (incremental)
cpSync(path.join(root, 'src-tauri'), path.join(stage, 'src-tauri'), {
  recursive: true,
  filter: (src) => !/[\\/](target|gen)([\\/]|$)/.test(src.slice(root.length)),
});
if (variant) {
  const confFile = path.join(stage, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(readFileSync(confFile, 'utf8'));
  conf.identifier = `org.opencord.tauri.${variant}`;
  conf.productName = `OpenCord ${variant}`;
  writeFileSync(confFile, JSON.stringify(conf, null, 2));
}
rmSync(path.join(stage, 'dist'), { recursive: true, force: true });
cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
mkdirSync(path.join(stage, 'resources'), { recursive: true });
// Go Live nativo (ADR-0062): o oc-live.exe é compilado à parte (native/oc-live, no Windows)
execFileSync('sh', [path.join(root, 'native/oc-live/build-win.sh')], { stdio: 'inherit' });
cpSync(`${path.dirname(stage)}/oc-live/target/release/oc-live.exe`, path.join(stage, 'resources', 'oc-live.exe'));
for (const exe of ['oc-audio.exe', 'oc-input.exe']) {
  const src = path.join(root, '../desktop/resources/win', exe);
  if (!existsSync(src)) throw new Error(`${src} não existe: rode antes o build do apps/desktop (build-win-audio.mjs)`);
  cpSync(src, path.join(stage, 'resources', exe));
}

const cargo = `${profile}\\.cargo\\bin\\cargo.exe`;
const run = bundle
  ? `set PATH=${profile}\\.cargo\\bin;%PATH%&& npx --yes @tauri-apps/cli@2 build`
  : `${cargo} build --release`;
execFileSync('cmd.exe', ['/c', `cd /d ${stageWin}\\src-tauri && ${run}`], { cwd: '/mnt/c', stdio: 'inherit' });

// sem o instalador, os auxiliares ficam ao lado do .exe (o app procura lá)
const out = path.join(stage, 'src-tauri', 'target', 'release');
for (const exe of ['oc-audio.exe', 'oc-input.exe', 'oc-live.exe'])
  cpSync(path.join(stage, 'resources', exe), path.join(out, exe));
console.log(`\nPronto: ${stageWin}\\src-tauri\\target\\release\\opencord-tauri.exe`);
if (bundle) console.log(`Instalador: ${stageWin}\\src-tauri\\target\\release\\bundle\\nsis\\`);

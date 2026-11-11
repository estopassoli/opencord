// Instalador do app em Tauri no Windows do CI (desktop.yml, ADR-0062), sem WSL:
//   node apps/desktop-tauri/scripts/build-ci.mjs <versão> <pasta de saída>
// 1. versão em package.json, tauri.conf.json e Cargo.toml (é por ela que o app instalado detecta a atualização);
// 2. interface com o Vite (VITE_OPENCORD_SERVER_URL do ambiente);
// 3. auxiliares nativos: oc-audio/oc-input (csc do .NET, build-win-audio.mjs) e oc-live (cargo);
// 4. `tauri build` (NSIS) e o instalador copiado como OpenCord-Setup-<versão>-x64.exe (mesmo padrão do Electron:
//    a API tira a versão do nome do arquivo).
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, outDir] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !outDir) {
  console.error('uso: build-ci.mjs <x.y.z> <pasta de saída>');
  process.exit(2);
}
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

// 1. versão
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.version = version;
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
const confFile = path.join(root, 'src-tauri/tauri.conf.json');
const conf = JSON.parse(readFileSync(confFile, 'utf8'));
conf.version = version;
writeFileSync(confFile, `${JSON.stringify(conf, null, 2)}\n`);
const cargoFile = path.join(root, 'src-tauri/Cargo.toml');
writeFileSync(cargoFile, readFileSync(cargoFile, 'utf8').replace(/^version = "[^"]*"/m, `version = "${version}"`));

// 2. interface
run('pnpm exec vite build');

// 3. auxiliares nativos
const resources = path.join(root, 'resources');
mkdirSync(resources, { recursive: true });
run('node scripts/build-win-audio.mjs', path.join(root, '../desktop'));
for (const exe of ['oc-audio.exe', 'oc-input.exe'])
  copyFileSync(path.join(root, '../desktop/resources/win', exe), path.join(resources, exe));
run('cargo build --release', path.join(root, 'native/oc-live'));
copyFileSync(path.join(root, 'native/oc-live/target/release/oc-live.exe'), path.join(resources, 'oc-live.exe'));

// 4. instalador
run('npx --yes @tauri-apps/cli@2 build --bundles nsis', path.join(root, 'src-tauri'));
const nsis = path.join(root, 'src-tauri/target/release/bundle/nsis');
const built = readdirSync(nsis).find((f) => f.endsWith('-setup.exe'));
if (!built) throw new Error(`instalador não encontrado em ${nsis}`);
mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(nsis, built), path.join(outDir, `OpenCord-Setup-${version}-x64.exe`));
console.log(`instalador: ${path.join(outDir, `OpenCord-Setup-${version}-x64.exe`)}`);

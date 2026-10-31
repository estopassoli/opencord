// Compila o native/win-audio/OcAudio.cs em resources/win/oc-audio.exe (ADR-0024) com o csc do .NET Framework 4, que
// vem em todo Windows. No Windows (CI e máquina de dev) roda direto; no WSL, pelo cmd.exe; em outros sistemas, pula
// (o app segue só com a captura do Chromium).
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const src = path.resolve('native/win-audio/OcAudio.cs');
const out = path.resolve('resources/win/oc-audio.exe');
const fresh = existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
const csc = (windir) => `${windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`;
const args = (o, s) => ['/nologo', '/optimize+', '/platform:x64', `/out:${o}`, s];

if (fresh) {
  console.log('oc-audio.exe em dia');
} else if (process.platform === 'win32') {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(csc(process.env.WINDIR ?? 'C:\\Windows'), args(out, src), { stdio: 'inherit' });
  console.log(`oc-audio.exe → ${out}`);
} else if (existsSync('/mnt/c/Windows/System32/cmd.exe')) {
  // WSL: compila numa pasta temporária do Windows e copia
  const tmp = execSync('cmd.exe /c echo %TEMP%', { cwd: '/mnt/c' }).toString().trim();
  const wsl = tmp.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  copyFileSync(src, path.join(wsl, 'OcAudio.cs'));
  execSync(`cmd.exe /c "cd /d ${tmp} && ${csc('C:\\Windows')} ${args('oc-audio.exe', 'OcAudio.cs').join(' ')}"`, {
    cwd: '/mnt/c',
    stdio: 'inherit',
  });
  mkdirSync(path.dirname(out), { recursive: true });
  copyFileSync(path.join(wsl, 'oc-audio.exe'), out);
  console.log(`oc-audio.exe → ${out}`);
} else {
  console.log('oc-audio.exe: só compila no Windows; pulando');
}

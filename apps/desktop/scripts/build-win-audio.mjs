// Compila os auxiliares nativos do Windows com o csc do .NET Framework 4, que vem em todo Windows:
// - native/win-audio/OcAudio.cs → resources/win/oc-audio.exe (som de cada saída e da live, ADR-0024/0025);
// - native/win-input/OcInput.cs → resources/win/oc-input.exe (mouse e teclado do controle remoto, ADR-0026).
// No Windows (CI e máquina de dev) roda direto; no WSL, pelo cmd.exe; em outros sistemas, pula (o app segue sem eles).
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HELPERS = [
  { src: 'native/win-audio/OcAudio.cs', out: 'oc-audio.exe' },
  { src: 'native/win-input/OcInput.cs', out: 'oc-input.exe' },
];
const csc = (windir) => `${windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`;
const args = (o, s) => ['/nologo', '/optimize+', '/platform:x64', `/out:${o}`, s];

for (const h of HELPERS) {
  const src = path.resolve(h.src);
  const out = path.resolve('resources/win', h.out);
  const fresh = existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
  if (fresh) {
    console.log(`${h.out} em dia`);
  } else if (process.platform === 'win32') {
    mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(csc(process.env.WINDIR ?? 'C:\\Windows'), args(out, src), { stdio: 'inherit' });
    console.log(`${h.out} → ${out}`);
  } else if (existsSync('/mnt/c/Windows/System32/cmd.exe')) {
    // WSL: compila numa pasta temporária do Windows e copia
    const tmp = execSync('cmd.exe /c echo %TEMP%', { cwd: '/mnt/c' }).toString().trim();
    const wsl = tmp.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
    const name = path.basename(src);
    copyFileSync(src, path.join(wsl, name));
    execSync(`cmd.exe /c "cd /d ${tmp} && ${csc('C:\\Windows')} ${args(h.out, name).join(' ')}"`, {
      cwd: '/mnt/c',
      stdio: 'inherit',
    });
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(path.join(wsl, h.out), out);
    console.log(`${h.out} → ${out}`);
  } else {
    console.log(`${h.out}: só compila no Windows; pulando`);
  }
}

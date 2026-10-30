/**
 * Preferências do aplicativo que precisam valer ANTES de a janela abrir (por isso não ficam nas configurações da
 * conta, que só chegam depois do login). Arquivo `app-prefs.json` na pasta de dados do usuário.
 */
import { app } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GpuMode, type AppPrefs } from '../shared/ipc';

const DEFAULTS: AppPrefs = { gpuMode: 'full' };
const file = () => path.join(app.getPath('userData'), 'app-prefs.json');

export function readAppPrefs(): AppPrefs {
  try {
    if (!existsSync(file())) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { gpuMode?: unknown; hardwareAcceleration?: unknown };
    const mode = GpuMode.safeParse(raw.gpuMode);
    if (mode.success) return { gpuMode: mode.data };
    // modo removido (tirava da placa a codificação e a decodificação das lives): volta ao padrão
    if (raw.gpuMode === 'ui-software') return { ...DEFAULTS };
    // formato antigo (só liga/desliga): desligada continua desligada
    return { gpuMode: raw.hardwareAcceleration === false ? 'off' : DEFAULTS.gpuMode };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeAppPrefs(prefs: AppPrefs) {
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs));
  renameSync(tmp, file());
}

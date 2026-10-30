/**
 * Preferências do aplicativo que precisam valer ANTES de a janela abrir (por isso não ficam nas configurações da
 * conta, que só chegam depois do login). Arquivo `app-prefs.json` na pasta de dados do usuário.
 */
import { app } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppPrefs } from '../shared/ipc';

const DEFAULTS: AppPrefs = { hardwareAcceleration: true };
const file = () => path.join(app.getPath('userData'), 'app-prefs.json');

export function readAppPrefs(): AppPrefs {
  try {
    if (!existsSync(file())) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppPrefs>;
    return {
      hardwareAcceleration:
        typeof raw.hardwareAcceleration === 'boolean' ? raw.hardwareAcceleration : DEFAULTS.hardwareAcceleration,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeAppPrefs(prefs: AppPrefs) {
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(prefs));
  renameSync(tmp, file());
}

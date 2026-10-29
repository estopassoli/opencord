/**
 * Armazenamento de segredos (refresh token) cifrado com DPAPI via safeStorage no Windows.
 * Se a cifragem não estiver disponível, NADA é persistido (sessão só em memória).
 */
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SecureKey } from '../shared/ipc';

const file = () => path.join(app.getPath('userData'), 'secure-store.json');
const memory = new Map<SecureKey, string>();

function load(): Record<string, string> {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, string>) {
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file());
}

export const secureAvailable = () => safeStorage.isEncryptionAvailable();

export function secureGet(key: SecureKey): string | null {
  if (!secureAvailable()) return memory.get(key) ?? null;
  const enc = load()[key];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

export function secureSet(key: SecureKey, value: string) {
  if (!secureAvailable()) {
    memory.set(key, value);
    return;
  }
  const data = load();
  data[key] = safeStorage.encryptString(value).toString('base64');
  save(data);
}

export function secureDelete(key: SecureKey) {
  memory.delete(key);
  const data = load();
  if (key in data) {
    delete data[key];
    save(data);
  }
}

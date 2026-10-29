import type { OpenCordBridge } from '../../electron/shared/ipc';

declare global {
  interface Window {
    opencord?: OpenCordBridge;
  }
}

/** Bridge do Electron; `null` quando o renderer roda no navegador (desenvolvimento/E2E web). */
export const bridge: OpenCordBridge | null = typeof window !== 'undefined' ? (window.opencord ?? null) : null;
export const isDesktop = bridge !== null;

/**
 * Persistência de segredos: safeStorage (DPAPI) no desktop; localStorage no navegador.
 * No navegador precisa sobreviver ao fechamento da aba: quem entra só com apelido perderia a identidade.
 */
export const secrets = {
  async get(key: 'session' | 'serverUrl'): Promise<string | null> {
    if (bridge) return bridge.secure.get(key);
    try {
      return localStorage.getItem(`oc:${key}`);
    } catch {
      return null;
    }
  },
  async set(key: 'session' | 'serverUrl', value: string): Promise<void> {
    if (bridge) return bridge.secure.set(key, value);
    try {
      localStorage.setItem(`oc:${key}`, value);
    } catch {
      /* armazenamento indisponível: sessão só em memória */
    }
  },
  async delete(key: 'session' | 'serverUrl'): Promise<void> {
    if (bridge) return bridge.secure.delete(key);
    try {
      localStorage.removeItem(`oc:${key}`);
    } catch {
      /* ignore */
    }
  },
};

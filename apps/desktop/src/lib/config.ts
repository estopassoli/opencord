/**
 * Endereço do servidor embutido no build (o usuário só escolhe o apelido).
 * Para distribuir aos amigos: `VITE_OPENCORD_SERVER_URL=https://chat.exemplo.com pnpm --filter @opencord/desktop build`.
 */
export const DEFAULT_SERVER_URL: string = import.meta.env.VITE_OPENCORD_SERVER_URL || 'http://localhost:3000';

/**
 * Teste contra um servidor remoto (pnpm dev:vidro): o endereço do build vence o salvo no perfil, que pode ser de outro
 * servidor (ex.: o localhost:3000 do dev normal no mesmo perfil do Electron).
 */
export const FORCED_SERVER_URL: string | null =
  import.meta.env.VITE_OPENCORD_FORCE_SERVER === '1' ? DEFAULT_SERVER_URL : null;

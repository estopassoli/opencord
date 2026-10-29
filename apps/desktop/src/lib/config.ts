/**
 * Endereço do servidor embutido no build (o usuário só escolhe o apelido).
 * Para distribuir aos amigos: `VITE_OPENCORD_SERVER_URL=https://chat.exemplo.com pnpm --filter @opencord/desktop build`.
 */
export const DEFAULT_SERVER_URL: string = import.meta.env.VITE_OPENCORD_SERVER_URL || 'http://localhost:3000';

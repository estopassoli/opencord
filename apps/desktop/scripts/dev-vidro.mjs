// Teste do layout Vidro contra o servidor de produção (ou outro remoto), sem deploy:
// sobe o proxy local (scripts/dev-remote-proxy.mjs) e o Vite em http://localhost:5174 com o layout Vidro.
// Abrir no navegador, ou no Electron (Windows) com perfil próprio:
//   OPENCORD_DEV_URL=http://localhost:5174 OPENCORD_DEV_PROFILE=vidro-profile pnpm dev:win
import { spawn } from 'node:child_process';

const proxyPort = process.env.PROXY_PORT ?? '5180';
const children = [
  spawn(process.execPath, ['scripts/dev-remote-proxy.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: proxyPort },
  }),
  spawn('pnpm', ['exec', 'vite', '--port', '5174'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_OPENCORD_SERVER_URL: `http://localhost:${proxyPort}`,
      VITE_OPENCORD_LAYOUT: 'vidro',
      VITE_OPENCORD_FORCE_SERVER: '1',
    },
  }),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children)
  c.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });

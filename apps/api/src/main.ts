import { createApp } from './bootstrap.js';
import { loadConfig } from './config/config.js';

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
console.warn(`OpenCord API ouvindo em http://${cfg.API_HOST}:${cfg.API_PORT}`);

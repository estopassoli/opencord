// Service worker do app no navegador (PWA, ADR-0035): gerado no build do Vite com a lista do que pré-cachear.
// Sem dependência nova: o worker é este texto com a versão e a lista preenchidas. O Electron nunca o registra.
import { createHash } from 'node:crypto';

/** Arquivos fixos (pasta public/) que entram no cache junto com a casca do app. */
export const STATIC_PRECACHE = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/**
 * O que pré-cachear a partir do bundle: a página, o chunk de entrada, o CSS dele e os chunks que ele importa de
 * forma estática (o resto dos assets com hash entra no cache ao ser usado).
 * @param {Record<string, { type: string; isEntry?: boolean; imports?: string[]; viteMetadata?: { importedCss?: Set<string> } }>} bundle
 */
export function precacheFromBundle(bundle) {
  const out = new Set(['./', './index.html', ...STATIC_PRECACHE]);
  for (const [name, chunk] of Object.entries(bundle)) {
    if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
    out.add(`./${name}`);
    for (const css of chunk.viteMetadata?.importedCss ?? []) out.add(`./${css}`);
    for (const dep of chunk.imports ?? []) out.add(`./${dep}`);
  }
  return [...out];
}

/** Versão do cache: muda sempre que qualquer arquivo do bundle muda de nome (hash de conteúdo). */
export function versionFromBundle(bundle) {
  return createHash('sha1').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
}

/**
 * Texto do service worker.
 * - navegação: rede primeiro, cai no index.html do cache (abrir o app sem rede mostra a casca com o aviso de conexão)
 * - assets com hash (./assets/*): cache primeiro, imutáveis
 * - demais arquivos da mesma origem (manifesto, ícones): rede primeiro, cache de reserva
 * - qualquer outra origem (API, LiveKit, imagens de servidores): nunca passa pelo cache
 * @param {{ version: string; precache: string[] }} opts
 */
export function buildServiceWorker({ version, precache }) {
  return `/* OpenCord — service worker gerado no build (versão ${version}) */
const CACHE = 'opencord-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => put(request, r))));
    return;
  }
  event.respondWith(fetch(request).then((r) => put(request, r)).catch(() => caches.match(request)));
});
`;
}

/** Plugin do Vite: escreve sw.js na raiz do build. */
export function pwaPlugin() {
  return {
    name: 'opencord-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorker({ version: versionFromBundle(bundle), precache: precacheFromBundle(bundle) }),
      });
    },
  };
}

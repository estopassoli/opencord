// Proxy local para testar a interface (Vite em localhost) contra um servidor remoto, sem mudar o CORS dele.
// A API só aceita origens da lista CORS_ORIGINS (ou sem Origin, como o app empacotado). Este proxy repassa REST e
// Socket.IO para o remoto sem o cabeçalho Origin e devolve CORS liberado para o navegador local.
// Uso: OPENCORD_REMOTE=https://api.opencord.pro PORT=5180 node scripts/dev-remote-proxy.mjs
// Só para desenvolvimento local: escuta em 127.0.0.1 e não guarda nada.
import http from 'node:http';
import https from 'node:https';

const remote = new URL(process.env.OPENCORD_REMOTE ?? 'https://api.opencord.pro');
const port = Number(process.env.PORT ?? 5180);
const client = remote.protocol === 'https:' ? https : http;
const ALLOW_HEADERS = 'Authorization, Content-Type, X-Device-Id, X-Hardware-Id';

function upstreamHeaders(req) {
  const h = { ...req.headers, host: remote.host };
  delete h.origin;
  delete h.referer;
  return h;
}

function cors(req) {
  return {
    'access-control-allow-origin': req.headers.origin ?? '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': ALLOW_HEADERS,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(req));
    return res.end();
  }
  const up = client.request(
    {
      protocol: remote.protocol,
      hostname: remote.hostname,
      port: remote.port || undefined,
      servername: remote.hostname,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(req),
    },
    (r) => {
      const headers = { ...r.headers };
      for (const k of Object.keys(headers)) if (k.startsWith('access-control-')) delete headers[k];
      res.writeHead(r.statusCode ?? 502, { ...headers, ...cors(req) });
      r.pipe(res);
    },
  );
  up.on('error', (err) => {
    console.error(`[proxy] ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain', ...cors(req) });
    res.end('Servidor remoto indisponível pelo proxy.');
  });
  req.pipe(up);
});

// WebSocket (Socket.IO): repassa o upgrade e liga os dois sockets
server.on('upgrade', (req, socket, head) => {
  const up = client.request({
    protocol: remote.protocol,
    hostname: remote.hostname,
    port: remote.port || undefined,
    servername: remote.hostname,
    method: req.method,
    path: req.url,
    headers: upstreamHeaders(req),
  });
  up.on('upgrade', (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${r.statusCode} ${r.statusMessage}`];
    for (let i = 0; i < r.rawHeaders.length; i += 2) lines.push(`${r.rawHeaders[i]}: ${r.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    upSocket.on('error', () => socket.destroy());
    socket.on('error', () => upSocket.destroy());
  });
  up.on('response', (r) => {
    socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`);
  });
  up.on('error', (err) => {
    console.error(`[proxy] websocket ${req.url}: ${err.message}`);
    socket.destroy();
  });
  up.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Proxy pronto: http://localhost:${port} → ${remote.origin}`);
});

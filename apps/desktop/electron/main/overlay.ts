/**
 * Overlay no jogo (ADR-0027): janela transparente, sempre no topo e que deixa o clique passar, no canto do monitor
 * principal. Mostra quem está na chamada (quem fala acende), o meu mudo/surdo e avisos curtos (clipe salvo, pedido de
 * controle remoto). A janela principal manda o estado; aqui só se posiciona, mostra/esconde e repassa. Jogos em tela
 * cheia exclusiva ficam por cima dela (limitação do Windows); em janela sem borda funciona.
 */
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { OverlayCorner, OverlayState } from '../shared/overlay';

const WIDTH = 340;
const HEIGHT = 420;
const MARGIN = 12;

let win: BrowserWindow | null = null;
let corner: OverlayCorner | null = null;

function place(c: OverlayCorner) {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const x = c === 'tl' || c === 'bl' ? workArea.x + MARGIN : workArea.x + workArea.width - WIDTH - MARGIN;
  const y = c === 'tl' || c === 'tr' ? workArea.y + MARGIN : workArea.y + workArea.height - HEIGHT - MARGIN;
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
  corner = c;
}

function create() {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true);
  w.setVisibleOnAllWorkspaces(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  w.on('closed', () => {
    if (win === w) win = null;
  });
  return w;
}

export function updateOverlay(s: OverlayState) {
  if (!s.visible) {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    return;
  }
  if (!win || win.isDestroyed()) {
    win = create();
    win.webContents.once('did-finish-load', () => updateOverlay(s));
    return;
  }
  if (corner !== s.corner) place(s.corner);
  win.webContents.send('overlay:state', { ...s, bottom: s.corner === 'bl' || s.corner === 'br' });
  if (!win.isVisible()) win.showInactive();
}

export function destroyOverlay() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

// fundo translúcido (o jogo aparece por trás) e texto com sombra para ler sobre qualquer cena; nada de HTML montado
// com texto: nomes, fotos e cores entram por textContent/atributos, e a CSP só deixa carregar imagens http(s)
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>OpenCord overlay</title><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:13px/1.25 "Segoe UI",system-ui,sans-serif;
    color:#f2f3f5;user-select:none}
  body{display:flex;flex-direction:column;gap:6px;padding:0;box-sizing:border-box}
  body.bottom{justify-content:flex-end}
  .card{background:rgba(12,13,16,.5);border-radius:10px;padding:6px 8px;text-shadow:0 1px 2px rgba(0,0,0,.85);
    -webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px)}
  .head{display:flex;align-items:center;gap:6px;font-size:12px;color:#d6d9de;margin:0 0 4px}
  .head b{color:#f2f3f5;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .time{color:#3fb27f;font-weight:700;font-variant-numeric:tabular-nums}
  .badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;
    box-sizing:border-box;border-radius:9px;background:rgba(218,55,60,.85);color:#fff;font-size:10px;font-weight:700;
    text-shadow:none}
  .p{display:flex;align-items:center;gap:7px;padding:2px 0}
  .av{position:relative;flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
    font-size:9px;font-weight:700;color:#fff;overflow:hidden;box-shadow:0 0 0 2px transparent;transition:box-shadow .12s}
  .av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .p.speaking .av{box-shadow:0 0 0 2px #3fb27f}
  .p .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
  .p.muted .n{opacity:.7}
  .m{font-size:10px;color:#ff6b6f;font-weight:700}
  .notice{background:rgba(12,13,16,.5);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);border-left:3px solid #4d56fd;border-radius:8px;padding:6px 10px;
    text-shadow:0 1px 2px rgba(0,0,0,.85);animation:in .15s ease-out}
  .notice.error{border-left-color:#da373c}.notice.success{border-left-color:#3fb27f}
  @keyframes in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.notice{animation:none}.av{transition:none}}
</style></head><body><div id="call"></div><div id="notices"></div><script>
  const PALETTE = ['#4d56fd','#7a4fd1','#b4542c','#2d6cb5','#8a6d12','#a3376b','#3f7d3a','#5b5f6b'];
  const colorOf = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const ini = (n) => { const p = n.trim().split(/\\s+/).filter(Boolean); return (p.length > 1 ? (p[0][0] || '') + (p[1][0] || '') : (p[0] || '?').slice(0, 2)).toUpperCase(); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0'), x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + m + ':' + x : m + ':' + x; };
  let startedAt = null;
  const tick = () => { const t = document.getElementById('time'); if (t && startedAt) t.textContent = fmt(Date.now() - startedAt); };
  setInterval(tick, 1000);
  window.overlay.onState((s) => {
    document.body.classList.toggle('bottom', !!s.bottom);
    const call = document.getElementById('call');
    const notices = document.getElementById('notices');
    call.replaceChildren();
    startedAt = s.call ? s.call.startedAt : null;
    if (s.call) {
      const card = el('div', 'card');
      const head = el('div', 'head');
      head.append(el('b', null, s.call.channel));
      if (startedAt) { const t = el('span', 'time'); t.id = 'time'; head.append(t); }
      if (s.call.muted) head.append(el('span', 'badge', 'mudo'));
      if (s.call.deafened) head.append(el('span', 'badge', 'surdo'));
      card.append(head);
      for (const p of s.call.people) {
        const row = el('div', 'p' + (p.speaking ? ' speaking' : '') + (p.muted ? ' muted' : ''));
        const av = el('span', 'av', ini(p.name));
        av.style.background = colorOf(p.id);
        if (p.avatar) { const img = el('img'); img.alt = ''; img.onerror = () => img.remove(); img.src = p.avatar; av.append(img); }
        const n = el('span', 'n', p.name + (p.me ? ' (você)' : ''));
        if (p.color) n.style.color = p.color;
        row.append(av, n);
        if (p.muted) row.append(el('span', 'm', 'mudo'));
        card.append(row);
      }
      call.append(card);
      tick();
    }
    notices.replaceChildren(...s.notices.map((n) => el('div', 'notice ' + n.kind, n.text)));
  });
</script></body></html>`;

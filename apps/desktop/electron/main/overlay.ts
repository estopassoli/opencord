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

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>OpenCord overlay</title><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:13px/1.25 "Segoe UI",system-ui,sans-serif;
    color:#f2f3f5;user-select:none}
  body{display:flex;flex-direction:column;gap:8px;padding:0;box-sizing:border-box}
  body.bottom{justify-content:flex-end}
  .card{background:rgba(20,22,27,.78);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 10px;
    backdrop-filter:blur(6px)}
  .head{display:flex;align-items:center;gap:8px;font-size:12px;color:#b5bac1;margin-bottom:6px}
  .head b{color:#f2f3f5;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .badge{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;
    background:#da373c;color:#fff;font-size:10px;font-weight:700}
  .p{display:flex;align-items:center;gap:8px;padding:3px 0}
  .av{width:24px;height:24px;border-radius:50%;background:#4d56fd;display:grid;place-items:center;font-size:11px;
    font-weight:700;color:#fff;box-shadow:0 0 0 2px transparent;transition:box-shadow .12s}
  .p.speaking .av{box-shadow:0 0 0 2px #3fb27f}
  .p .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .p.speaking .n{color:#fff}
  .p.muted .n{color:#8b909a}
  .m{font-size:10px;color:#da373c;font-weight:700}
  .notice{background:rgba(20,22,27,.9);border-left:3px solid #4d56fd;border-radius:8px;padding:8px 10px;
    animation:in .15s ease-out}
  .notice.error{border-left-color:#da373c}.notice.success{border-left-color:#3fb27f}
  @keyframes in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
</style></head><body><div id="call"></div><div id="notices"></div><script>
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const ini = (n) => esc(n.trim().split(/\\s+/).slice(0,2).map((w) => w[0] || '').join('').toUpperCase() || '?');
  window.overlay.onState((s) => {
    document.body.classList.toggle('bottom', !!s.bottom);
    const call = document.getElementById('call');
    const notices = document.getElementById('notices');
    if (s.call) {
      const me = s.call.muted ? '<span class="badge" title="mudo">M</span>' : '';
      const deaf = s.call.deafened ? '<span class="badge" title="surdo">S</span>' : '';
      call.innerHTML = '<div class="card"><div class="head"><b>' + esc(s.call.channel) + '</b>' + me + deaf + '</div>' +
        s.call.people.map((p) => '<div class="p' + (p.speaking ? ' speaking' : '') + (p.muted ? ' muted' : '') + '">' +
          '<span class="av">' + ini(p.name) + '</span><span class="n">' + esc(p.name) + (p.me ? ' (você)' : '') + '</span>' +
          (p.muted ? '<span class="m">mudo</span>' : '') + '</div>').join('') + '</div>';
    } else call.innerHTML = '';
    notices.innerHTML = s.notices.map((n) => '<div class="notice ' + n.kind + '">' + esc(n.text) + '</div>').join('');
  });
</script></body></html>`;

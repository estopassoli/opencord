// OpenCord — landing page: links de download do app desktop e prévia dos temas.

// ---------- downloads ----------
// Instaladores publicados pelo servidor (GET /downloads/desktop): o botão aponta para o do sistema de quem visita
// e as demais plataformas aparecem logo abaixo. Sem instaladores (ou com o servidor fora do ar), os botões continuam
// levando ao app no navegador; no celular, onde não há app desktop, eles somem.
const API = document.querySelector('meta[name="opencord-api"]')?.content;
const NAMES = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

function detectPlatform() {
  const uad = navigator.userAgentData;
  if (uad?.mobile) return null;
  const p = `${uad?.platform ?? ''} ${navigator.userAgent}`;
  if (/android|iphone|ipad|ipod|cros/i.test(p)) return null;
  if (/win/i.test(p)) return 'windows';
  // iPadOS se apresenta como Mac; só ele tem toque
  if (/mac/i.test(p)) return navigator.maxTouchPoints > 1 ? null : 'mac';
  if (/linux|x11/i.test(p)) return 'linux';
  return null;
}

function fileLabel(f) {
  if (f.platform === 'mac') return f.arch === 'arm64' ? 'macOS (Apple Silicon)' : 'macOS (Intel)';
  if (f.platform === 'linux') return f.format === 'deb' ? 'Linux (.deb)' : 'Linux (AppImage)';
  return 'Windows (64 bits)';
}

// No Mac o navegador não informa o processador de forma confiável: Apple Silicon é o padrão, Intel fica na lista.
function pickFile(files, platform) {
  const mine = files.filter((f) => f.platform === platform);
  const pref =
    platform === 'mac'
      ? mine.find((f) => f.arch === 'arm64')
      : platform === 'linux'
        ? mine.find((f) => f.format === 'AppImage')
        : undefined;
  return pref ?? mine[0] ?? null;
}

const platform = detectPlatform();
const buttons = document.querySelectorAll('.js-download');
const setLabel = (text) => {
  for (const b of buttons) b.querySelector('.download-label').textContent = text;
};
if (!platform) for (const b of buttons) b.hidden = true;
// o sistema já é conhecido antes da resposta do servidor; o link vira o instalador assim que ele chegar
else setLabel(`Baixar para ${NAMES[platform]}`);

if (API) {
  fetch(`${API}/downloads/desktop`)
    .then((r) => (r.ok ? r.json() : null))
    .then((dl) => {
      const files = dl?.files ?? [];
      const primary = platform && pickFile(files, platform);
      if (platform && !primary) setLabel('Baixar o app');
      if (!files.length) return;
      if (primary) {
        const mb = primary.sizeBytes ? ` · ${Math.round(primary.sizeBytes / 1024 / 1024)} MB` : '';
        for (const b of buttons) {
          b.href = primary.url;
          if (primary.fileName) b.setAttribute('download', primary.fileName);
        }
        setLabel(`Baixar para ${NAMES[primary.platform]} ${primary.version ?? ''}`.trim());
        document.getElementById('download-meta').textContent =
          `${fileLabel(primary)}${mb} · ou use direto no navegador`;
      }
      const others = files.filter((f) => f !== primary);
      const box = document.getElementById('download-others');
      if (!others.length || !box) return;
      box.append(primary ? 'Outras versões: ' : 'Baixe o app para computador: ');
      others.forEach((f, i) => {
        if (i) box.append(' · ');
        const a = document.createElement('a');
        a.href = f.url;
        a.textContent = fileLabel(f);
        if (f.fileName) a.setAttribute('download', f.fileName);
        box.append(a);
      });
      box.hidden = false;
    })
    .catch(() => {
      if (platform) setLabel('Baixar o app');
    });
}

// ---------- prévia dos temas ----------
// Abas trocam a captura; sem JS a primeira fica visível. Avança sozinha devagar, para ao passar o mouse,
// ao focar e quando a pessoa escolhe um tema (ou prefere menos movimento).
const demo = document.querySelector('[data-theme-demo]');
if (demo) {
  const tabs = [...demo.querySelectorAll('[role="tab"]')];
  const panels = [...demo.querySelectorAll('.theme-img')];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
  let timer = 0;
  let manual = false;

  const show = (i) => {
    current = (i + tabs.length) % tabs.length;
    tabs.forEach((t, k) => {
      const on = k === current;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p, k) => {
      p.classList.toggle('is-active', k === current);
      p.setAttribute('aria-hidden', k === current ? 'false' : 'true');
    });
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = 0;
  };
  const start = () => {
    stop();
    if (manual || reduce.matches) return;
    timer = setInterval(() => show(current + 1), 5000);
  };

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => {
      manual = true;
      stop();
      show(i);
    });
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      manual = true;
      stop();
      show(current + d);
      tabs[current].focus();
    });
  });
  demo.addEventListener('pointerenter', stop);
  demo.addEventListener('pointerleave', start);
  demo.addEventListener('focusin', stop);
  demo.addEventListener('focusout', start);
  reduce.addEventListener?.('change', start);
  show(current);
  start();
}

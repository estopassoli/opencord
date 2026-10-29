// OpenCord — landing page: entrada suave ao rolar e links de download do app desktop.

const reveal = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  reveal.forEach((el, i) => {
    // cascata leve dentro de grades e listas
    el.style.transitionDelay = `${Math.min(i % 4, 3) * 60}ms`;
    io.observe(el);
  });
} else {
  reveal.forEach((el) => el.classList.add('in'));
}

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
if (!platform) for (const b of buttons) b.hidden = true;

if (API) {
  fetch(`${API}/downloads/desktop`)
    .then((r) => (r.ok ? r.json() : null))
    .then((dl) => {
      const files = dl?.files ?? [];
      if (!files.length) return;
      const primary = platform && pickFile(files, platform);
      if (primary) {
        const mb = primary.sizeBytes ? ` · ${Math.round(primary.sizeBytes / 1024 / 1024)} MB` : '';
        for (const b of buttons) {
          b.href = primary.url;
          if (primary.fileName) b.setAttribute('download', primary.fileName);
          b.querySelector('.download-label').textContent =
            `Baixar para ${NAMES[primary.platform]} ${primary.version ?? ''}`.trim();
        }
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
    .catch(() => undefined);
}

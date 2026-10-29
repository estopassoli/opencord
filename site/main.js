// OpenCord — landing page: entrada suave ao rolar e link de download da última release do GitHub.

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

// Release mais recente: aponta direto para o instalador .exe e mostra versão/tamanho.
// Sem release publicada (ou offline/limite da API), o botão continua levando à página de releases.
const REPO = 'estopassoli/opencord';
fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    const exe = rel?.assets?.find((a) => /\.exe$/i.test(a.name));
    if (!exe) return;
    const mb = Math.round(exe.size / 1024 / 1024);
    const version = String(rel.tag_name || '').replace(/^v/, '');
    for (const a of document.querySelectorAll('a[href$="/releases/latest"]')) a.href = exe.browser_download_url;
    document.getElementById('download-label').textContent = `Baixar para Windows ${version}`.trim();
    document.getElementById('download-meta').textContent = `Windows 11 (64 bits) · ${mb} MB · código público no GitHub`;
  })
  .catch(() => undefined);

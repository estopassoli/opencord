# ADR-0008 — App desktop também para macOS e Linux
Status: Accepted (pedido do mantenedor, 2026-10-29)

## Contexto
O ADR-0002 definiu Electron com prioridade Windows. Quem acessa pelo navegador em macOS ou Linux não tinha app para
baixar, e o código do Electron já roda nessas plataformas (sem módulo nativo; só a captura com áudio do sistema é
exclusiva do Windows).

## Decisão
- Empacotar com o mesmo `electron-builder.yml`: Windows NSIS x64, macOS dmg arm64 + x64, Linux AppImage + deb x64.
- Gerar cada um no próprio sistema pelo workflow `.github/workflows/desktop.yml` (manual ou tag `v*`).
- Nomes fixos (`OpenCord-Setup-x.y.z-x64.exe`, `OpenCord-x.y.z-mac-arm64.dmg`, `OpenCord-x.y.z-linux-x86_64.AppImage`,
  `OpenCord-x.y.z-linux-amd64.deb`): a API (`GET /downloads/desktop`) deduz plataforma/arquitetura pelo nome e lista a
  versão mais recente de cada uma em `files`; `windows` continua no corpo para clientes antigos.
- A interface no navegador e a landing sugerem o arquivo do sistema de quem visita (Apple Silicon no Mac, AppImage no
  Linux) e listam os demais.
- `node_modules` fora do asar: main/preload (esbuild) e renderer (vite) já saem empacotados (asar de 111 MB → 2,3 MB).

## Consequências
- Sem certificados: o Windows mostra o SmartScreen; no macOS a assinatura é ad-hoc, sem notarização, e o Gatekeeper
  exige "Abrir mesmo assim" na primeira execução.
- Go Live com áudio do sistema segue só no Windows; em macOS/Linux o Go Live transmite só o vídeo.
- macOS e Linux **não validados em máquinas reais** (só empacotamento e inicialização do Linux em WSLg).
- Runners macOS em repositório privado consomem minutos do GitHub Actions com multiplicador 10×.

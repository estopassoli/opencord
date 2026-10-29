# Arquitetura e organização

## Topologia
`Electron renderer (React)` ↔ `Electron preload/main (IPC restrito)`; renderer ↔ `NestJS API (HTTPS/Socket.IO)`; renderer ↔ `LiveKit SFU (WebRTC)`; API ↔ PostgreSQL, Redis, armazenamento S3; LiveKit ↔ coturn quando necessário.

## Monorepo planejado
```text
apps/
  desktop/
    electron/{main,preload,native}/
    src/{app,features,components}/
  api/src/{auth,users,friends,servers,channels,permissions,messages,presence,voice,media,realtime,invites,notifications,settings}/
packages/
  db/
  contracts/
  ui/
  media/
  config/
infra/{docker,nginx,livekit,coturn}/
docs/
```

## Responsabilidades
- `api`: fonte de verdade para autorização e operações de domínio; REST para CRUD e Socket.IO para eventos.
- `db`: Prisma migrations e modelos persistentes.
- `contracts`: Zod, enums, contratos versionados, sem dependência Electron.
- `media`: adaptadores LiveKit, interface de captura, estados e métricas.
- `desktop/main`: tray, janelas, shortcuts, permissões e captura nativa.
- `desktop/preload`: bridge mínima, tipada e validada.
- `desktop/renderer`: UI, acessibilidade, estados e orquestração.

## Estratégia de deploy
V1 em Docker Compose, HTTPS para API, TCP/UDP de mídia expostos conforme documentação da versão do LiveKit/coturn. Não encaminhar mídia WebRTC via Nginx HTTP proxy. Separar SFU em host dedicado quando testes de capacidade indicarem.

## Qualidade
TypeScript strict; ESLint/Prettier; testes unitários/integrados/E2E; CI em PR; dependências fixadas por lockfile; build Windows em runner Windows para testes e distribuição.

## ADRs
Ver `adr/0001-media-sfu.md` e `adr/0002-desktop-electron.md`.

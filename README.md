# OpenCord

Comunicação privada e self-hosted para grupos de amigos: servidores com canais de texto e voz, DMs, webcam e **Go Live com áudio do sistema**. Desktop-first para Windows 11. Interface própria (marca, cores e logotipo originais); a mídia passa por um SFU LiveKit hospedado por você.

> **Estado (2026-10-29):** funcional em uma máquina (API, desktop, voz, vídeo, Go Live e instalador não assinado), com testes automatizados e E2E. **Ainda não validado entre dois PCs em redes distintas**, que é o gate obrigatório de mídia. Licença ainda **não definida** pelo mantenedor. Detalhes em [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## O que tem
- Entrar só com apelido (sem conta, sem endereço e sem convite); conta opcional (apelido + senha) para usar o mesmo apelido em outros PCs; sessões com refresh rotativo e detecção de reuso.
- Servidores abertos a todos (diretório "Explorar servidores").
- Servidores, categorias, canais, cargos com hierarquia, overrides por canal, kick e audit log.
- Chat em tempo real: edição, exclusão, respostas, reações, menções, anexos com verificação de MIME real, não lidas e digitação.
- Amigos, bloqueios, DMs e grupos; presença (online, ausente, não perturbe, invisível).
- Voz: entrar com um clique, VAD, push-to-talk, mute/deafen, volume por pessoa, indicador de fala e reconexão.
- Webcam; Go Live de monitor ou janela com áudio do sistema (loopback do Windows); assistir sob demanda, destacar e tela cheia.
- Desktop: bandeja (fechar não derruba a chamada), notificações nativas, atalhos globais e armazenamento seguro da sessão (DPAPI).

## Estrutura
```
apps/api        NestJS + Fastify, Socket.IO, Prisma, LiveKit (tokens/webhooks)
apps/desktop    Electron + React (Vite); main/preload com IPC validado
packages/contracts  schemas Zod, permissões, protocolo realtime
packages/db     Prisma (schema, migrações, seed, create-owner)
packages/media  máquinas de estado de voz/stream, perfis, PTT, VAD
packages/ui     tokens de design, ícones (Heroicons) e avatar
infra/          docker compose, LiveKit, coturn
spikes/         provas de viabilidade do F0 (com evidências)
docs/           PRD, SDD, arquitetura, ADRs, pesquisa e plano
site/           landing page estática (GitHub Pages via .github/workflows/pages.yml)
```

## Começar (desenvolvimento)
Veja [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md#desenvolvimento-nativo-validado). Resumo:
```sh
pnpm install && cp .env.example .env
pnpm --filter @opencord/db migrate:dev && pnpm --filter @opencord/db seed
scripts/dev-livekit.sh &        # LiveKit de dev
pnpm --filter @opencord/api dev # API :3000
```

## Testes
```sh
pnpm turbo run build typecheck lint test          # unitários de todos os pacotes
pnpm --filter @opencord/api test:integration      # Postgres/Redis/LiveKit reais
# E2E (Windows, app preparado com stage:win): npx playwright test -c e2e
```

## Segurança
Veja [`SECURITY.md`](SECURITY.md) e [`docs/SECURITY.md`](docs/SECURITY.md). WebRTC é criptografado em trânsito, mas **não é E2EE** contra o servidor SFU.

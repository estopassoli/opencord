# OpenCord

Chat, voz, webcam e **Go Live com áudio do sistema** para grupos de amigos, em software livre e self-hosted. Servidores com canais de texto e voz, DMs e grupos. Funciona no navegador e no app para Windows, macOS e Linux.

O nome vem de *open source* + Discord: uma alternativa aberta, com marca, interface e código próprios. **Não tem nenhum vínculo com o Discord.**

> **Projeto sem fins lucrativos.** O OpenCord é um projeto pessoal, feito para usar com os amigos. Não tem plano pago, anúncios, venda de dados, rastreamento de marketing nem intenção de virar produto comercial. A instância pública é mantida pelo autor do próprio bolso enquanto for viável. Quem quiser independência pode hospedar o seu servidor.

## Usar agora (instância pública)
- **No navegador:** <https://app.opencord.pro>. Basta escolher um apelido, sem conta, e-mail ou convite.
- **App para computador:** <https://opencord.pro> (o botão sugere o instalador do seu sistema). O app avisa quando sai versão nova (no Windows, já baixa a atualização).
  - Windows: o instalador ainda não é assinado, então o SmartScreen pode avisar. Clique em "Mais informações → Executar assim mesmo".
  - macOS: assinatura ad-hoc, sem notarização. Na primeira vez, clique com o botão direito no app e escolha **Abrir**.
  - Linux: `.AppImage` (dê permissão de execução) ou `.deb`.
- Transmitir com **áudio do sistema** funciona só no app para Windows. Nos outros, a transmissão de tela fica sem o som do computador.

A instância pública é de uso livre e sem garantias. Não use para nada sensível: as chamadas são criptografadas em trânsito, mas **não ponta a ponta** (veja [Segurança](#segurança)).

## Hospedar o seu (self-hosted)
O guia completo está em [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md). Resumo:

1. Num servidor Linux com Docker, aponte dois domínios com TLS no seu proxy reverso: `chat.exemplo.com` para a API e `rtc.exemplo.com` para o LiveKit. Se quiser a interface no navegador, aponte também `app.exemplo.com` (serviço `web`).
2. Abra as portas de mídia **direto para o LiveKit**, sem passar pelo proxy HTTP: 7881/TCP e 50000-50100/UDP. Para o coturn, abra 3478 e 5349.
3. Configure e suba a stack:
   ```sh
   cp infra/docker/.env.example infra/docker/.env   # preencha segredos e domínios
   # troque as chaves em infra/docker/livekit.yaml e infra/coturn/turnserver.conf
   docker compose -f infra/docker/docker-compose.yml up -d --build
   ```
4. Gere os instaladores apontando para o seu servidor. O endereço vai embutido no app: os instaladores oficiais só conectam na instância pública. A forma mais simples é fazer um fork e rodar o workflow **Desktop (instaladores)** com o input `server_url`.

A stack do compose (Postgres, Redis, LiveKit, migrações, API e web) é testada a cada push no CI (job `self-host-compose`).

## Como o projeto foi montado
| Parte | Tecnologia |
|---|---|
| API | NestJS + Fastify, Socket.IO (chat, presença e sinalização), Prisma + PostgreSQL, Redis |
| Mídia | [LiveKit](https://livekit.io) (SFU WebRTC) + coturn. A mídia nunca passa pela API nem pelo Socket.IO |
| App | Electron + React (Vite), com o mesmo renderer servido no navegador. `contextIsolation`, sandbox e IPC com allowlist validada |
| Compartilhado | `packages/contracts` (schemas Zod e protocolo realtime), `packages/media` (máquinas de estado de voz/stream, VAD, PTT), `packages/ui` (tokens, ícones Heroicons) |
| Infra | Docker (API e nginx para web/landing), GitHub Actions (CI, instaladores das 3 plataformas, entrega automática) |

```
navegador / app Electron ──HTTPS + Socket.IO──▶ API (NestJS) ──▶ PostgreSQL, Redis, arquivos (disco ou S3)
          │                                       │ emite tokens e recebe webhooks
          └──────────WebRTC (UDP/TCP)────────────▶ LiveKit SFU (+ coturn)
```

**Como foi feito.** O projeto começou como um pacote de especificação, com PRD, SDD, arquitetura, plano de testes e plano de implementação em fases e gates (`docs/`, `START_HERE.md`, `docs/SDD_PACK_README.md`). Depois foi implementado com agentes de IA (Claude Code) seguindo esse plano, sob as regras de [`CLAUDE.md`](CLAUDE.md). A regra é não marcar nada como pronto sem evidência, e algumas validações exigem teste manual em máquinas reais. Cada decisão de arquitetura tem um ADR. O que foi feito, com evidências e bloqueios, está em [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

Leitura recomendada:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`docs/MEDIA_ARCHITECTURE.md`](docs/MEDIA_ARCHITECTURE.md): visão geral, voz, vídeo e Go Live.
- [`docs/REALTIME_PROTOCOL.md`](docs/REALTIME_PROTOCOL.md) e [`docs/DATABASE.md`](docs/DATABASE.md).
- [`docs/adr/`](docs/adr) e [`docs/DECISIONS.md`](docs/DECISIONS.md): decisões e alternativas descartadas.
- [`docs/research/`](docs/research) e [`spikes/`](spikes): provas de viabilidade, como o áudio do sistema no Windows, e o teste de carga.

### Estrutura
```
apps/api            API NestJS + Fastify, Socket.IO, Prisma, LiveKit (tokens/webhooks)
apps/desktop        Electron + React (Vite); main/preload com IPC validado
packages/contracts  schemas Zod, permissões, protocolo realtime
packages/db         Prisma (schema, migrações, seed, create-owner)
packages/media      máquinas de estado de voz/stream, perfis, PTT, VAD
packages/ui         tokens de design, ícones (Heroicons) e avatar
infra/              Docker Compose, Dockerfiles, LiveKit, coturn
site/               landing page estática (servida pelo nginx do serviço web)
spikes/             provas de viabilidade do F0 (com evidências)
docs/               PRD, SDD, arquitetura, ADRs, pesquisa e plano
```

## Estado
O projeto funciona e está em uso: chat, voz, vídeo, Go Live, app nas 3 plataformas e aviso de atualização. Ainda faltam:
- validar o Go Live entre dois PCs em redes distintas (gate obrigatório de mídia);
- assinatura de código dos instaladores;
- TURN na instância pública;
- testes dos apps de macOS e Linux em máquinas reais.

Detalhes em [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Desenvolvimento
Requisitos: Node 24, pnpm 12, PostgreSQL 18 e Redis 8 (ou o compose). Passo a passo em [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md#desenvolvimento-nativo-validado).
```sh
pnpm install && cp .env.example .env
pnpm --filter @opencord/db migrate:dev && pnpm --filter @opencord/db seed
scripts/dev.sh                                    # LiveKit + API (watch) + Vite
pnpm turbo run build typecheck lint test          # unitários
pnpm --filter @opencord/api test:integration      # Postgres/Redis/LiveKit reais
```
Contribuições são bem-vindas. Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) antes.

## Segurança
Relate vulnerabilidades em privado, como explica o [`SECURITY.md`](SECURITY.md). Modelo de ameaça e controles: [`docs/SECURITY.md`](docs/SECURITY.md). O WebRTC é criptografado em trânsito (DTLS/SRTP), mas **não é E2EE** contra o servidor SFU: quem administra o servidor tem acesso técnico à mídia e às mensagens.

## Licença
[AGPL-3.0](LICENSE). Você pode usar, modificar e hospedar livremente, inclusive para outras pessoas. Se rodar uma **versão modificada** como serviço, precisa disponibilizar o código-fonte dessa versão aos usuários.

Créditos de terceiros: ícones [Heroicons](https://heroicons.com) (MIT) e fonte [Inter](https://rsms.me/inter/) (OFL-1.1, `site/assets/INTER-LICENSE.txt`). Dependências com as próprias licenças (MIT, Apache-2.0, BSD e ISC).

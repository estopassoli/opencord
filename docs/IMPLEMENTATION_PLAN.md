# Plano executável — OpenCord

## Como operar
Status: `[ ]` pendente, `[x]` concluído com evidência. Não marcar `x` sem testes. Bloqueios: registrar abaixo da tarefa. Executar em ordem de dependência, mas o **spike de mídia** deve ocorrer cedo. Cada PR/fatia: código + testes + docs + evidência.

## F-1 — Pesquisa comportamental (cancelada)
A pesquisa planejada sobre o comportamento de outro aplicativo não foi feita (nenhum binário ou dado de terceiros foi analisado) e saiu do repositório antes da abertura do código. O OpenCord seguiu a própria especificação (`docs/PRD.md`, `docs/SDD.md`, `docs/DESIGN_SYSTEM.md`).

## F0 — Descoberta e viabilidade (gate antes de UI final)
- [x] F0.1 Inspecionar repo, SO, toolchain, disponibilidade de Docker/Node/pnpm; registrar baseline.
  - Evidência: `docs/research/F0_FEASIBILITY.md#f01`. Docker **indisponível** (impacta F1.3).
- [ ] F0.2 Criar PoC isolada LiveKit local com dois clientes e áudio bidirecional; validar conectividade de rede.
  - Local: PASS 4/4 (`spikes/f0.2-livekit-audio/evidence/`, LiveKit 1.13.10, rtc-node 1.1.0).
  - BLOQUEADO PARA VALIDAÇÃO: conectividade entre redes distintas/NAT/TURN (sem segunda máquina nem coturn).
- [x] F0.3 Criar PoC Electron de seleção/captura de monitor e janela no Windows 11.
  - Evidência: `spikes/f0.3-electron-capture/evidence/selftest-run1..9.json` (monitor, janela, stop, recaptura, fonte fechada → `ended` em 5 ms). Jogo fullscreen/borderless não testado (manual).
- [ ] F0.4 Verificar áudio do sistema via Electron/Chromium; se insuficiente, avaliar WGC + WASAPI loopback e registrar ADR.
  - Caminho comprovado em 1 máquina: loopback 7/7 (inclui processo externo); `restrictOwnAudio` exclui o próprio app 4/4; externo com `restrictOwnAudio` 3/4 (run7 não explicada). ADR-0003 (Proposed).
  - BLOQUEADO PARA VALIDAÇÃO: espectador em 2º Windows/rede distinta; reexecutar `selftest:tone` só com consentimento (teste audível).
- [x] F0.5 Criar matriz de compatibilidade (Windows, fullscreen, codecs, GPU) e identificar bloqueios de hardware.
  - Evidência: `docs/research/F0_FEASIBILITY.md#f05` (H.264/HEVC via NVENC; VP8/VP9/AV1 software; lacunas: outras GPUs, fullscreen, 1440p real).
**Gate F0:** riscos técnicos documentados; implementação de áudio do sistema tem caminho comprovado ou bloqueio explícito.
  - 2026-10-29: **atendido para prosseguir ao F1** (caminho comprovado em 1 máquina + bloqueios explícitos). Gate especial de mídia segue BLOQUEADO PARA VALIDAÇÃO.

## F1 — Fundação
- [x] F1.1 Inicializar pnpm/Turborepo, TypeScript strict, ESLint/Prettier, scripts e CI.
  - Evidência: `pnpm turbo run build typecheck lint test` → 22/22 tarefas; `pnpm format:check` OK. `.github/workflows/ci.yml` escrito, **não executado** (repositório sem remoto).
- [x] F1.2 Scaffold `apps/api`, `apps/desktop`, `packages/contracts`, `packages/db`, `packages/ui`, `packages/media`.
  - Versões: ADR-0004.
- [ ] F1.3 Docker Compose dev (Postgres, Redis, LiveKit, coturn, MinIO opcional) com `.env.example`.
  - Escrito: `infra/docker/*`, `infra/coturn/turnserver.conf`, `.env.example`. **BLOQUEADO PARA VALIDAÇÃO: Docker indisponível.** Caminho nativo validado (Postgres 18 + Redis 8 do WSL + LiveKit binário, `scripts/dev-livekit.sh`).
- [x] F1.4 Prisma schema inicial, migrations, seed idempotente.
  - Migração `init` + CHECKs (XOR, sem autoamizade) + `down.sql`; seed rodado 2× → 1/1/2/1 (idempotente); `create-owner` para produção.
- [x] F1.5 Autenticação por convite, login, refresh rotation e logout.
  - **Alterado (ADR-0007):** conta opcional; entrada só com apelido; servidores abertos sem convites. `guest.int.test.ts` 11/11.
  - `apps/api/test/auth.int.test.ts` 13/13 (maxUses concorrente, reuso de refresh revoga a família, logout imediato, lockout).
- [x] F1.6 Electron secure preload/IPC, AppShell inicial, testes smoke.
  - E2E `apps/desktop/e2e/smoke.spec.ts` 5/5 no Windows, em código e no **app empacotado**; fuses verificadas com REA.
**Gate F1:** dev bootstrap reproduzível; autenticação real; build e typecheck verdes.
  - 2026-10-29: atendido no caminho nativo; Compose pendente de Docker.

## F2 — Comunicação textual e permissões
- [x] F2.1 Servidores, membros, roles, canais, categorias e overrides.
  - `servers.int.test.ts` 10/10; regra de permissões em `docs/SECURITY.md`; 11 testes unitários de permissões.
- [x] F2.2 AppShell dark: server rail, channel sidebar, chat, members panel e user dock.
  - E2E smoke + screenshots; identidade própria (ADR-0006).
- [x] F2.3 Mensagens com cursor, edição, deleção, replies, reactions e não lidas.
  - `messages.int.test.ts` (120 mensagens paginadas sem duplicar ou pular; idempotência); renderer `store.test.ts`.
- [x] F2.4 Socket.IO auth, ACK/idempotência, typing, presença com TTL.
  - `realtime.int.test.ts` 11/11 (dois clientes, canal privado, perda de acesso ao vivo, kick, logout, resync, rate limit).
- [x] F2.5 Upload seguro, anexos, links e permissões de download.
  - `attachments.int.test.ts` 7/7 (MIME real, spoofing, 413, URL assinada); links só http(s) (`rich.test.tsx`).
- [x] F2.6 Amigos, bloqueio e DMs/grupos.
  - `messages.int.test.ts` (pedido/aceite, DM, bloqueio impede DM, grupo exige amizade).
**Gate F2:** dois clientes trocam mensagens reais; RBAC e replays testados.
  - 2026-10-29: atendido (Socket.IO com dois clientes + E2E do app no Windows).

## F3 — Voz
- [x] F3.1 API join/leave com grants LiveKit de escopo mínimo.
  - `voice.int.test.ts` 10/10 contra LiveKit real (sala opaca, `canPublishSources` por permissão, a SFU recusa tela sem STREAM).
- [x] F3.2 Client voice state machine e dock persistente.
  - `packages/media` 16 testes; E2E de voz com duas instâncias.
- [ ] F3.3 Mute/deafen, VAD, volume individual, dispositivos e speaking indicators.
  - Implementado. E2E: mute refletido e indicador de fala. **Sem teste:** troca de dispositivo, volume individual e limiar de VAD com voz real (manual).
- [ ] F3.4 PTT global seguro, reconexão e troca de canais.
  - PTT em foco (segurar) + global em alternância (ADR-0005); troca de canal (int test); reconexão com backoff implementada. **Sem teste:** queda de rede real e PTT com jogo em foco.
- [x] F3.5 Kick/revogação ativa da SFU, sincronização de presença.
  - int test (removido da SFU em < 5 s; perda de CONNECT) + E2E no app.
**Gate F3:** dois Windows em redes diferentes conversam e reconectam; evidência manual.
  - **BLOQUEADO PARA VALIDAÇÃO** (uma máquina disponível).

## F4 — Vídeo e Go Live
- [x] F4.1 Webcam e grid de participantes com subscriptions adaptativas.
  - E2E: câmera recebida; adaptiveStream/dynacast; streams só assinadas sob demanda.
- [x] F4.2 ScreenSourcePicker com thumbnails e preview real.
  - E2E: listagem com miniaturas reais (desktopCapturer).
- [x] F4.3 Captura/publicação de tela, stop confiável e erros.
  - E2E `golive-real.spec.ts` (captura real 1920×1080 chega ao espectador; parar encerra para ele); fonte fechada → `ended` (F0.3).
- [ ] F4.4 Captura/publicação de áudio do sistema Windows; integração nativa se necessária.
  - Publicado no app (loopback + restrictOwnAudio, ADR-0003). **BLOQUEADO PARA VALIDAÇÃO:** espectador ouvindo em outro PC (testes audíveis suspensos a pedido do usuário).
- [ ] F4.5 Perfis 720p30/1080p60/1440p60 com capability detection e telemetria.
  - Perfis + telemetria (encoder, fps, limitação) na UI. Achado: com simulcast o H.264 roda em software; camada única ficou em 480×270 (`docs/research/F4_GOLIVE_APP.md`). Pendente.
- [ ] F4.6 Multi-stream viewer, destaque, fullscreen e controle de volume.
  - Implementado (assistir, destacar, tela cheia, volume via saída). **Sem teste** com 2 streams simultâneas no app (a carga da SFU com 3 streams está em LOAD_TEST.md).
- [x] F4.8 Cenas do Go Live (tela, câmera, imagem, texto; troca ao vivo) — ADR-0015.
  - E2E `golive-real.spec.ts` (uma máquina Windows): cena com o app coberto acompanha o conteúdo (≥ 80% do fps), troca ao vivo para "Sem cena", espectador segue em 1080p. Validação em duas máquinas faz parte do F4.7.
- [ ] F4.7 Testes reais em dois Windows, áudio de jogo, borderless/fullscreen e redes distintas.
  - **BLOQUEADO PARA VALIDAÇÃO.**
**Gate F4:** Go Live vídeo + áudio do sistema comprovados em dois computadores; sem isso status bloqueado.
  - **BLOQUEADO PARA VALIDAÇÃO.**

## F5 — Desktop polish
- [x] F5.1 Tray e minimizar sem interromper chamada.
  - E2E: fechar → oculto, chamada continua e o outro participante segue vendo.
- [ ] F5.2 Notificações nativas e DND.
  - Implementado (menções/DM, respeita DND e foco, flash da taskbar, badge). **Sem teste** automatizado da notificação do SO (manual).
- [x] F5.3 Settings voz/vídeo, atalhos, perfil, aparência e persistência.
  - Persistência versionada (int test); E2E abre as configurações e navega por teclado.
- [ ] F5.4 Instalador Windows, versionamento e atualização assinada quando disponível.
  - `OpenCord Setup 0.1.0.exe` (NSIS) gerado e app empacotado testado. **Não assinado** (sem certificado); auto-update desativado. Instalação manual pelo usuário não testada.
- [ ] F5.5 Acessibilidade, layout responsivo desktop e reduced motion.
  - Foco visível, roles/labels, tabs por teclado, contraste AA, reduced motion. **Sem auditoria** em 1280×720/1920×1080/2560×1440 nem leitor de tela.
**Gate F5:** instalador e experiência de uso diária testados.

## F6 — Hardening e release
- [x] F6.1 Auditoria RBAC, uploads, IPC, auth, tokens LiveKit e abuso de banda.
  - Revisão automatizada em `docs/SECURITY.md` (abuso de banda: só limites de perfil; sem teste com clientes reais).
- [ ] F6.2 Carga 10 em voz / 2–4 streams e observabilidade com métricas reais.
  - Local: 10 participantes + 3 streams 720p30 → SFU 36% de 1 núcleo, 166 MiB (`docs/research/LOAD_TEST.md`). Pendente com clientes e rede reais.
- [x] F6.3 Backups/restore, deploy/rollback e runbook.
  - `scripts/backup.sh`/`restore.sh` ensaiados (contagens idênticas; recusa banco não vazio); runbook em `docs/SELF_HOSTING.md`.
- [x] F6.4 README, CONTRIBUTING, SECURITY, guia self-hosted e escolha de licença pelo mantenedor.
  - Licença AGPL-3.0 (`LICENSE`), escolhida pelo mantenedor em 2026-10-29; README com instância pública, self-hosting, como foi construído e aviso de projeto sem fins lucrativos.
- [ ] F6.5 Release candidate, checklist manual completo e registro de limitações.
  - **BLOQUEADO:** depende dos gates de mídia e da aprovação do mantenedor.
**Gate F6:** release somente após gates e aprovação explícita do mantenedor.

## Registro de execução
| Data | Tarefa | Evidência (comando/arquivo/log) | Resultado | Bloqueio |
|---|---|---|---|---|
| 2026-10-29 | F0.1 | PowerShell CIM + `--version` das ferramentas | baseline registrado | sem Docker |
| 2026-10-29 | F0.2 | `node poc.mjs` ×4 contra `livekit-server --dev` 1.13.10 | PASS 4/4 local | redes distintas/TURN |
| 2026-10-29 | F0.3 | `electron . --selftest` ×9 (Electron 44.7.1) | monitor/janela/stop OK; 1 falha de janela de terceiros (run4) | fullscreen manual |
| 2026-10-29 | F0.4 | `selftest` com tom (runs 1–7) | loopback OK; restrictOwnAudio OK; externo+restrict 3/4 | 2º PC; testes audíveis suspensos a pedido do usuário |
| 2026-10-29 | F1 | turbo build/typecheck/lint/test; seed 2×; E2E smoke 5/5 | verde | Docker (Compose) |
| 2026-10-29 | F2 | `pnpm --filter @opencord/api test:integration` → 64/64 | verde | — |
| 2026-10-29 | F3/F4 | E2E voice 6/6 + golive-real 1/1 (Windows, 2 instâncias) | verde em 1 máquina | 2º PC / redes distintas |
| 2026-10-29 | F5 | instalador NSIS + smoke no app empacotado; REA fuses | gerado, não assinado | certificado |
| 2026-10-29 | F5 | instaladores macOS (dmg arm64/x64) e Linux (AppImage/deb) no workflow `desktop.yml` (ADR-0008); Linux empacotado iniciou em WSLg | gerados, não assinados | validar em Mac e Linux reais |
| 2026-10-29 | F6 | load 10×3; backup/restore; revisão de segurança | ver docs | auditoria externa |
| 2026-10-29 | ADR-0007 | int 76/76; E2E 14/14 (só apelido, conta opcional, explorar servidores) | verde | — |
| 2026-10-29 | F0.5 | `selftest` silencioso (runs 8–9), `getStats` | NVENC H.264/HEVC | outras GPUs |
| 2026-10-29 | UI: ícones/movimento | `icon.css` (descendente, ignora desabilitado) + `styles/motion.css`; E2E `motion.spec` | verde (3 rodadas, 21/21 com smoke/responsive/persist) | — |
| 2026-10-29 | Aparência personalizável | `lib/theme.ts` (contraste AA derivado) + aba Aparência; unit `theme.test` 9/9; int `aparência personalizada fica na conta` (81/81) | verde | — |
| 2026-10-29 | Sessão persistente | `restore()` single-flight + trava `navigator.locks` no refresh; unit `api.test` (2 clientes); E2E `persist.spec` (reabrir 3× + dev/StrictMode) | verde | — |
| 2026-10-29 | Cor da marca | `--brand` #4d56fd (fundo da logo), ADR-0006 atualizado | verde | — |
| 2026-10-29 | Importar fonte (local) + flush das configurações ao fechar | unit `fonts.test` 11/11; E2E `fonts.spec` (arquivo falso recusado, importa, reabre, remove); suíte E2E 22/22 ×2 | verde | — |
| 2026-10-29 | Layout de celular (web) | `styles/mobile.css` + `lib/media.ts`; gavetas de navegação/membros, gestos, `inert`, safe-area; E2E `mobile.spec` (Edge, 390×844 toque, 360/320, deitado 844×390) 6/6; suíte 35/35 ×2 | verde em emulação | aparelho real (iOS/Android) não testado |
| 2026-10-31 | Auditoria de segurança (skill `security-audit`, quick) | 8 confirmados corrigidos + 2 leads endurecidos (ver `docs/SECURITY.md`); api typecheck/lint/unit 26/26; integração 19 arquivos, 136 testes verdes (novos de regressão em auth/boards/voice/sounds/reaction-roles); `attachments.int` trava no `app.close()` também sem estas mudanças | verde | PowerShell/Unicode e placeholders LiveKit sem validação em Windows/deploy real |
| 2026-10-31 | Endurecimento pós-auditoria | login sem corrida e sem trancar conta alheia, revalidação de socket, logout tira da voz, bits de cargo/override, travas de parte, limites por pessoa, CAS de avatar, IPC/permissões do desktop, sandbox do YouTube, nginx anti-iframe, coturn, Actions por SHA (ver `docs/SECURITY.md`); api typecheck/lint/unit; integração 139/139 (+3 regressões em servers/realtime/voice) | verde | sandbox do iframe do YouTube e permissões do desktop sem teste manual em Windows; `attachments.int` segue travando no `afterAll` (anterior) |

## Backlog futuro
Federação, Linux/macOS, mobile, bots, overlay, screen-share avançado, E2EE auditado, gravação opt-in.

# Instruções permanentes para agentes — OpenCord

Você é o agente de implementação do OpenCord. Leia `docs/PRD.md`, `docs/SDD.md`, `docs/ARCHITECTURE.md`, `docs/MEDIA_ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `docs/SECURITY.md`, `docs/TEST_PLAN.md` e `docs/IMPLEMENTATION_PLAN.md` antes de decisões importantes.

## Regras inegociáveis
- Construir software real, não apenas mockups. Nunca declarar uma funcionalidade como concluída sem evidências verificáveis.
- Prioridade: Windows 11, áudio confiável, Go Live com áudio do sistema, UX de comunicação compacta e dark.
- UX familiar ao Discord, mas **não** copiar nome, logos, ícones proprietários, imagens, código ou assets do Discord.
- Usar LiveKit SFU para mídia, Socket.IO somente para sinalização de domínio, chat e presença. Nunca trafegar mídia via Socket.IO.
- Tokens LiveKit emitidos somente pelo backend após autorização; não confiar em claims do cliente.
- Desktop Electron: contextIsolation, sandbox, nodeIntegration=false, IPC com allowlist e validação.
- Documentar limitações reais de captura Windows, hardware, codecs, TURN e latência.
- Não fazer deploy em produção, gastar recursos, alterar secrets ou publicar repositório sem aprovação.
- Evitar infraestrutura nova não justificada. Tudo deve ser self-hostable.
- Cada fase deve terminar com lint, typecheck, testes possíveis e atualização do plano.
- Nunca alterar arquitetura silenciosamente: registrar ADR em `docs/adr/` e decisão em `docs/DECISIONS.md`.
- Não marcar testes manuais como aprovados sem executá-los em dispositivos reais.

## Fluxo de execução
1. Inspecione o repositório e preserve código existente.
2. Leia o plano; selecione a primeira tarefa desbloqueada e não concluída.
3. Explique brevemente o objetivo e os arquivos previstos.
4. Implemente a menor fatia vertical funcional.
5. Rode verificações; registre comandos e resultados.
6. Atualize `docs/IMPLEMENTATION_PLAN.md` (checklist, evidências, bloqueios).
7. Continue com a próxima tarefa desbloqueada, sem pular gates de aceite.

## Convenções
- **Novidades** (`apps/desktop/src/features/home/changelog.ts`, mais nova primeiro, texto para quem usa): só entra o que for **relevante para quem usa** — recurso novo, melhoria que muda o uso ou correção de um problema que as pessoas sentiam (pedido do mantenedor, 2026-11-07). **Não** entram: ajustes visuais pequenos (alinhamento, espaçamento, setinha, ícone, animação), acertos de detalhe de algo recém-lançado, coisas de super admin/painel admin, SDK/npm/docs, releases, infra ou melhorias internas. Na dúvida, não entra; vários ajustes pequenos de uma mesma área podem virar uma entrada só. Não escreva `version`: o CI carimba a versão do app em que a novidade entrou (`apps/desktop/scripts/changelog-versions.mjs`, a partir das tags de release).
- **Versão do app (SemVer, ADR-0063):** o CI calcula pelos commits desde a última release (Conventional Commits). `feat` só para recurso novo (sobe o minor); correções, desempenho, docs, testes, CI → `fix`/`perf`/`docs`/`test`/`ci`… (sobe o patch); mudança incompatível → `tipo!:` ou `BREAKING CHANGE:` (sobe o major). Para fixar o número de uma release (ex.: o mantenedor pede um recurso como patch), ponha `Release-As: X.Y.Z` no corpo de um commit do app. Não edite a versão nos `package.json`.
- pnpm + Turborepo, TypeScript strict, NestJS/Fastify, React/Vite/Electron, Prisma/PostgreSQL, Redis, Socket.IO, LiveKit, coturn.
- API de domínio tipada; schemas compartilhados em `packages/contracts`.
- Sem uso de `any` salvo exceção documentada; sem secrets hardcoded.
- Migrações versionadas e reversibilidade documentada; não executar em produção automaticamente.
- UI acessível por teclado, foco visível, contrastes adequados, reduced motion.

## Gate especial de mídia
Antes de afirmar que Go Live funciona: validar vídeo e **áudio do sistema** em duas máquinas Windows reais e em redes diferentes, incluindo o encerramento de captura e reconexão. Se não houver ambiente, status = BLOQUEADO PARA VALIDAÇÃO, nunca CONCLUÍDO.


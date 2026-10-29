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
- pnpm + Turborepo, TypeScript strict, NestJS/Fastify, React/Vite/Electron, Prisma/PostgreSQL, Redis, Socket.IO, LiveKit, coturn.
- API de domínio tipada; schemas compartilhados em `packages/contracts`.
- Sem uso de `any` salvo exceção documentada; sem secrets hardcoded.
- Migrações versionadas e reversibilidade documentada; não executar em produção automaticamente.
- UI acessível por teclado, foco visível, contrastes adequados, reduced motion.

## Gate especial de mídia
Antes de afirmar que Go Live funciona: validar vídeo e **áudio do sistema** em duas máquinas Windows reais e em redes diferentes, incluindo o encerramento de captura e reconexão. Se não houver ambiente, status = BLOQUEADO PARA VALIDAÇÃO, nunca CONCLUÍDO.

## Engenharia reversa com REA
- Antes do refinamento de UI e fluxos, ler `docs/REVERSE_ENGINEERING.md` e executar as tarefas F-1 do plano quando possível.
- REA é ferramenta de investigação, não fonte de código para copiar. Preferir observação de comportamento com contas próprias e consentimento.
- Nunca extrair ou transpor código, assets, credenciais, tokens, protocolos internos ou conteúdo privado do Discord; não contornar proteções.
- Manter evidências e incertezas em `docs/research/discord/`; implementar OpenCord de forma independente com APIs próprias e LiveKit.

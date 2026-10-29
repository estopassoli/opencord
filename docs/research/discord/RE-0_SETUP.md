# RE-0.1 / RE-0.2 — Disponibilidade do REA, versões e limites

Data: 2026-10-29

## Ferramenta
- O MCP `rea` já estava configurado no Claude Code do usuário (`~/.claude.json`): `npx -y rea-agents@6.5.0 mcp`, com Ghidra 12.1.4 e OpenJDK 21. O agente não alterou essa configuração.
- Versão mais recente publicada no npm na data: `rea-agents@6.8.0`. **Não atualizado**: a mudança de configuração fica para o mantenedor revisar.
- Conectividade: `list_electron_targets` em endpoint loopback sem processo respondeu com erro estruturado (`provider_unavailable / endpoint_unreachable`). O servidor MCP está ativo e respondendo.

## Ambiente de observação
- Windows 11 Pro build 26200. Discord Desktop instalado em `%LOCALAPPDATA%\Discord` (`app-1.0.9265`); apenas a presença do diretório foi verificada.
- **Nenhum binário, ASAR, cache ou dado do Discord foi lido ou analisado.**

## Limites aplicados
- Os termos de serviço do Discord restringem engenharia reversa/descompilação do software. Sem revisão do mantenedor, a análise estática de artefatos do Discord (fuses, ASAR, bundles JS, binários) **não será feita**.
- Iniciar o Discord com depuração remota (CDP) para usar `capture_electron_scenario`/`inspect_electron_page` também é instrumentação do cliente e fica fora de escopo sem aprovação explícita.
- Método permitido por padrão: observação black-box (uso normal, capturas de tela feitas pelo próprio usuário, cronometragem manual), com contas próprias e consentimento dos participantes.

## Situação das tarefas
| Tarefa | Estado | Motivo |
|---|---|---|
| RE-0.1 | concluída | este documento |
| RE-0.2 | concluída (validação) | MCP já instalado; conectividade comprovada; upgrade 6.5.0→6.8.0 pendente de decisão |
| RE-0.3 – RE-0.5 | **BLOQUEADO** | exigem sessão do usuário no Discord, contas de teste e consentimento de participantes; o agente não opera a conta do usuário |
| RE-0.6 | **BLOQUEADO** | depende de RE-0.3 – RE-0.5 |

Pelo `docs/REVERSE_ENGINEERING.md`, esse bloqueio não impede F0/F1.

## Como desbloquear
1. O mantenedor confirma o escopo (somente black-box ou também CDP) e se os termos aplicáveis foram revisados.
2. O usuário executa os cenários RE-01…RE-07 com contas próprias e registra capturas/tempos. O agente pode guiar e transformar em especificação neutra.

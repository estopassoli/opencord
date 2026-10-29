# OpenCord — Plano de investigação com REA

## Objetivo
Estudar comportamentos observáveis do Discord Desktop para criar uma implementação **independente** e original do OpenCord. A investigação não substitui o SDD nem autoriza copiar código, assets, marca, segredos ou protocolos privados.

## Ferramenta
Fonte oficial: https://github.com/morluto/rea

O REA disponibiliza MCP e workflows para Claude Code, análise de aplicativos Electron/JavaScript, inspeção de estrutura e observação de comportamento. Consultar o README e a documentação oficial da versão instalada; não presumir ferramentas disponíveis.

### Preparação
1. Instalar Node.js em versão suportada pelo REA, conferir documentação atual.
2. Em diretório confiável, executar `npx rea-agents setup` e selecionar Claude Code.
3. Revisar mudanças de configuração, permissões e dependências antes de aprovar.
4. Reiniciar Claude Code e verificar MCP instalado.
5. Registrar versões do REA, Discord, Windows, Electron (quando identificável) e ambiente de testes.
6. Preferir observação black-box, testes com contas próprias e capturas feitas com consentimento. Análise estática somente quando legalmente permitida.

## Limites e regras
- Não extrair nem reutilizar código proprietário, recursos gráficos, fontes, tokens, chaves ou credenciais do Discord.
- Não contornar DRM, proteções, autenticação, anti-tamper, rate limits ou controles de acesso.
- Não instrumentar terceiros, interceptar sessões de outros usuários ou coletar conteúdo privado.
- Não realizar chamadas a endpoints internos do Discord nem replicar protocolos privados em produção.
- Respeitar legislação, licenças e termos aplicáveis; caso haja dúvida, parar a etapa e registrar necessidade de revisão.
- Manter evidências de comportamento separadas do código OpenCord; documentar apenas especificações funcionais, medidas e observações necessárias.
- Toda implementação OpenCord deverá usar APIs próprias e LiveKit, não depender da infraestrutura do Discord.

## Matriz de investigação
| ID | Área | Cenário a observar | Artefato esperado |
| --- | --- | --- | --- |
| RE-01 | Shell | janela, barras, navegação, resize, densidade | UX_SHELL.md |
| RE-02 | Chat | agrupamento, edição, reply, menção, scroll, teclado | UX_CHAT.md |
| RE-03 | Voz | entrar/sair/trocar canal, mute, deafen, VAD, PTT | UX_VOICE.md |
| RE-04 | Vídeo | ativação, grade, destaque, fullscreen | UX_VIDEO.md |
| RE-05 | Go Live | seleção de fontes, prévia, áudio, viewer, encerramento | UX_GOLIVE.md |
| RE-06 | Desktop | tray, hotkeys, notificações, dispositivos | UX_DESKTOP.md |
| RE-07 | Resiliência | perda de rede, reconexão, troca de hardware | UX_RESILIENCE.md |
| RE-08 | Desempenho | CPU/RAM/GPU, FPS e condições do teste | PERF_BASELINE.md |

Salvar relatórios em `docs/research/discord/`, com data, versão, passos, observações, evidências, nível de confiança e limitações. Não armazenar conteúdo privado ou dados de terceiros.

## Método para cada investigação
1. Definir hipótese e cenário reproduzível.
2. Observar comportamento visível com contas e dispositivos próprios; obter autorização quando necessário.
3. Medir timings e estados; evitar inferir implementação interna a partir de aparência.
4. Se autorizado, usar REA para esclarecer componentes e fronteiras técnicas, sem transpor código proprietário.
5. Produzir especificação funcional neutra e critérios de aceite para OpenCord.
6. Implementar independentemente com a stack aprovada.
7. Testar OpenCord comparando fluxos observáveis, sem exigir identidade pixel-perfect ou copiar assets.
8. Registrar diferença entre observado, inferido e não verificado.

## Gates
- Pesquisa concluída exige relatório e evidências reproduzíveis, não necessariamente análise de binário.
- REA indisponível não deve bloquear a implementação: registrar bloqueio e continuar com referências públicas e testes black-box permitidos.
- Nenhuma descoberta autoriza substituir LiveKit por API privada do Discord.
- Não declarar paridade de desempenho sem benchmark controlado em ambos os produtos.

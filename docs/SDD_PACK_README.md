# OpenCord — SDD Execution Pack

Documentação para construir um aplicativo open source de comunicação privada, desktop-first, com experiência de uso próxima ao Discord e identidade própria.

## Iniciar

1. Extraia **todo o conteúdo** deste pacote na raiz do repositório vazio do OpenCord.
2. Abra a raiz do projeto no Claude Code.
3. Execute `/opencord-start` (se o Claude Code reconhecer comandos personalizados) ou cole o conteúdo de `START_HERE.md`.
4. Acompanhe `docs/IMPLEMENTATION_PLAN.md` e `docs/DECISIONS.md`.

**Atenção:** este pacote é documentação e plano, não uma aplicação implementada. Não há credenciais nem serviços externos provisionados. A licença open source deve ser escolhida pelo mantenedor antes da publicação.

## Ordem de leitura

`CLAUDE.md` → `START_HERE.md` → `docs/PRD.md` → `docs/SDD.md` → `docs/IMPLEMENTATION_PLAN.md` → documentos especializados.

## Escopo inicial

Windows 11, 5–15 amigos, instância privada, servidor de texto/voz, DM, webcam e Go Live com áudio do sistema. Sem federação, marketplace, bots ou mobile no MVP.

## Investigação de referência
O plano inclui `docs/REVERSE_ENGINEERING.md` para pesquisa comportamental do Discord com REA, sem incorporar código ou assets proprietários.

# ADR-0017: Quadros kanban e canal de relatos
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
O mantenedor pediu: "Neste servidor oficial, quero que você coloque um canal de report bugs, e um canal de kanban onde os bugs entrarão. O canal de kanban apenas eu de super admin e quem eu dar administrador poderá ver."

## Decisão
- **Novo tipo de canal `board`** (enum `ChannelKind`). Ele tem cards em colunas fixas e não aceita mensagens: o envio devolve 400. As colunas são Novo, Em análise, Em andamento e Resolvido (`BoardColumn`: `new`, `triage`, `doing`, `done`).
- **Tabela `BoardCard`** (migração `20261030140000_boards`):
  - título, descrição, coluna e posição (float: soltar entre dois cards usa a média, sem renumerar);
  - quem relatou e, quando veio de uma mensagem, a mensagem e o canal de origem;
  - limite de 2000 cards por quadro.
- **Canal que alimenta um quadro:** `Channel.boardId` num canal de texto.
  - Cada mensagem nova nele vira um card em "Novo": a primeira linha é o título e o texto inteiro é a descrição.
  - Uma falha ao criar o card não derruba o envio da mensagem; ela só fica registrada no log.
  - A ligação é feita pelo `PATCH /channels/:id` (`boardId`, só canal de texto e quadro do mesmo servidor), por Configurações → Canais ou pelo seed do oficial.
- **Permissões:** são as do canal, sem regra nova.
  - Ver o quadro exige VIEW_CHANNEL no quadro.
  - Criar, mover, editar e excluir cards exige MANAGE_MESSAGES no quadro.
  - "Só a equipe vê" = override no @everyone negando VIEW_CHANNEL. Dono, super admin da instância (ADR-0013) e cargos com Administrador continuam vendo, porque têm todas as permissões.
  - Quem não vê o quadro recebe 404 até para o card.
- **API:** `GET/POST /channels/:id/cards`, `PATCH/DELETE /cards/:id`.
- **Tempo real:** eventos `board:card:upserted` e `board:card:deleted`, enviados à sala do canal do quadro (só chega a quem o vê).
- **App:**
  - Tela do quadro com arrastar entre colunas e dentro da coluna.
  - Sem mouse: menu "Mover para" e o diálogo do card, com seletor de coluna.
  - "Ir para o relato" abre o canal de origem.
  - O canal de relatos mostra o aviso "Cada mensagem aqui vira um card".
- **Servidor oficial:**
  - O seed transforma #bugs em #reportar-bugs, ligado ao quadro #kanban-de-bugs, que só a equipe vê.
  - Na lista de membros, o dono do oficial aparece sempre no topo, no grupo "Criador", com selo de verificado (só no oficial; nos outros servidores continua "dono").

## Alternativas descartadas
- Quadro como página fora dos canais: perderia as permissões por canal e o tempo real que já existem.
- Cards como mensagens com reações: não dá para ordenar nem mover entre colunas.

## Consequências
- **Deploy:** a migração é aditiva e precisa rodar antes da API nova. A API nova lê `Channel.boardId`, então falharia sem a coluna. A API antiga ignora a coluna nova, mas quebra ao ler um canal `board`: só crie quadros depois do deploy.
- Apps antigos mostram o quadro como canal sem tela. Ele só aparece para quem o vê, que é a equipe.
- **Reversão:** `DROP TABLE "BoardCard"; DROP TYPE "BoardColumn"; ALTER TABLE "Channel" DROP COLUMN "boardId";` depois de excluir os canais `board`. O valor `board` do enum fica, sem efeito.

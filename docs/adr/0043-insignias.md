# ADR-0043: Insígnias
Status: Accepted (pedido do mantenedor, 2026-11-04)

## Contexto
O mantenedor pediu: "queria que tivessemos insignias, essas insignias eu crio no painel admin e posso atribuir aos usuarios, por exemplo a Verificado é uma insignia". Ele também escolheu:
- desenho com ícone + cor **ou** imagem enviada;
- exibição de até 3 ao lado do nome e de todas no perfil.

## Decisão
- **Tabelas** (migração `20261104000000_badges`):
  - `Badge`: nome até 32, descrição até 120, `icon`, `color` (#rrggbb), `imageKey` e `position`.
  - `UserBadge`: `userId` + `badgeId`, quem deu e quando; cascata nos dois lados.
- **Catálogo:** vai para todo mundo em `InstanceInfo.badges`.
  - Toda mudança no catálogo dispara `instance:updated` para todos, que já existia.
  - A imagem é servida em `GET /badge-images/:nome`, com as mesmas regras e validação da foto de perfil: PNG/JPEG/WebP/GIF, até 1 MB, de 16 a 1024 px.
- **Quem tem o quê:** fica em `UserPublic.badges` (ids, na ordem do catálogo, só quando há).
  - O `BadgesService` mantém um índice em memória (`userBadgeIndex`), recarregado a cada mudança e a cada 60 s, porque outra réplica pode ter mudado as insígnias.
  - Assim todo `userPublic()` leva as insígnias sem um join em cada consulta. São poucas e dadas à mão.
  - Dar ou tirar envia `user:updated` a quem compartilha servidor com a pessoa.
- **API** (só super admin, 404 para os demais):
  - `POST /admin/badges`, `PATCH /admin/badges/:id`, `DELETE /admin/badges/:id`;
  - `POST /admin/badges/:id/image` e `DELETE /admin/badges/:id/image`;
  - `PUT /admin/users/:id/badges` (substitui o conjunto).
  - Tudo vai para a auditoria global.
- **App:**
  - Até 3 ícones ao lado do nome no chat, na lista de membros e no painel; o que sobra vira "+N", com dica.
  - No cartão de perfil aparecem todas, com nome e descrição na dica.
  - A mensagem usa as insígnias atuais do membro, não as gravadas na mensagem.
  - Painel admin ganha a aba "Insígnias" e o item "Insígnias…" no menu de cada usuário.
  - Ícone de um nome desconhecido vira estrela.
- **Verificado:** continua sendo o selo de antes (`User.verified`), com a mesma ação no menu do usuário. No perfil, ele aparece como a primeira insígnia, para ler como uma delas.

## Alternativas descartadas
- Migrar o Verificado para uma linha de `Badge`: mexeria no selo de servidor, no "criador" e em todos os clientes antigos, sem ganho para quem usa.
- Join de `UserBadge` em cada `USER_PUBLIC_SELECT`: um custo em toda consulta de mensagens e membros, e eventos montados sem o join perderiam as insígnias.

## Consequências
- **Deploy:** a migração é aditiva e precisa rodar antes da API nova. Mesmo assim, sem as tabelas o serviço só registra um aviso e segue com catálogo vazio. Apps antigos ignoram os campos novos.
- **Limites:** 100 insígnias no catálogo e 50 por pessoa.
- **Reversão:**
  ```sql
  DROP TABLE "UserBadge";
  DROP TABLE "Badge";
  ```
  Depois, apague `badges/` do armazenamento.

# ADR-0050: Configurações do servidor mais completas (sem plano pago)
Status: Accepted (pedido do mantenedor, 2026-11-05)

## Contexto
O mantenedor pediu configurações de servidor parecidas com as do Discord, com bastante personalização.
O OpenCord não tem assinatura paga, então tudo vale para qualquer servidor: faixa animada, fundo do convite, emojis animados.
O trabalho foi dividido em quatro levas:
1. Navegação agrupada e perfil do servidor.
2. Engajamento, faixa e fundo do convite.
3. Membros, convites, banimentos e auditoria.
4. Emojis personalizados.

Este ADR cobre as quatro levas, já entregues.

## Decisão
- **Migração aditiva `20261105020000_server_customization`:**
  - `Server`: `description`, `traits` (jsonb, até 5 `{emoji, label}`), `bannerColor`, `bannerKey`, `inviteBgKey`, `systemChannelId`, `welcomeEnabled`, `defaultNotify` e `invitesPaused`.
  - `ServerMember.inviteCode`.
  - `Invite.expiresAt` e `Invite.maxUses`.
  - Tabela `ServerEmoji`.
- **Migração `20261105030000_notify_default_mentions`:** o padrão de `defaultNotify` passa a ser `mentions`, que é como sempre funcionou. Com `all`, todo servidor passaria a avisar a cada mensagem.
- **Faixa:**
  - Pode ser uma de 10 cores prontas (`SERVER_BANNER_COLORS`, degradês desenhados no app) ou uma imagem enviada. A imagem pode ser PNG, JPEG, WebP ou GIF animado, até 4 MB.
  - Imagens: `POST/DELETE /servers/:id/banner`, servidas em `GET /server-banners/:name`.
  - Aparece no topo da lista de canais, na prévia e no convite.
- **Fundo do convite:** `POST/DELETE /servers/:id/invite-background`, servido em `GET /invite-backgrounds/:name`. A prévia do convite (`InvitePreview.server`) leva a faixa, o fundo, a descrição e as características.
- **Mensagens do sistema:**
  - `systemChannelId` precisa ser um canal de texto do servidor.
  - Com `welcomeEnabled`, o `WelcomeService` escuta `member.joined` (DomainEvents) e a conta de sistema OpenCord posta uma frase aleatória que menciona a pessoa.
  - A conta de sistema pode postar em qualquer canal de texto, sem moderação automática.
- **Notificação padrão:** com `all`, cada mensagem sem menção gera `notification` do tipo `message` para a sala do canal. A leitura de `defaultNotify` tem cache de 30 s. O app ignora o aviso das próprias mensagens e respeita o Não perturbe e a opção de notificações na área de trabalho.
- **Convites:**
  - Com `invitesPaused`, entrar por convite responde 400.
  - Convite vencido (`expiresAt`) ou esgotado (`maxUses`) responde 404.
  - O código usado fica guardado em `ServerMember.inviteCode`, para a tabela de membros da leva 3.
- **Tela:**
  - A barra das configurações do servidor fica agrupada em Servidor, Expressões, Pessoas, Apps e Moderação.
  - Abas novas: "Perfil do servidor" (antiga Visão geral, com faixa, características, descrição e prévia ao vivo), "Tema do servidor" e "Engajamento". O Engajamento junta mensagens do sistema, notificação padrão, canal de ausentes e fundo do convite.
- **Leva 3, sem migração:**
  - `POST /servers/:id/invites` aceita `maxAgeSec` (30 min a 7 dias, `INVITE_MAX_AGES`) e `maxUses` (1 a 100, `INVITE_MAX_USES`). Com um deles cria um convite novo; sem corpo continua devolvendo o convite permanente da pessoa.
  - `GET /servers/:id/invites` (MANAGE_SERVER) lista os convites com criador, usos, limite e validade.
  - `DELETE /invites/:code` pode ser usado por quem criou o convite ou por quem tem MANAGE_SERVER; fica no registro de auditoria.
  - A prévia de um convite vencido ou esgotado responde 404.
  - `GET /servers/:id/members/joins` (MANAGE_SERVER) diz por qual convite e de quem cada membro entrou.
  - `GET /servers/:id/audit-log` filtra por `actorId`, `action` (prefixo: `role` pega `role.*`) e `before`, este último para paginar.
  - Telas: aba Convites (pausar, criar com validade e limite, lista com copiar e apagar). Membros virou tabela, com busca, filtro por cargo, ordem, data de entrada, convite usado e páginas de 50. Banidos ganhou busca e a Auditoria ganhou filtros por autor e tipo, com "Carregar mais".
- **Leva 4, emojis personalizados (sem migração; a tabela `ServerEmoji` veio na primeira):**
  - Cada servidor tem até 50 emojis (`MAX_SERVER_EMOJIS`), com nome de 2 a 24 letras, números ou `_`, único no servidor.
  - GIF animado vale para todos, até 512 KB e 512 px. O app reduz as imagens paradas para 128 px.
  - Rotas: `POST /servers/:id/emojis?name=` (multipart, MANAGE_SERVER), `PATCH`/`DELETE /emojis/:id` e `GET /servers/:id/emojis`.
  - A imagem é pública em `GET /emojis/:id`, para aparecer onde quer que o texto vá.
  - Lista de cada servidor:
    - Vai em `ServerSummary.emojis`, por um índice em memória (`serverEmojiIndex`, mesmo padrão das insígnias), recarregado a cada 60 s e após cada mudança.
    - Chega a todos pelo `server:updated`.
  - **No texto e nas reações:** o token é `<:nome:id>` ou `<a:nome:id>`. Por isso `Emoji` aceita até 80 caracteres.
    - No compositor, `:nome:` vira o token ao enviar. Vale o emoji do servidor aberto ou, se não houver, o de qualquer servidor da pessoa: o uso entre servidores não é pago.
    - O botão de emojis do campo de mensagem lista os emojis por servidor.
    - As reações oferecem os emojis do servidor.
    - Mensagem só com emojis mostra grande.
  - Apagar um emoji apaga a imagem. Onde ele já foi usado, aparece o `:nome:` em texto.
  - **Limitação:** editar uma mensagem não converte `:nome:`, só o envio converte.
- Tudo exige MANAGE_SERVER e usa o `PATCH /servers/:id`, que já existia. A mudança chega a todos pelo `server:updated`.

## Alternativas descartadas
- **Recursos só para servidores "impulsionados":** não existe plano pago no OpenCord.
- **Mensagem de boas-vindas escrita por quem administra:** ficou para depois. Frases prontas evitam moderar um texto que a conta de sistema repete.
- **Cor livre na faixa:** as 10 cores prontas garantem contraste com o nome do servidor por cima. Quem quiser outra cor envia uma imagem.

## Consequências
- Clientes antigos ignoram os campos novos, que são opcionais no contrato.
- **Deploy:** as duas migrações rodam antes da API nova. As duas já foram aplicadas em produção.
- **Reversão:** derrubar as colunas novas de `Server`, `ServerMember.inviteCode`, `Invite.expiresAt`/`maxUses` e a tabela `ServerEmoji`. Ainda nada depende delas fora deste ADR.
- **Limitações:** a frase de boas-vindas é fixa. A notificação "todas as mensagens" só conta para quem está conectado: não há push, como no restante dos avisos. Ainda não existe silenciar um servidor ou canal por pessoa: com "todas as mensagens", a saída é o Não perturbe.

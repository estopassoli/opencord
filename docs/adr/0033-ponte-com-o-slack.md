# ADR-0033: Ponte com o Slack (canal espelhado nos dois sentidos)
Status: Accepted (pedido do mantenedor, 2026-11-01: "integração direto com o Slack", opção bidirecional)

## Contexto
Os webhooks de entrada (ADR-0030) já aceitam o formato do Slack, mas só num sentido e sem autoria. O mantenedor quer
um canal do OpenCord e um canal do Slack com as mensagens de um aparecendo no outro, com o nome de quem escreveu.

## Decisão
- **Um app do Slack por instância**, configurado por variáveis de ambiente (`SLACK_BOT_TOKEN` xoxb-…,
  `SLACK_SIGNING_SECRET`). Nada de token do Slack no banco: a instância é self-hosted e pertence a uma turma;
  quem administra a instância cria o app (escopos `chat:write`, `chat:write.customize`, `channels:read`,
  `channels:history`, `users:read`; Events API apontando para `<PUBLIC_API_URL>/integrations/slack/events` com o
  evento `message.channels`). Guia em `docs/SLACK.md`.
- **Tabela `SlackLink`**: canal de texto do OpenCord ↔ canal público do Slack (um para um, nos dois lados). Quem
  tem MANAGE_SERVER liga/desliga em Configurações do servidor → Slack, escolhendo o canal do Slack numa lista
  (`conversations.list`); a API tenta `conversations.join` para o bot entrar no canal.
- **OpenCord → Slack**: `MessagesService.create` emite o evento interno `message.created`; a ponte posta com
  `chat.postMessage` usando `username` = nome de quem escreveu (escopo customize), menções viram `@nome`, anexos
  viram links assinados. Mensagens de autores-fantoche do Slack não voltam (anti-eco).
- **Slack → OpenCord**: `POST /integrations/slack/events` (público, assinatura `v0=` HMAC-SHA256 do corpo bruto
  com janela de 5 min; `url_verification` responde o `challenge`). Só `message` sem subtipo (ou `file_share`) e
  sem `bot_id` (anti-eco: o que o próprio app posta volta com `bot_id`). Cada pessoa do Slack vira um usuário
  fantoche `slack-<id>` (`isWebhook`, selo APP, nome real via `users.info` com cache) e a mensagem entra pelo mesmo
  caminho dos webhooks (`postAsWebhook`). `event_id` repetido (reenvio do Slack) é ignorado.
- O corpo bruto das requisições JSON fica em `req.rawBody` (parser em `bootstrap.ts`), porque a assinatura do
  Slack cobre o texto exato.

## Alternativas rejeitadas
- **Token por servidor no banco** (cada servidor com seu workspace): segredo de terceiro no banco e OAuth de
  instalação para uma instância de amigos; não vale o custo agora.
- **Socket Mode** do Slack (sem endpoint público): exige conexão WebSocket persistente com o Slack e token de app
  extra; a API já é pública para o desktop, então a Events API basta.
- **Edição/remoção espelhadas, threads, reações**: fora desta fase; só mensagens novas.

## Consequências
- Migração `20261101050000_slack_links` (aditiva) e deploy pendentes de aprovação; sem app do Slack configurado,
  a aba mostra como configurar e nada mais acontece.
- Usuários fantoche se acumulam (um por pessoa do Slack que escrever); sem login, sem senha.
- Limite global por IP vale para o endpoint de eventos; o Slack reenvia até 3 vezes se a resposta demorar — por
  isso a entrada responde `200` na hora e processa depois.

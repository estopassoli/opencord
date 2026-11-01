# ADR-0030: Webhooks de entrada
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
A turma queria avisos de fora dentro do canal (servidor do jogo, GitHub, Twitch), sem escrever bot nenhum.

## Decisão
- **Tabela `Webhook`** (servidor, canal de texto, nome, `token` de 32 bytes, quem criou) e **um usuário por webhook**
  (`User.isWebhook`, `username = webhook-<id>`, sem senha, sem e-mail) que assina as mensagens. Assim a mensagem é uma
  mensagem comum (busca, fixar, reagir, responder funcionam) e `UserPublic.bot` liga o selo "APP". Migração aditiva
  `20261101020000_webhooks`.
- **Rotas:** `GET/POST /servers/:id/webhooks` e `DELETE /webhooks/:id` exigem `MANAGE_CHANNELS`; `POST
  /webhooks/:id/:token` é pública, compara o token em tempo constante, responde 404 para id ou token errado (sem
  revelar qual) e tem limite de 30/min por IP. Corpo: `{"content"}` (Discord) ou `{"text"}` (Slack), até 4000
  caracteres; o resto do JSON é ignorado, então o que já manda para Discord/Slack manda para cá.
- **Postagem** (`MessagesService.postAsWebhook`): não passa por `access` (o usuário do webhook não é membro); sem
  menções, anexos ou resposta; mesmos eventos de tempo real e o canal→quadro (ADR-0017) continua valendo.
- Apagar o webhook mantém o usuário dele (as mensagens antigas precisam de autor); o link morre na hora.
- Limite de 20 webhooks por servidor.

## Alternativas descartadas
- Autor = quem criou o webhook, com nome sobrescrito na mensagem: exigiria coluna e lógica especial em toda a UI.
- Webhooks de saída e bots interativos: fora do escopo (e abririam a instância para código de terceiros).

## Evidências (2026-10-31)
- `apps/api/test/webhooks.int.test.ts`: criar (canal de voz → 400; membro comum → 403), POST público vira mensagem
  com `author.bot` e o nome do webhook (evento em tempo real), estilo Slack, vazio → 400, token errado → 404,
  apagar → 404 para quem não gerencia, 204 para o dono, e o link para de funcionar.
- Desktop: typecheck, lint e unitários; selo "APP" ao lado do nome.
- **Pendente:** migração em produção (aprovação) e um serviço real apontando para o link.

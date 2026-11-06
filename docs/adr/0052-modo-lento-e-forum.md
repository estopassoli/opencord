# ADR-0052: Modo lento e canal de fórum
Status: Accepted (pedido do mantenedor, 2026-11-06)

## Contexto
O mantenedor pediu modo lento para os canais e um canal de fórum (posts com título e respostas em cada um).

## Decisão
- **Migração `20261106000000_slowmode_forum`** (aditiva): `Channel.slowmodeSec` (0 = desligado), `Message.title` e o valor `forum` em `ChannelKind`. Aplicada em produção antes do código (backup `opencord-pre-migration-20261106052812.dump`).
- **Modo lento:**
  - `PATCH /channels/:id` aceita `slowmodeSec` (0 a 21 600 s) em canais de texto e fóruns, com MANAGE_CHANNELS.
  - `MessagesService.create` recusa com 429 (`code: 'slowmode'`, `retryAfterSec`) a mensagem de quem escreveu no canal há menos que o intervalo. A última mensagem conta mesmo apagada, para apagar não furar a fila.
  - Quem tem MANAGE_MESSAGES ou MANAGE_CHANNELS não espera. Reenvio idempotente (mesmo `requestId`) devolve a original antes da checagem.
  - O app mostra a espera acima da caixa e não envia antes dela (`lib/slowmode.ts`); a API continua sendo a regra.
- **Fórum:**
  - Mensagem raiz é um post e precisa de `title` (até 100 caracteres). Resposta precisa de `replyToId` apontando para um post (não para outra resposta) e não leva título. Título fora do fórum é recusado.
  - `GET /channels/:id/posts?before&limit` lista os posts pela atividade mais recente (o post ou a última resposta não apagada), com paginação por essa data.
  - No app, o fórum é uma lista de cartões; abrir um post usa o painel de thread que já existia (respostas ao vivo e caixa para responder). No celular o post ocupa a tela.
  - Menções, notificações, busca, não lidas e moderação por IA valem como num canal de texto.

## Alternativas descartadas
- **Fórum como canal de texto com threads de verdade (canais filhos):** muito mais modelo (permissões, rooms, não lidas por thread) para o mesmo uso.
- **Modo lento só no app:** qualquer cliente (bot, API direta) furaria.

## Consequências
- `Message.title` só tem valor em posts de fórum; o DTO manda `title: null` nos demais.
- O fórum não tem tags nem posts fixados próprios (os fixados do canal continuam valendo).

# ADR-0053: Encaminhar mensagem
Status: Accepted (pedido do mantenedor, 2026-11-06)

## Contexto
O mantenedor pediu para compartilhar uma mensagem (um clipe, por exemplo) com outra pessoa ou outro canal de texto.

## Decisão
- **Migração `20261106010000_message_forward`** (aditiva): `Message.forwardedFromId` e `Message.forwardedChannelId`, UUID sem chave estrangeira. Sem FK de propósito: a cópia continua "encaminhada" mesmo se a original ou o canal dela for apagado; os ids só servem para o link "ver original".
- **`POST /messages/:id/forward`** `{ requestId, targets (1 a 5 canais ou conversas), note? }`:
  - quem encaminha precisa ler a mensagem (senão 404); mensagem sem texto, anexo nem embed (enquete sozinha) é recusada;
  - cada destino recebe uma cópia criada pelo `create` comum (permissão de enviar e anexar, castigo, bloqueio, modo lento, moderação por IA), com autor = quem encaminhou, sem menções (não notifica de novo) e com os embeds da original;
  - anexos viram arquivos novos no armazenamento (`StorageService.copy`: `CopyObject` no S3, cópia no disco), porque cada anexo tem a própria chave e apagar um não pode levar o outro;
  - o comentário vai logo depois, como mensagem comum;
  - um destino que falha não impede os outros: a resposta traz `{ messageId, error }` por destino. O `requestId` de cada cópia deriva do pedido, então reenviar não duplica.
- A cópia não pode ser editada (`400`).
- O `Message` ganha `forwarded: { messageId, channelId } | null`. Só ids: o app mostra "de #canal · servidor" e o link apenas se já conhece aquele canal, para não vazar nome de canal privado.
- No app: botão e item de menu "Encaminhar"; diálogo com busca entre conversas, amigos sem conversa (a DM é aberta no envio) e canais de texto onde a pessoa pode escrever; a cópia aparece com a etiqueta "Encaminhada" e borda à esquerda.

## Alternativas descartadas
- **Reaproveitar o mesmo arquivo do anexo:** `storageKey` é único e a limpeza apaga por chave.
- **Citar a original (como responder no privado):** quem recebe pode não ter acesso ao canal de origem.
- **Enviar pelo app (baixar e reenviar os anexos):** lento para vídeos grandes e gasta a banda de quem encaminha.

## Consequências
- Encaminhar um vídeo grande ocupa o espaço dele de novo no armazenamento.

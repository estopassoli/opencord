# ADR-0042: Responder no privado
Status: Accepted (pedido do mantenedor, 2026-11-03)

## Contexto
O mantenedor pediu: "qualquer user pode responder uma mensagem de um canal de texto no pv, … responder de forma privada mas marcando o comentario dele".

## Decisão
- **Coluna nova `Message.privateReplyToId`** (migração `20261103020000_private_reply`). É uma FK para `Message` com `ON DELETE SET NULL`.
  - Ela é separada de `replyToId` de propósito. `replyToId` alimenta a contagem e o painel de thread do canal, e uma DM citando o canal ali vazaria a conversa privada para a thread pública.
- **Regras no envio (`privateReplyToId` no REST e no `chat:message:create`):**
  - Só vale numa DM 1:1 entre quem responde e o autor da mensagem citada. Em grupo, ou com outra pessoa, devolve 400.
  - A mensagem citada precisa ser de canal, não estar excluída e estar num canal que quem responde lê (VIEW_CHANNEL e READ_HISTORY). Senão, devolve 404, que não confirma que a mensagem existe.
  - Não combina com `replyToId` (400).
- **Leitura:** `Message.privateReplyTo` traz:
  - id, autor, prévia de até 200 caracteres;
  - `deleted`;
  - canal e servidor (id e nome).
  - Original excluída: aparece com `deleted` e sem texto. Canal excluído: `null`.
- **App:**
  - "Responder no privado" no menu da mensagem e na barra de ações. Aparece só em mensagem de canal de outra pessoa, e não aparece para bots.
  - A ação abre ou cria a DM e mostra a faixa "Respondendo no privado a X em #canal", que Esc cancela.
  - Na DM, a citação é clicável e leva à mensagem no canal.

## Alternativas descartadas
- Reaproveitar `replyToId` entre destinos: misturaria DM nas threads do canal.
- Colar a citação no texto da mensagem: não teria link para a original nem acompanharia a exclusão dela.

## Consequências
- **Deploy:** a migração é aditiva e precisa rodar antes da API nova, porque o include lê a coluna. A API antiga ignora a coluna, e apps antigos ignoram o campo novo.
- **Privacidade:** a citação só aparece para as duas pessoas da DM. As duas já viam a mensagem: o autor, porque a escreveu, e quem responde, porque a checagem de canal exige isso.
- **Reversão:**
  ```sql
  ALTER TABLE "Message" DROP CONSTRAINT "Message_privateReplyToId_fkey";
  ALTER TABLE "Message" DROP COLUMN "privateReplyToId";
  ```

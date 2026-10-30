# ADR-0012 — Prévia das transmissões por byte stream do LiveKit
Status: Accepted (pedido do mantenedor, 2026-10-29)

## Contexto
- O mantenedor pediu: "quero que apareça previa das transmissoes aqui".
- O card de uma live que a pessoa ainda não assiste mostrava só "fulano está transmitindo".
- Assinar o vídeo para mostrar a prévia gastaria a banda da live inteira, e a live tem camada única (sem simulcast).

## Decisão
- Quem transmite envia uma miniatura JPEG de 320 px de largura (qualidade 0,6, ~8–20 KB):
  - a cada 4 s, só quando há mais alguém na sala;
  - pela própria sala do LiveKit, com `sendFile`, tópico `stream-preview`.
  - Nada passa pelo Socket.IO: mídia continua só na SFU.
- O token concede `canPublishData` **só a quem tem a permissão STREAM** (`permissionFor`, também aplicada em `updateParticipant`). Sem STREAM não há canal de dados.
- O receptor só aceita a miniatura quando:
  - o remetente está publicando tela;
  - o `mimeType` é `image/jpeg` e os bytes têm a assinatura JPEG;
  - o tamanho é de no máximo 48 KB;
  - a anterior do mesmo remetente chegou há pelo menos 1 s.
- A imagem é exibida como URL de blob, revogada ao trocar ou ao sair.

## Consequências
- **Tráfego:** ~5 KB/s por live, para cada pessoa na sala.
- **Risco:** quem pode transmitir pode mandar uma imagem arbitrária como prévia. É o mesmo que já pode mostrar na própria live.
- **Evidência:**
  - E2E `voice.spec.ts` (Go Live): B vê a miniatura (`naturalWidth` 320) antes de assistir.
  - Integração `voice.int.test.ts`: `canPublishData` só com STREAM.
  - Unit `test/preview.test.ts`.

## Revisão (2026-10-30)
- O mantenedor achou a miniatura pixelada: "coloque a imagem certinha só que com uma atualização de 5 em 5 min, com um blur".
- A imagem passa a ter 640 px de largura, JPEG 0,8 e teto de 256 KB.
- É enviada a cada 5 min, mais uma vez logo para quem entra na sala (`destinationIdentities`).
- No card ela aparece com blur leve.
- O tráfego cai para menos de 1 KB/s por live.

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

## Revisão: prévia no "Em atividade" (2026-10-30)
- Pedido do mantenedor: "aqui em atividade colocar a previa das lives… clicar na transmissao faz entrar no canal de voz e abre a transmissao em foco".
- Quem está fora da chamada não recebe o byte stream da sala. Por isso, quem transmite também publica a mesma prévia na API:
  - `POST /voice/stream-preview`, multipart, só JPEG pelos bytes, até 256 KB, só enquanto `streaming`;
  - a cada 5 min, e a primeira 3 s após começar;
  - a API guarda só a última no Redis (`voice:preview:<id>`, TTL 15 min) e marca `previewAt` no estado de voz (evento `voice:state:changed`);
  - `GET /voice/members/:id/stream-preview` entrega a imagem a quem tem VIEW_CHANNEL no canal da live (404 para os demais), com `Cache-Control: private, no-store`;
  - a imagem é apagada quando a live acaba.
- No card, o clique abre o canal, entra na chamada (se preciso), assiste e põe a live em destaque.
- É uma imagem estática por HTTP, não mídia contínua. Socket.IO continua sem mídia.
- Evidência: integração `voice.int.test.ts` (recusa sem live e não JPEG; quem vê o canal baixa; quem não participa recebe 404) e E2E `voice.spec.ts` (B vê a prévia de A em "Em atividade" e o clique leva à live em destaque).

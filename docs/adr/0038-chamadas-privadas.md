# ADR-0038: Chamadas privadas (voz, câmera e tela em conversas diretas e grupos)

Status: Accepted (pedido do mantenedor, 2026-11-02)

## Contexto
Até aqui só havia voz em canais de servidor. O mantenedor pediu "call privada": ligar direto numa conversa, a dois
ou em grupo, como se faz em mensagens diretas.

## Decisão
- **Mesma pilha de voz**, sem tabela nova: a sessão de voz (`StoredState` no Redis) ganha `conversationId` e
  `serverId` passa a ser nulo em chamada privada; o `channelId` da sessão é o id da conversa (UUIDs não colidem),
  então todo o resto (sets por "canal", limite de lotação, reconcile, webhooks da SFU, presença de mídia) segue igual.
  A sala da SFU é `roomNameFor('conv:' + id)`; os eventos (`voice:member:joined`, `voice:state:changed`,
  `voice:member:left`, com `conversationId`) vão para a sala da conversa no realtime, que os membros já assinam.
- **Entrar**: `POST /voice/conversations/:id/join` (só membros; bloqueio entre participantes recusa). Todos podem
  falar, ligar câmera e transmitir tela (não há cargos numa conversa). Quem abre a chamada (ninguém dentro) "toca"
  para os outros: `notification:created` com `kind: 'call'`; o app toca um som e mostra "Atender". `GET
  /conversations/:id/voice-states` lista quem está.
- **Não existem em chamada privada** (são do servidor): gravação, soundboard, atividades/Assistir juntos, música,
  silenciar/mover/desconectar pela moderação. A API responde 400 "indisponível em chamada privada"
  (`requireServerId`); o app esconde os botões.
- **App**: botão de telefone no cabeçalho da conversa começa a chamada; barra "Fulano na chamada · Entrar na
  chamada" aparece quando há gente; durante a chamada o palco fica em cima e a conversa embaixo
  (`.dm-call-split`); o painel do usuário mostra "Chamada privada"; perfil e lista de amigos mostram "chamada
  privada" no lugar do canal. Reconectar ao reabrir só vale para servidores (última chamada não é guardada).
- Contratos: `VoiceMemberState.serverId` nulo + `conversationId`; `VoiceJoinResponse.conversationId`;
  notificação `call`.

## Alternativas descartadas
- Canal de voz "fantasma" por conversa no banco: mexeria em permissões/listagens do servidor para algo que não é.
- Toque insistente (ring até atender): fica como notificação única + barra na conversa; evita spam e som preso.

## Consequências
- Lotação igual à dos canais (MAX_PER_CHANNEL). Quem está numa chamada de servidor e atende uma privada troca.
- Recursos de servidor desligados na chamada privada (lista acima); candidatos a entrar depois: música e Assistir juntos.
- Validação real (duas pessoas, câmera e tela) ainda pendente; testes cobrem a API.

## Evidências (2026-11-02)
- `apps/api/test/dm-calls.int.test.ts` 1/1 (entrar pela conversa com voz/câmera/tela liberados, toque `call` ao
  outro membro, evento `joined` com `serverId` nulo e `conversationId`, listagem, quem não é da conversa recebe 404,
  saída avisa a conversa) + `voice.int.test.ts` 16/16 com LiveKit real continuam verdes.
- Desktop: typecheck, lint e unit verdes (barra, palco em modo conversa, atender pela notificação).

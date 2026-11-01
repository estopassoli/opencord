# ADR-0029: Canal de voz "criador de salas" e salas temporárias
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
Para a turma se dividir (duas duplas, um grupo jogando outro jogo) era preciso criar canais de voz à mão, e eles
ficavam lá vazios. Pedido: um canal "➕ Criar sala" que gera uma sala só da pessoa e some quando esvazia.

## Decisão
- Duas colunas em `Channel` (migração aditiva `20261101010000_temporary_rooms`): `roomHub` (canal de voz que cria
  salas) e `temporary` (sala criada assim). Expostas no contrato `Channel`; `roomHub` aceito em criar/editar canal
  (só voz; exige `MANAGE_CHANNELS` como qualquer canal).
- **Entrar no criador** (`VoiceService.join`): cria a sala "Sala de {nome}" na mesma categoria, logo abaixo do criador,
  copiando os overrides dele (quem pode entrar no criador pode entrar na sala), e a pessoa entra **nela**; o
  `VoiceJoinResponse.channelId` devolve a sala e o app atualiza o canal da máquina de voz (`AUTHORIZED.channelId`).
  Não passa por `MANAGE_CHANNELS`: quem tem `CONNECT` no criador abre salas.
- **Esvaziou, sumiu**: ao encerrar qualquer sessão (sair, cair, kick, mover), se o canal é temporário e o conjunto
  `voice:channel:<id>` do Redis está vazio, a sala é apagada (`channel:deleted` para o servidor, evento de domínio
  para a SFU). Sem cron: a limpeza acontece no fluxo normal de saída; o `reconcile` existente cobre sessões perdidas.
- Limite de canais do servidor vale também para as salas.

## Alternativas descartadas
- Salas só no Redis (sem linha em `Channel`): todo o app (permissões, lista, voz) espera um canal de verdade.
- Apagar por tempo ocioso: esvaziar já é o sinal certo.

## Evidências (2026-10-31)
- `apps/api/test/voice.int.test.ts` "criador de salas": criar canal com `roomHub`, texto com `roomHub` → 400, entrar
  cria a sala (evento `channel:created` com `temporary`), o estado de voz aponta para a sala, sair apaga
  (`channel:deleted`, linha some) e o criador fica.
- `packages/media` unitário: `AUTHORIZED` com `channelId` troca o canal da máquina.
- **Pendente:** migração em produção (aprovação do mantenedor) e uso real.

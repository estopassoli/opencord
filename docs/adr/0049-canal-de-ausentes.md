# ADR-0049: Canal de ausentes
Status: Accepted (pedido do mantenedor, 2026-11-05)

## Contexto
O mantenedor pediu um canal de ausentes por servidor: quem fica parado em voz é movido para ele automaticamente.

## Decisão
- **Configuração no servidor:** `Server.afkChannelId` e `Server.afkTimeoutSec` (migração `20261105010000_afk_channel`).
  - Os limites aceitos são 1, 5, 15, 30 e 60 minutos (`AFK_TIMEOUTS`).
  - O canal precisa ser de voz, do próprio servidor, e não pode ser o criador de salas nem uma sala temporária.
  - A edição exige MANAGE_SERVER e usa o `PATCH /servers/:id` que já existia. O valor chega a todos pelo `server:updated`.
- **Quem decide é o app desktop** (`lib/afk.ts`).
  - O processo principal já informa a cada 30 s o tempo do computador sem teclado nem mouse (`powerMonitor`, usado também pelo ausente automático).
  - O app move a pessoa quando ela está numa chamada de servidor que tem canal de ausentes, e o tempo parado chegou ao limite.
  - **Não move se:** ela falou nesse intervalo (quem conversa sem tocar no computador não está ausente), está transmitindo a tela ou já está no canal.
  - **Como move:** entra no canal pelo `join` normal, que respeita CONNECT, silencia o próprio microfone e mostra um aviso.
- **Configurações do servidor → Visão geral:** seção "Canal de ausentes", com o canal e o limite.

## Alternativas descartadas
- **Decidir no servidor:** o servidor não sabe se a pessoa está mexendo no computador. Só a fala seria um sinal ruim, porque quem ouve calado não é ausente.
- **Mover sem permissão de CONNECT no canal:** daria um caminho para entrar em canal fechado. Quem configura deve deixar o canal aberto para os membros.

## Consequências
- O navegador não move ninguém, porque não informa o tempo parado do computador. A tela diz que vale só para o app desktop.
- **Deploy:** a migração é aditiva e roda antes da API nova. Clientes antigos ignoram os campos novos.
- **Reversão:** `ALTER TABLE "Server" DROP COLUMN "afkChannelId", DROP COLUMN "afkTimeoutSec";`

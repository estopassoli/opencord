# ADR-0028: Eventos do servidor com confirmação de presença
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
A turma combinava jogatinas fora do OpenCord. Faltava um lugar para marcar "sexta 21h, raid", ver quem vai e ser
lembrado na hora.

## Decisão
- **Tabelas novas** `ServerEvent` (servidor, canal de voz opcional, quem criou, título, descrição, início, fim
  opcional) e `EventRsvp` (`going` | `maybe`, chave evento+pessoa). Migração aditiva
  `20261101000000_server_events`; reverter = `DROP TABLE` das duas.
- **Rotas** `GET/POST /servers/:id/events`, `PATCH/DELETE /events/:id`, `PUT /events/:id/rsvp`. Qualquer membro
  cria (e já entra como "vou"); edita/apaga quem criou ou tem `MANAGE_CHANNELS`. O canal precisa ser de voz do
  mesmo servidor e a pessoa precisa de `CONNECT` nele. Início no futuro (tolerância de 1 min), no máximo 1 ano à
  frente; fim depois do início.
- **Lista** = em andamento + futuros, do mais próximo ao mais distante (50 no máximo). Evento sem fim some 6 h depois
  de começar; com fim, some ao terminar. Nada é apagado automaticamente.
- **Tempo real** pela room do servidor: `event:changed` (criado, editado, presença) e `event:deleted`. O evento
  retransmitido não carrega a resposta de cada um (`me` = null); o app preserva a sua.
- **Lembretes no app** (`src/lib/event-reminders.ts`), sem cron no servidor: a cada minuto, 15 min antes e na hora,
  para quem respondeu "vou" ou "talvez"; notificação do sistema + aviso com "Entrar na chamada". Marcados como vistos
  em `localStorage` para não repetir.
- **UI:** linha "Eventos" no topo da lista de canais (com o próximo e a contagem) abre a janela com os cartões e o
  formulário (`datetime-local` do kit, canal de voz, descrição).

## Alternativas descartadas
- Lembrete pelo servidor (fila/cron): mais infraestrutura para o mesmo resultado numa instância pequena. Se a turma
  usar o celular sem o app aberto, revisitar.
- Eventos recorrentes: fora da primeira versão.

## Evidências (2026-10-31)
- `apps/api/test/events.int.test.ts` (3 testes): criar/listar/presença com evento em tempo real; permissões, 404 de
  fora, validações; filtro de encerrados. Migração aplicada com `migrate deploy` no banco de teste.
- Desktop: typecheck, lint, unitários (`test/events.test.ts`: rótulo hoje/amanhã/dia da semana).
- **Pendente:** migração em produção (precisa de aprovação do mantenedor) e uso real pela turma.

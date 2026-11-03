# ADR-0040: Salas privadas (canal privado e sala temporária trancada)

Status: Accepted (pedido do mantenedor, 2026-11-03)

## Contexto
O mantenedor pediu "criação de salas privadas" e escolheu as duas leituras: um canal privado permanente do servidor
(como no Discord) e a sala temporária (ADR-0029) que a pessoa tranca para só entrar quem ela chamar.

## Decisão
- **Sem conceito novo de permissão**: tudo é override de canal (`ChannelPermissionOverride`), já validado e aplicado
  na SFU pelo `permissions.changed` (`VoiceService.reevaluateServer`).
- **Canal privado**: `CreateChannelRequest.private` + `allowedRoleIds`/`allowedUserIds` cria o canal com o @everyone
  negando `VIEW_CHANNEL`, os cargos e membros escolhidos (e quem criou) liberados. `UpdateChannelRequest.private`
  liga/desliga só o bit do @everyone (as liberações ficam). Exige `MANAGE_CHANNELS`, como criar canal.
- **Sala trancada**: a sala temporária ganha dona (`Channel.ownerId`) e limite de vagas (`Channel.userLimit`).
  Trancar = @everyone e cargos perdem `CONNECT` (continuam vendo); quem já está dentro ganha override próprio.
  Rotas: `POST /channels/:hub/rooms` (cria já trancada/com limite), `PATCH /rooms/:id` (nome, tranca, vagas),
  `POST /rooms/:id/invite` (override de membro + aviso `room_invite` com "Entrar"), `DELETE /rooms/:id/members/:u`
  (tira da voz e do convite), `POST /rooms/:id/knock` (aviso `room_knock` para a dona com "Deixar entrar").
  A dona ou quem tem `MANAGE_CHANNELS` manda na sala. Dona que sai com gente dentro passa a sala a quem ficou;
  vazia, a sala some como antes. Limite de vagas não vale para a dona nem para quem tem `MOVE_MEMBERS`.
- **Flags calculadas na API**: `Channel.locked` e `Channel.private` vêm prontos para todos, porque os overrides só
  vão a quem gerencia cargos/canais.
- **App**: interruptor "Canal privado" com escolha de cargos e pessoas no "Criar canal"; cadeado na lista; contador
  de vagas; menu da sala (trancar, convidar, vagas, renomear); "Criar sala trancada…" no criador de salas; clicar em
  sala trancada (ou o botão do palco) vira "Pedir para entrar"; "Remover da sala" no menu da pessoa.

Migração `20261103010000_private_rooms` (aditiva): `Channel.ownerId`, `Channel.userLimit`.

## Alternativas descartadas
- Senha de sala: mais uma coisa para lembrar; convite e "pedir para entrar" cobrem o caso de amigos.
- Tabela própria de convites de sala: override de membro já é o convite, já some com a sala e já vale na SFU.

## Consequências
- A sala trancada continua visível (quem vê sabe que existe e pode pedir); canal privado some para quem não foi
  liberado.
- Tirar alguém da sala apaga o override dela (perde o convite); se a pessoa tinha outro override no canal, ele vai
  junto, o que é aceitável numa sala temporária.

## Evidências (2026-11-03)
- `apps/api/test/rooms.int.test.ts` 4/4: canal privado (só escolhidos veem, membro comum recebe `private` sem
  overrides, tornar público e privado de novo, sem MANAGE_CHANNELS 403); sala trancada (criada trancada com 2 vagas,
  membro vê `locked`, 403 ao entrar, pedido chega à dona, só a dona convida, convite chega, cheia 400, remover tira
  da voz e do convite, dona sai e a sala passa adiante, nova dona destranca); trancar depois não derruba quem está.
  Suíte 204/204.
- Desktop: typecheck, lint, unit; capturas headless (cadeado, vagas, "Pedir para entrar", menus, canal privado).

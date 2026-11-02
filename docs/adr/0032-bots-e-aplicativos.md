# ADR-0032: Bots e aplicativos (plataforma para quem desenvolve)
Status: Accepted (pedido do mantenedor, 2026-11-01)

## Contexto
O mantenedor quer que pessoas que desenvolvem criem seus próprios bots, "como no Discord", e que portar um bot
escrito para o Discord seja fácil. Hoje só existem webhooks de entrada (ADR-0030): recebem texto, não respondem,
não têm comandos. Regra do projeto: não copiar código, assets nem protocolos internos de terceiros — a
compatibilidade é só de **forma de uso** (nomes e assinaturas públicas que a comunidade já conhece), implementada
do zero sobre a API e o gateway do OpenCord.

## Decisão
- **Bot = usuário com token.** Tabela `Bot` (dono, descrição, público, `tokenHash`, `commands` JSON, `lastSeenAt`)
  ligada a um `User` com `isBot=true` (`bot: true` no `UserPublic`, selo APP). O bot entra em servidores como
  membro comum (quem tem MANAGE_SERVER adiciona em Configurações do servidor → Bots) e recebe cargos como qualquer
  pessoa: as permissões que valem são as de membro, sem um sistema paralelo.
- **Mesma API, mesmo gateway.** O token `ocb_<32 bytes base64url>` (só o SHA-256 fica no banco; o claro aparece uma
  vez, ao criar ou regenerar) é aceito no `Authorization: Bearer` e no handshake do Socket.IO. `TokenService`
  reconhece o prefixo e devolve `AuthUser { userId: <usuário do bot>, sessionId: 'bot:<id>' }`. Toda rota
  existente (mensagens, reações, membros, canais, presença) vale para o bot sem código novo; o gateway entrega os
  mesmos eventos (`chat:message:created`, `server:member:joined`…) porque o bot está nas mesmas rooms de membro.
- **Comandos de barra.** O bot registra `PUT /bots/@me/commands` (nome, descrição, opções tipadas: string, integer,
  number, boolean, user, channel; escolhas). O app lista `GET /servers/:id/commands` (dos bots membros) no composer ao
  digitar `/`, e envia `POST /interactions {channelId, botId, command, options}`. A API valida permissão
  (SEND_MESSAGES no canal), valida as opções contra a definição, guarda a interação no Redis (TTL 180 s; 15 min
  após `defer`) e emite `interaction:created` só para o usuário do bot (room `user:<id>`). Sem o bot conectado →
  409. O bot responde com `POST /interactions/:id/reply {content, ephemeral}`: efêmera vira o evento
  `interaction:replied` só para quem usou o comando; normal vira mensagem comum do bot no canal (devolve
  `messageId`, que o SDK edita com `PATCH /messages/:id`). `POST /interactions/:id/defer` avisa "pensando…".
- **SDK `@opencord-chat/bot`** (`packages/bot-sdk`, Node 20+): `Client`, eventos (`ready`, `messageCreate`,
  `interactionCreate`, …), `Message.reply/react`, `ChatInputCommandInteraction.reply/deferReply/editReply` com
  `options.getString/getInteger/…`, `SlashCommandBuilder`, `EmbedBuilder` (vira markdown), `Events`,
  `GatewayIntentBits` (aceito e ignorado). Trocar o import de `discord.js` e o token costuma bastar para um bot de
  comandos e mensagens; o guia de portabilidade está em `docs/BOTS.md`.
- **Telas.** Configurações → Aplicativos (meus bots: criar, token uma vez, regenerar, público, excluir);
  Configurações do servidor → Bots (adicionar da lista pública ou por id, remover); composer com autocompletar de
  `/comandos` e respostas efêmeras na conversa ("só você vê").

## Alternativas rejeitadas
- **Compatibilidade de fio com a API do Discord** (mesmos caminhos, snowflakes, opcodes do gateway, intents) para
  rodar o discord.js sem mudar nada: enorme, frágil e beira reproduzir protocolo de terceiro. O SDK com a mesma forma
  de uso resolve o porte com um import.
- **Bots só por webhook de saída** (a API chama uma URL do bot): exige que quem desenvolve exponha um servidor
  público; a conexão de saída pelo gateway roda em qualquer máquina atrás de NAT.
- **OAuth2 para instalar bots**: para uma instância self-hosted de amigos, adicionar pelo painel do servidor basta.

## Consequências
- Migração `20261101040000_bots` (aditiva; reversão documentada no SQL) e deploy da API em produção: pendentes de
  aprovação do mantenedor, como as anteriores.
- Rotas sensíveis a sessão (`sessionId` de bot não é UUID): o código que consulta `Session` pelo id precisa ignorar
  `bot:*`. Limites: 10 bots por pessoa, 50 comandos por bot, 10 opções por comando; limite global de requisições por
  IP vale para bots.
- Sem voz, botões, menus ou modais nesta fase; embeds viram markdown. Não há loja nem verificação de bots.

## Adendo (2026-11-02): nome no npm e licença do SDK
- O escopo `@opencord` no npm pertence a outro projeto (opencord.xyz, `@opencord/client`) e `opencord` sem escopo é
  uma lib de terceiros. O SDK passa a chamar `@opencord-chat/bot` (organização `@opencord-chat`, livre na data). O
  pacote interno `@opencord/contracts` mantém o nome: é privado e nunca sai do monorepo.
- **Licença do SDK: MIT** (decisão do mantenedor). Com AGPL todo bot que importasse o SDK herdaria a licença; para um
  SDK, MIT é o que a comunidade espera. Só `packages/bot-sdk` muda; o restante continua AGPL-3.0-only.
- **Autossuficiência:** o SDK importa apenas tipos do contracts, então o JS publicado não depende dele. O build
  (`scripts/bundle-types.mjs`) copia as declarações do contracts para `dist/contracts/` e reescreve os imports dos
  `.d.ts`; `zod` vira dependência porque essas declarações o referenciam. `prepack` (`scripts/check-pack.mjs`) recusa
  um tarball que ainda referencie `@opencord/contracts` ou que não seja MIT.
- **Publicação:** workflow `publish-sdk.yml` em tag `bot-sdk-vX.Y.Z` (precisa bater com `package.json`), com
  "trusted publishing" do npm (OIDC, `--provenance`), sem token guardado. Pendente do mantenedor: criar a organização
  `@opencord-chat` no npm, o pacote, e configurar o publicador confiável (repositório `estopassoli/opencord`, workflow
  `publish-sdk.yml`). Nenhuma publicação acontece sem a tag.


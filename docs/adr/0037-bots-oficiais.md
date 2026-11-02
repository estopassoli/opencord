# ADR-0037: Bots públicos oficiais (YOU6, Dínamo, Carlos, Dank Mineiro, Tíquete, Oráculo)

Status: Accepted (pedido do mantenedor, 2026-11-02)

## Contexto
O mantenedor pediu "os bots famosos do Discord" no OpenCord, públicos (qualquer servidor adiciona) e rodando na
nossa infra. Regra do projeto: nada de copiar nome, marca, logo ou código de terceiros. Combinado: trazer as
**funções** que os tornam conhecidos, com nomes-trocadilho que lembram sem confundir e fotos de perfil nossas.

## Decisão

### Os bots (`apps/bots`, um processo, SDK `@opencord-chat/bot`)
| Bot | Lembra | O que faz |
|---|---|---|
| **YOU6** | bots de níveis | XP por mensagem (15–25, 1/min), `/nivel`, `/ranking`, cargo por nível, boas-vindas com `{pessoa}` `{servidor}` `{membros}` |
| **Dínamo** | bots de automod | palavras proibidas (sem acento/maiúscula), bloqueio de links, antiflood, `/aviso dar/listar/limpar`, castigo automático a cada N avisos, canal de registro |
| **Carlos** | bots de utilidades | `/tag` (respostas prontas com autocompletar), `/lembrar`, `/sorteio` com botão Participar (encerra sozinho, resorteia), `/escolher`, `/dado`, `/sortear` |
| **Dank Mineiro** | bots de economia/memes | `/diario`, `/trabalhar`, `/apostar`, `/caraoucoroa`, `/roubar`, `/pagar`, `/ricos` (moedas de brincadeira) |
| **Tíquete** | bots de tickets | painel com botão → canal privado (overrides: @everyone não vê; pessoa, bot e cargo da equipe veem), botão Fechar |
| **Oráculo** | bots de IA | `/pergunte`, `/resumo` do canal, `/traduzir`, menu "Explicar mensagem" (Claude Haiku 5.5 pela ANTHROPIC_API_KEY) |

- Persistência: SQLite por processo (`node:sqlite`, sem dependência nativa) em `DATA_DIR` (volume `/data`).
  Sorteios e lembretes pendentes voltam depois de reiniciar.
- Permissões: cada bot entra só com @everyone; quem adiciona dá um cargo ao bot (Dínamo: Gerenciar mensagens +
  Castigar membros; Tíquete: Gerenciar canais + Gerenciar cargos). Sem isso, o bot explica o que falta.
- Fotos de perfil: PNGs geométricos gerados por nós (`apps/bots/avatars`), enviados pelo próprio bot na primeira
  subida (`POST /me/avatar`).

### Tokens sem segredo colado à mão (`POST /bots/official/claim`)
Rota pública da API guardada por `OFFICIAL_BOTS_SECRET` (mesmo valor nos dois containers): o container dos bots
manda `{ key, name, description, secret }` e recebe o bot **público, do criador da instância** (dono do servidor
oficial), criado na primeira vez e reconhecido depois por `Bot.officialKey` (migração `20261102050000_official_bots`,
`@@unique([ownerId, officialKey])`). Cada subida gira o token (o antigo deixa de valer). Também aceita
`BOT_TOKEN_<KEY>` no ambiente para rodar fora da infra. Sem segredo configurado a rota responde 404.

### Infra
`infra/docker/bots.Dockerfile` (node 24, `pnpm deploy` do pacote) e serviço `bots` no compose (`OPENCORD_URL`,
`OFFICIAL_BOTS_SECRET`, `ANTHROPIC_API_KEY`, volume `botsdata`). Em produção: mesma imagem, ao lado da API.

## Alternativas descartadas
- Nomes e avatares idênticos aos originais: marca de terceiros; o trocadilho dá o reconhecimento sem confundir.
- Um container por bot: seis processos para o mesmo trabalho; um processo com clientes separados basta.
- Banco Postgres para os bots: a API já tem o dela; os bots guardam pouco e SQLite dispensa migrações.
- Tokens colados no painel: exigiria o mantenedor criar seis bots e copiar seis segredos; o claim resolve com um.

## Consequências
- Mais um serviço na infra (pequeno). O Oráculo gasta tokens da Anthropic por comando (Haiku 5.5; centavos).
- Bots famosos que dependem de voz (música) ficam de fora por enquanto: o SDK não expõe eventos de voz nem
  entrada em canal de voz. Candidato a próxima ADR.
- Migração `official_bots` antes da API nova (duas etapas, como as outras de hoje).

## Evidências (2026-11-02)
- `apps/bots/test/logic.test.ts` 11/11 (curva de XP, automod, duração, sorteio, chances, slug, SQLite).
- `apps/api/test/official-bots.int.test.ts` 2/2 (claim cria público do criador; segunda vez só gira o token e o
  antigo morre; aparece no diretório; segredo errado 403, chave inválida 400).
- Prova real contra a API local (`scratchpad/rn/smoke-bots.out`): 6 bots sobem, enviam foto e registram comandos;
  `/nivel`, `/ranking`, `/diario`, `/trabalhar`, `/apostar`, `/saldo`, `/ricos`, `/tag criar/ver`, `/dado`,
  `/escolher`, `/lembrar`, `/sorteio criar` + botão Participar (contador 1), `/automod palavras adicionar` +
  mensagem "seu BOBAO" apagada com aviso 1, `/aviso listar`, `/ticket painel` + botão abre `ticket-bruno-…` com
  overrides corretos, `/pergunte` e `/traduzir` (stub da Anthropic) respondem.

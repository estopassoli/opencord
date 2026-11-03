# ADR-0036: Moderação por IA (Claude) antes de publicar

Status: Accepted (pedido do mantenedor, 2026-11-02)

## Contexto
O mantenedor quer que toda mensagem e todo anexo (texto, imagem, vídeo) passem por um modelo de linguagem antes de ir
ao ar, com análise do contexto da conversa. Quando a IA tiver certeza, decide sozinha; quando ficar em dúvida, não
publica e passa o envio para os administradores, que aprovam ou reprovam (e podem punir). O modelo é da Anthropic,
o mais barato possível.

## Decisão

### Modelo e custo
`claude-haiku-5-5` por padrão (`MODERATION_AI_MODEL`): o modelo mais barato da Anthropic (US$ 0,10 por milhão de
tokens de entrada, US$ 0,50 de saída), com visão. Uma mensagem de texto com contexto gasta ~1,5 mil tokens de entrada
(prompt de sistema em cache, ~90 % mais barato) e ~80 de saída: na casa de US$ 0,0002 por mensagem; uma imagem
acrescenta ~1,5 mil tokens. `output_config.effort: 'low'` e resposta estruturada (`zodOutputFormat`) deixam a
resposta curta e previsível. O modelo pode ser trocado por variável de ambiente sem mexer no código.

### Fluxo (`MessagesService.create`/`edit` → `AiModerationService`)
1. Só roda com `ANTHROPIC_API_KEY` e com a chave "Moderação por IA" ligada no painel da instância
   (`InstanceConfig.aiModeration`, padrão ligada). Mensagens diretas só entram com `aiModerationDms` (padrão
   desligado: privacidade). Super admins e webhooks não passam pela IA; bots passam.
2. Contexto enviado: nome do servidor, canal e tópico, **regras do servidor** (`Server.aiRules`, editadas por quem
   gerencia o servidor), as 12 últimas mensagens do destino (autor + texto), o autor e o texto do envio, a lista de
   anexos e, como blocos de imagem, as imagens (reduzidas a 1280 px quando grandes; GIF vira um quadro) e até 4
   quadros espalhados de cada vídeo (ffmpeg/ffprobe, agora na imagem da API). Áudio e outros arquivos entram só
   pelo nome e tipo. Limite de 8 imagens por envio.
3. Três vereditos: `allow` publica; `block` (certeza de violação grave) responde **422** com o motivo e grava um
   `ModerationCase` com status `blocked`; `review` (dúvida) responde 422, grava o caso como `pending`, prende os
   anexos ao caso (`Attachment.caseId`: não expiram como órfãos) e avisa os moderadores na hora
   (`moderation:case:created` + notificação). Edição de mensagem também passa; em dúvida vira bloqueio (não há como
   "publicar depois" uma edição) e o texto original fica.
4. Revisão (`POST /moderation/cases/:id/review`, exige `MODERATE_MEMBERS` no servidor; DMs só o super admin):
   **aprovar** publica a mensagem original com o mesmo `requestId`, resposta e anexos, sem nova análise; **reprovar**
   apaga os anexos e pode punir (castigo de 10 min a 7 dias, expulsão ou banimento) pelas regras de hierarquia já
   existentes. O autor recebe notificação do resultado. Tudo vai para a auditoria do servidor (`ai.held`,
   `ai.blocked`, `ai.approved`, `ai.rejected`).
5. IA fora do ar ou lenta (`MODERATION_AI_TIMEOUT_MS`, padrão 12 s; o SDK tenta uma segunda vez): **libera** a
   mensagem e registra em log (fail-open: a conversa dos amigos não pode parar porque um serviço externo caiu).
   `MODERATION_AI_FAIL_CLOSED=true` inverte: retém para revisão com motivo "IA indisponível".
6. Recusa do próprio modelo (`stop_reason: refusal`): tratada como dúvida (vai para a fila).

### Interface
- Configurações do servidor → **Moderação** (quem tem `MODERATE_MEMBERS`): regras para a IA (quem gerencia o
  servidor), fila de envios retidos com autor, canal, categoria, motivo da IA, texto e prévias dos anexos, botões
  "Aprovar e publicar" e "Reprovar…" (motivo + punição). Atualiza em tempo real.
- Painel do super admin → **Moderação IA**: ligar/desligar, incluir DMs, modelo em uso, fila de toda a instância.
- Quem envia recebe o aviso do app com o motivo (retido ou bloqueado) e, depois, a decisão.
- Moderadores online recebem um aviso com "Revisar" quando entra algo na fila.

### Prompt
Prompt de sistema fixo (em cache) descreve o produto (chat de amigos: palavrão e zoeira são normais), as três
decisões com exemplos do que é bloqueio seguro e do que é dúvida, o peso das regras do servidor e do histórico, e
tolerância maior em DMs. O envio vai na mensagem de usuário com o contexto. Saída: `{ decision, category,
confidence, reason }`.

### Bloqueio automático e de dispositivo (adendo, mesmo dia)
Pedido do mantenedor: em agravantes (pornografia etc.) bloquear a pessoa sozinho, "por MAC address". Não existe MAC
visível pela internet (fica na rede local; o navegador não expõe), então o bloqueio é por **dispositivo**:
- Chaves no painel do super admin → Moderação IA: "Bloquear automaticamente quem envia conteúdo grave" e "Também
  bloquear o dispositivo" (ambas desligadas por padrão). Agravantes = `block` nas categorias `sexual`, `menores` ou
  `violencia` com confiança ≥ 0,85 (`isSevere`). Super admins nunca.
- Ação (`ModerationHoldService.autoBlock`): conta suspensa na instância (`User.disabledAt`), `ServerBan` e saída do
  servidor onde aconteceu, todas as sessões revogadas (cache de token invalidado, sockets derrubados), caso marcado
  com `autoAction`, auditoria `ai.autoblock`; a resposta 422 (`moderation_autoblock`) avisa o autor. O caso continua
  na fila para um moderador rever; reativar a conta (painel → Usuários → reativar) também remove os bloqueios de
  dispositivo que vieram dela.
- Dispositivo (`DeviceBan`, `kind`/`value` únicos): `hardware` = SHA-256 dos MACs físicos ordenados, calculado no
  processo principal do Electron (`electron/shared/hardware-id.ts`) e enviado em todo pedido no cabeçalho
  `x-hardware-id` (só o hash sai da máquina); `device` = identificador do app no aparelho (`deviceId`, já existia);
  `ip` = IP de origem (IPs privados nunca entram). As sessões passam a guardar `hardwareId` e `ip`. Ao bloquear, os
  três valores das sessões dos últimos 30 dias da pessoa viram bloqueios; `assertAllowed` recusa (403 "este
  dispositivo está bloqueado nesta instância") em apelido, cadastro, login e refresh. No navegador o aparelho só é
  reconhecido pelo `deviceId` (localStorage) e pelo IP: quem limpar o navegador e trocar de IP volta; no app desktop
  trocar de placa de rede também burla. Painel lista os bloqueios (valor mascarado) com "Desbloquear".
- Vídeos: quadros passam a escalar com a duração (1 a cada 10 s, mínimo 4, máximo 10; `framesFor`), teto de 12
  imagens por envio.
- Migração `20261102040000_device_bans` (Session.hardwareId/ip, DeviceBan, InstanceConfig.aiAutoBlock/
  aiAutoBlockDevice, ModerationCase.autoAction), aditiva.

## Alternativas descartadas
- Moderar depois de publicar e apagar: o mantenedor pediu decisão antes de publicar.
- Modelo maior (Sonnet/Opus) por padrão: 20–40× mais caro por mensagem; a classificação curta com contexto é o caso de
  uso do Haiku. Fica trocável por variável de ambiente.
- Transcrever áudio: custo e latência; áudio vai só pelo nome/tipo por enquanto.
- Fail-closed por padrão: derrubaria a conversa a cada instabilidade da API.

## Consequências
- Latência extra no envio (≈ 1–3 s em texto; mais com vídeo) enquanto a IA responde.
- Custo mensal proporcional ao volume (estimativa: 10 mil mensagens/dia ≈ US$ 2/dia com Haiku).
- Migração `20261102030000_ai_moderation` (ModerationCase, Attachment.caseId, Server.aiRules,
  InstanceConfig.aiModeration/aiModerationDms) precisa rodar em produção ANTES da API nova; a imagem da API ganha
  `ffmpeg`. A chave `ANTHROPIC_API_KEY` é segredo de produção: só o mantenedor define.
- O conteúdo retido (texto e arquivos) fica no banco/armazenamento até a decisão; reprovado apaga os arquivos.

## Evidências (2026-11-02)
- `apps/api/test/ai-moderation.int.test.ts` 7/7 contra um stub da API da Anthropic: contexto do canal e regras no
  prompt, bloqueio (422 + caso `blocked`, fila negada a quem não modera), dúvida com imagem (bloco de imagem enviado,
  anexo preso ao caso, aviso ao dono, aprovar publica com anexo e sem nova chamada, decisão única), reprovar com
  castigo (anexo apagado, castigo aplicado, autor avisado, fila da instância), fail-open com IA em erro, super admin e
  DM fora, painel desliga, edição retida mantém o texto. Suíte de integração completa 186/186.
- Desktop: typecheck, lint e unit 201/201 (abas novas compilam; comportamento de UI sem captura ainda).
- Adendo (bloqueio automático): `ai-moderation.int.test.ts` +3 (desligado só bloqueia a mensagem; ligado com
  dispositivo suspende, bane, derruba a sessão, bloqueia hardware+device (IP local fora), recusa apelido novo do mesmo
  aparelho/identificador e aceita outro, painel lista, reativar libera; super admin nunca); `media.test.ts`
  (`framesFor`); desktop `hardware-id.test.ts` (hash estável, ignora loopback/zerado, MAC não aparece).
- Pendente: validação com a chave real da Anthropic em produção (qualidade dos vereditos e latência).

## Adendo (2026-11-03): revisão do que bloqueia
Pedido do mantenedor depois de casos reais na fila (convite do próprio app retido como golpe, "ai" retido como
assédio por causa do histórico):
- Mensagem só com link(s) e sem anexo publica sem chamar a IA (`onlyLinks`).
- A IA julga só o envio; o histórico serve para entender o tom, nunca para barrar um envio inofensivo.
- "review" fica para mídia que pode ser nudez/gore, ameaça ou doxxing sem certeza e regra explícita do servidor;
  zoeira, palavrão, discussão, contexto insuficiente e link passam.
- DMs: nunca retém para revisão. Bloqueia só `menores`, `sexual`, `violencia` e `doxxing` com confiança ≥ 0,8; o
  resto publica. A regra está no código (`classify` com `direct`), não só no texto da IA.
- Evidência: `ai-moderation.int.test.ts` 12/12 (links sem IA; DM com dúvida e ódio publicam, nudez bloqueia).


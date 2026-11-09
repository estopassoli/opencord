# ADR-0057: Clipes na conta e em destaque no perfil
Status: Accepted (pedido do mantenedor, 2026-11-09; card "Os clipes que forem gravados podem ficar no perfil da conta" do #kanban-de-ideias)

## Contexto
Os clipes (ADR-0022) ficam só no computador que gravou: quem entra em outro aparelho não os vê, e não há como mostrá-los
a outras pessoas a não ser mandando numa conversa. O card pede que fiquem "no perfil da conta", disponíveis em qualquer
aparelho. O mantenedor sugeriu também destacá-los no perfil.

## Decisão
- **Salvar é escolha da pessoa, clipe a clipe.** Nada sobe sozinho: no visualizador de clipes há "Salvar na conta"
  (ou "Salvar o corte na conta"). Gravar continua só local, como no ADR-0022.
- **Armazenamento:** o vídeo sobe pelo mesmo caminho dos clipes compartilhados (`/attachments/large`, partes de 8 MB,
  até 1 GB) e a miniatura como anexo comum. A tabela nova `ProfileClip` (migração `20261109000000_profile_clips`)
  prende os dois anexos ao clipe: título, jogo, duração, quando foi gravado e se está em destaque.
  - Anexos presos a um clipe não são órfãos (a limpeza de 24 h os ignora), não contam no limite de anexos pendentes e
    não podem ir para uma mensagem.
  - Apagar o clipe apaga os dois anexos e os arquivos. Excluir a conta (ADR-0039) apaga todos os anexos da pessoa e,
    em cascata, os clipes. O export inclui a lista dos clipes da conta.
- **Limites por pessoa:** 50 clipes e 2 GB no total (`ACCOUNT_CLIPS_MAX`, `ACCOUNT_CLIPS_MAX_BYTES` em
  `packages/contracts`). Até 6 em destaque (`CLIP_FEATURED_MAX`).
- **Rotas:** `GET /me/clips` (lista + uso), `POST /me/clips`, `PATCH /me/clips/:id` (`title`, `featured`),
  `DELETE /me/clips/:id`.
- **Perfil:** `UserProfile.clips` traz só os destacados, com o mesmo acesso do perfil (vínculo e sem bloqueio). As
  URLs são as assinadas dos anexos (~1 h).
- **App:**
  - Página de Clipes: item "Na conta" na barra, com uso de espaço; selo de nuvem (e estrela, se destacado) nos clipes
    do computador já salvos. No navegador a página mostra os clipes da conta.
  - Visualizador: seção "Na conta" com Salvar, progresso do envio e Destacar/Tirar do perfil. Um clipe só da conta
    abre pela URL; "Apagar" vira "Tirar da conta".
  - Cartão de perfil, cartão do painel do usuário e painel da DM: "Clipes em destaque" (até 6 miniaturas); clicar
    abre o vídeo no visualizador de mídia, que agora toca vídeo.
  - O clipe da conta é ligado ao arquivo do computador pelo instante da gravação (`recordedAt`).

## Alternativas descartadas
- Subir todo clipe automaticamente: gasta banda e armazenamento sem a pessoa pedir, e clipes podem ter conteúdo que
  ela não quer fora do computador.
- Guardar só a referência e baixar do computador de origem: não funciona com o computador desligado.
- Tabela sem anexos (arquivo próprio do clipe): duplicaria o envio em partes, a assinatura das URLs e a limpeza.

## Consequências
- **Armazenamento:** até 2 GB por pessoa que usar o recurso. O limite fica no contrato; trocar exige nova versão.
- **Moderação:** os clipes em destaque não passam pela moderação por IA (ela atua nas mensagens). Quem vê um clipe
  impróprio pode denunciar a pessoa como hoje.
- **Deploy:** a migração é aditiva e roda antes da API nova (Rick). App antigo com API nova: nada muda. App novo com
  API antiga: a página de clipes só mostra os do computador e o perfil fica sem destaques.
- **Reversão:** remover as rotas e `DROP TABLE "ProfileClip"`; os anexos viram órfãos e a limpeza apaga os arquivos.

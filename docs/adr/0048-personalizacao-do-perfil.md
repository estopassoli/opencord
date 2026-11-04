# ADR-0048: Personalização do perfil (parte 1)
Status: Accepted (pedido do mantenedor, 2026-11-04; card "1-Personalização de perfil" do #kanban-de-ideias)

## Contexto
O card pedia "colocar imagens, gifs, cores que a pessoa quiser tanto no perfil ou no próprio app". O mantenedor mandou referências de um editor de perfil (só referência de UX: nada de nomes, ícones, assets ou layout copiados).

Para a parte 1 ele escolheu:
- banner com imagem ou GIF;
- duas cores do perfil;
- bio;
- foto animada, com GIF do KLIPY e fotos recentes;
- editor com prévia ao vivo.

## Decisão
- **Dados:** colunas novas em `User` (migração `20261104030000_profile`):
  - `bio` (até 190, formatação do chat);
  - `bannerKey` (enviado, `GET /banners/:nome`) **ou** `bannerUrl` (GIF do KLIPY);
  - `avatarUrl` (foto por GIF do KLIPY, no lugar de `avatarKey`);
  - `profileColors` (0 ou 2 `#rrggbb`);
  - `recentAvatars` (até 6 entradas `key:`/`url:`, mais recente primeiro).
- **URLs do KLIPY:** só são aceitas URLs de mídia `*.klipy.com` (GIF/WebP), guardadas como vieram.
  - Os termos do KLIPY proíbem cópia, então não guardamos o arquivo.
  - O filtro impede que alguém ponha uma URL qualquer que rastrearia o IP de quem abre o perfil.
- **Por onde chega:**
  - `UserPublic.avatarUrl`, só quando existe. A foto aparece em todo lugar pelo `AvatarProvider`.
  - Bio, banner e cores vêm em `UserProfile.appearance` (`GET /users/:id/profile`), com o mesmo acesso do painel de DM: vínculo e sem bloqueio. Eles não entram em `UserPublic`, para não pesar em cada mensagem.
  - O cartão carrega a aparência ao abrir (`store/profiles`).
- **Edição:**
  - `GET` e `PATCH /me/profile` (bio, cores, `bannerUrl`, `avatarUrl`);
  - `POST` e `DELETE /me/banner`: até 4 MB e 2560 px. O GIF animado vai como está; o resto o app reduz para 1500 px.
  - `GET /me/avatars/recent` e `POST /me/avatars/recent {entry}`.
  - A foto anterior vai para as recentes em vez de ser apagada. Só a que sai das 6 tem o arquivo removido.
  - Excluir a conta (ADR-0039) apaga foto, recentes e banner, e o export inclui bio, banner e cores.
- **App:**
  - Aba **Perfil** nas Configurações. À esquerda ficam foto (enviar, GIF, recentes, remover), banner (enviar, GIF, remover), duas cores (paleta + hex) e bio com contador. À direita, a prévia do cartão com as cores e a foto ainda não salvas.
  - A barra "Você tem alterações não salvas." traz Desfazer e Salvar. Nada sai antes de Salvar.
- **Cartão de perfil:**
  - Banner no topo, com a foto sobreposta.
  - O cartão inteiro fica no degradê das duas cores. O texto é claro ou escuro conforme a luminância média, e no Vidro o degradê vai no vidro do cartão.
  - O `ProfileCardHead` é o mesmo no cartão e na prévia.

## Alternativas descartadas
- Bio, banner e cores em `UserPublic`: viajariam em toda mensagem, membro e evento.
- Baixar e hospedar os GIFs do KLIPY: os termos proíbem.
- Seletor de cor nativo: a regra do app é usar os controles do kit. A paleta e o hex cobrem o caso.
- Molduras, efeitos e widgets de jogos: ficam para as próximas partes do card.

## Consequências
- O armazenamento guarda até 6 fotos antigas por pessoa, além do banner.
- **Privacidade:** quem vê um perfil com GIF do KLIPY carrega a mídia direto do KLIPY. A Política de privacidade foi ajustada.
- **Animação:** a foto e o banner em GIF não param com "reduzir movimento". O navegador não pausa GIF sem convertê-lo, então isso fica para depois.
- **Deploy:** a migração é aditiva e roda antes da API nova (Rick). Apps antigos ignoram os campos novos e mostram as iniciais no lugar da foto por GIF do KLIPY.
- **Reversão:** remover as rotas e as colunas (SQL na migração). Os arquivos em `banners/` ficam órfãos.

# ADR-0055: Espaço 3D da chamada
Status: Accepted (pedido do mantenedor, 2026-11-08)

## Contexto
O mantenedor quer uma atividade da chamada de voz em que todos aparecem como avatares low poly num ambiente 3D, andam
livremente, ouvem os outros mais baixo quando estão longe (sem nunca deixar de ouvir), assistem juntos num telão (live
de alguém da chamada ou vídeo do YouTube) e, como no The Sims, o dono do servidor monta o ambiente (paredes, área,
móveis). Cada servidor precisa ter um ambiente próprio desde o começo. Escolhas dele: câmera em terceira pessoa com
WASD; fases 1 a 3 juntas (ambiente, avatares e voz; telão; editor); editar por uma permissão nova; quem está na
chamada sem abrir o espaço fala em volume normal.

## Decisão
- **Atividade da chamada**, ao lado de "Assistir juntos" e "Música". Só em canais de servidor (não em chamada privada).
  Abrir o espaço é individual: quem não abre continua no palco normal e sem posição.
- **Renderização no app com three.js** (já usado no fundo do layout Vidro), sem arquivos de modelo: peças e avatares
  são geometria low poly montada em código (`apps/desktop/src/features/space3d`). Avatar original (cápsula com rosto de
  tela, olhos que piscam, antena), cor estável por pessoa — sem reproduzir personagens de jogos existentes.
  Sem sombras em tempo real; o laço para com a janela escondida e o app avisa se ficar abaixo de 24 fps.
- **Ambiente por servidor**: formato `SpaceLayout` (tema, largura × profundidade de 8 a 60 m, cores, até 200 paredes
  em segmentos e 300 peças de um catálogo fechado, ponto de entrada) validado com zod nos dois lados
  (`packages/contracts/src/space.ts`). Sem edição, o ambiente é **gerado de forma determinística a partir do id do
  servidor** (6 temas, tamanhos, cores e arranjos variados) — sem IA, sem custo e sem guardar nada. Ao salvar, vai
  para a tabela `ServerSpace` (1 linha por servidor, JSONB + revisão); salvar exige a revisão de origem (409 se outra
  pessoa salvou no meio). "Restaurar original" apaga a linha.
- **Permissão nova `EDIT_SPACE` (1 << 21)**: dono e administradores têm; pode ser dada a cargos. Salvar e restaurar
  ficam no registro de auditoria (`space.update`, `space.reset`).
- **Posições pelo Socket.IO, não pelo canal de dados do LiveKit**: o canal de dados da SFU só é liberado para quem pode
  transmitir (decisão anterior, para ninguém mandar imagens/dados fora da moderação), e abrir para todos exigiria
  revalidar a prévia da live e o controle remoto. A posição é presença efêmera: `space:move` sem ACK (~10/s andando,
  1/s parado, balde próprio de 20/s por socket), validada pelo zod, repassada como `space:moved` **só para quem está na
  mesma chamada** (lista relida a cada 2 s) com emissão volátil (descartada se o socket estiver ocupado). Nada é
  guardado. `space:leave`/sair da chamada tiram o avatar; sem notícia por 6 s ele some.
- **Voz pela distância no cliente**: cada um calcula a distância até os outros e multiplica o volume da voz deles
  (GainNode do LiveKit) por uma curva suave: cheia até 3 m, cai até 35% aos 22 m e não desce disso. Não mexe no áudio
  de quem não está no espaço nem no áudio das lives.
- **Telão**: estado da chamada no Redis (`space:<canal>`, como a atividade), `space:get`/`space:screen` com ACK,
  `space:state`/`space:ended`. Fontes: a live de alguém da chamada (o app assina a transmissão e usa o vídeo como
  textura no telão e nas televisões) ou o vídeo do "Assistir juntos" (o mesmo player oficial do YouTube e a mesma
  sincronia, desenhado num plano CSS 3D atrás do canvas, que abre um "buraco" transparente no lugar da tela — o YouTube
  não pode virar textura por ser de outra origem). Chamada vazia apaga o estado.
- **Editor no próprio espaço**: câmera livre, selecionar/arrastar peças (grade de 25 cm), girar, duplicar, recolorir,
  apagar, desenhar paredes arrastando (grade de 50 cm), altura de parede, tamanho da área (paredes da borda
  acompanham), tema, cores, ponto de entrada, gerar outro ambiente e desfazer. Trabalha num rascunho; "Salvar para
  todos" manda `PUT /servers/:id/space` e todos do servidor recebem `space:layout`.

## Alternativas descartadas
- Canal de dados do LiveKit para posições: menor latência, mas exigiria liberar dados para todos (ver acima).
- Áudio espacial com HRTF/panorâmica: mais imersivo, mas cansa em conversas longas e exige um grafo de áudio próprio
  fora do LiveKit; pode vir depois como opção.
- Ambientes gerados por IA: custo por geração e resultado imprevisível; o gerador procedural já dá um ambiente
  diferente por servidor.
- Modelos glTF prontos: arquivos e licenças a gerenciar; a geometria em código é leve e tem o mesmo estilo low poly.

## Consequências
- Migração `20261108000000_server_space` (aditiva) antes da API nova.
- Posições passam pela API: com 25 pessoas andando são ~250 mensagens/s por chamada, repassadas a 24 sockets cada.
  Aceitável na escala atual; se pesar, o próximo passo é o canal de dados da SFU com dados liberados só no espaço.
- Quem não abriu o espaço não aparece nele (sem posição) e é ouvido normalmente por todos.
- O telão com live depende do Go Live; a regra do projeto continua: validar Go Live em duas máquinas Windows reais
  antes de afirmar que funciona — o telão com live está **bloqueado para validação** até esse teste.

## Adendo 2026-11-08: interação e x1 no soco
- **Interagir (F)**: assentos (sofá, poltrona, cadeira, banqueta, puff, cama) põem o avatar sentado (pose `a = 5`,
  vista por todos; lugar ocupado não é oferecido); luminária, lareira e fliperama ligam/desligam para a chamada
  (`space:toggle`, estado `toggles` no Redis da sessão, só peças desses tipos que existem no ambiente do servidor);
  televisão/telão abrem o menu do telão; caixa de som abre a música. No máximo 6 luzes de verdade por ambiente
  (apagar = intensidade 0, para não recompilar materiais).
- **x1 no soco**: desafiar alguém a até 4 m, convite de 20 s, contagem de 3 s, luta de 90 s, 100 de vida, soco rápido
  8 (recarga 0,42 s), forte 16 (1,1 s), defesa reduz a um quarto. **O servidor decide cada golpe** pela última posição
  recebida de cada um (alcance 1,5 m + 0,4 de folga, mira de ±69°, recarga, defesa = pose `a = 8`), não pelo que o
  cliente diz. Ringue no chão; quem luta não sai dele e fica virado para o adversário. Sair do espaço = derrota.
  As lutas ficam **em memória** na API (duram ~2 min); reiniciar a API encerra as lutas em andamento.
- **Esportes (basquete, futebol, tênis)**: cada um tem uma arena fixa (não depende do ambiente do servidor), aberta
  pelo botão Jogos; a posição leva `zone` (0 sala, 1–3 arenas) e quem está em outra arena é ouvido como se estivesse
  longe (piso de 35%). A bola é de quem tocou por último: essa pessoa simula e manda `space:ball` (~10/s, repassado
  só a quem está na chamada, volátil); os outros simulam também e corrigem pelo que chega; empate de toque fica com
  quem já mandava. Física própria (gravidade, quique, atrito, muros, aro/tabela, traves, rede). Ponto detectado por
  quem simula → `space:score` (placar no Redis da sessão, mesma arena ignorada por 1,5 s para não contar o mesmo lance
  duas vezes; qualquer um da chamada pode zerar). Basquete: pegar/roubar com F, segurar e soltar na faixa boa; 3 pontos
  de trás do arco. Futebol: encostar chuta, F chuta forte. Tênis: F rebate, ponto por dois quiques, bola fora ou
  bola que não passa da rede.
- Limite conhecido: a autoridade da bola confia no cliente (um app modificado poderia marcar pontos falsos); como é
  diversão sem prêmio, aceitamos. O x1 continua decidido no servidor.
- 2026-11-08 (ajustes após o teste do mantenedor): no x1 os golpes vão no mouse (esquerdo rápido, direito forte),
  com a mira travada no centro (Pointer Lock; Esc solta), câmera por cima do ombro e o boneco olhando para onde a mira
  aponta (acertar depende de mirar); defesa segurando Shift. A posse da bola deixou de comparar o relógio de cada PC
  (quem estava com o relógio atrasado nunca conseguia pegar a bola): agora é um contador de toques (o meu toque = o
  maior visto + 1; empate decidido pelo id, igual em todos os apps). Times nas arenas: entra no time com menos gente,
  pode trocar, faixa e disco da cor do time no boneco, gol/cesta/fundo da cor de quem defende; no tênis quem ganha o
  ponto saca, com a bola aparecendo na frente de quem está daquele lado.
- 2026-11-09: vôlei de areia (4), ping pong (5, a bolinha quica na mesa), sinuca (6) e corrida de moto (7) — arenas
  próprias como os outros esportes. Raquete na mão no tênis e no ping pong. Regras de ponto dos jogos de rede numa
  função testada (`netPoint`). Sinuca: física das 16 bolas no cliente de quem tacou (`space:pool`, contador de tacadas
  como a posse da bola), vez por time, 1 ponto por bola. Corrida: cada um simula a própria moto (posição pelo
  `space:move`), pontos de controle a cada terço impedem cortar caminho; largada (`space:race:start`, contagem de 4 s)
  e chegada (`space:race:finish`) no servidor, que recusa tempo impossível por volta ou maior que o tempo desde a
  largada (+3 s). Pista refeita depois do teste do mantenedor: circuito largo (11 m) de ~355 m numa arena de 130 m, só curvas abertas, guidão gradual; mínimo por volta baixado para 8 s. Estilo de corrida arcade original (não reproduz personagens, pistas ou itens de outros jogos).
- 2026-11-09 (pedido do mantenedor): teclado só com W A S D, E (acenar) e F (interagir); demais ações no mouse
  (direito segurado corre / defende no x1; meio pula; esquerdo bate, chuta, taca, arremessa, usa o turbo, e no x1
  clique = soco rápido, segurar e soltar = soco forte). O mouse fica preso na visão ao entrar (Pointer Lock, Esc solta
  para usar os botões; editar usa o cursor). Painel de comandos por contexto, painel dos jogos com Jogar / Zerar /
  Classificação (pontos por pessoa em `SpaceSession.board`, `space:score.by` só conta para quem está na chamada).
  Buraco negro original (horizonte, anel de fótons, disco de acreção e halo) no lugar do planeta da estação espacial.
- 2026-11-09: atalhos configuráveis (`features/space3d/bindings.ts`, por código de tecla ou botão do mouse, guardados
  neste computador): padrão W A S D, Shift corre, Espaço pula, E acena, F interage, esquerdo = ação, direito = defender.
  Esc (do navegador) solta o mouse e abre o menu de pausa (Continuar, Comandos, Sair). Correção: a cena cancelava o
  `pointerdown`, o que impede o navegador de gerar o `mousedown` — com o mouse preso, os cliques não chegavam.
- 2026-11-09 (pedido do mantenedor — muda a decisão de "sem modelos glTF"): avatares viraram **bonecos de massinha**
  (silhueta lisa e simples, com olhos que piscam, boca que abre com o volume da voz e a antena como marca do OpenCord)
  animados por esqueleto. Animações e esqueleto: Universal Animation Library (Standard) da Quaternius, licença **CC0**
  (domínio público; crédito por cortesia). O corpo é nosso: gerado a partir de cápsulas que se fundem (campo de
  distância + surface nets), cabeça esculpida, montado em pose em A com pesos suaves; o resultado é gravado uma vez em
  `apps/desktop/src/features/space3d/assets/doll.glb` (~1,7 MB: malha, esqueleto e só as 15 animações usadas, sem
  dedos/pés/posição/escala). O gerador fica em `apps/desktop/scripts/doll-bake.html` (abrir com o `ual.json` do pack
  ao lado e chamar `window.__bake()`). Estados → animações: parado/conversando, andar, trotar, pular, sentado/
  conversando sentado, pilotar, soco rápido/forte, guarda (início do jab parado), nocaute, levar golpe, raquete
  (golpe de espada usado como raquetada); aceno feito por cima da animação. Boca: `Participant.audioLevel` do LiveKit
  (só leitura no cliente). Alternativas recusadas: personagens prontos de outros packs (não eram o estilo pedido),
  gerar o corpo no app a cada abertura (segundos de CPU por pessoa).

## Adendo 2026-11-09: som do jogo e panorâmica leve só para efeitos (plano 2026-11-09, P6)
- **Decisão.** Os minigames ganham efeitos sonoros próprios (`features/space3d/sfx.ts` e `sfxmap.ts`), todos
  sintetizados no cliente com Web Audio (osciladores, ruído filtrado e envelopes). Não há arquivo de áudio nem som de
  terceiros. O motor usa o **mesmo AudioContext e o mesmo dispositivo de saída** das notificações
  (`lib/sounds.ts`: `context()` e `applySink()` passaram a ser exportados). Cada `GameEvent` (ADR-0056) tem um som
  ou fica marcado como "sem som" no mapa, e o tipo obriga a cobrir todos.
- **Panorâmica leve só para efeitos.** Esta é a mudança em relação à alternativa descartada acima. Efeitos curtos
  passam por um `StereoPannerNode` limitado a **±0,5**, pelo ângulo em relação à câmera. Não usamos HRTF. A **voz
  continua sem panorâmica**: só o ganho pela distância, como antes. O motivo do descarte (cansaço em conversa longa)
  não vale para estalos de menos de 2 s, e saber de que lado veio a bola ajuda a jogar.
- **Mixagem.**
  - **Distância:** usa a mesma curva da voz (`spaceVoiceGain`), reescalada para um piso de 0,15.
  - **Outra zona:** efeito de outra zona não toca.
  - **Ducking:** quando alguém fala a menos de `SPACE_VOICE_FAR` (ou eu falo), os efeitos caem para 0,4. Placar,
    apito e contagem caem só para 0,7, porque são informação.
  - **Mestre:** fica em **0,25·vol²**, sendo `vol` o volume das notificações vezes o volume próprio "Efeitos do jogo".
  - **Compressor:** um compressor leve no fim segura os picos.
  - **Limites:** no máximo 12 vozes (sai a mais baixa); o mesmo som repete no máximo a cada 40 ms; um som mais forte
    corta o mais fraco que saiu junto (exemplo: a última volta corta a volta).
  - **Motor da moto:** uma voz contínua por piloto, no máximo 6, com o tom pela velocidade.
- **Silêncio total** com Sons desligados, Não perturbe, ensurdecido ou a chave "Efeitos do jogo" desligada. A chave e
  o volume ficam no menu do Esc, em Comandos → Som, salvos neste computador (`localStorage` com try/catch).
- **Autoplay e testes.** O contexto só recebe `resume()` depois de um gesto (clique ou tecla na cena, clique no menu).
  Sem AudioContext (jsdom), o motor só escreve no `sfx.log`. Os testes conferem pelo log e por um AudioContext falso.
  Nenhum som é tocado em teste.
- **Limitação.** A audição real (timbre, volume relativo à voz, cansaço) **ainda não foi validada**. Ela fica com o
  mantenedor, em fone e caixa, no Electron. Pulo, aterrissar, sentar e passos continuam sem som.

## Adendo 2026-11-09: treino contra bot (Fácil, Médio, Difícil)
- **Decisão.** Em cada minigame (basquete, futebol, tênis, vôlei, ping pong, sinuca, corrida e x1 na sala) dá para
  jogar contra um bot em três níveis (`bots/level.ts`: reação, erro, escolha da jogada e velocidade). O bot é um
  boneco a mais ("Bot · Fácil") **simulado só no app de quem o chamou**: nada vai para a rede (`space:ball`,
  `space:pool`, `space:score`, corrida e x1 ficam de fora) e ninguém mais o vê.
- **Só com a arena vazia.** Com outra pessoa na arena, a opção fica desabilitada com o motivo; se alguém entra no
  meio, o bot sai e um aviso explica. Assim a simulação local nunca se mistura com a da rede (autoridade, ADR-0056).
  No x1 da sala a luta é toda local (ringue na frente de quem chamou); quem está em volta só vê a pessoa socando.
- **Treino.** A partida contra o bot tem placar local (`bots/store.ts`), sem servidor e sem classificação, mas com a
  experiência completa: contagem 3-2-1, o alvo de `MATCH_RULES` (sinuca: até 8 bolas), faixa de ponto, tela de fim e
  Revanche. O HUD é o mesmo (`MatchHud`, `DuelHud`, `RaceHud`), lendo o placar local quando há bot.
- **Como o bot joga.** Cérebros puros e testáveis em `bots/` (`sportbot`, `poolbot`, `racebot`, `duelbot`, com
  sorteio por semente em `rng.ts`) devolvem os mesmos comandos de uma pessoa. Os jogos mudaram pouco:
  `SportPlay.asBot` roda as ações como um segundo jogador local (posição, time, carga e carrinho dele) e
  `PoolPlay.botShot` taca na vez do bot. `bots/runner.ts` liga o boneco, o corpo e os cérebros na cena.
- **Limitação.** Equilíbrio medido só em simulação (testes com semente fixa); a sensação de jogar contra cada nível
  ainda precisa de teste manual.

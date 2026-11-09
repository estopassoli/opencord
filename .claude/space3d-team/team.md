# Contexto compartilhado — Espaço 3D

_Atualize quando o estado do mundo mudar. Última revisão: 2026-11-09._

## O que existe

- **Código:** `apps/desktop/src/features/space3d/` (~8,4 mil linhas), estado em `apps/desktop/src/store/space.ts`,
  contratos em `packages/contracts/src/space.ts` e `realtime.ts`, servidor em `apps/api/src/voice/space.service.ts`
  e `duel.service.ts`.
- **Cena:** `scene.ts` (`SpaceScene`: loop, câmera em 3ª pessoa, Pointer Lock, entrada por atalhos de
  `bindings.ts`, zonas, esportes, x1, sentar). `world.ts` (ambientes/temas), `models.ts` (móveis), `editor.ts`.
- **Bonecos:** `doll.ts` + `avatar.ts` — corpo de massinha próprio em `assets/doll.glb` sobre esqueleto e animações
  da Universal Animation Library (Quaternius, CC0). Olhos piscam, boca pelo `audioLevel` do LiveKit, antena na cor da
  pessoa. Ritmo das pernas pela velocidade real. Gerador: `apps/desktop/scripts/doll-bake.html`.
- **Zonas/minigames:** 0 sala (telão, sofás, música, x1 no soco), 1 basquete, 2 futebol, 3 tênis, 4 vôlei,
  5 ping pong, 6 sinuca, 7 corrida de moto. Arenas em `sports.ts`/`arena3d.ts`; partida/placar em `sportplay.ts`;
  sinuca em `pool.ts`; corrida em `race.ts`; x1 em `DuelHud.tsx` + servidor.
- **Rede:** Socket.IO só sinalização (`space:move` volátil ~10/s, `space:ball`, `space:pool`, `space:score`,
  `space:race:*`, `space:duel:*`). Mídia só pelo LiveKit. Autoridade da bola: contador de toques.
- **UI:** `SpaceView.tsx` (barra, HUDs por jogo, aviso de ação), `GameHud.tsx` (painel de comandos, menu de jogo em
  tela cheia no Esc com cartões dos jogos e atalhos), `space3d.css`.
- **HUD da partida (P3 feito em 2026-11-09, `MatchHud.tsx`):** menu do Esc com a aba "Esta partida" (Jogar/Revanche,
  Trocar de time, Classificação, Zerar com `aria-disabled` + Tooltip durante a partida; corrida: Jogar/Nova corrida;
  x1: Desistir). "Menu — a partida continua"; Esc fecha; foco preso. No x1 e na corrida o mouse solto mostra só a
  `LockStrip`. Placar "Azul 7 × 5 Vermelho · até 11, vence por 2" + selo MATCH POINT + relógio nos jogos com tempo;
  contagem 3-2-1-VAI grande (`BigCountdown`, também na corrida); faixa de ponto pelo evento `score` (motivo e nome) e
  "Saque do X" nos jogos de rede; tela de fim (`MatchEnd`: vencedor, destaque do `board`, Revanche e Voltar à sala),
  `RaceEnd` (pódio e DNF) e Revanche no x1; Tab segurado = `HeldScoreboard`. Sinuca: vez/bolas rolando num selo
  (`pool.status`), o aviso só aparece quando dá para tacar. Uma região viva só (`LiveRegion`/`useAnnounce`).
- **Tutorial e dicas (P4 feito em 2026-11-09):** `tutorial.ts` (dados puros: objetivo + 2–4 passos por zona 0–7 e x1,
  cada passo com `Action`, `conclui(evento|entrada)` e alvo no mundo) e `TutorialHud.tsx` (cartão no canto superior
  esquerdo, passo atual com `<Binding>`, "Pular tutorial" sempre visível; "Como jogar" no menu do Esc refaz). Passo só
  some pela ação; depois, uma dica por vez (máx. 2 cada, some pela ação ou em 8 s). Progresso em
  `localStorage['opencord.space3d.learned']` (`done`, `hints`, `panel`). Entrada em `scene.inputs` (`InputBus`).
  Marcador amarelo (anel + seta) em `scene.setTutorialTarget` (bola, cesta, gol, rede, branca, caixa de turbo).
  Painel de comandos recolhido por padrão e lembrado; H (`help`) abre.
- **Som (P6, 2026-11-09):** efeitos sintetizados (Web Audio, sem arquivos) em `sfx.ts` (motor, receitas, prefs
  `useSfxPrefs`, `sfx.log`) e `sfxmap.ts` (puro: `SFX_MAP` cobre todo `GameEventKind`, `sfxMix`/`sfxPan`/
  `sfxDistanceGain`). Ligado em `scene.events` (`sfx.attach`); a cena chama `sfx.listen` por quadro, `sfx.duck` no
  `updateGains`, `sfx.engine` por piloto, `sfx.unlock` no clique/tecla e o tique/"ding" da carga. Contagem das
  partidas e do x1 por `countdownSounds`; vitória/derrota no `MatchEnd` e no fim do x1; gongo no ringue. Chave e
  volume em Esc → Comandos → Som. Ensurdecido pelo `setSfxDeafened` (SpaceView). Audição real pendente.
- **Eventos de jogo (ADR-0056, P1 feito em 2026-11-09):** `events.ts` com `GameEvent` (kick, hit, whiff, bounce,
  surface, score com `reason`, pocket, ballHit, cushion, cue, boost, item, lap, finalLap, finish, punch, ko,
  countdown, go; todos com `at`, `power`, `zone`) emitido em todos os clientes no `scene.events` (`GameBus`:
  `on(kind, fn)` / `on(fn)` devolvem o "desligar"). Só a autoridade reporta ponto. `netCall` dá o motivo do ponto
  (fora, rede, dois quiques, caiu, não passou). Futebol: gol vindo de trás não conta.
- **Autoridade (ADR-0056):** `net/authority.ts` `nextAuthority` — dono que sai ou fica 1,5 s calado é trocado pelo
  menor id vivo na zona (bola e sinuca). Bola segura por quem sumiu cai. Sinuca de quem observa respeita o "rolando"
  do dono. `input.ts` `cancelHeld` solta tudo ao perder a trava, no blur e com a aba escondida.

- **Impacto (P5 feito em 2026-11-09):** todo apertar toca o golpe na hora (`press()` → `{ result: 'hit'|'whiff',
  quality?: 'early'|'perfect'|'late' }`; `release()` do basquete → `'short'|'perfect'|'long'`). Nos jogos de rede o
  tempo decide a bola (`hitQuality`/`contactDt`/`netShotTarget`: perfeita funda e mais reta, cedo cruzada, tarde
  paralela, as duas curtas) e o texto "Perfeito!/Cedo/Tarde/Longe" (ou "Curto/Longo" no arremesso) sobe da cabeça do
  boneco. Poses procedurais com antecipação: `a` 10 chute, 11 forehand, 12 backhand, 13 manchete (contrato até 13).
  Sombra redonda sob a bola em todas as arenas e anel de queda branco no tênis, vôlei e ping pong (`landingPoint`).
  `juice.ts`: pausa de impacto 40–90 ms (1 a cada 150 ms), partículas em pool fixo (poeira, areia, faíscas no aro,
  giz, turbo, soco), brilho no que foi atingido, tremor só em golpe forte, gol/cesta e nocaute, confete na cor do time
  no ponto, rede/cesta balançando, número do placar pulando (`.space3d-score-pop`). `motion` vem de
  `prefers-reduced-motion` (sem tremor nem câmera lenta; partículas e pausa pela metade).
- **Partidas (P2 feito em 2026-11-09):** regra de vitória em `contracts/space.ts` (`MATCH_RULES`: basquete 21 ou
  3 min, futebol 5 gols ou 3 min com gol de ouro, tênis 7, vôlei 15 e ping pong 11 vencendo por 2; `matchWinner`,
  `isMatchPoint`, `matchPhase`, `matchRuleLabel`). `SpaceSession.matches[zona] = { phase, startAt, winner?, endedAt? }`
  no Redis, sem migração. `space:match:start` (Jogar/Revanche) abre 3 s de contagem; ponto só em `playing`; o ponto ou
  o tempo fecham em `ended`; Zerar só parado (grava `idle`). Arena sem registro = jogo livre (compatível com app
  antigo). Treino (um lado vazio) não soma na classificação. Corrida: `racers`, `endsAt` (30 s após o 1º), `closed`,
  `dnf`. Store: `startMatch`, `matchLocalStart` (VAI no relógio local), `refresh()` ao reconectar; `raceKey` gravado
  no `open` (quem chega com corrida em andamento assiste).
- **Regras puras (`rules.ts`):** `canSteal` (1 s de posse, só de frente), `attackHoop` (cesta pelo time),
  `goodBand`/`GOOD_BAND` (faixa verde encolhe com a distância e com marcador; a barra do HUD usa a mesma),
  `poolTurn` (vez por pessoa em rodízio A1, B1, A2, B1; sozinho joga todas), `netSideOf`/`clampToHalf` (lado pelo
  time; a rede é parede; trocar de time reposiciona), `AUTO_SERVE_MS` (saque sai sozinho em 8 s, só em jogo).
  `SportPlay.setPhase` trava pegar/sacar na contagem.

- **Treino contra bot (2026-11-09):** Esc → Esta partida → "Jogar contra bot" (Fácil/Médio/Difícil, "Tirar o bot")
  em todas as arenas; na sala, "x1 contra bot". Só com a arena vazia (Tooltip com o motivo; se alguém entra, o bot sai
  com aviso). Tudo local: `bots/store.ts` (placar, corrida e x1 do bot; o HUD lê daqui quando há bot), `bots/runner.ts`
  (boneco e corpo do bot na cena), cérebros puros `bots/sportbot|poolbot|racebot|duelbot.ts` com `rng.ts` (semente).
  `SportPlay.asBot`/`botStep` = segundo jogador local; `PoolPlay.botShot`. Sinuca contra bot vai até 8 bolas.

## Controles atuais

W A S D andar · Q/E girar a câmera · Shift correr · Espaço pular · G acenar · F interagir (aceita convite de x1) ·
X recusa/cancela convite · H mostra/esconde os comandos · botão esquerdo = ação (bater, chutar, tacar, arremessar, turbo, soco) · botão direito =
defender no x1 · Tab segurado = placar · R = começar partida/revanche (arenas 1–5, x1; na corrida só com a prova fechada) · Esc solta o mouse e
abre o menu; Esc no menu fecha. Configuráveis (`bindings.ts`; mapas antigos migram em `fromSaved`). Todo texto de tecla
sai de `<Binding action>`.

## O que o mantenedor sente (2026-11-09)

"Ainda está muito amador." Quer minigames **imersivos** e **100% didáticos/autoexplicativos**, com controles e
mecânicas que o público já conhece de jogos tradicionais, sem precisar ler manual.

## Rodada atual (2026-11-09)

Plano em `context/plano-2026-11-09.md` (6 pacotes em série: base de eventos/autoridade → fim de partida → HUD →
tutorial → impacto → som). P1 (base) feito: ADR-0056 escrito. P2 (partidas) feito. P3 (HUD) feito. P4 (tutorial) feito. P5 (impacto) feito. P6 (som) feito: adendo no ADR-0055. Próxima ADR livre: 0057.
Gate da Rita feito (relatório em `context/rodada-2026-11-09.md`): checks verdes; 4 bugs pequenos corrigidos (convite de x1
respondido ao digitar no chat; R/"Correr de novo" largando corrida por cima de quem corre; som de fim para quem chega
depois). Todo o teste manual está PENDENTE. Falta: `docs/IMPLEMENTATION_PLAN.md` e Novidades (diretora/mantenedor).

- **Gunfight (zona 8, rodada 1 de correções em 2026-11-09):** `gunfight/` — `weapons.ts` (armas e balística puras,
  `lookAt`, `maxDamage`, `BASH`), `movement.ts` (tática recarrega aos poucos, deslize com teto 7,8 m/s e recarga de
  600 ms, bhop com teto × arma), `game.ts` (`GunGame`: fila de tarefas no `step` no lugar de `setTimeout`, clique
  guardado 320 ms, saída da corrida por classe, recuo = parte fixa + tranco visual `viewPunch`, mira convergente na 3ª
  pessoa, bots saem quando alguém entra), `fx.ts` (traçantes e clarões em pool), `grips.ts` (pegadas das mãos usadas
  pela 1ª pessoa e pelo boneco), `viewmodel.ts` (ombro fixo + cotovelo resolvido, mãos animadas no ferrolho/recarga).
  `hand.ts` junta a mão numa malha por pose (cache compartilhado). Rede: `space:gun` com `restart`; só `fire` é
  volátil (cliente `realtime.send` e servidor `emit`); placar = cada um publica `k`/`d` na `SpaceGunPose`. Teste
  manual com 2 pessoas PENDENTE. Recomeço ignora o `k`/`d` velho da pose até a pessoa publicar outro (`staleScore`).
  **Rodada 2 integrada (Caio, 2026-11-09):** acertos por balde por remetente (cabe 2 + 0,5 s da arma juntos);
  `restart`/`die`/`spawn` só de quem está na arena, `restart` da rede só com a partida acabada ou sem abate
  (`canRestart`; o botão "Recomeçar para todos" só aparece depois de um vencedor); `die`/`restart` vão com buffer
  (`realtime.send(..., { buffer })`). Mola do recuo em subpassos de 1/120 s, limite 0,15 rad. Sem mira na recarga; sem
  visão livre na zona 8. 3ª pessoa: `gunfight/camera.ts` `shoulderCam` (puro, testado contra `GUN_BOXES`; o boneco some
  com a câmera < 0,9 m); corpo gira para a mira (`bodyYaw`, ~50° de folga parado). Pose leva `act`/`an` (recarga,
  golpe, ferrolho, sacar) e o boneco anima; `gunKick` no tiro (meu, de outro e de bot); clarão remoto sai da arma do
  boneco (`muzzleOf`). Treino: bots esperam com o mouse solto (`paused`). Mapa: materiais do módulo + `mergeGeometries`
  (21 malhas, 24–32 chamadas sem bots). `skeleton.dispose()` em `disposeGun`/`Avatar.dispose`. Mão de apoio por arma
  (`SUPPORT_AT`), baioneta pelo centro do cabo (`FIST_HOLE`), Kar98k com pegada de coronha reta, tática solta a mão
  esquerda, alavanca pela malha (`partCenter`). SMG: MP7 26, MP5 27 a 860 rpm (de perto mais rápidas que o M4).
  **Teste r2 (Rita, 2026-11-09):** checks verdes (desktop 69/477, contracts 37, `space.int` 11, api tsc). Nome do boneco some
  perto da câmera (`avatar.ts`). Ainda aberto: arma na 3ª pessoa parece pistola de pé (cano para longe da câmera, mão
  esquerda solta), braços dos bots com SMG não conferidos de perto.
  Teste manual com 2 pessoas PENDENTE.
  **Revisão r3 (Rita, 2026-11-09):** checks verdes (69/477). Quebrar passou (munição, recarga+troca, morrer recarregando,
  Esc, vencedor e R). Abertos: preso agachado depois do slide (`movement.ts`), slide depende do FPS, `gunPoseKey` sem
  `act`/`an`, sem aviso com 0/0 (dica `gun-swap` gasta à toa), arma na 3ª pessoa. Relatório em
  `context/reviews/2026-11-09-gunfight-r3-rita.md`.
  **Revisão r3 (Téo, 2026-11-09):** checks verdes (69/477). Achados altos: na 3ª pessoa o sinal do ângulo do cano
  está invertido (`holdGun`: rotação x positiva levanta a boca; quadril 8–24° para cima, coice abaixa, sacar vem de
  cima) e a mão esquerda não alcança o apoio (braço 0,38 m, apoio a 0,57–0,65 m do ombro). Médios: o pente não vai à
  mão na recarga, o antebraço cobre a tela na recarga vazia, a Kar98k usa a recarga de pente, o pente da pistola fica
  fora da tela, a inspeção da baioneta não muda nada e o golpe pesado é igual ao leve. Lista em
  `context/reviews/2026-11-09-gunfight-r3-teo.md`.
  **Teste r3 (Rita, 2026-11-09):** checks verdes (desktop 69/490, `space.int` 11). Visto nos quadros: recargas,
  luneta, quick scope, ferrolho, inspeção, faca e 3ª pessoa ok. Corrigido: golpe pesado escondia a lâmina atrás da mão
  (`viewmodel.ts`), bots atravessavam a pessoa (`BODY_GAP` em `bots.ts`, com teste), nome do bot gigante colado na
  câmera (some a 1,6 m). Abertos: mãos juntas no punho na 3ª pessoa, antebraço na recarga vazia e na Kar98k, dedos
  abertos no karambit no golpe pesado. Teste manual com 2 pessoas PENDENTE.
  **Pegada e recoil r1 (Rita, 2026-11-09):** medido sem mexer no código. A cadência depende do FPS (MP5 a 600 rpm a 30 qps), o
  recuo não tem padrão nem recuperação, o coice visual não aparece (1 mm), a palma de apoio flutua 2 cm ou entra 1 cm na arma, o
  cabo da karambit fica fora da mão e as mãos ficam juntas na 3ª pessoa. Lista em `context/reviews/2026-11-09-pegada-recoil-r1-rita.md`.
  **Pegada e recoil r1 integrada (Téo, 2026-11-09):** recuo por padrão fixo por arma com volta da mira, tranco da vista
  (cima/lado/rolagem) por arma, coice da 1ª pessoa e do boneco por molas (`gunfight/spring.ts`, subpassos), cadência
  que não cai com o fps, abertura da dispersão na rajada (HUD e bots), luneta pula com o tranco. Pegada: indicador no
  gatilho, mão no punho pelo vão da mão, karambit reversa, pistola com polegares para a frente, recarga com a mão no
  pente de verdade, recarga vazia por arma (tapa no retém, alavanca por baixo/pela frente, polegar na pistola, ferrolho
  na sniper), Kar98k carregada pela mão direita, 3ª pessoa com a mão no guarda-mão. ADR-0058 com adendo. Checks verdes
  (69/497). Teste manual PENDENTE.
  **Jogo todo r1 integrado (Caio, 2026-11-09):** partida com alvo pelo tamanho (15/20/25) e limite de 8 min (relógio e
  alvo na pose: `ft`/`fl`), proteção ao nascer de 1,5 s (`prot`, boneco meio transparente), nascer fora da vista de
  inimigos e olhando para a vista livre, bots com recuo/aviso/reação mais humana no Difícil, marcas de tiro (pool de
  64), câmera da morte para o atirador, céu sem buraco negro, faca 55/150, passos com som, tiro de longe, panorâmica
  ±0,8, placar curto no alto e lista 1·2·3 ao trocar, painel de morte com arma e cabeça, cruz na 3ª pessoa mirando,
  inspecionar na rede, corrida com a arma baixa no boneco. Contrato: `SpaceGunPose` com `prot`, `ft`, `fl` e
  `act: 'inspect'`. Checks verdes (desktop 69/512, contracts 37, api tsc). Teste manual PENDENTE.
  **Teste da Rita (pegada/recoil r1):** recoil medido e conferido nos quadros, mãos na 3ª pessoa no apoio. Corrigido o
  antebraço esquerdo, que tinha a ponta reta solta na tela no quadril (`placeArm` estica a manga até o cotovelo, teto
  2×). Abertos: cartuchos do .glb visíveis na mira de ferro, marcas de tiro pouco visíveis em parede escura, selo de
  proteção logo abaixo da mira. Checks verdes (69/512). Teste manual PENDENTE.
  **Pegada e recoil r2 (Caio, revisão):** alto: o 1º tiro mirando zera também a punição de pulo/deslize/movimento
  (`fire`). Médios: a rajada esfria bem depois de a mira voltar (`burstNow`), o tronco do boneco não curva com a mira
  (olhando para baixo, a mão esquerda escorrega 6–10 cm) e o antebraço esquerdo na 1ª pessoa é um tubo que esconde a mão.
  Lista em `context/reviews/2026-11-09-pegada-recoil-r2-caio.md`.
  **Pegada e recoil r2 (Téo, revisão, 2026-11-09):** recuo ok nos quadros. Abertos: indicador fora do gatilho em
  todas as armas (~2,5 cm abaixo/atrás, `grips.ts`/`hand.ts`), Kar98k com a mão 6–7 cm atrás do gatilho, braço
  esquerdo no quadril esticado 1,4–1,8× (tubo no meio da tela; `HIP_LONG` longe demais), argola da karambit fora do
  indicador, mira de ferro da MP7 ~90 px acima do ponto, cartuchos visíveis, no-scope preciso demais. Lista em
  `context/reviews/2026-11-09-pegada-recoil-r2-teo.md`.
  **Pegada e recoil r2 integrada (Téo, 2026-11-09):** indicador de gatilho próprio em `hand.ts` (base quase reta, meio
  dobrado, abre 0,8 rad para o polegar quando fica mais aberto que os outros dedos): a ponta a ≤ 0,5 cm da lâmina em todas
  as armas; Kar98k mais à frente e inclinada, madeira 25% mais escura; karambit 5 cm para trás (indicador na argola);
  `HIP_LONG` (0,13, −0,15, −0,38) + ombro esquerdo próprio (−0,26, −0,32, −0,08) + antebraço fino (estica ≤ 1,1×);
  mão esquerda some no espaço da câmera (tática→slide, inspeção da pistola). Recuo: `shotSpread` único (tiro e mira),
  1º tiro só na parte parada, ar/deslize somam, sniper sem bônus; `burstNow` esfria no `recover.delay` por exponencial;
  hora lógica do tiro e sem volta com o gatilho preso (subida igual a 30/60/144 qps); volta pelo quanto a mira andou e
  continua ao trocar de arma; tranco inteiro na pontaria com "reduzir movimento"; "S" da AK. 3ª pessoa: coluna curva
  com a mira, coice ×0,55 mirando, sniper em 0,78. Checks verdes (69/518). Teste manual PENDENTE.
  **Resto do jogo r2 integrado (Caio, 2026-11-09):** mira de ferro da MP7 no ponto (`SIGHT_AT` 0,45 em `models.ts`);
  cartuchos do .glb num grupo próprio escondido (`splitRounds`, `GunModel.rounds`), aparecem só com o pente fora na
  recarga; marca de tiro 8,5 cm com anel claro de poeira; tiro na parede com faísca pequena e poeira cinza próprias
  (`FX.shotSpark`/`shotDust` em `juice.ts`); selo "Protegido" em cima da barra de vida. Checks verdes (69/518). Teste
  manual PENDENTE.
  **Pegada e recoil r2, teste da Rita (2026-11-09):** checks verdes (prettier, tsc, eslint, vitest 69/518). Recuo medido
  a 60 qps coerente (mirando, 30 tiros: M4 7,0°, AK 9,8° com S, MP7 4,6°, MP5 4,1°; Deagle 6,4° de câmera no quadril ×
  M9 2,1°; sniper com tranco 3,4° e coice 5,5 cm). Corrigido: anel de poeira da marca de tiro some aos poucos (de perto
  parecia um adesivo de alvo; `fx.ts`). Aberto: na 3ª pessoa mirando a arma fica no peito (não sobe ao rosto); mão
  esquerda no guarda-mão da 1ª pessoa quase toda escondida. Lista em `context/reviews/2026-11-09-pegada-recoil-r2-teste-rita.md`.

## Decisões registradas

- ADR-0055 (e adendos) e `docs/DECISIONS.md`. Arquitetura nova exige ADR + linha em DECISIONS.

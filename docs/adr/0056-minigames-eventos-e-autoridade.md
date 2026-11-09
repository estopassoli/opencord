# ADR-0056: Minigames do Espaço 3D — eventos de jogo, troca de autoridade e destino `Minigame`
Status: Accepted (time do Espaço 3D, rodada de 2026-11-09; adendo de arquitetura ao ADR-0055)

## Contexto
O mantenedor achou os minigames "muito amadores". A revisão do time (`.claude/space3d-team/context/reviews/`) achou
três problemas de base, antes de qualquer polimento:
1. **Nada responde.** `stepBall`, `stepPool` e `stepBike` devolviam poucos eventos e quase todos eram descartados; o
   chute, a rebatida e o choque entre bolas nem geravam evento, e o pouco que existia só rodava em quem tinha a
   autoridade. Som, partículas, faixa de ponto e tutorial não tinham onde se pendurar.
2. **Trava.** A bola é de quem tocou por último (ADR-0055). Se essa pessoa some (minimiza, cai, sai da zona) a bola
   fica parada no ar (`held` nunca é limpo) e a sinuca fica "rolando" para sempre. Quem só observa a sinuca não sabia
   que a mesa ainda rolava e podia tacar no meio da jogada.
3. **Entrada gruda.** Soltar o mouse (Esc), trocar de janela ou esconder a aba não cancelava a carga do arremesso ou da
   tacada.

Além disso, `scene.ts` despacha cada jogo com `if (this.sport/pool/bike)` em vários métodos, o que deixa caro evoluir
qualquer minigame.

## Decisão
1. **`GameEvent` é efeito local, emitido em todos os clientes, separado da regra**
   (`apps/desktop/src/features/space3d/events.ts`). União discriminada: `kick`, `hit` (raquete, mão, quadril),
   `whiff`, `bounce` (chão, mesa), `surface` (`wall`, `board`, `rim`, `post`, `net`, com a velocidade normal), `score`
   (`side`, `points`, `by`, `reason`), `pocket`, `ballHit` (velocidade relativa), `cushion`, `cue`, `boost` (chão ou
   item), `item`, `lap`, `finalLap`, `finish`, `punch`, `ko`, `countdown`, `go`. Todo evento leva `at` (x, y, z),
   `power` (0–1) e `zone`. O barramento (`GameBus`) é síncrono, sem three.js, e um ouvinte com erro não derruba os
   outros. As funções de física continuam puras: só empurram eventos numa lista opcional (`fx`).
   - `stepBall` emite quique, muro, tabela, aro, trave e rede; `stepPool` emite `ballHit`, `cushion` e `pocket`;
     `stepBike` emite `boost`, `item` e `lap`; a cena emite `finalLap`, `finish`, `countdown`, `go`, `punch` e `ko`.
   - Quem só observa emite o toque do rival quando o contador de toques (`t`) sobe, a caçapa quando uma bola passa de
     "na mesa" para "caiu" e a tacada quando a mesa começa a rolar.
   - **Só a autoridade reporta o ponto ao servidor.** O evento `score` de quem observa é só efeito (a simulação local
     pode divergir; o placar continua vindo do servidor).
   - `netPoint` ganhou a forma com motivo, `netCall`: `fora`, `rede`, `dois quiques`, `caiu`, `não passou`.
   - Futebol: o gol só conta quando a bola sai de dentro do campo para dentro do gol (`|prev.x| < GOAL_X <= |x|`);
     vindo de trás não conta mais.
2. **A autoridade troca de dono quando o dono some ou fica calado** (`net/authority.ts`, função pura
   `nextAuthority`). Se o dono sair da lista de vivos da zona ou ficar mais de 1,5 s sem mandar estado, assume o
   **menor id vivo** na zona (o mesmo em todos os apps, sem servidor), a partir do último estado recebido, com um
   toque a mais no contador (o estado antigo do dono, se ele voltar, perde). O dono manda estado pelo menos 1x/s
   mesmo parado (a sinuca passou de 2 s para 1 s). Usado na bola (`SportPlay`) e na sinuca (`PoolPlay`).
   - Bola segura por quem já não está na zona vira bola solta (cai).
   - Sinuca: quem observa guarda o `moving` de quem simula e não deixa tacar com as bolas rolando; se o dono some no
     meio da tacada, quem assume termina a tacada (a vez passa se nada caiu depois da troca).
   - Aba escondida: o laço de render para; antes disso a pessoa solta a bola da mão e cancela a carga. Calada, ela
     perde a autoridade para quem ficou.
3. **Entrada que não gruda** (`input.ts`, `cancelHeld`): ao perder a trava do mouse, no `blur` e no
   `visibilitychange`, as teclas presas e o botão de ação são soltos e o jogo ativo esquece a carga (`cancel()`), sem
   arremessar nem tacar.
4. **Destino da próxima rodada: interface `Minigame` e registro `GAMES`.** Cada jogo vira um objeto com `enter`,
   `exit`, `step(dt, input, me, now)`, `onAction(ação, fase)` (incluindo `cancel`), `prompt()`, `camera()`, `hud()`,
   `remote(msg)` e os eventos acima; `GAMES: Record<SportZone, () => Minigame>` substitui `ARENAS[z]` + `if`s, e o
   `SpaceScene` só delega. Ordem de migração: corrida → sinuca → jogos de rede → basquete/futebol → x1. Junto vem o
   passo fixo de 60 Hz e a sinuca determinística por tacada. Ninguém deve inventar outra interface até lá.

## Alternativas descartadas
- **Autoridade no servidor** (simular a bola na API): latência de ida e volta em cada toque e custo de CPU por
  chamada; para jogo social, a troca determinística por menor id basta.
- **Eleição com mensagens** (quem assume avisa e os outros confirmam): mais mensagens e mais casos de corrida; o menor
  id vivo dá o mesmo resultado sem conversa, porque todos veem a mesma lista de vivos (com folga de alguns segundos).
- **Heartbeat com a aba escondida**: mandar estado parado com a simulação parada manteria uma autoridade que não
  simula; melhor soltar a bola e deixar a autoridade passar.
- **Eventos só na autoridade**: quem observa ficaria sem som e sem efeito dos toques dos outros.

## Consequências
- Sem migração, sem mudança de contrato nem de servidor; apps antigos convivem (o contador de toques continua igual).
- Rede: a sinuca parada manda 1 estado/s em vez de 1 a cada 2 s; trocas de autoridade mandam um estado a mais.
- Com rede ruim (mais de 1,5 s sem pacote do dono) a autoridade pode trocar sem o dono ter saído; o dono antigo
  aceita o estado novo (contador maior) e a bola pode dar um pequeno salto.
- A pontuação de quem só observa é efeito e pode divergir da do servidor; o HUD deve usar o placar do servidor.
- **Pendente de teste manual** (não aprovado sem gente real): sinuca com o dono fechando a janela no meio da tacada,
  basquete com quem segura a bola minimizando, e queda de rede de 10 s, em duas máquinas.

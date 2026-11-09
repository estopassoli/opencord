# Gunfight: revisão de QA, rodada 1 de 3 (Rita Pacheco, 2026-11-09)

Escopo: `apps/desktop/src/features/space3d/gunfight/*`, a ligação em `scene.ts`, `SpaceView.tsx`, `GameHud.tsx`,
`tutorial.ts`, `bindings.ts`, `bots/level.ts`, além de `packages/contracts/src/space.ts` (SpaceGun) e do repasse
na API. Nesta rodada eu só li e rodei o código, sem editar nada.

## Evidência rodada

```
cd apps/desktop
npx tsc --noEmit -p .   → exit 0
npx eslint src test     → exit 0
npx vitest run          → 66 arquivos, 438 testes, todos passaram
```

Simulação pura de `gunfight/movement.ts`, feita com esbuild em node (scratchpad `rita/slide*.ts`):
- slide e cancel no C, um quadro de cada: 5,13 → **11,62 m/s** em 40 quadros. Num ritmo humano (C a cada 50–100 ms)
  o máximo foi 7,3 m/s.
- corrida tática: sobram 500 ms depois de 2,5 s; ao soltar o Shift, `tacLeft` volta para **3000 na hora**. Com mais
  dois toques, a tática liga de novo.
- slide, pulo e 20 bunny hops: a velocidade fica em **8,6 m/s** (bhopMax) para sempre, acima da tática (6,7).

Página de teste (cópia minha em `scratchpad/rita/gp`, roteiro `rita` e `sniper`, Chromium sem som):
- segurei o tiro e chamei `onBlur()`, o mesmo caminho de Esc, troca de janela e aba escondida: o M4 continuou
  atirando sozinho, **30 → 21 → 6 → 0** e recarregou, com `triggerDown=true` até um novo clique.
- forcei 30 abates (vencedor "Você") e apertei R: o vencedor continuou na tela, porque o R virou recarregar.
- três toques de Desert Eagle e o quick scope (apertar e soltar no mesmo quadro): o pente ficou em **7/28** e **5/25**,
  ou seja, nenhum tiro saiu.
- 3 bots no Fácil com o jogador parado: a vida foi de 100 para 16 em cerca de 2 s.

Nenhum dos testes cobre o gunfight. `weapons.ts` diz "tudo puro e testado", mas nenhum arquivo em `test/` importa `gunfight/`.

## Problemas (do mais grave ao menos)

### Alta
1. **Entrar no gunfight derruba a tela do Espaço 3D.** `SpaceView.tsx` renderiza `<ControlsPanel zone={8}>`, e em
   `GameHud.tsx` (`ControlsPanel`) a linha `rows = zone ? SPORT[zone as SportZone] : ROOM` dá `undefined` para a zona 8.
   Aí `[...rows, ...extra]` lança TypeError, mesmo com o painel fechado. A página de teste não pega isso porque monta
   só a `SpaceScene`. Correção: criar `SPORT_GUN`/`GUN_ROWS` com os comandos do gunfight e escolher pela zona antes do
   cast. Falta também um teste de render do `ControlsPanel` com `zone={8}`.
2. **O tiro continua sozinho depois de Esc, troca de janela ou aba escondida** (reproduzido). `scene.ts` `cancelHeld()`
   limpa as teclas, mas não chama `gun.release('fire')`, e `onMouseUpDoc` ignora o mouseup sem a trava do mouse.
   O efeito é que a arma automática esvazia o pente com o menu aberto, recarrega e volta a atirar. Correção:
   `this.gun?.release('fire')` em `cancelHeld()`. Melhor ainda: em `GunGame.step`, usar `host.held('fire')` no lugar
   de `triggerDown`, que fica só para o "apertou neste quadro".
3. **Clique curto não atira** (reproduzido). Em `game.ts`, `press('fire')` só liga `triggerDown`, e o tiro sai no
   próximo `step`. Se o botão sobe antes do quadro seguinte (clique de menos de 16 ms, ou de menos de ~40 ms com o
   app a 24 fps), o tiro se perde. Isso atinge as armas semiautomáticas e o quick scope. Correção: em
   `press('fire')`, chamar `this.fire(now)` na hora quando a arma não é faca, deixando o `step` só para a repetição
   automática.
4. **O R na tela de vencedor não recomeça.** `scene.ts` `gunPress` mapeia `rematch → 'reload'` e dá `continue`, então
   `hooks.onRematch` nunca roda na zona 8. Além disso, `rematchKey` (`SpaceView.tsx`) não trata a zona 8. Mesmo assim
   o `WinnerPanel` diz "R ou o menu: jogar de novo". Depois do vencedor o jogo também não para: os bots seguem, os
   abates seguem e, se a pessoa morre, o `DeadPanel` some (`h.dead && !h.winner`). Correção: com `winner` definido,
   o R chama `restart()` (em `gunPress`, se `g.winner` então `restartGun`), o tiro e os bots congelam, e o painel
   mostra o placar final.
5. **Os bots não saem quando uma pessoa entra na zona 8.** O painel só impede ligar bots com gente na arena; nada
   desliga bots que já estão rodando. O resultado: a pessoa nova não vê os bots, mas eu levo tiro deles e somo
   abates neles (posso ganhar a partida em cima de bots). Além disso, o `die` com `by: 'bot:1'` é rejeitado pela API,
   porque `SpaceGun.by` é `Id` = uuid, e por isso as minhas mortes por bot não chegam a ninguém. Correção: em
   `GunGame.step`, se `host.players().length > 0` e houver bots, chamar `setBots(null)` com aviso ("Os bots saíram:
   chegou alguém"), igual ao `realPeersHere` dos outros jogos. Nunca mandar `die` à rede quando o matador é bot.
6. **Ninguém ensina o gunfight a quem nunca jogou.** `tutorialKey(8)` cai em `'0'`, então o tutorial da **Sala**
   ("Ande pela sala… chame alguém para um x1") aparece no gunfight. Não existe painel de comandos da zona 8, e o
   `LockHint` não fala de arma. Só o R aparece no HUD, e só com pouca munição. Ficam escondidos: 1/2/3 e a rodinha
   para trocar, F coronhada/faca, G inspecionar, C agachar/slide, V visão, dois toques no Shift, botão direito mirar
   ou golpe pesado. Os rótulos do menu de atalhos também não servem aqui: G aparece como "Acenar", R como "Começar
   partida · revanche" e F como "Interagir". Correção: tutorial `'8'` curto (mirar, atirar, recarregar, trocar,
   correr/slide), linhas próprias no `ControlsPanel` e rótulos de atalho com o sufixo "· gunfight: recarregar /
   inspecionar / coronhada".

### Média
7. **Placar e "Recomeçar" só existem no meu app.** `restart()` zera só `this.kills` local e não manda nada pela
   rede. Quem entra no meio vê todos com 0. Com duas pessoas, uma recomeça e a outra continua com o vencedor antigo
   e o placar velho, e os dois placares divergem para sempre. Correção: `SpaceGun.kind: 'restart'` (todos zeram e
   renascem), ou bloquear "Recomeçar" com gente na arena e mostrar que o placar é local. Pendente de teste manual
   com 2 pessoas.
8. **A faca atravessa paredes.** `game.ts` `meleeHit` só confere distância e ângulo, sem caixa no caminho. A parede
   do galpão tem 0,4 m e o alcance chega a 2,6 m no golpe pesado, então dá para matar com um golpe através da parede.
   Correção: `lineOfSight(eye, {x:t.x, y:t.y+0.9, z:t.z}, GUN_BOXES)` antes de aceitar o alvo. Isso vale para a
   coronhada também.
9. **O acerto em pessoas usa a posição crua da rede, e não o boneco que aparece na tela.** `gunHost().players()` dá
   `p.x/p.z` do último `space:move`, que chega 10 vezes por segundo, enquanto o boneco desenhado anda com
   `k = 1−e^(−12·dt)` (cerca de 83 ms de atraso). A 6,7 m/s isso dá 0,56 m de diferença, contra 0,24 m de raio do
   corpo. Mirando no boneco que corre, o tiro erra. Correção: usar no tiro a posição renderizada do `Avatar` (o
   que se vê é o que acerta). Pendente de teste manual em rede.
10. **Matar uma pessoa não dá o retorno de abate.** `dealDamage` só sabe `kill` quando o alvo é bot. Para gente, o
    marcador vermelho e o som `kill` nunca aparecem. Correção: em `remote()` `case 'die'`, se `g.by === selfId`,
    `set({hitAt, hitKill:true})` e emitir `gunfx 'kill'`.
11. **Equilíbrio das armas** (pela tabela de `weapons.ts`, em mapa de 48 m):
    - **AK-47 sem espaço próprio**: mata em 4 de perto (33) a 600 rpm, ou seja 300 ms, contra 225 ms do M4 (28,
      4 tiros a 800 rpm). Longe, são 5 tiros em 400 ms contra 300 ms. A AK perde em tudo e ainda tem mais recuo.
      Sugestão: dano perto 34–36 com 3 tiros na cabeça + 1, ou algo como 650 rpm para alcançar o M4 de longe.
    - **MP5 = M4 de perto**: 25 de dano dá 4 tiros a 800 rpm, os mesmos 225 ms, só que com mira e passo mais rápidos.
      Sugestão: MP5 com 24, que dá 5 tiros.
    - **Kar98k é melhor que L115 e M200**: todas matam com 1 tiro no corpo em qualquer ponto do mapa (a queda só
      começa em 45–70 m), e a Kar tem ferrolho de 950 ms, mira em 300 ms e passo de 0,92. As outras ganham só no zoom.
      Sugestão: Kar com 1 tiro só na cabeça ou no peito alto (corpo em 85–90), ou L115/M200 com ferrolho e mira
      mais rápidos. Também conferir com o mantenedor se a Kar98k precisa abrir luneta, porque o pedido foi "luneta
      abrindo nas snipers" e a Kar está com `scope: false`.
12. **Movimento sem limite** (simulado):
    - Corrida tática infinita: em `movement.ts` `stepMove`, o ramo `else if (tacLeft < tacMs && now − tacEmptyAt >
      tacRechargeMs)` recarrega na hora quando a tática acaba antes de zerar (o `tacEmptyAt` é antigo). Correção:
      gravar `tacEmptyAt = now` sempre que a tática termina e recarregar aos poucos.
    - O bunny hop fica em 8,6 m/s para sempre e ignora `gunK`, então a sniper (0,83) pula tão rápido quanto a faca.
      Correção: `bhopMax` multiplicado por `gunK`, ganho só com o strafe no ar ou perda de 2–3% por pulo.
    - Spam de C (slide e cancel por quadro) chega a 11,6 m/s. No ritmo humano não passa de 7,3, mas um macro passa.
      Correção: limitar `speed + 1.2` a `bhopMax` e dar uma pausa de ~300 ms entre slides.
13. **O "Fácil" mata rápido demais para quem está começando.** Na página de teste, 3 bots Fácil levaram a vida de
    100 a 16 em cerca de 2 s. Em `bots.ts`, o erro de mira (`errYaw`) cai exponencialmente até zero, então em ~1 s o
    Fácil já mira perfeito. Correção: um piso de erro por nível (Fácil ≥ 0,05 rad, Médio ≥ 0,02), rajadas mais
    curtas e pausa maior no Fácil.

### Baixa
14. A troca rápida pula o ferrolho: `equip()` zera `boltPending`, e trocar para a pistola e voltar (420 + 600 ms)
    sai mais rápido que o ferrolho da M200 (1300 ms). Correção: guardar `boltPending` por arma.
15. `reload()` não confere `alive`. O `setTimeout` de 250 ms depois do último tiro pode começar uma recarga já
    morto (a animação roda no morto). Isso é inofensivo, porque `respawn()` zera, mas falta a guarda. Os timers de
    som da recarga antiga também tocam magOut/magIn de novo se uma recarga nova começar em menos de 50 ms
    (`reloadUntil` é um só). Correção: um id de recarga capturado no timer.
16. O golpe da faca e a coronhada (`setTimeout` em `knife()`/`bash()`) acertam mesmo depois de trocar de arma.
    Correção: conferir `this.weapon === sp.id` no timer.
17. Q/E giram a câmera também no gunfight (`turnCamera` roda antes do `gun.step`). Em primeira pessoa isso
    desorienta quem aperta E por hábito. Correção: não girar com Q/E na zona 8.
18. O número da vida fica escuro em cima da barra vermelha quando a vida está baixa (página de teste, 44 e 16):
    contraste ruim. Correção: texto claro quando `data-low`.
19. Em `game.ts` sobram `void wasGrounded`, `void this.lastFire`, `void UP` e o campo `lastFire`, que não são usados.

## Pendente de teste manual (não aprovado)
- Duas pessoas na zona 8, em máquinas diferentes: acerto em alvo correndo, abates no placar dos dois, vencedor e
  Recomeçar, entrada no meio da partida, e alguém entrando com os bots ligados.
- Mouse real com Pointer Lock: Esc segurando o tiro, Alt+Tab e a rodinha no touchpad (troca de arma em excesso).
- Desktop e API sobem juntos (`SpaceMove.zone` até 8, `gun`, `space:gun`): listar no relatório antes de publicar.

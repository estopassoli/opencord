# Revisão do gunfight — rodada 1 (Caio, engenharia e rede) — 2026-11-09

Só leitura e medição (nenhum código mexido). Checks em `apps/desktop`: `tsc --noEmit` ok, `eslint src test` ok,
`vitest run` 66 arquivos / 438 testes ok. **Nenhum teste cobre o gunfight** (weapons, movement, bots, game, contrato).

Medições (página de sonda própria em `scratchpad/caio-r1`, SpaceScene de verdade, relógio falso, swiftshader):

| O quê | Resultado |
|---|---|
| Segurar o tiro (M4) e perder o foco (`onBlur`) | **10 tiros saíram depois**, com `keys` vazio |
| Trocar de arma 30× (M200/Deagle/Karambit) | geometrias 494 → 651 (**+5 por troca**, nunca liberadas) |
| Zona 8 sem bots × com 5 bots (nível médio) | 155 → **611 chamadas de desenho**, 49 mil → **286 mil triângulos** |
| Só os dedos (168 cápsulas = 6 bonecos × 2 mãos × 14) | 112 chamadas de desenho |
| 20 ciclos C/C (slide → cancelar) a partir da corrida | velocidade sustentada **8,2 m/s** (corrida tática = 6,7) |
| Segurar Shift e depois apertar W | `sprint=false`, anda a 3,8 m/s (não corre) |

## Problemas (do mais grave ao menos)

### ALTA
1. **Gatilho preso** — `scene.ts` `cancelHeld()` (≈1456) limpa `keys` mas não o `GunGame.triggerDown`. Esc, Alt+Tab ou
   aba escondida segurando o tiro = a arma automática continua atirando (e mandando `fire`/`hit`) até esvaziar.
   Correção: `GunGame.cancel()` (triggerDown=false, semiReady=true, shotsInBurst=0) e passar `this.gun` na lista do
   `cancelHeld(this.keys, [this.sport, this.pool, this.gun])`.
2. **`hit`/`die`/`spawn` são voláteis** — cliente (`lib/realtime.ts` `sendVolatile` → `socket.volatile.emit`) e
   servidor (`space.service.ts` `gun()` → `emitVolatile`). Com a conexão ocupada (justamente em tiroteio) o dano some e
   a morte não chega: placares divergem para sempre. Correção: `fire` continua volátil; `hit`, `die` e `spawn` por
   emit normal (cliente e servidor), com balde próprio no gateway.
3. **Placar sem fonte única** — `game.ts` `onKill`/`restart`/`winner`: cada app conta do zero desde que entrou;
   "Recomeçar a partida" zera só o meu; o vencedor sai de placares diferentes em cada app; quem entra depois vê 0×0.
   Correção mínima: cada um é dono das próprias mortes e abates (conta o `die` em que `by === eu`) e manda `k`/`d`
   no `spawn` e na pose; `restart` vira `kind: 'restart'` repassado (ou guardar no `SpaceSession.matches['8']` como as
   arenas, sem migração). O vencedor só sai do total publicado pelo próprio jogador.
4. **Acerto testado onde o alvo NÃO está desenhado** — `scene.ts` `gunHost().players()` devolve a pose crua de `peers`
   (última recebida, 10/s), mas na tela o boneco é interpolado (`Avatar.setTarget`). Alvo correndo de lado a 5 m/s fica
   0,5–0,8 m deslocado, maior que `BODY_R` 0,24: mirar no boneco erra. Correção: usar a posição desenhada
   (`this.others.get(id).root.position`, y e agachado da pose) — "favorece quem atira", como o resto do modelo.
5. **Bots do gunfight não saem quando alguém entra** e quebram a rede — `GunBots` não tem o `realPeersHere()` do
   `bots/runner.ts`; o bloqueio é só no botão (`GunMatchPanel`). Com gente na arena os bots não veem nem acertam quem é
   de fora, e o `die` com `by: 'bot:1'` é **recusado pelo servidor** (`SpaceGun.by` é `Id` = uuid), então os outros
   nunca recebem a minha morte. Correção: checar a cada 500 ms em `GunGame.step` e chamar `setBots(null)` com o aviso;
   e no `die` por bot mandar `by` ausente (morte "do ambiente") ou o contrato aceitar `bot` explícito.

### MÉDIA
6. **Vazamento na troca de arma** — `viewmodel.ts` `setGun` só remove o modelo antigo (sem `disposeGun`); cada
   `equip` (troca, rodinha, renascer) cria um modelo novo. `Viewmodel.dispose` também não libera mãos
   (`handR/handL.dispose()`), arma, clarão (geometria/material/textura). `disposeGun` (models.ts) libera geometria mas
   não os materiais criados por `mat()` nem os clonados da M200. Correção: `disposeGun(this.gun)` no `setGun`; dispose
   completo; `disposeGun` liberar materiais com `userData.own` (marcar os clonados da M200).
7. **Desempenho com 6+ bonecos** — cada boneco custa ~91 chamadas de desenho e ~47 mil triângulos (medido). Os dedos
   (`hand.ts`: 16 malhas por mão, geometrias novas por mão, todas `castShadow`) somam 112 chamadas com 6 bonecos e
   valem em todas as zonas. A arma do arquivo tem `frustumCulled=false`. Correção: geometrias da mão compartilhadas no
   módulo e mescladas (ou `InstancedMesh`), sem sombra nos dedos, mão simples (luva) a mais de ~6 m; tirar
   `frustumCulled=false` dos bonecos (só a primeira pessoa precisa). Meta: ≤ 300 chamadas com 6 bonecos.
8. **`setTimeout` sem dono** — `game.ts`: sons da recarga (`reload`), ferrolho (`fire`), golpe (`knife`/`bash` →
   `meleeHit`) e a recarga automática (250 ms) seguem depois do `dispose` (sair da zona no meio da recarga toca o "pente
   entrando" na sala; `meleeHit` pode mandar `hit` fora da zona; `reload` chama `vm.play` no Viewmodel liberado). Os
   sons da recarga antiga também tocam em dobro se outra começar antes (a guarda só olha `reloadUntil`). Correção:
   guardar os ids e limpar no `dispose`/`die`/`equip`, ou checar `this.disposed` + um contador de recarga
   (`reloadSeq`) dentro de cada callback; melhor ainda, agendar pelo `now` do `step` (sem timers).
9. **Segurar Shift antes do W não corre** — `movement.ts` `stepMove`: `sprint` só liga no `pressRun` (borda). Andar
   com Shift já apertado, ou voltar a correr depois de atirar/mirar segurando Shift, fica andando. Correção: em
   `stepMove`, `if (runHeld && forward && !ads && !firing && !crouch && grounded) s.sprint = true`; o `pressRun` fica
   só para o duplo toque da tática.
10. **Slide cancel sem limite** — `pressCrouch` dá `max(slideMin, speed + 1,2)` a cada slide e `cancelSlide` mantém a
    velocidade: apertar C seguido sustenta 8,2 m/s (mais que a tática). Também a tática recarrega na hora se parar
    antes de acabar (`tacEmptyAt` fica 0). Correção: teto `slideMax` (~7,8), recarga do slide (~600 ms) e
    `tacEmptyAt = now` ao sair da tática por qualquer motivo.
11. **Faca e coronhada atravessam parede** — `game.ts` `meleeHit` não olha `lineOfSight` (parede do galpão tem 0,4 m;
    golpe pesado alcança 2,86 m) nem a altura. Correção: `lineOfSight(eye, peito do alvo, GUN_BOXES)` e |dy| < 1,2.
12. **Sem testes do gunfight** — `weapons.ts` diz "tudo puro e testado", mas não há teste. Faltam: `damageAt`/
    `shotsToKill` (equilíbrio do cabeçalho: fuzil 4–5, sniper 1 no peito), `castShot` (cabeça × corpo × parede,
    agachado atrás da mureta), `aimDir` × `lookAt` (mesma convenção), `findPath` (sem cortar quina, alvo bloqueado),
    `pickSpawn`, `stepMove` (slide, cancel, bhop até `bhopMax`, Shift segurado), e `GunGame` com host falso
    (morte/renascer/placar, `remote('die')`, `hurt` morto ignora, `dispose` sem timers). Contrato: `SpaceGun` recusa
    `by` não uuid (hoje é o bug 5).

### BAIXA
13. **Quem leva confia em qualquer `hit`** — `remote('hit')` aceita `dmg` até 1000 de quem nem está na zona 8 ou está
    morto. Checagem barata: remetente com pose na zona 8 e `alive`, `dmg ≤ GUNS[w].dmg[0] × head` (faca 150), e no
    máximo ~1 por `shotInterval`.
14. **"R: jogar de novo" mente** — `GunHud.tsx` `WinnerPanel`; no gunfight R = recarregar (`gunPress` mapeia
    `rematch → reload`) e `rematchKey` ignora a zona 8. Correção: depois do vencedor, R chama `restartGun` (ou tirar o
    texto). E a partida não para com vencedor (continua contando).
15. **Equipamento salvo inválido derruba** — `state.ts` `loadLoadout` aceita qualquer id do `localStorage`;
    `GUNS[id].mag` quebra no `respawn`. Validar com `SLOT_GUNS[slot].includes(id)`.
16. **Sorteio igual em todo app** — `GunGame.seed = 1`: o primeiro `rand()` é ~0 em todos, então quem nasce ao mesmo
    tempo com os mesmos inimigos vivos escolhe o mesmo ponto. Semente pelo `selfId`/`Date.now()`.
17. **Matar gente de verdade nunca mostra o marcador de abate** — `dealDamage` só sabe `kill` de bot; ao receber
    `die` com `by === eu`, acender `hitKill` (`useGunHud.set({ hitAt, hitKill: true })`).
18. **Traçante aloca geometria por tiro** — `tracer()` cria `BufferGeometry` a cada bala (≈70/s com 6 armas
    automáticas). Pool fixo de linhas (ou um `LineSegments` com buffer dinâmico).

## O que está certo (não mexer)
- Modelo "quem leva decide a morte" evita morte dupla; `hurt` ignora morto; `castShot` para na parede primeiro.
- Convenção yaw/pitch igual em `aimDir`, `lookAt` dos bots e câmera; recuo em `turn` com o mesmo sinal.
- Bots: grade BFS com diagonal sem cortar quina, linha de visão nas mesmas caixas do tiro, reação e erro por nível.
- Bots dos outros jogos saem quando alguém entra (`runner.ts` `realPeersHere`, a cada 500 ms) e liberam o boneco e o
  motor no `dispose`.
- Balde do gateway 40/40 cobre `fire`+`hit` da MP7 (~32/s), mas fica justo: separar o de `hit/die` (item 2).

# Revisão do gunfight — rodada 2 (Caio, engenharia e rede) — 2026-11-09

Só leitura e medição (nenhum código do app mexido). Checks em `apps/desktop`: prettier ok, `tsc --noEmit` ok,
`eslint src test` ok, `vitest run` 68 arquivos / 465 testes ok (saídas em `scratchpad/caio-r3/*.txt`).

Sondas próprias:
- `scratchpad/caio-r3/probe/net.test.ts` (vitest com config em `probe/vitest.config.mts`, mesmo host falso do teste do
  gunfight): rede e placar.
- `scratchpad/caio-r3/page/` (SpaceScene de verdade, relógio falso, swiftshader; `node build.mjs <pasta>`,
  `node run.cjs <porta>`): memória, bots, câmera.

## Conferido da rodada 1 (ficou bom)
- Gatilho preso, `setTimeout`, vazamento de geometria na troca, bots saindo quando alguém entra, `die` sem `by` para
  bot, eventos de placar confiáveis (cliente `send` + servidor `emit`), acerto pela posição desenhada, `staleScore`.
- 6 bots no Difícil por 60 s: nenhum bot travado (> 5 s parado com caminho), placar e abates entre eles corretos.
- Juice não pausa o tempo no gunfight (`impact` não chama hitstop).

## Problemas (do mais grave ao menos)

### ALTA
1. **Acertos legítimos descartados quando chegam juntos** — `gunfight/game.ts` `hitPlausible` (≈838): exige
   `0,6 × shotInterval` entre um acerto e o seguinte *na chegada*. Com rede de verdade (jitter, TCP segurando e soltando
   pacotes, que agora acontece mais porque `hit` é confiável) os acertos chegam em bolo. Sonda P1: 3 acertos da MP7
   (22 cada) chegando a 10 ms → só 22 de dano (vida 78; o certo era 34). Correção: balde por remetente — crédito
   `(agora − último)/shotInterval`, teto ~3 acertos, cada acerto gasta 1 (ou "no máximo `1000/intervalo × 1,25 + 2`
   acertos por segundo").

### MÉDIA
2. **Textura de ossos vaza a cada arma e boneco liberado** — `gunfight/models.ts` `disposeGun` e `avatar.ts`
   `dispose` não chamam `skeleton.dispose()` (o three 0.187 cria uma `boneTexture` por esqueleto; o `SkeletonUtils.clone`
   faz esqueleto novo por cópia). Medido (`renderer.info.memory.textures`): 30 trocas de arma 5 → 25; 10 renasceres
   +10; 5 vezes "5 bots / tirar" 36 → 102; 6 bots por 3 min 26 → 44. Vale também para quem troca de arma ou de zona
   na chamada (o boneco dele é recriado em todos os apps). Correção: em `disposeGun` e em `Avatar.dispose`,
   `root.traverse(o => o instanceof THREE.SkinnedMesh && o.skeleton.dispose())`.
3. **Qualquer um zera a partida de todos, a qualquer hora** — `game.ts` `remote('restart')` não confere nada e o
   "Recomeçar" do `GunMatchPanel` (SpaceView ≈566) está sempre disponível. Sonda P4: meus 12 abates viram 0 com um
   clique do Bob no meio. Sonda P2/P3: `restart` e `die` com `by` = eu chegam de quem nem está na zona 8 (o servidor
   repassa para a chamada toda) e valem. Correção: `restart`, `die` e `spawn` só de quem está em `players()`;
   `restart` da rede só aceito com a partida acabada (`over`) ou sem abates ainda; o botão "Recomeçar" só depois do
   vencedor (ou sozinho/com bots).
4. **Terceira pessoa encostado na parede: câmera dentro do contêiner** — `scene.ts` `placeGunCamera`: o ponto do ombro
   (`eye + direita × 0,45`) não é testado contra as caixas, e o mínimo de 0,4 m (`Math.max(0.4, t − 0.2)`) empurra a
   câmera para dentro da parede. Sonda: a 0,3 m de um contêiner, em 2 das 4 direções a câmera fica dentro da caixa, a
   0,63 m do olho (é a "cabeça cobrindo a tela" da Rita) — e de dentro da caixa as faces somem: dá para ver através
   do contêiner. Correção: raio olho → ombro (encolhe o deslocamento até `hit − 0,15`), raio de trás a partir daí
   com mínimo 0 (não 0,4) e, perto demais, esconder o próprio boneco/encostar na cabeça.
5. **Visão livre (Alt) gira a câmera e o tiro não** — `scene.ts` `freeLooking` vale na zona 8; `placeGunCamera` usa
   `yaw + freeYaw` e `GunGame` atira por `this.yaw`. Sonda: segurando Alt e mexendo o mouse, a câmera olha 45° para um
   lado e o tiro sai para o outro (em primeira pessoa a mira mente). Correção: `freeLooking` falso com `this.gun` (e
   zerar `freeYaw/freePitch` ao entrar na zona 8).
6. **`die` some se a conexão cair um instante** — `lib/realtime.ts` `send`: `if (s?.connected) s.emit(...)` joga fora
   o evento desconectado. O abate de quem matou só conta pelo `die` (a morte de quem levou se corrige pela pose; o
   abate não). Correção: para `die` e `restart`, emitir sem o teste de conectado (o socket.io guarda e manda ao
   reconectar); `hit` velho pode continuar sendo descartado.

### BAIXA
7. **`SpaceScene.dispose` não libera o gunfight** — fechar o espaço na zona 8 deixa `useGunHud` com `active: true`,
   `bot` e `scoped` do jeito que estavam (bots, visão em 1ª pessoa e traçantes sem `dispose`). Se fechou com a luneta
   aberta, ao voltar à zona 8 a luneta preta fica na tela até mirar (o construtor não zera `scoped` e `lastScoped`
   começa falso). Correção: `this.gun?.dispose()` no `dispose` da cena e `scoped: false, hurts: []` no construtor do
   `GunGame`.
8. **Mapa: material por caixa, nunca liberado, e chamadas de desenho altas** — `gunfight/mapmesh.ts` cria 2–3
   materiais por caixa a cada entrada na zona 8 e `setZone` só libera geometria. Com 6 bots: 396–481 chamadas (meta
   300). Correção: materiais do módulo (por cor) e `mergeGeometries` por material (contêineres, frisos, molduras) — cai
   para dezenas de chamadas e resolve a liberação.
9. **Testes que faltam** (`test/space3d-gunfight.test.ts`): acertos chegando juntos (item 1); `disposeGun` liberando
   o esqueleto (item 2, dá para contar `skeleton.dispose` com espião); `restart`/`die` de quem não está na arena
   (item 3); recomeço sozinho depois de `WINNER_MS` (hoje sem teste); câmera de 3ª pessoa fora das caixas (função pura
   extraída de `placeGunCamera`).

## Não reabro
- Kar98k sem luneta (decisão do mantenedor), reflexo da M200, arma vista bem de trás — fora do meu foco.
- Teste com 2 pessoas em máquinas e redes diferentes: continua PENDENTE (não aprovado).

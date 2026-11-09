# Memória — Caio Brandão (gameplay)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09: revisão em `context/reviews/2026-11-09-caio.md`. Baseline: `pnpm exec vitest run test/space3d-` (em apps/desktop) = 7 arquivos/31 testes verdes; só funções puras são testadas, `SportPlay`/`PoolPlay`/`SpaceScene` não.
- 2026-11-09: armadilha — `scene.ts` despacha cada jogo com `if (this.sport/pool/bike)` em ~6 métodos (42 refs); qualquer jogo novo mexe em tudo. Plano: interface `Minigame` + registro por zona (ADR).
- 2026-11-09: armadilha — dt variável (`Math.min(0.05, …)`, scene.ts ~994) entra direto na física; PC lento = jogo lento e clientes divergem. Passo fixo 60 Hz primeiro; ele destrava a sinuca por "replay de tacada".
- 2026-11-09: armadilha — rAF para com a aba escondida → sem pose/bola na rede; dono da bola some e `held` nunca limpa (bola congela). Precisa passagem de autoridade (silêncio > ~750 ms → menor id vivo na zona).
- 2026-11-09: `a` da pose = número mágico e `5` vale sentado E pilotando; `occupied` (scene.ts ~601) não filtra zona. Sempre filtrar `peers` por zona + `PEER_TIMEOUT_MS`.
- 2026-11-09 (P1 feito): `events.ts` (GameEvent + GameBus), `input.ts` (cancelHeld), `net/authority.ts` (nextAuthority). As funções de física continuam puras: recebem uma lista opcional `fx: GameEvent[]` (5º arg de `stepBall`, 3º de `stepPool`, 6º de `stepBike`); `SportHooks`/`PoolHooks` ganharam `emit?` e `alive?`. A cena expõe `scene.events` (GameBus) — P3/P4/P5/P6 se penduram ali.
- 2026-11-09: `netPoint` ficou como embrulho do `netCall` (com motivo) para não quebrar os testes antigos; use `netCall` em código novo. `netTouched` decide "rede" × "não passou".
- 2026-11-09: armadilha de teste — `SportPlay.mesh.position` só muda no `render()` (dentro do `update`); `remote()` não renderiza. E `remote` só faz "snap" se a diferença for > 1,5 m (senão anda metade).
- 2026-11-09: a sinuca de quem observa não simula (vx/vz ficam 0); por isso quem assume a autoridade no meio da tacada termina a tacada na hora (vez passa). Replay por tacada (passo fixo) é o conserto de verdade, na próxima rodada.
- 2026-11-09 (gunfight r1): `cancelHeld` da cena só conhece sport/pool — todo jogo novo com "segurar" (gatilho do
  `GunGame`) precisa entrar na lista, senão atira sozinho após Esc/blur (medido: 10 tiros).
- 2026-11-09 (gunfight r1): `sendVolatile`/`emitVolatile` servem para efeito (pose, traçante); evento que muda placar
  (`hit`, `die`, `spawn`) tem que ser confiável. `SpaceGun.by/target` são `Id` (uuid): id de bot (`bot:1`) é recusado.
- 2026-11-09 (gunfight r1): sonda de medição em `scratchpad/caio-r1` (entry.tsx + run.cjs): `renderer.info.autoReset`
  precisa ser false e `info.reset()` por quadro, porque o Viewmodel faz um segundo `render` que zera a contagem.
  Base: 155 chamadas sem bots, ~91 por boneco a mais (dedos = 14 cápsulas por mão).
- 2026-11-09 (gunfight r1): no `Viewmodel.setGun`/`equip` cada troca cria modelo novo sem `disposeGun` (+5 geometrias).
  Hit test deve usar a posição desenhada do boneco, não a pose crua de `peers`.
- 2026-11-09: aba escondida não manda heartbeat: solta a bola (`SportPlay.drop`) e deixa a autoridade passar por silêncio — heartbeat com a simulação parada manteria um dono que não simula.
- 2026-11-09 (gunfight r1, integração): `GunGame` não usa mais `setTimeout` — `later(tag, at, fn)` roda no `step` e
  `cancelJobs` limpa em trocar arma/morrer/dispose (teste: `vi.getTimerCount() === 0`). Testar o `GunGame` com host falso
  e `vi.mock` de `gunfight/models` (os .glb não carregam no jsdom).
- 2026-11-09: placar do gunfight sem servidor: cada um é dono dos próprios abates/mortes (conta pelo `die` com `by` = eu)
  e publica `k`/`d` na pose; `restart` repassado. Acerto recebido é validado (na arena, vivo ou recém-nascido, dano ≤
  `maxDamage`, cadência).
- 2026-11-09: armadilha — `SkinnedMesh` dos .glb das armas precisa de `frustumCulled = false` (a esfera de corte sai dos
  ossos antes de mover a arma e a arma some no boneco). Malha comum pode ser cortada.
- 2026-11-09: medição (sonda `scratchpad/caio-r2p`): boneco com arma ~10–13 chamadas (eram ~91); mão = 1 malha. O resto
  das chamadas no gunfight é o mapa (~150–320 conforme a direção da câmera): juntar as malhas do `mapmesh.ts` é o próximo
  ganho. Contar chamadas com bots varia com o nascer (semente por pessoa e hora).

- 2026-11-09 (gunfight r2): sonda de rede sem mexer no repo: `scratchpad/caio-r3/probe/vitest.config.mts` com `root`
  = apps/desktop, `include` absoluto e alias `^three$` → `three/build/three.module.js` (alias da pasta quebra
  `three/addons`). Copiar o cabeçalho do `space3d-gunfight.test.ts` trocando `../src/` por caminho absoluto.
- 2026-11-09 (gunfight r2): three 0.187 cria `boneTexture` por esqueleto; `SkeletonUtils.clone` = esqueleto novo.
  Liberar malha com esqueleto exige `skeleton.dispose()` (medir com `renderer.info.memory.textures`, não só geometrias).
- 2026-11-09 (gunfight r2): validar cadência na *chegada* descarta acerto legítimo (rede junta pacotes). Use balde
  com folga, nunca intervalo mínimo entre mensagens.
- 2026-11-09 (gunfight r2): 3ª pessoa — testar o ponto do ombro contra as caixas antes do raio de trás; mínimo de
  distância > 0 empurra a câmera para dentro da parede (vê através do contêiner). Alt (visão livre) não pode valer onde
  a câmera é a mira.
- 2026-11-09 (gunfight r2, integração): a porta 5391 já era de outra sonda (servidores `http.server` antigos ficam
  vivos): sempre `ss -ltn` antes e conferir o `cwd` do processo — a página velha serviu o bundle antigo e enganou a medição.
- 2026-11-09 (gunfight r2): `grips.ts` `MARTELO` é uma base canhota (x × y ≠ z): o quaternion não é o que o nome diz.
  Medir offsets aplicando o próprio quaternion (`FIST_HOLE.applyQuaternion(MARTELO)`), nunca à mão.
- 2026-11-09 (gunfight r2): Euler explícito em mola rígida (k=400, c=40) explode com dt > ~41 ms; subpassos de 1/120 s +
  limite + teste com dt = 0,05. Vale para toda mola nova (viewmodel tem outras: kick k=170, jolt k=260).
- 2026-11-09 (gunfight r2): mapa juntado por material = 21 malhas e 24–32 chamadas sem bots (eram ~155); texturas
  estáveis após 20 trocas de arma (`renderer.info.memory.textures`). Sonda em `scratchpad/caio-r4` (calls.cjs, hands.cjs).
- 2026-11-09 (gunfight r3): `maybeSend` só manda a pose quando a `gunPoseKey` muda (ou a cada 1 s): campo novo na
  `SpaceGunPose` (ex.: `act`/`an`) tem que entrar na chave, senão chega até 1 s atrasado parado (medido 792 ms).
- 2026-11-09 (gunfight r3): achar vazamento de geometria: embrulhar `renderer.render` para guardar as geometrias vistas
  e marcar `dispose` no protótipo; o que não está mais na cena e não foi liberado aparece por caminho de pais
  (`scratchpad/caio-r5/page/leak2.cjs`). Achou a sombra do `Avatar` (1 geometria + 1 material por boneco).
- 2026-11-09 (gunfight r3): `over` é local (cada app marca `winnerAt` quando vê o vencedor): quem entra na tela do
  vencedor fica até 12 s parado. Sair do `over` quando o vencedor publica `k` < alvo.
- 2026-11-09 (gunfight r3, integração): o boneco tem braço curto (0,19+0,19 m) para a arma em escala: o apoio fica a
  0,53–0,63 m do ombro. Solução no `avatar.ts`: `pullInReach` escorrega a mão esquerda pelo cano até o punho até caber
  em 95% do braço (busca binária). Meta "supToHandL < 0,03" do Téo não é alcançável sem mudar a proporção do boneco.
- 2026-11-09 (gunfight r3): `SpaceScene.prototype.<método>.call({ gun })` testa método da cena sem montar WebGL; `Avatar`
  monta no jsdom com `getContext` falso (Proxy com `measureText`) — o doll não carrega e sobra sombra, anel e nome.
- 2026-11-09 (gunfight r3): sonda visual desta rodada em `scratchpad/caio-r6` (scripts r6, r6b, r6c no entry.tsx; porta
  5411; `tp.cjs` = câmera real da 3ª pessoa). `click(ms)` com `window.setTimeout` usa tempo real, não o relógio falso:
  para esvaziar pente, mexer `g.ammo.get(g.weapon).mag` direto. Não usar `pkill -f` no mesmo comando (mata o shell).
- 2026-11-09 (gunfight r3): clique seco só sem reserva; com reserva, o `semiReady` não pode ficar falso (senão, segurando
  o gatilho até zerar tudo, o clique final nunca sai).

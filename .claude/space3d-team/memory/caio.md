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
- 2026-11-09: aba escondida não manda heartbeat: solta a bola (`SportPlay.drop`) e deixa a autoridade passar por silêncio — heartbeat com a simulação parada manteria um dono que não simula.

# Memória — Rita Pacheco (QA)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09 (revisão 1): os testes atuais (28, `vitest run test/space3d-*.test.ts`, ~1,4 s, sem áudio) só cobrem física/regra pura; `SportPlay`, `PoolPlay` e `store/space.ts` não têm nenhum teste. Pedir que a regra (vez, posse, vitória, troca de autoridade) vá para funções puras antes de testar.
- 2026-11-09: armadilha — o menu de Esc em tela cheia (`.gm`, z-index 4) cobre os HUDs das arenas (z-index 2); com Pointer Lock, botão de HUD fica inalcançável. Sempre conferir se uma ação existe também no menu/atalho.
- 2026-11-09: armadilha — a saída de alguém (`peers` timeout / `space:left`) não chega a `SportPlay`/`PoolPlay`; a autoridade (bola/mesa) nunca é transferida, e janela escondida para o rAF. Cenário obrigatório: "autoridade sai no meio da jogada".
- 2026-11-09: armadilha — `useSpace.open()` grava a sessão sem `applySession` (raceKey fica null) → corrida fantasma no próximo `space:state`. Qualquer estado derivado de sessão precisa passar por `applySession`.
- 2026-11-09: textos de atalho escritos à mão ("(F)") já divergiram do mapa real; exigir `<Binding action>` em todo HUD.
- 2026-11-09 (QA final): rodada fechou com desktop 62 arquivos/391 testes, contracts 36, api unit 26, space.int 10 — tudo verde. `space.int` e `duel.int` juntos no mesmo comando caem por `EADDRINUSE :3101` (mesma `TEST_API_PORT`); rodar separados.
- 2026-11-09: armadilha — ouvinte de tecla em `window` na captura (convite de x1) sem olhar o alvo responde enquanto a pessoa digita no chat. Todo atalho global precisa de `typingIn(e.target)` (`DuelHud.tsx`).
- 2026-11-09: armadilha — virar botão em tecla (R = revanche/nova corrida) transforma "clique deliberado" em acidente fácil; conferir se a ação afeta os outros (largar corrida por cima de quem corre). Ação que afeta todos: tecla só com o jogo parado; o menu continua podendo.
- 2026-11-09: armadilha — efeito de "fim" disparado pela sessão (som de vitória/derrota) toca para quem chega depois; gatear por `endedAt` recente.
- 2026-11-09: desktop e API têm de subir juntos (`space:match:start`, `SpaceMove.a` até 13); sempre listar isso no relatório antes de publicar.

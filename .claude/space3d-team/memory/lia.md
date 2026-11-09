# Memória — Lia Vasconcelos (diretora)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09 (plano): consenso das 6 revisões = "nada termina, nada responde, nada ensina, trava". Plano em `context/plano-2026-11-09.md`, 6 pacotes em série: P1 caio (eventos/cancelHeld/autoridade + ADR-0056), P2 bento (regra de partida em contracts + fase no servidor, vez por pessoa na sinuca), P3 nara (HUD/menu/fim), P4 nara (tutorial), P5 teo (juice/poses/sombra), P6 iara (sfx).
- 2026-11-09: a sessão do espaço fica no Redis (`space.service.ts`), então mudar a partida não exige migração; campos novos do contrato sempre opcionais, porque push no main sobe a API sozinho e apps antigos continuam no ar.
- 2026-11-09: cortes conscientes para a próxima rodada: interface Minigame/registro GAMES, passo fixo 60 Hz, câmeras por jogo, SPORT_SCALE, lobby "Pronto", regras completas (vôlei 3 toques, bola 8, x1 em rounds). Não deixar escorregar de novo.
- 2026-11-09: regressão do 7599caa: o menu do Esc (.gm z4 inset 0) cobre os botões da partida. Qualquer HUD novo precisa de teste de componente que ache o botão pelo papel com o mouse solto.

# Memória — Lia Vasconcelos (diretora)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09 (plano): consenso das 6 revisões = "nada termina, nada responde, nada ensina, trava". Plano em `context/plano-2026-11-09.md`, 6 pacotes em série: P1 caio (eventos/cancelHeld/autoridade + ADR-0056), P2 bento (regra de partida em contracts + fase no servidor, vez por pessoa na sinuca), P3 nara (HUD/menu/fim), P4 nara (tutorial), P5 teo (juice/poses/sombra), P6 iara (sfx).
- 2026-11-09: a sessão do espaço fica no Redis (`space.service.ts`), então mudar a partida não exige migração; campos novos do contrato sempre opcionais, porque push no main sobe a API sozinho e apps antigos continuam no ar.
- 2026-11-09: cortes conscientes para a próxima rodada: interface Minigame/registro GAMES, passo fixo 60 Hz, câmeras por jogo, SPORT_SCALE, lobby "Pronto", regras completas (vôlei 3 toques, bola 8, x1 em rounds). Não deixar escorregar de novo.
- 2026-11-09: regressão do 7599caa: o menu do Esc (.gm z4 inset 0) cobre os botões da partida. Qualquer HUD novo precisa de teste de componente que ache o botão pelo papel com o mouse solto.
- 2026-11-09 (pegada/recuo r1): medir o recuo pela página de teste: o `step` precisa ceder microtarefas (`await null`), senão o `loadGuns().then(respawn)` nunca roda e o jogador nunca nasce. Sonda em `scratchpad/lia-r1/gp/probe.cjs`.
- 2026-11-09: o recuo era uma rampa: sobe igual a cada tiro, o lado vem de um sorteio com a mesma semente para todas as armas e a mira não volta. Pente do M4 no quadril = 16,7°; AK = 25,8°. Exigir padrão fixo por arma, volta da mira e tranco visual por arma.
- 2026-11-09: na 3ª pessoa o braço do boneco (0,38 m) não chega ao apoio (0,56–0,64 m do ombro). Só mudar a pegada não resolve: o corpo e a escala precisam ceder (tronco de lado, arma no meio, braço um pouco mais longo só com arma longa).
- 2026-11-09: no Difícil, quem fica parado vive 1,1–3,1 s depois de nascer (morre logo ao nascer). Faltam proteção ao nascer e linha de visão no `pickSpawn`. Uma partida de 30 abates é longa demais para 1–4 pessoas.

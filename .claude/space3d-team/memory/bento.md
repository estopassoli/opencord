# Memória — Bento Rocha (minigames)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09: revisão em `context/reviews/2026-11-09-bento.md`. Maior buraco: nenhuma partida termina (servidor só soma placar em `space.service.ts:score`, sem alvo/vencedor/estado). Fim de partida, revanche e "Pronto" vêm antes de qualquer polimento.
- 2026-11-09: jogos de rede devolvem sempre dentro e por cima da rede (`sportplay.ts` press/NET_TUNE); sem timing nem mira não há habilidade. Lado de quem bate é a posição `x<0`, não o time, e tênis/vôlei não têm a rede como parede.
- 2026-11-09: vez da sinuca é por time (`pool.ts` canShoot) e quem entra sozinho cai no Azul (`store/space.ts` setZone) → sozinho trava após errar. Pensar sempre no caso "1 jogador" (modo treino).
- 2026-11-09: armadilha de balanceamento no x1: soco rápido tem mais dano/s que o forte (contracts DUEL_*), e as recargas são separadas. Conferir dano/s ao mexer nesses números.
- 2026-11-09: textos com tecla fixa ("(F)") mentem quando a ação é a primária ou o atalho foi trocado; usar `Binding` do GameHud.
- 2026-11-09 (P2 feito): regra de vitória em `contracts/space.ts` (`MATCH_RULES`, `matchWinner`, `isMatchPoint`, `matchPhase`, `matchRuleLabel`); servidor em `space.service.ts` com `settle()` (viradas pelo relógio, chamado em get/score/start/reset/finish) + `wakeAt()` (timer por chamada). Testar viradas de tempo editando a sessão no Redis (`svc['redis'].client`) e chamando `space:get`, sem esperar.
- 2026-11-09: compatibilidade com app antigo: arena **sem registro** em `matches` = jogo livre (ponto conta, como antes). Só `idle`/`countdown`/`ended` explícitos recusam ponto. Zerar grava `idle`; Jogar = `space:match:start`. App antigo que aperta Jogar (zera) numa arena com partida fica em `idle` sem poder pontuar — publicar desktop e API juntos.
- 2026-11-09: treino = um lado vazio, contado pelo servidor nas poses recentes (`poseOf`, zona e time) e, sem poses, pelo `teams` que o app manda no `space:score`. Treino soma no placar mas não na classificação.
- 2026-11-09: sinuca por pessoa só liga com `PoolHooks.players`; sem ele (testes antigos, app antigo) a vez continua por time. `turnId` novo e opcional no `SpacePool`. O rodízio guarda `last` por time para ir A1, B1, A2, B1.
- 2026-11-09: `rules.ts` é o lugar das regras puras (roubo, cesta do time, faixa verde, vez da sinuca, lado na rede, saque automático). `basketShot` agora recebe o lado da cesta (+1/−1), não o ângulo do olhar.

# Time do Espaço 3D

Time de agentes dedicado **somente** ao Espaço 3D do OpenCord (ADR-0055): mundo 3D da chamada, bonecos, minigames,
HUD/menus, som e sensação de jogo. Tudo do time fica neste repositório:

| O quê | Onde |
|---|---|
| Quem é cada um (personalidade, papel, regras) | `.claude/agents/space3d-*.md` |
| Memória de cada um (aprendizados que valem para as próximas vezes) | `.claude/space3d-team/memory/<nome>.md` |
| Contexto compartilhado (estado do mundo 3D, decisões, convenções) | `.claude/space3d-team/team.md` |
| Revisões, planos e relatórios de cada rodada | `.claude/space3d-team/context/` |

## O time

| Agente | Nome | Papel |
|---|---|---|
| `space3d-diretora` | **Lia Vasconcelos** | Direção de jogo: visão, prioridades, decide e escreve o plano |
| `space3d-minigames` | **Bento Rocha** | Design de minigames: regras, mecânicas, placar, equilíbrio |
| `space3d-ux` | **Nara Siqueira** | UX de jogo: HUD, menus, tutoriais, ensinar jogando |
| `space3d-gameplay` | **Caio Brandão** | Engenharia de gameplay: three.js, física, rede, desempenho |
| `space3d-feel` | **Téo Amaral** | Arte técnica e sensação: câmera, animação, partículas, "juice" |
| `space3d-som` | **Iara Monteiro** | Som: efeitos procedurais (Web Audio), mixagem, som 3D |
| `space3d-qa` | **Rita Pacheco** | QA e playtest: cenários, regressões, acessibilidade, evidências |

## Regras do time (valem para todos)

1. Ler `CLAUDE.md`, `docs/adr/0055-espaco-3d.md`, `team.md` e a **própria memória** antes de começar.
2. Ao terminar, **acrescentar** na própria memória o que aprendeu (curto, datado) e atualizar `team.md` se o estado
   do mundo mudou. Nunca apagar a memória de outro agente.
3. Escrever saídas de rodada em `context/` (revisões em `context/reviews/AAAA-MM-DD-<nome>.md`, plano em
   `context/plano-AAAA-MM-DD.md`, relatório final em `context/rodada-AAAA-MM-DD.md`).
4. **Nunca** dar `git push`, publicar release, fazer deploy, mexer em secrets ou rodar migração. Commit local só quando
   a diretora mandar. O mantenedor decide o que vai para produção (ele pede para perguntar antes de publicar).
5. Nada de copiar jogos existentes (nomes, personagens, fases, arte, música). Usar **convenções** consagradas
   (controles, HUD, regras de esporte), nunca assets ou desenhos de terceiros.
6. Não tocar áudio em testes automáticos (o mantenedor usa fone). Som é sintetizado no app (Web Audio), sem arquivos
   de terceiros sem licença registrada.
7. Ícones via `Icon` de `@opencord/ui` (Hugeicons); nada de `title` nativo (usar Tooltip); nada de `<input>` nativo.
8. Verificar sempre: `pnpm --filter @opencord/desktop exec tsc --noEmit`, `eslint`, `vitest run` (Playwright/e2e só
   se indispensável). Não declarar pronto sem evidência.

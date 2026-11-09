# Gunfight — revisão 2 (Rita, QA e jogo) — 2026-11-09

Só leitura e testes, sem mudar código. Nenhum áudio tocado, sem commit/push/deploy.

## Checks (apps/desktop)
| Comando | Resultado |
|---|---|
| `npx prettier --check src/features/space3d test/space3d-*` | limpo |
| `npx tsc --noEmit -p .` | sem erros |
| `npx eslint src test` | sem erros |
| `npx vitest run` | 68 arquivos, 465 testes passaram |

Saídas em `scratchpad/rita3/{prettier,tsc,eslint,vitest}.txt`. Sondas na página de teste em `scratchpad/rita3/gp`
(`probe.cjs`, `shots.cjs`, folha `sheet.jpg`); movimento puro em `scratchpad/rita3/mv.ts`.

## Conferido e OK
- R e trocar de arma no mesmo quadro: recarga cancelada, munição intacta (3/120), fila vazia.
- Morrer recarregando: recarga e fila limpas; renasce com 30/120.
- Atirar sem munição nenhuma (0/0): sem travar, sem erro.
- Perder o foco segurando o tiro: não atira sozinho.
- Vencedor (29→30): partida para; R recomeça (placar zerado, vencedor some).
- Bunny hop: teto 7,95 m/s com faca e 6,74 com M4, sem crescer. Loop deslize+cancelar+tática: média 5,35 m/s (abaixo
  da tática pura, 7,5): sem velocidade infinita.
- Bots com o jogador morto: vão atrás uns dos outros, ninguém mira em mim.

## Problemas (do mais grave ao menos)
1. **ALTA — tranco do recuo explode abaixo de ~24 qps** (`gunfight/game.ts`, `step`, mola `punch`/`punchV`). Euler com
   k=400 e c=40 é instável para dt > 41 ms; a cena limita dt em 50 ms. Medido: 1 tiro da L115 a 20 qps → `punch` 6.000
   rad em 1,2 s e −8,5e11 em 2 s; a câmera fica olhando o chão (quadro `d_20fps_24.jpg`) e só volta muito depois (ou
   vira NaN). Máquina fraca ou um engasgo longo bastam. Correção: rodar a mola em subpassos de ≤ 1/120 s (ou
   decaimento exato), limitar `punch` a ±0,15 e guardar contra NaN; teste com dt = 0,05.
2. **MÉDIA — acerto legítimo descartado quando os pacotes chegam juntos** (`game.ts`, `hitPlausible`). O intervalo
   mínimo é medido na chegada (`gap = min(intervalo, 450) × 0,6`); com entrega garantida, um atraso de rede entrega 2–3
   `hit` no mesmo instante e todos menos o primeiro somem (MP7: 38 ms). Correção: orçamento por janela (ex.: até
   `ceil(1000 / intervalo) + 2` acertos por 1 s por remetente) em vez de distância mínima entre dois.
3. **MÉDIA — luneta/mira abre durante a recarga** (`game.ts`, `adsHeld` não olha `reloadUntil`). Medido: L115 com R e
   botão direito → `scoped: true` com "Recarregando…" (quadro `b_reload_scoped.jpg`); a recarga fica invisível atrás
   da luneta. Correção: `adsHeld = … && !this.reloadUntil`.
4. **MÉDIA — Alt (visão livre) funciona no gunfight e desalinha a mira** (`scene.ts`, `freeLooking`/`onAimMove`,
   `placeGunCamera` soma `freeYaw`). Em 1ª pessoa a câmera gira mas o tiro vai pelo `yaw` antigo: a mira do centro
   mente. Correção: `freeLooking` falso com `this.gun` (ou só na 3ª pessoa e sem atirar).
5. **MÉDIA (equilíbrio) — fuzil mata mais rápido que submetralhadora de perto** (`weapons.ts`). Tempo para matar a
   0 m: AK 200 ms (3×100), M4 225 ms (4×75), MP7 253 ms (5×63), MP5 300 ms (5×75). A SMG perde até no papel dela.
   Correção: MP7 26 e MP5 27 de perto (4 tiros: 190 e 225 ms), mantendo a queda forte com a distância.
6. **BAIXA — "Recomeçar a partida para todos" sem confirmação** (`GunHud.tsx`, `GunMatchPanel`): um clique zera a
   partida de todos no meio. Correção: confirmar (segundo clique "Zerar para todos?") ou só com a partida acabada.
7. **BAIXA — `remote()` aceita `die`/`restart`/`spawn` de quem não está na zona 8** (`game.ts`): alguém em outra zona
   (ou app com bug) zera a partida; `die` com `by` arbitrário dá abate a qualquer um. Correção: exigir o remetente em
   `host.players()` para `restart` e `die`.
8. **BAIXA — dica "corrida tática" some com um toque só no correr** (`tutorial.ts`, `gun-tactical.feito`). Correção:
   emitir um `gunfx` `tactical` quando `pressRun` liga a tática e concluir por ele.
9. **BAIXA — `GunGame.setLoadout` é código morto e o comentário engana** (trocaria a arma na hora, sem sacar). Remover.
10. **BAIXA — no treino contra bots, o menu (Esc) não pausa**: os bots matam enquanto se troca o equipamento.
    Correção: com bots e o menu aberto, congelar os bots (é tudo local).

## Pendentes (não reconferidos nesta rodada; já listados na rodada de teste 1)
Baioneta segurada pela ponta do cabo; pente solto na recarga da L115; mão esquerda no bunny hop; Desert Eagle quadrada;
câmera da 3ª pessoa encostada na parede; Kar98k sem luneta (mantenedor decide); chamadas de desenho do mapa.
**Teste com duas pessoas em máquinas e redes diferentes: PENDENTE, não aprovado.** Desktop e API sobem juntos
(`restart` no enum do contrato).

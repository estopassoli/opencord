# Gunfight, rodada 3 de 3: revisão da Rita (QA e jogo), 2026-11-09

**Resumo:** todos os checks passam. Os cenários de quebrar passaram: munição, recarga com troca, morte, Esc, renascer e vencedor. Achei 2 problemas de movimento que quem joga sente: o boneco fica preso agachado depois do slide, e o slide muda conforme o FPS. Achei também 1 problema de rede (a pose não manda a ação) e 1 de clareza (sem munição). Nesta etapa não editei código.

## Checks (apps/desktop)
| Comando | Resultado |
|---|---|
| `npx prettier --check src/features/space3d test/space3d-* src/lib/realtime.ts` | ok |
| `npx tsc --noEmit -p .` | ok |
| `npx eslint src test` | ok |
| `npx vitest run` | 69 arquivos, 477/477 |

## Página de teste
Cópia em `scratchpad/rita-r3/gp`, porta 5361, com `s.noLock = true` e `window.key`/`window.hudStore`. Usei o roteiro `brk`, a sonda `brk.cjs` e a terceira pessoa em `tp.cjs`. As imagens estão em `scratchpad/rita-r3/sheet1.jpg` e `sheet2.jpg`. As simulações puras de movimento e de tiros para matar estão em `scratchpad/rita-r3/mv.ts` e `sl.ts`.

### Passou (com estado medido)
- **Recarregar e trocar de arma no mesmo quadro:** a recarga cancela, não fica tarefa pendente e o pente continua em 10/120 ao voltar.
- **Morrer recarregando:** `reloadUntil` vai a 0 e não sobra nenhuma tarefa. Ao renascer, o pente volta cheio (30/120) num ponto de nascer novo.
- **Esc no meio da rajada (`cancelHeld`):** o gatilho solta e a munição para de cair.
- **Sem munição nenhuma (0/0):** o tiro dá clique seco e o R não faz nada. Não trava, mas veja o achado 4.
- **Bunny hop:** o teto é 7,95 m/s com a faca. A corrente de slide com pulo dá 6,6 m/s de média, perto da tática; não fica infinito.
- **Slide contra parede:** para na parede sem atravessar.
- **Vencedor:** o bot chegou a 30 e apareceu "Bot 1 venceu" com o placar. O painel de abatido some, o R recomeça a partida, todos voltam vivos e o placar zera.
- **Câmera da morte:** o boneco caído aparece, com o painel acima.

## Achados (do mais grave ao menos grave)

1. **(alta) Depois do slide, o jogador fica preso agachado.** Arquivo: `gunfight/movement.ts`.
   - O `pressCrouch` liga `crouch = true` no slide, e nada desliga quando o slide acaba.
   - O `stepMove` exige `!s.crouch` para correr, e o `pressRun` não levanta.
   - Medido na cena: com W e Shift seguros, ou Shift apertado de novo, o jogador anda a 1,7 m/s agachado até apertar C ou Espaço.
   - O tutorial ensina "Corra e agache: você desliza", e logo depois a pessoa fica lenta sem saber por quê.
   - **Correção:** no fim natural do slide, com o correr seguro, levantar (`crouch = false`, `sprint = true`). E o `pressRun` agachado no chão também levanta. Teste: depois do slide, com Shift seguro, a velocidade volta para mais de 5.
2. **(média) O slide depende do FPS e é curto.** Arquivo: `gunfight/movement.ts`, `stepMove`, ramo `slide`.
   - A fórmula `want = slideEnd + (sp - slideEnd) * left` usa a velocidade **atual**, então a queda se acumula a cada quadro.
   - A distância do slide em cada taxa de quadros (`sl.ts`):

     | Quadros por segundo | Distância |
     |---|---|
     | 30 qps | 2,78 m |
     | 60 qps | 2,47 m |
     | 144 qps | 2,26 m |
     | 240 qps | 2,14 m |

   - A velocidade cai para a da corrida em cerca de 150 ms. O comentário promete "em linha", o que daria cerca de 3,7 m.
   - **Correção:** guardar `slideV0` (a velocidade e a direção no começo do slide) e calcular `want = slideEnd + (slideV0 - slideEnd) * left`. Teste: a mesma distância a 30 e a 240 qps (±2%).
3. **(média) A ação da pose (`act`/`an`) não força o envio.** Arquivo: `scene.ts`, `gunPoseKey`.
   - A chave é `w:pitch:crouch:ads:alive:k:d` e não inclui `act`/`an`.
   - Parado, sem mexer o mouse, a recarga, o ferrolho da sniper e o golpe de faca só saem no envio de 1 s. O outro vê a animação atrasada, depois de ela já ter acabado.
   - **Correção:** incluir `${g.act ?? ''}:${g.an ?? ''}` na chave.
4. **(média) Sem munição, a interface não diz o que fazer, e a dica de trocar de arma se gasta à toa.**
   - Arquivos: `gunfight/game.ts` (`fire` → `'dry'`), `tutorial.ts` (dica `gun-swap`) e `GunHud.tsx`.
   - Toda rajada automática que esvazia o pente emite `gunfx 'dry'`, mesmo com reserva, porque o tiro seguinte chega antes da recarga agendada para 250 ms.
   - Depois de duas recargas normais, a dica "Sem bala? Troque para a pistola (2)" aparece e some logo no `magOut` da mesma recarga. Fica gasta e não aparece quando a munição acaba de verdade.
   - Com 0/0, o HUD não mostra nada.
   - **Correção:** emitir `dry` só quando não há reserva, ou dar à dica uma condição de "reserva zerada". No `GunHud`, com `mag === 0 && reserve === 0`, mostrar "Sem munição · 2 pistola · 3 faca". Opcional: trocar sozinho para a pistola no clique seco sem reserva.
5. **(média, continua da r2) Na terceira pessoa, a arma parece pistola de pé, e a mão esquerda fica fora da arma.** Arquivos: `avatar.ts` e `grips.ts`.
   - Conferido de novo em `sheet2.jpg`: no quadril, o M4 aparece pequeno junto ao ombro.
   - **Correção:** abaixar a coronha até o ombro com o cano para a frente, na linha da mira, e pôr a mão de apoio pela IK no `SUPPORT_AT` da arma, como na primeira pessoa.
6. **(baixa) `canRestart` está sem uso.** Arquivo: `gunfight/game.ts:903`.
   - O menu decide por `counts[8]` (`GunHud.tsx`), e o `playZone(8)`/`restartGun` chamam `restart()` sem conferir nada.
   - **Correção:** usar `gun.canRestart` no `restartGun` da cena (ou no `GunMatchPanel`), ou apagar o getter.
7. **(baixa) Clicar de novo no nível de bot já escolhido zera a partida sem aviso.** Arquivo: `GunHud.tsx`, `GunMatchPanel`.
   - O `onBots(l, count)` → `setBots` → `restart`.
   - **Correção:** com `bot === l`, não fazer nada.
8. **(baixa, equilíbrio) A M9 perde da Desert Eagle em tempo para matar a qualquer distância.**
   - M9: 429 ms de perto e 571 ms a 30 m. Desert Eagle: 333 ms e 667 ms. A M9 só leva vantagem de 30 m em diante.
   - A Desert Eagle mata com 1 tiro na cabeça até cerca de 15 m.
   - A L115 e a M200 matam com 1 tiro no corpo a qualquer distância; a M200 só tem o pente maior (7 contra 5), em troca de mira e ferrolho mais lentos.
   - **Sugestão (Bento):** dar à M9 uma cadência maior (cerca de 520 rpm) ou 34 de dano. Para a M200, o tiro na cabeça mata de qualquer distância e com 1 tiro no corpo até 70 m; ou deixar a L115 com 2 tiros no corpo além de 90 m.

Tiros para matar no corpo (de perto e a 30 m) e na cabeça de perto:

| Arma | Corpo de perto | Corpo a 30 m | Cabeça de perto |
|---|---|---|---|
| M4 | 4 (225 ms) | 4 (225 ms) | 3 |
| AK-47 | 3 (200 ms) | 4 (300 ms) | 2 |
| MP7 | 4 (189 ms) | 8 (442 ms) | 3 |
| MP5 | 4 (209 ms) | 7 (419 ms) | 3 |
| L115 | 1 | 1 | 1 |
| M200 | 1 | 1 | 1 |
| Kar98k | 2 (1000 ms) | 2 (1000 ms) | 1 |
| M9 | 4 (429 ms) | 5 (571 ms) | 3 |
| Desert Eagle | 2 (333 ms) | 3 (667 ms) | 1 |

## Ainda aberto, já avisado pelo Caio
- A recarga vazia ainda cruza o antebraço por cima da arma.
- Os braços dos bots com submetralhadora não foram conferidos de perto.

## Pendente de teste manual (não aprovado)
- **Duas pessoas em rede:**
  - acertos chegando juntos;
  - morte e recomeço;
  - pose com recarga, golpe, ferrolho e sacar (depois da correção 3);
  - queda e volta da conexão;
  - aba escondida (o outro some da arena depois do tempo-limite do `peers`).
- **Mouse de verdade:** recuo, quick scope e os bots parando com Esc.
- **Desempenho em máquina Windows.**

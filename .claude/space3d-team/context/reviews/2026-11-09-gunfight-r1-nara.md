# Revisão do gunfight, rodada 1 de 3: Nara (UX e som)

Data: 2026-11-09. Só leitura: nada foi editado no código.

## Verificações
- `npx tsc --noEmit -p .` = 0 · `npx eslint src test` = 0 · `npx vitest run` = 66 arquivos e 438 testes, todos verdes.
  Nenhum teste cobre `ControlsPanel`/`SpaceView` na zona 8.
- Página de teste (cópia em `scratchpad/nara-gp`, porta 5393, roteiro novo `ui`: vida baixa, abatido, vencedor e placar)
  e quadros já gravados de `v_m4` e `v_sniper`.
- Prova da quebra: `renderToString(<ControlsPanel zone={8} …/>)` dá `rows is not iterable`.

## Problemas, do mais grave ao menos grave

### Alta
1. **A tela quebra ao entrar no gunfight** (`GameHud.tsx:162-169`). `SPORT` só tem as chaves de 1 a 7. Na zona 8,
   `rows` fica `undefined` e `[...rows, ...extra]` lança um erro durante a renderização. O `SpaceView` monta o
   `ControlsPanel` sempre que o menu está fechado (`SpaceView.tsx`), então a zona 8 derruba a tela no app de verdade.
   A página de teste não monta esse painel, por isso o problema não apareceu nela.
   **Correção:** criar `SPORT[8]` (ou `GUN_ROWS`) com: atirar, mirar (botão direito), recarregar (R), coronhada/faca
   (F), inspecionar (G), agachar/deslizar (C), Shift 2× para a corrida tática, 1/2/3 e a roda do mouse para trocar de
   arma, V para a visão e Tab para o placar. Usar um teste de `ControlsPanel` com a zona 8 para não voltar.
2. **Ninguém descobre os comandos do gunfight.** `tutorialKey(8)` devolve '0' (`tutorial.ts:315`), então aparece o
   tutorial da Sala e "Como jogar" refaz o da Sala. Em `bindings.ts`, `ACTION_LABELS` não fala de gunfight em
   primary, secondary, rematch, interact, wave e run. Só C e V aparecem.
   **Correção:** criar o tutorial '8' (atirar → mirar → recarregar → trocar de arma → deslizar) e acrescentar
   "· gunfight: atirar / mirar / recarregar / coronhada / inspecionar / 2 toques: corrida tática" aos rótulos.
3. **A tela de vencedor manda apertar uma tecla que não faz nada** (`GunHud.tsx:154-156`). Ela diz "R ou o menu:
   jogar de novo", mas na zona 8 o `gunPress` (`scene.ts:1962`) troca rematch por reload e não chama `onRematch`.
   Além disso, `rematchKey` ignora a zona 8.
   **Correção:** com `winner`, R chama `restartGun`; ou o texto passa a dizer só "Esc → Recomeçar a partida".
4. **Os bots do gunfight não saem quando alguém entra, e o botão de tirá-los some** (`GunHud.tsx:243,266`).
   O código usa `blocked = others > 0` e esconde "Tirar os bots". O `GunGame` não tem a regra "se alguém entra, o bot
   sai", que existe nos outros jogos (`bots/store` notice).
   **Correção:** tirar os bots com o aviso quando `counts[8] > 1`, ou pelo menos manter "Tirar os bots" visível
   quando `bot` existe.

### Média
5. **O número da vida fica invisível** (`space3d.css` `.gf-health strong`). O texto `#111` fica sobre o trilho
   escuro sempre que a vida passa de uns 90%: nos quadros, os números 75 e 22 quase não aparecem. **Correção:** pôr o
   número fora da barra em `#fff` com sombra, ou usar `mix-blend-mode`/duas camadas. Acrescentar o rótulo ou ícone de
   vida.
6. **Não há marcador de acerto na luneta** (`GunHud.tsx:53`). O `.gf-hit` fica dentro de `.gf-cross`, que é escondido
   com `scoped`, então quick scope e tiro com a luneta não têm confirmação visual (confirmado no quadro `v_sniper`).
   **Correção:** tirar o marcador de dentro do `!h.scoped` e renderizá-lo também por cima da luneta.
7. **Contra gente de verdade, o abate nunca aparece em vermelho e o som de abate nunca toca** (`game.ts:529-541`,
   `remote 'die'`). Com uma pessoa, `kill` é sempre `false`. Quando chega `die` com `by === selfId`, nada emite
   `gunfx kill` nem `hitKill`. **Correção:** em `remote('die')`, se `g.by === selfId`, emitir `kill` e
   `set({ hitAt, hitKill: true })`.
8. **O leitor de tela fala demais e não avisa o que importa** (`GunHud.tsx:36,138,150`). `DeadPanel` usa
   `role="status"` com "Renasce em N s", que muda a cada segundo, e o HUD inteiro é renderizado de novo a cada 50 ms.
   Isso vai contra a convenção de uma região viva só. Os abates e a morte não são anunciados, e
   `aria-hidden='false'` não faz nada. **Correção:** tirar o `role="status"`. Anunciar por
   `useAnnounce().say()` "Abatido por X", "Você abateu X" e "X venceu". O contador fica `aria-hidden`.
9. **O equipamento na tela de abatido não pode ser usado** (`GunHud.tsx:142`). O mouse continua preso e o foco está
   na cena, então os 11 botões ficam inalcançáveis durante 3 s. **Correção:** mostrar só o texto "Equipamento: M4 ·
   M9 · Karambit" e "Esc para trocar". Outra opção é soltar o cursor ao morrer.
10. **A partida não tem fim** (`game.ts:260`, `GunHud.tsx:128`). Depois do vencedor o jogo continua somando, o painel
    fica no centro para sempre e "Recomeçar a partida" só zera o placar no seu app (os outros continuam com o deles).
    **Correção:** com `winner`, congelar o placar e mostrar o placar final. Recomeçar sozinho em uns 10 s ou repassar
    o recomeço pela rede (`space:gun kind:'restart'`). Enquanto isso não existir, o botão deve dizer "(só no seu
    app)".
11. **Um tiro some quando outro igual sai na mesma hora** (`sfx.ts:402`). `SFX_BURST_MS` vale por nome e não por quem
    atira. Com vários bots usando fuzil ou submetralhadora, o meu estampido pode sair mudo. **Correção:** usar a
    chave `name + by` no gunshot, ou não aplicar o intervalo aos sons com `by === me`.
12. **O ganho do próprio tiro nunca é aplicado** (`sfxmap.ts:186`). O código compara `e.by === 'me'`, mas o jogo
    emite `by: selfId`, então o próprio tiro sai com 0,9 em vez de 1. **Correção:** comparar com `ctx.me`.
13. **Ponto duplo na mira** (`SpaceView.tsx`, `LockHint`). O `space3d-dot` de 6 px também aparece na zona 8, por cima
    da `gf-dot` e da alça de mira. **Correção:** não renderizar `LockHint` quando `zone === 8`.
14. **"Reduzir movimento" não chega à arma** (`viewmodel.ts:148-177`). O balanço do passo e do mouse ignora a
    preferência. **Correção:** passar `reducedMotion` para o `Viewmodel` e zerar o balanço do passo e do mouse.

### Baixa
15. **O equipamento salvo não é validado** (`state.ts:68`). Um id inválido em `localStorage` faz `GUNS[id]` ficar
    `undefined`, e a HUD quebra em `spec.cls`. **Correção:** filtrar por `SLOT_GUNS[slot].includes`.
16. **O painel do gunfight fica diferente do resto do menu** (`GunHud.tsx` `GunMatchPanel`). Falta `header.gm-head`
    com o h2 "Esta partida" e o objetivo. Os botões são `gf-option`, sem hover. `aria-label="Quantos bots"` está num
    `div` sem `role="group"`, e o mesmo falta nos níveis.
17. **Classe da arma no plural em cada opção** (`weapons.ts:288`). Aparece "M4 / Fuzis". **Correção:** usar o
    singular (Fuzil, Submetralhadora, Sniper, Pistola, Faca). O comentário de `FFA_TARGET` diz "mortes" onde deveria
    dizer "abates".
18. **O nível do bot aparece duas vezes no placar.** Aparece "Bot 1 · Fácil" e, ao lado, a etiqueta "bot".
    **Correção:** deixar o nome curto e uma etiqueta só, ou o nível só na etiqueta.
19. **Retículo da luneta pouco visível no escuro.** O preto 0,8 some sobre fundo escuro. **Correção:** pôr um halo
    branco fino (stroke duplo).

## O que está certo e fica como está
A mira abre com a dispersão e some correndo, o marcador fica branco no acerto, vermelho no abate e maior na cabeça,
o indicador de dano mostra de onde veio, a borda vermelha aparece com vida baixa, "R recarregar" usa `<Binding>`, a
luneta preta tem retículo próprio, o cartão do Gunfight tem bom texto, o placar no Tab tem tabela com cabeçalho, a
transição da barra respeita reduzir movimento e as receitas de som são sintetizadas sem arquivo de terceiros, cada
classe com seu peso.

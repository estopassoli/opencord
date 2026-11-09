# Pegada e recuo, rodada 1 de 2: Nara (UX, som e o jogo todo), 2026-11-09

Só leitura: não editei nada no código. Página de teste: cópia em `scratchpad/nara-r4` (porta 5619), com três roteiros novos:

- `burst`: vira para uma parede a cerca de 10 m e esvazia o pente, mirando ou do quadril, em pé ou agachado. A cada quadro grava `pitch`, `yaw`, `viewPunch`, `vm.kick` e `spreadPx` em `shots.json`. A conta é feita por `an.mjs`.
- `pose`: um bot parado a 1,9 m segurando cada arma, visto de lado, de lado mirando, de frente e de 3/4.
- `fp`: primeira pessoa com cada arma parada, 66 ms depois do tiro e correndo.

As imagens estão em `out_pose/sheet0-2.jpg`, `out_fp/sheet0-2.jpg` e `out_m4_a1_c0/f00000.jpg`.

## Medidas do recuo (mirando, em pé, parede a ~10 m)

| Arma | Subida por tiro | Pente inteiro | Depois de soltar (900 ms) | Lado no fim | Tranco máx. | Coice visual máx. |
|---|---|---|---|---|---|---|
| M4 | 0,30→0,39° | 10,8° (29 tiros) | **10,8°** (não volta) | +0,9° | 0,23° | 0,065 |
| M4 quadril | 0,47→0,60° | 16,7° | **16,7°** | +1,4° | 0,35° | 0,065 |
| M4 agachado | 0,24→0,31° | 8,7° | 8,7° | +0,7° | 0,18° | 0,065 |
| AK-47 | 0,47→0,60° | 16,8° | **16,8°** | +1,6° | 0,31° | **0,054** |
| MP7 | 0,24→0,31° | 11,5° (39) | 11,5° | +1,8° | 0,16° | 0,079 |
| MP5 | 0,27→0,34° | 9,5° | 9,5° | +1,0° | 0,16° | 0,065 |
| Desert Eagle | 1,27° | 8,9° (7) | 8,9° | −0,3° | 0,65° | **0,047** |
| M9 | 0,46° | 4,6° (10) | 4,6° | +0,2° | 0,30° | 0,065 |
| L115 | 0,69° | — | fica | — | 1,22° | 0,067 |
| Kar98k | 0,58° | — | fica | — | 1,02° | 0,067 |

A coluna "coice visual" mostra a mola do viewmodel. Com 0,065, a arma recua 2,6 mm e o cano sobe 0,37°.

Em resumo, o recuo é **uma escada reta para cima com um passeio aleatório para o lado**, e a mira **nunca volta**. A AK e o M4 só mudam na escala. Na primeira pessoa, o quadro do tiro sai igual ao quadro parado para todas as armas (`out_fp`). A AK coice menos que o M4 na tela, e a Desert Eagle menos que a M9.

## Problemas (pegada e recuo primeiro, do mais grave ao menos grave)

1. **(alta, recuo) Não há padrão por arma; o recuo é aleatório puro** (`game.ts:804-808`). A subida é constante e cresce 3% por tiro. O lado sai de `(rand−0,42)·2·side`, um sorteio por partida, então não dá para aprender o padrão. Correção: pôr em `weapons.ts` um `pattern` por arma, com o passo de cada tiro em graus e ±15% de sorteio por cima:
   - **M4:** tiros 1–6 sobem 0,36° e ficam no centro; tiros 7–15 sobem 0,30° e vão +0,06° para a direita; do tiro 16 em diante sobem 0,18° e balançam ±0,22° num ciclo de 8 tiros.
   - **AK:** tiros 1–5 sobem 0,62°; tiros 6–14 sobem 0,42° e vão −0,16° para a esquerda; do 15 em diante sobem 0,20° e balançam ±0,35° num ciclo de 6 tiros.
   - **MP7:** sobe 0,22° e, depois do tiro 10, vai +0,05° para a direita.
   - **MP5:** sobe 0,26° e, depois do tiro 12, vai −0,05° para a esquerda.

   Valores nossos. O fator de mira (0,65) e o de agachado (0,8) continuam valendo.
2. **(alta, recuo) A mira não volta depois de soltar o gatilho** (`game.ts`, nada guarda o recuo acumulado). Ela fica 10,8° acima com o M4, 16,8° com a AK e 8,9° com a Desert Eagle depois de 7 tiros. Com a pistola, cada clique sobe e não volta. Correção:
   - Guardar `recoilDebt {pitch, yaw}`, somando o que `host.turn` aplica.
   - Descontar dele o mouse que a pessoa puxou no sentido contrário.
   - A partir de 120 ms sem tiro, devolver o que sobrou da dívida, em grau por segundo: fuzil 70% a 9°/s, SMG 75% a 11°/s, pistola 85% a 14°/s, sniper 90% a 6°/s.
3. **(alta, recuo) O coice da arma na primeira pessoa não aparece e é o mesmo para todas** (`viewmodel.ts:201,240,292-293`).
   - O impulso é o mesmo para fuzil e SMG (1,2), para as pistolas (1,8) e para as snipers (2,6).
   - O pico fica entre 2 e 4 mm e 0,4–0,9°.
   - A cadência faz a AK coice menos que o M4, e a Desert Eagle (0,047) menos que a M9 (0,065).
   - Não há rolagem nem desvio para o lado.

   Correção: uma tabela `vmKick` por arma, com recuo (z, em m), subida do cano (rad), rolagem (±rad), lado (±rad) e mola (k, c):

   | Arma | z (m) | Subida (rad) | Rolagem (±rad) | Lado (±rad) | Mola (k, c) |
   |---|---|---|---|---|---|
   | M4 | 0,018 | 0,035 | 0,012 | — | 260, 26 |
   | AK | 0,024 | 0,05 | 0,02 | 0,012 | 220, 22 |
   | MP7 | 0,010 | 0,02 | 0,015 | — | 320, 30 |
   | MP5 | 0,012 | 0,025 | — | — | — |
   | L115/M200 | 0,07 | 0,16 | — | — | 110, 16 |
   | Kar98k | 0,06 | 0,14 | — | — | — |
   | Desert Eagle | 0,035 | 0,26 | 0,03 | — | 90, 11 (sobe alto e volta devagar) |
   | M9 | 0,012 | 0,07 | — | — | 300, 28 |

   O impulso vai na velocidade (`kickV`), sem acumular acima de 1,5× o pico. Mirando, multiplicar por 0,5. Fazer a integração da mola em subpassos de 1/120 s, como já se faz com o tranco da câmera.
4. **(alta, pegada) Na terceira pessoa, o fuzil fica à frente do corpo, com os braços esticados, a coronha longe do ombro e as duas mãos juntas atrás** (`avatar.ts` `holdGun`, `SHOULDER_PT`/`G_OFF`). Confirmado em `out_pose/sheet0-1.jpg` com o M4, a AK, a MP7, a L115 e a Kar98k, de lado e mirando. De frente, a mão esquerda fica aberta no ar ao lado da arma. Correção:
   - Ancorar a coronha no osso do ombro de verdade (`upperarm_r` no mundo, +0,03 m para dentro), no lugar do ponto fixo.
   - Mirando, o rosto fica a 0,05 m acima da linha da mira.
   - Com arma longa, alongar o braço esquerdo para 1,25× (escala do `lowerarm_l`) ou trazer o apoio para no máximo 0,16 m do punho (o `pullInReach` só desliza até onde o braço alcança).
   - A mão de apoio tem que fechar (curl 0,72) só quando encosta. Fora disso, nunca aberta.
5. **(média, recuo) A mira (retículo) não abre com os tiros** (`game.ts` `hud()`, `spreadNow`). O espalhamento não cresce na rajada, e o `spreadPx` fica fixo em 17 px no quadril do M4 do primeiro ao último tiro. O primeiro tiro mais preciso (×0,6) não aparece na mira. Correção:
   - Criar `bloom` por classe, somado a cada tiro: fuzil +0,004 rad (teto 0,03), SMG +0,003 (teto 0,025), pistola +0,008 (teto 0,02).
   - Mirando, ×0,3. Depois de 100 ms sem tiro, cai a 0,12 rad/s.
   - O `bloom` entra no `spreadNow` e no `spreadPx`.
   - No CSS, a `.gf-line` anima por `transform` (hoje o vão muda `top`/`left`, e a transição de 60 ms nunca roda).
6. **(média, recuo) A luneta quase não sobe, e todas as armas voltam na mesma mola** (`game.ts:1184`, `k`=400, `c`=40, ~150 ms). O tranco da L115 é de 1,2° numa luneta de 4× (cerca de 7% da altura da imagem), e o da Desert Eagle volta tão rápido quanto o da M9. Correção:
   - Mola por classe: sniper k 140, c 24, e a parte que volta (`1−keep`) dá cerca de 4,5° na L115 e 5° na M200.
   - Desert Eagle: k 160, c 22, cerca de 2,5° de tranco.
   - Fuzil e SMG continuam com a mola atual.
7. **(média, recuo) Na terceira pessoa, o coice é igual para todas as armas e não mexe no corpo** (`avatar.ts:926-962`, `KICK_S` 0,08). O cano sobe 0,1 rad e recua 4 cm na M9, na MP7 e na Desert Eagle. Correção:
   - Coice por classe: pistola 0,08 rad (Desert Eagle 0,3 rad e 160 ms), fuzil 0,06 rad e 3 cm, sniper 0,25 rad e 180 ms.
   - O tronco (`spine_02`) vai para trás: 0,03 rad no fuzil e 0,08 rad na sniper.
8. **(média, pegada) Os dedos fecham todos juntos: não existe indicador no gatilho** (`hand.ts:135-141`, `setCurl(c, t)`; `grips.ts`). Os quatro dedos abraçam o punho. Também não dá para pôr o indicador na argola do karambit nem os polegares para a frente na pistola. Correção:
   - `setCurl(c, thumb, index?)`, com o indicador entrando na chave do cache.
   - Punho com o dedo no gatilho: indicador 0,55. Correndo e na recarga, 0,2 (esticado ao longo da armação).
   - Karambit: indicador 1,0 e os outros 0,9.
   - Pistola: polegar 0,25 nas duas mãos.
9. **(média, pegada) O bot com faca e com alvo estica o braço, como se mirasse a faca** (`avatar.ts` `holdGun`, `y = p.ads ? 0.98…`, `z = p.ads ? 0.4…`; `bots.ts` `place`, `ads: !!b.target`). Visto em `out_pose/sheet2.jpg`. Correção: usar `p.ads && !knife` no `holdGun` e mandar `ads: !!b.target && GUNS[b.w].cls !== 'knife'` no `place` dos bots.
10. **(média, pegada, continua) Na recarga vazia, o antebraço esquerdo cobre cerca de 1/3 da tela** (`viewmodel.ts`, ramo `reloadEmpty`; `out_m4_a1_c0/f00000.jpg`). Correção: limitar o cotovelo esquerdo a `ELBOW_MAX_Z_OVER` também na ida ao pente, e baixar a manga 0,08 m no trecho de 0,6 a 0,9.
11. **(média, recuo) Os bots não têm recuo** (`bots.ts:451`). No Difícil, o espalhamento fica em `ads+0,006` rad do primeiro ao último tiro da rajada, e o bot atira com laser enquanto a pessoa luta contra 11–17° de subida. Correção: somar ao `spread` do bot `0,4 × shotsInBurst × recoil.up` (até 4× o `up`), ou fazer o pitch do bot subir com o padrão e corrigir com o `error` do nível.
12. **(baixa, recuo) Durante a rajada, a bala cai abaixo do centro da tela** (`scene.ts:2104`, `pitch − viewPunch`). A câmera sobe com o tranco, mas o tiro sai da mira de verdade, uma diferença de 0,18° a 0,35° medida. Correção: mandar o tiro por `pitch − viewPunch·0,5`, ou desenhar o tranco também no viewmodel, para a mira de ferro acompanhar.

## O resto do jogo (area "outro")

13. **(alta, som) Não há som de passo** (`sfxmap.ts`/`game.ts`/`bots.ts`; nenhum `gunfx 'step'`). Ninguém ouve o outro chegando, o que num shooter de PC é informação básica. Correção:
    - Emitir `gunfx 'step'` a cada passada: 0,55 m andando e 0,8 m correndo; agachado não emite.
    - Vale para mim, para os bots e para os outros (pela pose: distância andada acumulada).
    - Receita: `noise('lowpass', 900, 0.05, 0.35)` mais `tone(70, 0.04, 0.3)`.
    - Ganho: 0,25 para mim e 0,55 para os outros, 1,2× na corrida tática.
14. **(média, som) Armas diferentes têm o mesmo estampido, e o tiro sai sempre igual** (`sfxmap.ts` `SHOT_SOUND`). A L115, a M200 e a Kar98k usam `shotSniper`, e a MP7 e a MP5 usam `shotSmg`. Não há variação de tom de um tiro para outro (rajada "de metralhadora de brinquedo") nem diferença de longe. Correção:
    - Tom por arma no cue: Kar98k 1,12, M200 0,9, MP7 1,1, MP5 0,95.
    - Em `sfx.play`, para nomes `shot*`, tom ×(0,97 + 0,06·sorteio).
    - Tiro de outro a mais de 25 m: receita `shotFar` (`noise('lowpass', 900, 0.3, 0.5)` + `tone(60, 0.15, 0.6)`).
15. **(média, interface) A dica "Sem bala? Troque para a pistola (2)" mostra a tecla R** (`tutorial.ts` hint `gun-swap`, `action: 'rematch'`; `TutorialHud.tsx:247`, `StepKeys`). O R recarrega, então a dica mente ao lado do texto. Correção: deixar a dica sem `action` e desenhar `<kbd>2</kbd>`/roda no próprio texto, ou criar a ação `slot2`.
16. **(média, interface) A tela não mostra o meu placar nem o do líder sem segurar o Tab, nem as armas dos espaços 1/2/3** (`GunHud.tsx`). Correção:
    - No alto ao centro: "Você 12 · Bot 2 18 · até 30". Com `aria-hidden` (o anúncio continua pela região viva).
    - Ao trocar de arma, mostrar por 1,5 s a lista 1 M4 · 2 M9 · 3 Karambit, com a ativa em destaque.
17. **(baixa, som) O som do ferrolho abrindo chega 120–290 ms antes da mão** (`game.ts` `scheduleBolt`: `boltOpen` no começo; o giro em `viewmodel.ts` vai de 0,12 a 0,28 do tempo). Correção: `boltOpen` em `t + ms·0,15`, e um segundo ruído no puxão, em 0,45.
18. **(baixa, som) A panorâmica limitada a ±0,5 dificulta saber de onde veio o tiro** (`SFX_PAN_MAX`). Correção: na zona 8, ±0,8 para `gunshot` e passos, registrado no adendo de som do ADR-0055.
19. **(baixa, interface) A mira e a luneta são medidas pela janela, e não pela área 3D** (`game.ts` `hud()`, `window.innerHeight`; `space3d.css` `.gf-scope` `42vh`/`84vh`). Com o Espaço 3D menor que a janela, a mira exagera o espalhamento e a luneta sai do tamanho. Correção: usar `host.clientHeight` (o mesmo do `renderer.setSize`) e medir a luneta em `%` do `.gf-hud`.
20. **(baixa, interface) A tela de abatido não diz com que arma nem se foi na cabeça, e a vida e a munição continuam na tela durante a morte** (`GunHud.tsx` `DeadPanel`). Correção: "Abatido por Bot 2 · AK-47 · na cabeça", e esconder `.gf-health`/`.gf-ammo` com `h.dead`.
21. **(baixa, textos) Falta o golpe pesado nos comandos, e o 30 está escrito à mão** (`GameHud.tsx` `GUN`, `tutorial.ts` objective, cartão do menu). Correção: incluir "Faca: botão direito, golpe pesado" e usar `FFA_TARGET` nos textos.

## O que está bom
- Os sons da recarga batem com a mão: o pente sai em 0,18, encaixa em 0,6/0,62 e a alavanca vai em 0,8. A Kar98k empurra as balas em 0,46/0,58.
- O abate de gente de verdade dá marcador vermelho e o som de abate.
- A região viva única anuncia "Você abateu", "Abatido por" e o vencedor.
- O retículo da luneta tem halo.
- A vida fica legível.
- Reduzir movimento chega ao viewmodel (0,3) e ao tranco (0,35).
- Pistola na primeira pessoa: as duas mãos juntas no punho.
- Fuzil na primeira pessoa: a direita fica no punho e a esquerda no guarda-mão.

## Verificações
Não editei código e não rodei tsc/eslint/vitest nesta etapa. Medidas e imagens em `scratchpad/nara-r4`.

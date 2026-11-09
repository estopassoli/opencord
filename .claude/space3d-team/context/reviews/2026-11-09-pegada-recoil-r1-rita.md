# Pegada e recoil, rodada 1 de 2: revisão da Rita (QA), 2026-11-09

Nesta etapa não editei código, só li, medi e olhei os quadros. Checks em `apps/desktop`:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit -p .` | ok |
| `npx eslint src test` | ok |
| `npx vitest run` | 69 arquivos, 490/490 |

## Página de teste e sondas
- **Cópia:** `scratchpad/rita-pr`, porta 5477. Tem um roteiro novo, `probe` (`?s=probe&l=prim,sec,faca`), e expõe `window.THREE`, `window.key` e `window.tap`.
- **`spray.cjs`:** rajada parada a 30 e 144 qps. Mede o intervalo real entre tiros, a mira depois de cada tiro, o ângulo de cada impacto e o que a mira recupera 1,5 s depois de soltar. Saídas em `out/spray30.json`, `out/spray144.json` e `out/spray30b.json`.
- **`grip.cjs`:** um quadro por estado e por arma na 1ª pessoa: sacar, parado, mirar, tiro, correr, tática, slide, inspecionar, recarga, recarga vazia, coronhada, ferrolho e golpes. Folhas em `out/sheet_<arma>.jpg`.
- **`vmnum.cjs`:** na 1ª pessoa, a folga entre a palma e a malha da arma, medida com raio, e quantos pontos da mão encostam na arma.
- **`tp.cjs`:** o meu boneco em 3ª pessoa, de lado, de frente e de trás. Mede a distância de cada mão até o punho e até o apoio. Saída em `out/tp/` e `out/tp.log`.
- **`kick.cjs`:** o coice quadro a quadro. Folhas em `out/kick_*.jpg`.
- **`knum.cjs`:** o vão da mão fechada contra o cabo das facas.
- **Armadilha da página:** o `#host` tem 960×540 fixos. Com um viewport menor, o screenshot corta o canto, e a arma parece sumir da tela. Grave sempre em 960×540.

## Números do recoil (mira parada, olhando reto)
O mesmo padrão aparece a 30 e a 144 qps.

| Arma | Sobe por tiro, mirando (1º → último) | Rajada inteira, quadril / mirando | Lado no fim | Tranco máx. | Recupera depois de soltar |
|---|---|---|---|---|---|
| M4 | 0,30° → 0,39° | 17,1° / 11,1° | 1,2° | 0,26–0,41° | **0°** |
| AK-47 | 0,46° → 0,60° | 26,5° / 17,2° | 2,2° | 0,32–0,50° | **0°** |
| MP7 | 0,23° → 0,30° | 18,0° / 11,7° | 2,9° | 0,17° | **0°** |
| MP5 | 0,26° → 0,34° | 15,0° / 9,8° | 1,3° | 0,18° | **0°** |
| M9 | 0,46° fixo | 10,6° / 6,9° (15 tiros) | 0,3° | 0,31° | **0°** |
| Desert Eagle | 1,27° fixo | 13,6° / 8,9° (7 tiros) | 0,4° | 0,63° | **0°** |
| L115 | 0,69° | 3,2° / 2,1° (3 tiros) | 0,1° | 1,19–1,83° | **0°** |

- **Os sinais do lado se repetem em todas as armas e partidas:** `++-++-++++-+`. O sorteio tem semente fixa, e um sorteio só serve todas as armas. Não dá um padrão por arma que se possa aprender, e também não é aleatório entre partidas.
- **Coice visual na 1ª pessoa:** a mola chega a `kick` 0,016–0,043. No fuzil isso dá ~1 mm para trás e 0,17° no cano, o que não se vê (`out/kick_ak47_ads.jpg`). Na Desert Eagle é igual ao da M9.
- **Cadência medida:**

| Arma | Nominal | 30 qps | 144 qps |
|---|---|---|---|
| M4 | 800 | 600 | 785 |
| AK-47 | 600 | 498 | 576 |
| MP5 | 860 | 600 | 785 |
| MP7 | 950 | 900 | 864 |
| M9 | 520 | 450 | – |
| Desert Eagle | 180 | 164 | – |

## Achados (do mais grave ao menos)

### Alta
1. **A cadência depende do FPS, e o dano por segundo muda até 30%** (`game.ts` `fire`).
   - **Causa:** `nextShot = now + shotInterval` usa o quadro e não o tiro anterior, e só sai 1 tiro por quadro. A 30 qps a MP5 atira a 600 rpm em vez de 860, e o M4 a 600 em vez de 800.
   - **Correção:** `this.nextShot = Math.max(this.nextShot + iv, now)` na rajada contínua (a partir de `now` só no primeiro tiro da rajada). No `step`, `while (now >= nextShot && can) fire()`, com no máximo 3 tiros por quadro, distribuindo o recuo e o traçante entre eles.
   - **Teste:** 3 s de M4 dão 40±1 tiros a 30, 60 e 144 qps.
2. **O recoil não tem padrão por arma nem recuperação** (`weapons.ts` `recoil`, `game.ts` `fire`).
   - **Hoje:**
     - a mira sobe em linha e fica lá;
     - o lado é um sorteio com viés de +16%, que se acumula como passeio aleatório;
     - soltar o gatilho devolve 0°;
     - mirando, o recuo só cai 35%.
   - **Correção:**
     - Pôr em `GunSpec.recoil` uma tabela `pattern: [up, side][]` por arma, para os primeiros ~12 tiros, depois repetindo os 4 últimos.
     - Somar um ruído pequeno (±15%) de um sorteio separado. Não usar o `rand()` do espalhamento.
     - Guardar `recoilDebt` (yaw e pitch somados pelo recuo). Ao soltar o gatilho, ou depois de `iv + 80 ms` sem atirar, devolver a uma taxa por classe: fuzil 9°/s, SMG 11°/s, pistola 12°/s, sniper 6°/s. Devolver só o que ainda é dívida: o que o mouse já puxou para baixo abate da dívida.
     - Mirando: ×0,6. Agachado: ×0,85 (o efeito empilha com o da mira).
   - **Alvos com ADS** (o tiro 1 sobe 0,2–0,3°):

| Arma | Sobe nos 10 primeiros | Lado |
|---|---|---|
| M4 | ~4° | pende levemente à direita (+0,6°) e volta |
| AK-47 | ~6,5° | vai à direita até ~1,5° nos tiros 5–10 e depois à esquerda, em S |
| SMGs | ~3° | mais tremido (ruído ±25%), pouco lado |

   - **Teste:** a sequência dos 10 primeiros tiros sem ruído é sempre a mesma; depois de 0,6 s solto, a dívida volta a menos de 10%.
3. **O coice visual na 1ª pessoa não se vê, e todas as armas da mesma classe coicem igual** (`viewmodel.ts` `play('fire')` e `update`).
   - **Hoje:** o impulso é 1,2/1,8/2,6 por classe, e a mola k=170, c=18 é a mesma para todas. O `kick` máximo medido é 0,03 (1 mm e 0,17°). Não tem rolagem nem desvio lateral, e é igual mirando.
   - **Correção:** perfil por arma em `weapons.ts` (`vmKick: { back, up, roll, side, k, c }`):

| Arma | back (m) | up (rad) | roll (rad, sinal sorteado) | Mola |
|---|---|---|---|---|
| M4 | 0,018 | 0,045 | ±0,02 | |
| AK-47 | 0,022 | 0,06 | ±0,035 | lado ±0,012 |
| SMG | 0,012 | 0,03 | ±0,015 | k=260 |
| M9 | 0,02 | 0,12 | | |
| Desert Eagle | 0,045 | 0,32 | | k=90, c=12: sobe alto e volta devagar |
| L115/M200 | 0,07 | 0,18 | | k=110 |
| Kar98k | 0,06 | 0,16 | | |

   - Aplicar como impulso de posição/ângulo com mola (já com subpassos), mirando ×0,45 em `back`/`up`, e manter a mira (o `AIM`) na linha depois do retorno.
   - Limitar `pos.z` para a arma nunca encostar na câmera (`pos.z ≤ -0.2`).
4. **A mão de apoio não encosta no guarda-mão: flutua em umas armas e atravessa em outras** (`grips.ts` `leftGrip` e `models.ts` `bottomAt`).
   - **Medido com raio do centro da palma para cima** (a meia espessura da palma é 0,017):

| Arma | Folga até o guarda-mão |
|---|---|
| MP7 | 0,036 |
| MP5 | 0,036 |
| L115 | 0,037 |
| M4 | 0,037 |
| AK-47 | 0,006 |
| M200 | 0,004 |
| Kar98k | 0,004 |

   - Na MP7, MP5, L115 e M4 há ~2 cm de ar, e nenhum ponto da mão encosta. Na AK, M200 e Kar98k a palma entra 1,1–1,3 cm na malha.
   - Os dedos esticam até x = +0,072, a mesma largura em toda arma. Na MP7 (estreita) eles sobem no ar a 4–5 cm do lado do guarda-mão. Na tela, mirando, aparece uma garra solta à direita da arma (`out/ads4.jpg`, AK e MP7).
   - **Correção:**
     - `support.y` deve vir de um raio para cima em x=0 na fatia `sz`, a partir de y=−0,3 (a primeira superfície).
     - A palma fica a `support.y − 0.017`: pulso em `support + (−0.046, −0.017 − 0.017, 0)` no giro C.
     - Medir a meia largura `w` do guarda-mão na mesma fatia e pôr `curl` = 0,9 + 0,5·(0,03 − w), limitado a 0,8–1,0, para os dedos fecharem no lado direito.
   - **Teste:** com `vmnum.cjs`, folga entre 0,015 e 0,02 em todas as armas e ≥ 15 pontos da mão encostando.
5. **3ª pessoa: as duas mãos ficam juntas no punho em toda arma longa** (`avatar.ts` `holdGun` e `pullInReach`).
   - **Medido no quadril:** `hl_sup` (mão esquerda ao apoio) é 0,28–0,29 m na M4/AK, 0,22 na MP7, 0,28 na L115 e 0,24 na Kar98k. A distância entre as mãos é de 1,6–4 cm: os dedos se cruzam.
   - Mirando fica igual, `hl_sup` 0,18–0,23.
   - **Correndo o braço alcança:** `hl_sup` cai para 0,045–0,068, porque o tronco inclina e leva o ombro para a frente.
   - **Correção** (postura de tiro de verdade: ombro de apoio à frente):
     - girar `spine_02`/`spine_03` ~0,45 rad em y, para o ombro esquerdo ir à frente, e inclinar 0,12 rad para a frente sempre que segura arma longa (somando à pose atual);
     - `SHOULDER_PT.x` −0,2 → −0,14 no quadril;
     - só então o `pullInReach`.
   - **Meta:** `hl_sup` < 0,05 no quadril e mirando.
   - **Teste:** medir com `tp.cjs`.
6. **Karambit: o cabo fica fora da mão fechada, na frente dos dedos** (`grips.ts` `rightGrip`, ramo `karambit`).
   - **Medido:** o vão da mão fechada (`FIST_HOLE`) fica a 4,2 cm do centro do cabo: 4 cm acima e 1,3 cm à esquerda. Na tela, o cabo e a argola passam por fora dos dedos (`out/knives_zoom.jpg`).
   - **Correção:** igual à baioneta, `pos = handle − FIST_HOLE.applyQuaternion(Q)`, com `Q` = punho com o cabo em pé (lâmina saindo do lado do mindinho, para baixo e para a frente) e `curl` = `FIST_CURL`. A argola fica acima do indicador; o ideal é o indicador passando por ela (curl próprio do indicador, ver 8).
   - **Teste:** `knum.cjs` `dist` < 0,005.

### Média
7. **O antebraço esquerdo cobre o meio da tela na recarga vazia, em todas as armas, e na Kar98k** (`viewmodel.ts`, `leftOver` e `shoulderAt`). Visto em M4, MP7, Desert Eagle e Kar98k, de 68% a 86% da recarga vazia e em toda a `reloadClip` (`out/sheet_m4.jpg`, `out/sheet_deagle.jpg`, `out/sheet_kar98k.jpg`). Na Desert Eagle a manga tapa ~60% da tela.
   **Correção:**
   - Na pistola, soltar o ferrolho com o polegar esquerdo, sem levar a mão para cima: só `chargeBack` com a mão no lugar.
   - Nas armas longas, a mão vem por baixo e por fora: `leftOver` com o ombro em `x·(1+1.2·over)` e `z − 0.2·over`, e `ELBOW_MAX_Z_OVER` −0,32. A arma gira `rot.z += 0.45·over` em vez de 0,25.
   - Na Kar98k, a mão esquerda fica no guarda-mão, e só o polegar sobe. O pente-lâmina vem na mão direita.
   - **Teste:** projetar os vértices da manga e exigir que menos de 25% da tela fique coberta.
8. **O indicador não fica no gatilho** (`hand.ts` `setCurl` e `grips.ts`). Todos os dedos fecham com o mesmo curl, então o indicador abraça o punho junto (`out/m4_parado_zoom.jpg`).
   **Correção:**
   - `setCurl(c, t, index?)` com o curl do indicador separado: ~0,45 no gatilho, e 0,1 esticado fora do guarda-mato ao correr, recarregar e inspecionar.
   - No tiro, um pulso de +0,15 por 60 ms.
   - Chave do cache: `side:c:t:i`.
   - Na karambit, o indicador fica em 1,0 dentro da argola.
9. **A palma direita entra ~1–1,5 cm no punho** (`grips.ts` `rightGrip`): o raio do centro da palma para a esquerda acha o punho a 2–7 mm, e devia ser 17 mm.
   **Correção:** pulso em x = 0,018 + 0,012 (0,03), ou medir a largura do punho como no item 4.
10. **A pistola no quadril fica baixa demais.** Só se vê o alto do ferrolho, e as mãos ficam na borda de baixo (`out/sheet_deagle.jpg`, "parado").
    **Correção:** `HIP_PISTOL` (0,11, −0,105, −0,31) → (0,09, −0,085, −0,33), mais `rot.x` +0,05 na pistola.
11. **O tranco da câmera (`viewPunch`) separa a mira da bala.**
    - A câmera sobe `punch`, mas o tiro sai de `host.pitch()`, e as balas caem abaixo do centro da tela. Na rajada de fuzil são 0,2–0,5° (16–26 cm a 30 m). Na luneta, o impacto aparece abaixo da cruz (`out/kick_mix.jpg`).
    - **Correção:** o tiro usa `pitch - punch·0.5`, ou o `punch` passa a ser rolagem e posição da câmera, sem pitch. Na luneta, mexer também a sobreposição (`GunHud` da luneta, `translateY` = punch·px/rad, com a mola).
12. **A luneta quase não sobe no tiro.**
    - O tranco é de 1,2–1,8°, a ~7% da tela com zoom 4x, volta em ~150 ms e a moldura preta fica parada.
    - **Correção:** `punchV` das snipers ×2 e mola mais lenta (k=180, c=22: volta em ~350 ms). A moldura da luneta sobe junto e treme 2 px por 120 ms.
13. **Sem marca de impacto na parede, não dá para ver nem aprender o padrão do recuo** (`juice.ts` `impact` só solta faísca).
    **Correção:** um pool de 64 decalques (quad 6 cm, escuro, `polygonOffset`) na face da caixa acertada, apagando em 8 s. A normal sai do `rayBox`.
14. **3ª pessoa: a coronha da MP7 e da L115 atravessa o peito do boneco** (`out/tp_mix.jpg`, MP7 e L115 de lado). Os braços ficam esticados retos, como os de um zumbi.
    **Correção:** depois do item 5, `back` = `min(g.length+g.muzzle.z, 0.22)` para a MP7 (com a coronha recolhida) e o ombro na frente do peito. Cotovelo direito para baixo e para fora (polo `(−0.9, −1, −0.1)`).
15. **3ª pessoa: o coice é igual para toda arma** (`avatar.ts` `holdGun`: `kick·0.1`, sniper 0.2, `KICK_S` igual). A Desert Eagle coice igual à M9.
    **Correção:** usar o mesmo perfil `vmKick` do item 3, com `up`·0,6 e duração por arma (Desert Eagle 160 ms, SMG 60 ms). O tronco também dá um tranco curto no tiro de sniper e da Desert Eagle (`flinch`·0,4).

### Baixa
16. **Pistola em spam:** cada clique conta como "primeiro tiro" (espalhamento ×0,6, `k` sem rajada), então apertar o mais rápido possível é tão preciso quanto dar toques espaçados.
    **Correção:** `shotsInBurst` volta a 0 só depois de 1,5× o intervalo sem atirar, e não no `release`.
17. **A troca de arma não zera `shotsInBurst`** (`switchTo`). Zerar no `equip`.
18. **A aceleração no chão depende do FPS** (`movement.ts`: `a = min(1, 30·dt·0.25)`). A 90% da velocidade chega em 267 ms a 30 qps e em 300 ms a 144.
    **Correção:** `a = 1 − exp(−7.5·dt)`.
19. **Os bots atiram sem recuo nenhum** (`bots.ts` `fire`).
    **Correção:** somar um `kick` próprio por arma ao `errPitch` e devolvê-lo depois, para o Difícil não acertar uma rajada inteira em linha.
20. **A sensibilidade mirando é linear no FOV** (`scene.ts` `onAimMove`: `k = fov/70`).
    **Correção:** `k = tan(fov/2)/tan(35°)`. Com zoom 4x isso dá 0,22 em vez de 0,25.
21. **A mira da HUD não abre no slide e usa `window.innerHeight`** (`game.ts` `hud`).
    **Correção:** somar ×1,4 no slide e usar a altura do canvas.
22. **3ª pessoa: correndo, a arma continua no ombro, apontada.** Na corrida, baixar o cano 0,6 rad e levar a mão esquerda solta.

## Pendente de teste manual (não aprovado)
- Mouse de verdade: o recuo e a recuperação, a sensibilidade mirando e o quick scope.
- Duas pessoas em rede: o coice e as pegadas no boneco do outro.
- 144 qps reais numa máquina Windows.

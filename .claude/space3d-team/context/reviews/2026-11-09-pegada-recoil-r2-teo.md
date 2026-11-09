# Pegada e recoil, rodada 2: revisão do Téo (2026-11-09)

Só leitura e medida, sem mexer no código. Teste com pessoas: PENDENTE.

Página de teste copiada em `scratchpad/teo-pr3/` (servidor na porta 5533). Sondas novas:
- `fing.cjs`: ponta de cada dedo × osso `trigger` e apoio, no espaço da arma.
- `arm2.cjs`: distância ombro → pulso e quanto o antebraço estica.
- `burst.cjs`: rajada em 1ª pessoa, quadro a quadro, com o log de pitch, tranco e coice.
- `hv.cjs` e `hvs.sh`, mais folhas em `hv/`, `fp/`, `m3/` e `rl/`.

## O que ficou bom (visto nos quadros)
- **Recuo:** o padrão é fixo e aprendível, e a mira volta depois de soltar. O tranco, a luneta subindo, o coice por arma e a 3ª pessoa reagem.
  - O log da rajada bate com os números da rodada 1. AK no quadril: 9,3° em 1,2 s, voltando 3,5° em 0,4 s. Mirando: 5,6°.
- **Pistola:** as duas mãos estão no punho, com os polegares para a frente.
- **Baioneta:** em martelo.
- **Karambit:** a mão fica fechada no golpe pesado.
- **Kar98k:** na carga por pente-lâmina, a esquerda fica no guarda-mão.
- **3ª pessoa:** a esquerda fica no guarda-mão (M4, AK, Deagle).

## Problemas (do mais grave ao menos)

### Pegada
1. **ALTA: o indicador não está no gatilho em nenhuma arma de fogo.**
   - Medida de `fing.cjs`: a ponta do indicador fica ~2,5 cm abaixo e ~2,4 cm atrás da lâmina do gatilho.
   - Ela encosta na barra de baixo do guarda-mato e a atravessa 2,6 cm para o lado esquerdo (x −2,6). Na prática, enrola no punho como os outros dedos.
   - Isso vale para M4, AK, MP7, MP5, L115 e M200. Nas pistolas a distância é ~1,8 cm.
   - Close: `hv/trig4.jpg`, `hv/m4c_L.jpg`.
   - **Correção:**
     - `hand.ts poseRig`: dar ao indicador um giro próprio para o lado do polegar (`rotation.y` do 1º osso, ~0,3 rad, compensando a inclinação de 0,3 do punho). Hoje ele só dobra.
     - `grips.ts`: `TRIGGER_CURL` 0,72 → ~0,5 e `TRIGGER_PULL` ~0,62.
     - Meta: o centro da falange da ponta a ≤ 1 cm de (0, trigger.y − 0,017, trigger.z), com x entre −0,5 e +1 cm.
2. **ALTA: na Kar98k, a mão fica 6–7 cm atrás do gatilho.**
   - A ponta do indicador está em z +4,8 cm e o gatilho em z −2.
   - **Correção:** `grips.ts` `DELGADO_AT` z 0,10 → ~0,045, junto com o item 1.
   - Pendência antiga: as pontas dos dedos passam ~1 cm do fundo da coronha. Para isso, fechar `curl[0]` 0,95 → 1 ou subir o pulso 0,8 cm.
3. **ALTA: o braço esquerdo não alcança o guarda-mão no quadril.**
   - Em todas as armas longas, o antebraço vira um tubo de 8,6 cm que atravessa o meio de baixo da tela. É o objeto mais visível na tela no quadril (`fp/hip_sheet.jpg`).
   - O ombro esquerdo (−0,25, −0,35, +0,10) fica a 0,82–0,96 m do pulso de apoio, e o braço mede 0,62 m. O antebraço estica 1,4–1,8× (`arm2.cjs`: M4 1,76, AK 1,68, L115 1,66, MP7 1,38).
   - A causa é a arma longe demais no quadril: `HIP_LONG` z −0,46, com o apoio a −0,78. Mirando, ela fica a −0,15/−0,47, então a arma "voa" 30 cm até o olho ao mirar.
   - **Correção (`viewmodel.ts`):**
     - `HIP_LONG` (0,14, −0,17, −0,46) → (0,13, −0,15, −0,38).
     - Ombro esquerdo para a frente e para fora, em postura de lado: `SHOULDER_L` (−0,26, −0,32, −0,08).
     - Antebraço mais fino: `CylinderGeometry(0,026, 0,034)`, punho da manga 0,029, cotovelo 0,036.
     - Meta: `kL` ≤ 1,15 em todas as armas no quadril, medida com `arm2.cjs`.
4. **MÉDIA: na karambit, a argola fica fora do indicador** (`hv/hip_karambit.jpg`).
   - Dos dois lados, a argola aparece atrás e acima do punho fechado, ~2 cm fora do dedo.
   - **Correção (`grips.ts rightGrip`, karambit):**
     - Medir o centro da argola (`KARAMBIT_RING_Y` 0,056 e z) e pôr a fileira do indicador nele: `pos.z` += ~0,015, `pos.y` += ~0,008.
     - Fechar o indicador em 1 e o polegar em 0,8.
     - Meta: o centro da falange do meio do indicador a ≤ 0,6 cm do centro da argola (`fing.cjs`, `piece(handR, 1)`).
5. **BAIXA: na 3ª pessoa, a mão esquerda da L115 no quadril fica perto do punho, não no guarda-mão** (`m3/mm_l115.jpg`, vista da esquerda). As outras armas estão bem.
6. **BAIXA: na Kar98k, a madeira da coronha tem quase a cor da mão.** A mão some na coronha (`bu_kar_hip.jpg`). Para separar, escurecer a madeira ~25% ou a pele ~10%.

### Recoil
7. **MÉDIA: o "no-scope" das snipers sai preciso demais na metade da mira.**
   - No `fire` (`game.ts`), `spread *= FIRST_SHOT * (1 - ads)` multiplica de novo a base, que já cai com `ads`. A dispersão vira ∝ (1 − ads)².
   - L115 com ads 0,5, 180 ms antes da luneta aparecer: ~1°. Sem o fator, seriam 3,4°.
   - Com o ferrolho de 1150 ms, todo tiro da sniper é o "primeiro" da rajada.
   - **Correção:** só aplicar o fator de 1º tiro fora da sniper (`sp.cls !== 'sniper'`). Na sniper, usar `spread = hip × (1 − ads)` enquanto `ads < 0,85` (sem luneta) e 0 só com a luneta.
8. **BAIXA: o "S" da AK não cruza o centro.**
   - O 3º trecho é `side 0,06` + `swing 0,45`, e a rajada fica sempre à esquerda (0,9–1,5°).
   - **Correção (`weapons.ts`):** trocar `{ to: 99, up: 0,4, side: 0,06, swing: 0,45, period: 6 }` por:
     - `{ to: 22, up: 0,35, side: 0,32 }`;
     - `{ to: 99, up: 0,3, side: −0,1, swing: 0,4, period: 6 }`.
   - Assim a AK volta à direita, passa o centro no tiro ~19 e serpenteia.

### Resto do jogo
9. **ALTA: na MP7 mirando, a mira de ferro não bate com o ponto.** O anel da massa fica ~90 px acima do ponto central numa tela de 540 px (`fp/a_mp7_fp.jpg`).
   - `models.ts` mede a mira com `frontTop(holder, box.min.z*0.6)`. Na MP7 (arma curta), a massa fica atrás dessa fatia, e a linha de mira sai no topo do cano.
   - **Correção:** passar a fração por arma (MP7 ~0,35) ou um `SIGHT_Y` por arma, e conferir a mira das 7 com `ADS=1 V=fp hv.cjs`. As outras estão alinhadas.
10. **MÉDIA: aparecem cartuchos do modelo** (já visto pela Rita, confirmado aqui).
    - Mirando: M4, MP7 e AK (no meio de baixo da tela).
    - No quadril: a M9 mostra a base dourada de dois cartuchos atrás do ferrolho (`fp/hip_sheet.jpg`).
    - **Correção:** escala 0 nos ossos `bullet`/`bullets` fora da recarga, e na AK esconder a submalha dos cartuchos. Conferir a recarga cheia e a vazia (`rl/`).
11. **BAIXA: o selo "Protegido · atire para sair" fica 20 px abaixo da mira** e cobre o alvo por 1,5 s. Para tirá-lo da frente, levar ao alto, embaixo do placar curto, ou para cima da barra de vida.

## Quadros (em `scratchpad/teo-pr3/`)
- **Closes dos gatilhos:** `hv/trig4.jpg`, `hv/m4c_L.jpg`, `hv/m4c_B.jpg`.
- **Mãos por arma:** `hv/hip_<arma>.jpg` e `hv/ads_<arma>_*.jpg`.
- **1ª pessoa:** `fp/hip_sheet.jpg` (9 armas no quadril) e `fp/ads_sheet.jpg` (mirando, mais as facas).
- **Rajadas:** `bu_ak_hip.jpg`, `bu_m4_ads.jpg`, `bu_dg_hip.jpg`, `bu_kar_hip.jpg`, com os logs em `bu_*/log.json`.
- **3ª pessoa:** `m3/mm_<arma>.jpg`.
- **Recarga, pente-lâmina e golpe pesado:** `rl/sheet1.jpg`, `rl/sheet2.jpg`, `rl/z.jpg`.

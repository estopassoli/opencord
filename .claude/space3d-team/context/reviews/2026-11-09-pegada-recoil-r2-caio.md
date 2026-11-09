# Pegada e recuo — rodada 2 (Caio, gameplay) — 2026-11-09

Nesta rodada só li, medi e olhei os quadros. Não mexi no código do app. A sonda está em
`scratchpad/caio-pr3/` (porta 5531, bundle feito do código atual):
- `rc.cjs`: recuo por arma.
- `roll.cjs`: rolagem e lado durante a rajada.
- `tpk.cjs` e `tpk2.cjs`: mãos e coronha na 3ª pessoa, olhando para cima e para baixo e com coice.
- `me3e.cjs`: fotos do boneco, nas folhas `side_sheet.jpg`, `front_sheet.jpg` e `left_sheet.jpg`.
- `fp.cjs`: 1ª pessoa, na folha `fp_sheet.jpg`.
- `pure.ts`: contas puras de rajada e dispersão.

## O que conferi e está bom
- **Recuo medido:** bate com o do Téo e o da Rita.

  | Arma | Quadril | Mirando |
  |---|---|---|
  | M4 | 11,6° | 7,0° |
  | AK | 16,7° | 10,3° |
  | MP7 | 7,9° | 4,7° |

- **O padrão é fixo e a mira volta:** a M4 fica com 2,6° 0,5 s depois de soltar.
- **Rolagem e lado não tremem:** 4 a 5 trocas de sinal em 1,5 s de rajada, com a câmera a ±0,25° e a arma a ±0,8°.
- **3ª pessoa mirando:** o eixo da arma fica igual à mira (0,0°), com a mão direita a 2,3 cm do punho e a esquerda a
  0,8–1,3 cm do apoio. Isso vale olhando reto e para cima.
- **Coice no boneco:** se lê bem. Por tiro, o M4 sobe +3,9°, a L115 +15° e a Desert Eagle +21°. As mãos não soltam da
  arma no coice.

## Achados (do mais grave)
1. **ALTA (recuo/dispersão), `game.ts` `fire()`:** `if (n === 1) spread *= FIRST_SHOT * (1 - this.ads)` também zera as
   punições de pulo (×2), deslize (×1,4) e movimento.
   - **Efeito:** mirando, o primeiro tiro é sempre perfeito, pulando, deslizando ou correndo de lado. A L115 no ar,
     andando, deveria ter 0,036 rad e fica com 0.
   - **Correção:** o bônus de primeiro tiro só reduz a parte parada (`spreadNow(sp, ads, 0, crouch)` + abertura). O
     movimento e o ar entram depois, somados e não multiplicados, com um piso por classe no ar mesmo mirando: fuzil 0,05,
     SMG 0,04, pistola 0,04 e sniper 0,10 rad, × (1 − 0,5·ads). O deslize soma 0,02.
   - **HUD:** usar a mesma função no `hud()`.
   - **Teste:** com a L115, `ads` = 1, `n` = 1 e no ar, a dispersão fica ≥ 0,05.
2. **MÉDIA (recuo), `weapons.ts` `burstNow`:** a rajada esfria muito mais devagar do que a mira volta. A espera é
   intervalo + 180 ms, depois −1 tiro a cada 90 ms; a mira volta com τ de 0,14 s.
   - **M4:** 10 tiros e 600 ms parado, e a mira já voltou, mas o tiro seguinte é o nº 6 do padrão, já com a
     dispersão aberta (mirando 0,23°). Só volta ao 1º depois de ~1 s.
   - **Desert Eagle:** a 450 ms entre tiros, a rajada nunca esfria (fica em n = 10, mirando 1,0°).
   - **Correção:** começar a esfriar no `recover.delay` da arma e cair por exponencial,
     `n·exp(−(since − delay)/τb)`, com τb = 2·`recover.tau`. O bônus de primeiro tiro vale quando o resultado fica abaixo
     de 1. Resultados:
     - M4 com 600 ms parado → n = 1.
     - M4 com toques de 250 ms → n ≈ 2–3, sem virar "todo tiro é o primeiro".
3. **MÉDIA (pegada 3ª pessoa), `avatar.ts`:** o tronco não acompanha a mira. Olhando para baixo (pitch +0,6) no
   quadril, a mão esquerda escorrega para o pente:
   - M4: 7,3 cm do apoio, t = 0,38;
   - AK: 6,5 cm;
   - L115: 9,6 cm, t = 0,55, passando do `PULL_MAX`.

   O braço esquerdo fica a 95% esticado, e nas fotos (`front_sheet.jpg`, coluna do meio) o boneco fica reto com a arma
   pendurada.
   - **Correção:** curvar a coluna pela mira antes de `leanPose` e `holdGun`, com 0,2·pitch em `spine_01`, `spine_02`
     e `spine_03` (até ±0,35 rad no total). O `SHOULDER_PT` sai do ombro direito já girado, como o `leanD`.
   - **Teste:** com M4, AK e L115, quadril e pitch ±0,6, a mão esquerda fica a ≤ 3 cm do apoio.
4. **MÉDIA (pegada 1ª pessoa), `viewmodel.ts`:** no quadril do M4 e da AK (`fp_sheet.jpg`), o antebraço esquerdo é um
   tubo grosso e reto do canto de baixo até a ponta do guarda-mão. A mão de apoio quase não aparece (só a ponta dos
   dedos).
   - **Correção:** afinar o antebraço até ~0,03 m de raio no pulso.
   - Baixar e abrir o ombro esquerdo (cerca de −0,05 em y e +0,03 em x), para o cotovelo entrar na tela e o braço
     encurtar.
   - Puxar o `SUPPORT_AT` de M4 e AK 3–5 cm para trás, para a palma e os dedos aparecerem embaixo do guarda-mão.
   - **Dono:** Téo.
5. **BAIXA (recuo), `game.ts` `kick()`:** a dívida soma o recuo pedido, não o que andou. Com o pitch preso em ±1,35, a
   volta passa da mira inicial (olhando quase para o alto, a AK pode descer ~9° abaixo de onde começou).
   - **Correção:** somar `(pitch depois − pitch antes)·frac` (e o mesmo no yaw).
6. **BAIXA (recuo 3ª pessoa), `avatar.ts` `holdGun`:** o coice do boneco não diminui mirando. Mirando, a L115 sobe 15°
   e a Kar98k 14° com a coronha no ombro.
   - **Correção:** com `ads` e arma de coronha, `TP_KICK` vale ×0,55 (sniper ~8°, M4 ~2°). Pistola fica como está.
7. **BAIXA (padrão), `weapons.ts` AK:** o comentário diz que ela "volta à direita", mas o desvio fica entre 1,4° e
   2,8° para a esquerda do tiro 14 ao 30.
   - **Correção:** `side` do 3º trecho de 0,06 para 0,15, para chegar a ~0,5° no tiro 30. Ou corrigir o comentário.

# Pegada e recuo: revisão R1 do Téo (2026-11-09)

Só leitura e medição: não mexi no código do app. Checks em `apps/desktop` no estado atual (b38c682): `tsc --noEmit`
ok, `eslint src test` ok, `vitest run` 69 arquivos / 490 testes ok.

Página de teste: `scratchpad/teo-pg` (porta 5481). Sondas novas:
- `rc.cjs`: recuo medido por arma (parado a 7,5 m da parede, gatilho seguro ou cliques na cadência). Registra a mira
  por quadro, o tranco da câmera (`viewPunch`), o coice do viewmodel (`vm.kick`) e os impactos.
- roteiro `spray&g=<arma>` no `entry.tsx`: quadril, mira, recarga. Gravações em `v_sp_<arma>/`, folhas
  `ak_*.jpg`, `m4_*.jpg`, `de_*.jpg`, `l1_*.jpg`.
- `me3c.cjs`: a 3ª pessoa de perto. As imagens estão em `m3/`.
- `num.cjs`: as distâncias das mãos em `m3/num.txt`.
- `grips/g_<arma>.jpg`: closes das mãos.
- `hv_zoom.jpg`: a karambit.

## Números medidos (recuo de hoje)
| Arma | Subida do pente inteiro, quadril / mira | Volta 1,5 s depois de soltar | Tranco máx. da câmera | Coice do viewmodel |
|---|---|---|---|---|
| M4 | 17,1° / 11,1° | **nenhuma** (fica em 17,1° / 11,1°) | 0,38° | 0,2 cm para trás, 0,33° |
| AK-47 | 26,5° / 17,2° | nenhuma | 0,47° | 0,2 cm, 0,26° |
| MP7 | 18,0° / 11,7° | nenhuma | 0,25° | 0,3 cm, 0,46° |
| MP5 | 14,0° / 9,1° | nenhuma | 0,24° | 0,3 cm, 0,38° |
| L115 (5 tiros, quadril) | 1,06°/tiro | nenhuma | 1,88° (volta em ~150 ms) | 0,4 cm, 0,85° |
| M9 / Deagle (conta) | 0,71° / 1,95° por tiro | nenhuma | 0,52° / 1,43° | iguais (classe pistola) |

- A subida é uma reta: o M4 mirando sobe ~0,37° por tiro, sempre igual.
- O lado é um passeio aleatório de ±0,5°: não dá para aprender.
- A MP7 mirando sobe mais que o M4.
- O coice que se vê é ~5× pequeno demais e não muda de arma para arma dentro da classe.

## Problemas, do mais grave ao menos

### Pegada
1. **(alta) O indicador nunca está no gatilho e a mão fica ~3 cm baixa no punho**, em todas as armas de fogo, na 1ª e
   na 3ª pessoa (`grips/h_R_m4_side.jpg`, `de_hip_zoom.jpg`).
   - `hand.ts setCurl` fecha os 4 dedos igual.
   - O indicador fica enrolado no punho, embaixo do guarda-mato.
   - Todos os GLB têm o osso `trigger`, e ele não é usado como peça.
   - Correção:
     - `setCurl(c, thumb, index?)`, com o indicador fechando ~0,4 (a polpa no gatilho) e os outros dedos em 0,9. A
       chave do cache inclui o indicador.
     - Em `rightGrip`, subir o pulso: `pos.y` −0,035 → ~−0,008. A fileira do indicador fica na altura do gatilho, que
       está em (0, +0,03, −0,02) no espaço da arma. Inclinar com o ângulo do punho (`rot x` −0,3).
     - Mapear `trigger` em `BONE_PART`. No tiro, o gatilho gira e o indicador vai de 0,4 a 0,6 por ~60 ms.
     - Na pistola, a mão também sobe ~2 cm (a membrana do polegar embaixo do ferrolho).
2. **(alta) Recarga: o pente sai voando separado da mão** (AK `v_sp_ak47/f00085.jpg`, M4 `m4_rel.jpg` 1ª linha).
   - O `movePart(mag, MAG)` e o `LEFT` são calculados à parte, e o osso do pente tem outro espaço e outra escala.
   - A mão fica aberta 8–10 cm longe do pente.
   - Correção: depois do `movePart`, ler o fundo real do pente (`partNow(mag)` + o meio-fundo da caixa) e pôr `LEFT`
     nele (`+ UNDER_MAG`). Ou o contrário: o pente segue a mão. Enquanto segura, os dedos ficam em 0,85.
3. **(alta) Recarga vazia: o antebraço esquerdo ainda cobre ~1/3 da tela** (`v_sp_m4/f00083.jpg`).
   - O braço cruza por cima da arma até a alavanca.
   - Correção: trocar o gesto por arma, sem o braço passar por cima:
     - **M4:** tapa no retém do ferrolho com a palma, do lado esquerdo do receptor, em `magHome + (−0,035, +0,05, −0,01)`.
     - **AK:** puxar a alavanca da direita por baixo, com a mão passando sob o receptor, palma para cima, até
       `chargeHome + (0, −0,03, 0)`.
     - **MP5:** puxar a alavanca da frente, à esquerda do tubo.
     - O `OVER_Q` fica só onde não houver alternativa.
4. **(alta) 3ª pessoa, armas longas: a mão de apoio não chega, a coronha fica longe do ombro e os braços ficam
   esticados** (`m3/me_m4_hip_front.jpg`, `me_m4_hip_side.jpg`).
   - `num.cjs`:
     - a mão esquerda para 21–28 cm do ponto de apoio, colada no punho;
     - o ombro esquerdo fica a 0,55–0,64 m do apoio, para um braço de 0,383 m;
     - a coronha fica ~15 cm à frente do ombro.
   - Correção, por partes:
     - (a) Postura de lado: girar o tronco (`spine_02/03`) +0,35 rad para a direita quando segura arma longa. O ombro
       esquerdo vem ~10 cm para a frente.
     - (b) Coronha no ombro: `SHOULDER_PT` z 0,08 → −0,02 e x −0,2 → −0,15.
     - (c) Na 3ª pessoa, o apoio vai para logo à frente do pente (pegada no poço do carregador, que existe de verdade):
       `SUPPORT_AT·0,55`.
     - (d) Se ainda faltar: escalar `upperarm_l`/`lowerarm_l` em 1,12 só com arma longa.
   - Meta no `num.cjs`: `shL_sup` ≤ 0,36 e `supToHandL` < 0,03.
5. **(média) Pistola com duas mãos: polegares para cima, dos dois lados** (`de_ads_zoom.jpg`).
   - O apoio tem os dedos na horizontal, para a frente.
   - Correção:
     - `APOIO_PISTOLA` gira +0,6 rad em x, com os dedos descendo ~35° e envolvendo os da direita.
     - O polegar esquerdo fica esticado para a frente no lado esquerdo do quadro, embaixo do ferrolho (polegar 0,1); o
       direito fica por cima dele (0,5 → 0,25).
     - Posição do apoio em (−0,025, −0,04, 0,055).
6. **(média) Mirando, os dedos da mão de apoio (C-clamp) passam da altura do guarda-mão e enchem o lado direito da
   mira** (AK/M4, `ak_ads_zoom.jpg`). Correção: em `leftGrip`, `y` −0,032 → −0,045 e dedos 0,72 → 0,82.
7. **(média) A mira de ferro aponta ~1–1,4° abaixo de onde a bala vai** (AK, a massa 14 px abaixo do centro;
   M4, 10 px; em 540p com 48° de campo).
   - `models.ts` usa `sight = box.max.y + 0.01` (o topo mais alto, mais 1 cm).
   - Correção: `sight.y` no topo da massa (o maior `y` dos pontos com `z < 0,6·box.min.z`), sem o +0,01.
   - Conferir: a ponta da massa fica a ±2 px do centro.
8. **(média) Karambit: o cabo fica fora da mão fechada, na frente dos dedos** (`hv_zoom.jpg`).
   - Os dedos fecham no ar e a argola fica ao lado dos nós dos dedos.
   - Correção: encaixar como na baioneta, `pos = handle − FIST_HOLE·PUNHO` (≈ x 0,016 → 0,029). O pulso sobe até o
     indicador passar na argola: a argola em cima, na falange do indicador, e a lâmina saindo do lado do mindinho.

### Recuo
9. **(alta) A mira não volta.** Depois de soltar o gatilho, ela fica onde o recuo deixou (17,1° → 17,1°).
   - Correção (`game.ts`):
     - Guardar a "dívida" do recuo (`recPitch`, `recYaw`).
     - O mouse para baixo durante a rajada abate a dívida (nunca abaixo de 0).
     - Depois de 90 ms sem tiro (SMG 70, pistola 140, sniper 250), a dívida volta em exponencial (τ 0,12 s;
       pistola 0,18; sniper 0,3) pelo `host.turn`.
10. **(alta) O padrão não se aprende e as armas não se distinguem.** O lado é sorteado a cada tiro, e a subida é igual
    em todos os tiros. Correção: padrão fixo por arma em `weapons.ts`, mais um tremor pequeno. Números nossos, por
    tiro no quadril (mirando ×0,55, agachado ×0,85):

    | Arma | Subida nos primeiros tiros | Subida depois | Lado |
    |---|---|---|---|
    | M4 | 0,45° nos 8 primeiros | 0,2° | ±0,35° em ciclo de 10 tiros, deriva +0,02°/tiro, tremor 0,08° |
    | AK | 0,7° nos 9 primeiros | 0,3° | ±0,9° em ciclo de 12, começando para a esquerda, tremor 0,12° |
    | MP7 | 0,25° nos 6 primeiros | 0,12° | ±0,25° em ciclo de 6 (rápido e baixo) |
    | MP5 | 0,3° | 0,14° | ±0,2° |

    - **Pistolas:** M9 0,9° no quadril; Deagle 3,2°.
    - **Snipers:** como hoje.
    - O primeiro tiro sai com 0,6 do recuo.
11. **(alta) O coice que se vê na 1ª pessoa não aparece** (0,2–0,4 cm e 0,3–0,85°). Também não tem rolagem nem lado,
    e é igual por classe (Deagle = M9, AK = M4).
    - Correção: molas por arma em `viewmodel.ts`, para trás, subida do cano, rolagem e lado, com `vmKick` em
      `weapons.ts`. Impulso = pico·ω·e (mola crítica).
    - Picos no quadril (mirando: para trás ×0,7, subida ×0,35, rolagem ×0,4, para a massa não sair do centro):

      | Arma | Para trás | Subida | Rolagem | Lado | Mola (k) |
      |---|---|---|---|---|---|
      | M4 | 1,2 cm | 1,5° | ±0,6° | | 260 |
      | AK | 1,6 cm | 2,2° | ±1,0° | ±0,5° | 220 |
      | MP7 | 0,8 cm | 1,0° | | | 320 |
      | MP5 | 0,9 cm | 1,1° | | | 300 |
      | M9 | 1,5 cm | 6° (pulso) | | | 220 |
      | Deagle | 3,5 cm | 14° | | | 90 (lenta) |
      | L115/M200 | 6 cm | 8° | | | 70 |
      | Kar98k | 5 cm | 7° | | | 80 |

12. **(média) O tranco da câmera é invisível nas automáticas (0,25–0,47°) e só vertical. Na sniper, volta em
    150 ms** (mola 400/40 igual para todos).
    - Correção:
      - mola por classe: sniper k 120, c 22 (~350 ms), pico ~3° no quadril e 2° mirando; Deagle k 160;
      - acrescentar yaw (±30% do lado);
      - acrescentar uma rolagem de 0,3° (×0,35 com "reduzir movimento").
13. **(média) O espalhamento não cresce na rajada.** Só o primeiro tiro tem ×0,6. A mira do HUD também não abre.
    - Correção: +0,0015 rad por tiro mirando (até +0,012 no fuzil), voltando em 0,15 s.
    - O `hud()` soma o mesmo valor no tamanho da mira.
14. **(média) Mirando, o recuo cai só 35%** (`1 − ads·0,35`). Correção: ×0,55 mirando e ×0,85 agachado. Com a volta
    (item 9), o resultado continua controlável.
15. **(média) Recuo na 3ª pessoa igual para tudo** (80 ms, 0,1 rad; sniper 0,2).
    - Correção por classe:
      - pistola: pulso de 0,35 rad (Deagle) ou 0,15 (M9);
      - fuzil: 0,08 rad e o tronco 0,03 rad para trás em 120 ms;
      - sniper: 0,2 rad e o tronco 0,06 rad em 250 ms.

### O jogo (outros)
16. **(média) Escala.**
    - O olho fica a 1,12 m e o contêiner tem 2,6 m: na 1ª pessoa tudo parece 1,5× maior.
    - Agachado, o alto da cabeça fica em 1,00 m, acima da mureta de 0,95 m: dá para acertar quem se esconde.
    - Correção:
      - mureta com 1,02 m (`map.ts`);
      - a médio prazo, mapa ×0,8.
17. **(média, Bento) A faca leve dá o mesmo dano do golpe pesado** (150). Assim, o pesado só serve pelo alcance ×1,3.
    Sugestão: leve com 55 (2 golpes) e pesado com 150.
18. **(baixa) `scene.ts placeGunCamera` cria `Vector3` todo quadro** (`dir` e `position.clone()`). Correção: usar
    temporários do módulo.

## Pendente
Não está aprovado com mouse e em máquina real: a sensação do recuo, a volta da mira e o teste em rede com duas
pessoas.

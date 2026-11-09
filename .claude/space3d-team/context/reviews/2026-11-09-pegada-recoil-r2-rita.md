# Pegada e recoil, rodada 2: teste da Rita (QA), 2026-11-09

Sem mexer no código. Checks em `apps/desktop`: `tsc --noEmit -p .` ok; `vitest run` 512/512. Teste manual com pessoas: PENDENTE.
Sondas e quadros em `scratchpad/rita-pr3/` (servidor 5503): `rc.cjs` (agora com `FPS=`), roteiros novos `trans` (sacar,
andar, correr, tática, slide, inspecionar, golpe, tiro, troca) e `wall` (rajada contra a parede), `disc.cjs`, `me3c.cjs`.

## Recuo medido por fps (subida máxima, quadril; rajada inteira)
| Arma | 30 qps | 60 qps | 144 qps |
|---|---|---|---|
| M4 | 10,3° | 11,3° | 11,3° |
| MP5 | 5,4° | 5,1° | 6,9° |
| MP7 | 8,2° | 8,2° | 8,2° |
| M4 mirando | 6,9° | 6,9° | 6,9° (com 1,8 s de preparo) |
| MP5 mirando | 3,3° | 3,1° | 4,2° |

## Achados (do mais grave ao menos)
1. **Alta, recoil: a volta da mira entra no meio da rajada em fps baixo.** `game.ts` `stepRecoil` usa `now - lastShotAt > delay`
   com `lastShotAt` = hora do quadro. Com cadência quantizada pelo quadro, o vão passa do `delay` (MP5: 69,8 ms de intervalo,
   delay 80 ms) e a mira desce no meio da rajada (MP5 −26% de subida a 30–60 qps; M4 −9% a 30). O padrão deixa de ser o mesmo
   em cada PC. Correção: não recuperar com o gatilho seguro numa arma automática com bala (`triggerDown && spec.auto && mag>0`)
   e guardar em `lastShotAt` a hora lógica do tiro (`nextShot` antes de somar `iv`), não `now`.
2. **Média, pegada: mão esquerda solta no ar ao sair da corrida tática para o slide** (quadros 46–47 de `tr_m4`). `viewmodel.ts`
   faz `LEFT.lerp(LEFT_OFF, tacK)` no espaço da arma enquanto ela gira 0,9 rad; no meio a mão para aberta no meio da tela, ~10 cm
   do guarda-mão. Correção: interpolar no espaço da câmera com `ease()` e taxa de volta maior (k(20)), ou manter a mão fora da
   tela até `tacK < 0,15` e só então ir direto ao guarda-mão.
3. **Média, pegada: inspecionar pistola deixa os dedos da mão de apoio esticados no ar** (Deagle, `tr_deagle` 66–76) e a arma
   fica a ~25 cm do olho, com a manga cobrindo 1/3 da tela. Correção: no `inspect` de pistola, a mão esquerda sai (lerp para
   `LEFT_OFF` por `w`) e a arma vai `pos.z −0,06`, `pos.x +0,04`.
4. **Média, outro: faíscas do tiro na parede são bolas brancas e creme de ~0,4 m que caem por 4 quadros** (`juice.ts` caso
   `impact`, `FX.spark`/`FX.puff` dos esportes). Lê como "bolas", não como bala. Correção: presets próprios do tiro (faísca 2–3 cm,
   vida 0,12 s, 4–6 unidades; poeira da cor da parede 10 cm, vida 0,4 s, gravidade baixa).
5. **Média, outro: marcas de tiro ainda quase invisíveis** (6 cm, pretas em parede escura; `wl_sheet.jpg`). Correção: `MARK_SIZE`
   0,085 e anel claro (rgba(170,160,145,0,45) entre 0,55 e 0,8 do raio) na textura.
6. **Baixa, recoil: movimento reduzido muda onde a bala vai.** `motionK` 0,35 também entra em `viewPunch`, usado em `aimAngles`:
   quem liga movimento reduzido tem ~65% menos desvio do tranco (L115 4° → 1,4°). Correção: mira com o tranco inteiro e a câmera
   com 0,35, ou passar o tranco que falta para o recuo da mira (`turnAim`).
7. **Baixa, recoil: trocar de arma no meio do recuo perde a volta da mira** (`equip` zera `debt`): depois de uma rajada de AK e
   troca para a pistola, a mira fica 11–17° acima. Correção: manter `debt` e guardar o `recover` da arma que atirou.
8. **Baixa, pegada 3ª pessoa: pistola com a mão esquerda em concha ~8 cm abaixo da direita** (Deagle de frente, quadril), sem
   envolver. Correção: no `holdGun` de pistola, o alvo da esquerda = punho + (−0,02, −0,03, 0,01) no espaço da arma.
9. **Baixa, outro: selo "Protegido · atire para sair" continua logo abaixo da mira** (1ª e 3ª pessoa). Correção: mover para
   perto da vida (canto inferior esquerdo) ou 22% acima da base.

## Conferido e bom
- Padrão fixo por arma (AK esquerda e S, M4 reta e depois direita, SMG baixas), primeiro tiro mirando no centro (dispersão 0),
  mirando ×0,6 e agachado mais baixo; resíduo 0,5 s depois igual a 30/60/144 qps.
- Coice visível igual em qualquer fps (molas em subpassos). Clarão na boca certo.
- Karambit reversa e mão fechada no golpe pesado; baioneta ok; tática solta a mão esquerda de propósito.
- 3ª pessoa de fuzil e sniper com a mão no guarda-mão.

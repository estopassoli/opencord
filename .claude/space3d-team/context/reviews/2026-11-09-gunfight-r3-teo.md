# Gunfight: revisão R3 do Téo (sensação e animação)

Data: 2026-11-09. Só leitura: não mexi em nenhum código do app.

## Verificações
- Checks em `apps/desktop`, todos verdes:
  - `npx prettier --check src/features/space3d test/space3d-* src/lib/realtime.ts`: limpo.
  - `npx tsc --noEmit -p .`: sem erros.
  - `npx eslint src test`: sem avisos.
  - `npx vitest run`: 69 arquivos, 477/477.
- Página de teste copiada para `scratchpad/teo-r3` (porta 5373), com `s.noLock = true` para os bots atirarem.
- Roteiros gravados:
  - `t1`: M4 com corrida, tática, slide, agachar, bhop e recarga vazia; Deagle; karambit.
  - `t3`: AK em 3ª pessoa, terminando com a morte.
  - `t4`: Kar98k.
  - `sniper`: L115, Deagle e baioneta.
- Sondas novas:
  - `me3p.cjs`: o meu boneco em 3ª pessoa, de 4 lados, no quadril, mirando e agachado, para cada arma. Folhas `mm_*.jpg`.
  - `num.cjs`: mede o ângulo do cano e a distância de cada mão até a pegada.
  - `bot3.cjs`: os bots de perto.

## O que ficou bom
- **Tática:** a mão esquerda solta e a arma vai para a direita. Não aparece mais o tubo de manga.
- **Pegadas no quadril da 1ª pessoa:** a M4 com a mão no guarda-mão; a Kar98k na coronha reta; a baioneta no punho fechado.
- **Luneta:**
  - Na saída do quick scope, não aparece mais o miolo da arma.
  - O ferrolho é puxado com a mão direita.
- **3ª pessoa:**
  - O corpo vira parado, com passinho.
  - O clarão sai da arma do boneco.
  - A morte cai bem e o painel não cobre o corpo.
- **Bots com SMG:** os braços estão dobrados e as duas mãos na arma.

## Problemas, do mais grave ao menos

### Alta
1. **3ª pessoa: o sinal do ângulo do cano está invertido** (`avatar.ts` `holdGun`, `g.root.rotation` x).
   - Medido com `num.cjs`, olhando reto (pitch 0) no quadril:
     - o cano dos fuzis e snipers fica 8–13° acima da coronha (M4 11°, L115 12°);
     - o das pistolas, 16–24° acima (Deagle 24°).
   - Em `x`, positivo levanta a boca, porque ela fica em −z. Por isso, de trás, a arma parece uma "pistola de pé" (`mm_m4.jpg`, `mm_l115.jpg`, 1ª coluna).
   - O mesmo sinal erra mais três coisas:
     - o coice (`- kick*0.1`) abaixa a boca;
     - o sacar (`+ draw*0.9`) vem com o cano 52° para cima;
     - o comentário diz "o cano desce".
   - Correção:
     - inverter a parte do quadril: `-p.pitch - (ads||knife ? 0 : pistol ? 0.18 : 0.15)`;
     - coice `+ kick*…`;
     - sacar `- draw*0.9`.
   - Conferir: com `num.cjs`, `dropDeg` tem que dar cerca de −8° no quadril e 0 mirando. Abaixado, o comprimento da arma aparece de trás, porque a câmera fica acima.
2. **3ª pessoa: a mão esquerda não alcança a arma** (`avatar.ts` `holdGun` e `reachTo`).
   - O braço mede 0,192 + 0,191 = 0,38 m. O ombro esquerdo fica a 0,57–0,65 m do ponto de apoio.
   - Por isso a mão para a 15–23 cm do guarda-mão, aberta no ar (`supToHandL` 0,19–0,23 em `num.cjs`). Era a "mão solta" que a Rita viu.
   - Correção, por partes:
     - Trazer a arma para o meio: `SHOULDER_PT.x` −0,25 → ~−0,15 no quadril.
     - Na 3ª pessoa, puxar o alvo da mão esquerda pelo eixo do cano em direção ao punho, até ficar a ≤ 0,95·(l1+l2) do ombro esquerdo. Assim a mão pega no começo do guarda-mão ou no pente, mas encosta na arma.
     - Conferir de novo com `num.cjs`: `supToHandL` deve ficar < 0,03.

### Média
3. **Recarga do fuzil: o pente não vai para a mão** (`viewmodel.ts`, caso `reload`).
   - A mão fica aberta, de palma para cima, 5–8 cm abaixo do pente.
   - O pente desce só 0,09 e parece continuar preso na arma (`z_reload.jpg`, linha de cima).
   - Correção:
     - mirar a mão no fundo do pente (`min.y` da caixa da peça no espaço da arma), com os dedos em ~0,75;
     - enquanto `toMag > 0,5`, o pente segue a mão (`MAG = LEFT − magHome − offset`).
4. **Recarga vazia: o antebraço esquerdo cobre metade da tela** (`viewmodel.ts`, `leftOver`, `solveElbow`).
   - Ao puxar a alavanca por cima, a manga passa grande na frente da arma (`z_reload.jpg`, linha de baixo). É o que o Caio e a Rita deixaram aberto.
   - Correção, enquanto `leftOver > 0`:
     - empurrar a arma para a frente e para a esquerda (`pos.z −= 0.06·leftOver`, `pos.x −= 0.04`);
     - inclinar com `rot.z += 0.25` (a alavanca vem para a mão);
     - para o braço esquerdo, usar `ELBOW_MAX_Z` em −0,2 e o polo mais para fora: `(−1, −0.6, 0)`.
5. **A Kar98k usa a recarga de pente, mas não tem pente** (`viewmodel.ts`, `reload`; `game.ts` linha 615).
   - A mão esquerda abre vazia ao lado da coronha e o ferrolho não abre (`z_t4.jpg`).
   - Correção: uma recarga própria de pente-lâmina (clip):
     - a mão direita abre o ferrolho (os primeiros 45% do `bolt`);
     - o polegar esquerdo empurra duas vezes no topo do receptor (`chargeHome`);
     - o ferrolho fecha.
6. **Recarga das pistolas: o pente fica fora da tela** (`viewmodel.ts`, `reload` com `HIP_PISTOL`).
   - A troca acontece abaixo da borda. Só se vê a mão sumir e voltar (`s_t1_84.jpg`).
   - Correção, só para a pistola:
     - `pos.y += tilt*0.10` e `rot.x` com tilt em 0,45;
     - `away`/`drop` em ~0,05, para o pente e a mão ficarem no quadro.
7. **A inspeção da baioneta não muda nada** (`viewmodel.ts`, `inspect`).
   - `bladeRot` gira a lâmina em volta do próprio eixo comprido, que fica de fio para a câmera. E faca tem `rot.y` 0 (`s_sn_132.jpg`).
   - Correção:
     - na baioneta, girar o pulso para mostrar a face da lâmina: `rot.y` ±0,9 com a virada no meio, e `rot.x` −0,3;
     - deixar `bladeRot` só para o karambit.
8. **O golpe pesado da faca é o golpe leve esticado** (`game.ts` `knife(heavy)` → `vm.play('melee', ms)`).
   - Não tem antecipação maior nem estocada; lê igual ao leve, só que mais lento (`s_sn_120.jpg`, 3ª linha).
   - Correção:
     - passar `heavy` para o viewmodel;
     - fazer uma antecipação longa (0–0,35), com a mão recuando 6 cm;
     - depois, uma estocada reta para a frente (`pos.z −0.2`, sem arco) e um tranco maior.

### Baixa
9. **Karambit parado: a lâmina mal aparece.** Fica de fio e escura, então lê como "punho com argola"
   (`s_t1_96.jpg`). Correção: `rot.y` +0,4 só no karambit, para a face da lâmina aparecer, e um metal um pouco mais
   claro.
10. **Golpe do karambit pela esquerda: o antebraço cobre a mira no fim do arco** (`s_t1_108.jpg`). Correção:
    `inward` −0,14 → −0,08.
11. **Bot colado na câmera da 3ª pessoa tapa a visão** (`scene.ts` `placeGunCamera`). A Rita já resolveu o nome, mas o
    corpo continua tapando. Correção: apagar aos poucos o boneco que estiver a menos de 0,8 m da câmera, como já é
    feito com o nome (`avatar.ts` `label`).

## Sem mudança
Não está aprovado o teste manual com duas pessoas em máquinas reais, nem a sensação do recuo com mouse de verdade.

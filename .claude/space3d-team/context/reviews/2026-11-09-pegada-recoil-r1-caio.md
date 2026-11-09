# Pegada e recuo — rodada 1 (Caio, gameplay) — 2026-11-09

Só leitura e medição: não mexi em nenhum código do app. `vitest run` em `apps/desktop`: 69 arquivos, 490 testes, todos
verdes.

Sonda em `scratchpad/caio-pg/`, com a SpaceScene de verdade, relógio falso e porta 5521:
- `rc.cjs`: recuo medido por arma. Grava subida e desvio por tiro, tranco da câmera, coice do viewmodel, cadência real
  por fps, recuperação e desvio do impacto. Saídas em `rc_all.txt` e `rc_b.txt`.
- `tp2.cjs` e `tp3.cjs`: 3ª pessoa. Medem as mãos em relação ao punho e ao apoio e as distâncias aos ombros, no
  espaço do boneco.
- `tpshot.cjs` e `sheet.sh`: fotos do boneco de 5 lados, com câmera presa à arma. Folhas `tp_cur_a.jpg` (hoje),
  `tp_a_a.jpg` (com a correção) e `tp_cur_b.jpg` (pistolas e facas).
- `tpgame.cjs`: a câmera real da 3ª pessoa, antes e depois (`tg_cur.jpg` e `tg_a.jpg`).
- `entry.tsx` (roteiro `spray&g=<arma>`): rajada parada contra o contêiner. Folhas `sh_ak47.jpg`, `sh_ak47b.jpg` e
  `sh_m4.jpg`.
- `fl.cjs`: as mãos durante o tranco de levar tiro e o coice repetido.
- `app_a.js` e `index_a.html`: o bundle com a correção da 3ª pessoa (item P1), para conferir com números e fotos.

## Medições (60 fps, parado, 30 tiros na automática e 5–6 na semiautomática)

| arma | modo | subida em 30 tiros | por tiro | lado | volta ao soltar | tranco máx. | coice do viewmodel |
|---|---|---|---|---|---|---|---|
| M4 | quadril / mira | 17,1° / 11,1° | 0,45→0,60° | ±0,18° aleatório | 0 | 0,35° | 2,6 mm, 0,38° |
| AK-47 | quadril / mira | 26,5° / 17,2° | 0,70→0,93° | ±0,36° aleatório | 0 | 0,48° | 2,3 mm, 0,33° |
| MP7 | quadril / mira | 13,4° / 8,7° | 0,35→0,47° | ±0,3° | 0 | 0,25° | 3,2 mm |
| MP5 | quadril / mira | 15,0° / 9,8° | 0,40→0,53° | ±0,2° | 0 | 0,24° | 2,6 mm |
| M9 | quadril / mira | 0,71° / 0,46° por tiro | sempre igual | — | 0 | 0,42° | 2,3 mm, 0,33° |
| Deagle | quadril / mira | 1,95° / 1,27° por tiro | sempre igual | — | 0 | 0,99° | 1,9 mm, 0,27° |
| L115 | mira | 0,69° fica | — | — | 0 | 1,22° | 4,0 mm, 0,85° |
| Kar98k | mira | 0,58° fica | — | — | 0 | 1,02° | 4,0 mm, 0,85° |

- **Cadência real cai com o fps:** a M4 (800) dá 720 a 60 fps, 600 a 30 e 786 a 144. A MP5 (860) dá 720 a 60 fps, igual
  à M4. O equilíbrio "SMG de perto mais rápida que o M4" (ADR-0058) não vale a 60 fps.
- **3ª pessoa hoje:** o braço do boneco tem 0,38 m (0,46 m contando a mão). O ombro esquerdo fica a 0,49–0,63 m do
  apoio e o direito a 0,40–0,45 m do punho. A coronha fica 21 cm à frente do ombro. Resultado: a mão esquerda fica a
  17–29 cm do apoio, colada na direita (`t` 1,26–1,81 = atrás do punho), e os dois braços ficam esticados.
- **Com a correção do item P1** (`app_a.js`): a mão esquerda fica a 0–4,4 cm do apoio, o ombro direito a 0,20–0,28 m
  do punho e os cotovelos dobram. Nas fotos (`tp_a_a.jpg`), a direita fica no punho e a esquerda no guarda-mão.

## PEGADA (3ª pessoa: mecânica)

**P1 — ALTA: mãos juntas no punho e arma longe do corpo** (`avatar.ts` `setGun` e `holdGun`)
- Correção medida:
  - Armas longas (não pistola nem faca) em escala `DOLL_SCALE * 0.86`, no `setGun` e no `G_OFF` do `holdGun`.
  - `SHOULDER_PT`:
    - quadril `(-0.10, 0.92, -0.03)`, no lugar de `(-0.2, 0.9, 0.08)`;
    - mira `(-0.08, 0.96, -0.04)`, no lugar de `(-0.13, 1.0, 0.07)`.

    Assim a coronha encosta no ombro direito, que fica em `(-0.12, 0.99, -0.09)`.
  - No `pullInReach`, limitar `t ≤ 0.5`: a mão nunca escorrega até o punho e, no pior caso, para no pente.
- Teste: com cada arma longa, a distância entre a mão esquerda e o apoio fica abaixo de 0,05 e a mão direita fica no
  punho.

**P2 — MÉDIA: levar tiro solta as duas mãos da arma** (`avatar.ts` `update`: `flinchPose` roda depois do `holdGun`)
- O tranco gira o `spine_02` depois da IK. Os braços vão junto, mas a arma, que é filha do `root`, fica parada.
- Medido: a mão direita sai até 3,4 cm do punho e a esquerda até 8,8 cm do apoio, por 160 ms. Numa rajada recebida,
  isso se repete a cada tiro.
- Correção: chamar `flinchPose()` antes do `holdGun()`, e levar a arma junto com o tronco. Para isso, aplicar ao
  `g.root` o mesmo giro do `spine_02` em torno do quadril, ou calcular o `SHOULDER_PT` a partir do osso
  `clavicle_r`/`spine_03`.

**P3 — BAIXA: a pistola mirando estica o braço direito a 98%** (0,448 de 0,457 m). Está aceitável. Se a pose mudar,
manter o `z` mirando ≤ 0,38.

## RECOIL

**R1 — ALTA: a mira não volta depois de soltar o gatilho** (`game.ts` `fire`: `host.turn` com `RECOIL_KEEP`)
- Medido: volta 0,00° em todas as armas. A AK mirando sobe 17° e fica lá (`sh_ak47.jpg`: depois de soltar, a vista
  fica no céu).
- Correção: guardar a dívida do recuo `debt = { pitch, yaw }`:
  - cada tiro soma a parte que fica;
  - o mouse no sentido contrário desconta (`debt.pitch = max(0, debt.pitch - puxadaParaBaixo)`, para não voltar duas
    vezes);
  - depois de `max(1,5 × intervalo, 120 ms)` sem tiro, devolver `debt × (1 - exp(-dt × 9))` com `host.turn`, até a
    fração `RECOVER`: fuzil 0,75, SMG 0,8, pistola 0,9 e sniper 1,0. O resto fica.
- Teste puro: 10 tiros, solta, 0,5 s depois `pitch` volta ≥ 70% (fuzil). Com o mouse compensando, não passa da mira
  original.

**R2 — ALTA: o desvio lateral é aleatório puro** (`side = (rand - 0.42) × 2 × side`)
- Não dá para aprender a rajada (medido: ±0,1 a 0,36° por tiro, sinal sorteado), e a AK "mais lateral" é só ruído
  maior.
- Correção em `weapons.ts`: um padrão por arma, função pura `recoilKick(spec, n) → { up, side }`, com o número do tiro
  na rajada (`n`). Ruído de ±20% por cima, com a semente do jogo.
- Proposta, em rad por tiro no quadril (mirando ×0,6, agachado ×0,85). Os números são nossos.

| arma | subida | lado | padrão |
|---|---|---|---|
| M4 | 0,0085 × (1 + 0,03n, teto 1,3) | 0,0035 | tiros 1–6 retos; 7–14 deriva +0,5 (direita); depois senoide de período 8 tiros |
| AK-47 | 0,012 × (1 + 0,04n, teto 1,4) | 0,0065 | 1–4 retos; 5–12 deriva −1 (esquerda); 13+ volta à direita com senoide de período 6 |
| MP7 | 0,0055 | 0,0045 | tremor curto, alterna a cada 2 tiros, sem deriva |
| MP5 | 0,006 | 0,003 | deriva +0,3, senoide de período 10 |
| M9 | 0,014 | 0,003 | sinal alterna |
| Deagle | 0,05 | 0,012 | sinal pelo padrão (direita, direita, esquerda) |
| snipers | inalterado | — | `RECOIL_KEEP` 0,3 já deixa quase tudo no tranco que volta |

- Alvo em 30 tiros mirando: M4 ~8° para cima e ≤ 2° de lado; AK ~13° e ~4° de lado; MP7 ~5°; MP5 ~6°.
- Teste: o mesmo `n` dá o mesmo lado (sem ruído). O deslocamento total da AK é maior do que o da M4, em cima e de lado.

**R3 — ALTA: a rajada "zera" a cada clique** (`release('fire')` põe `shotsInBurst = 0`)
- Clicando rápido, todo tiro é "o primeiro": dispersão ×0,6 e o recuo mínimo.
- Na M9 e na Deagle, a subida é sempre igual (0,71° e 1,95°), sem crescer. Clicar rápido no fuzil fica perfeito.
- Correção: tirar o zerar do `release` e do `cancel`. O índice cai com o tempo:
  `if (now - lastShot > shotInterval + 180) shotsInBurst = max(0, shotsInBurst - floor((now - lastShot - interval) / 90))`.
  O bônus de primeiro tiro só vale com `now - lastShot > 250 ms`.

**R4 — ALTA: o coice visual na 1ª pessoa quase não aparece e é igual por classe** (`viewmodel.ts` `play('fire')` e o
bloco "coice")
- O pico é de 2–3 mm para trás e 0,3–0,4° de subida. A Deagle (1,9 mm, 0,27°) coiceia menos que a M4. A AK coiceia igual
  à M4. Não há rolagem nem lado.
- A mola é Euler sem subpasso: o pico muda com o fps (0,034 a 30 fps e 0,089 a 144 fps).
- Correção:
  - Em `GunSpec`, `vis: { back, rise, roll, side, k, c }` por arma, com quatro molas: z, rot.x, rot.z e rot.y.
  - A rolagem e o lado seguem o sinal do `recoilKick` (o mesmo padrão).
  - Mirando ×0,45 (×0,25 em `back`, para a mira não sair do olho).
  - Subpassos de 1/120 s, como o `stepPunch`.

  Picos alvo no quadril:

  | arma | para trás | subida | rolagem | volta |
  |---|---|---|---|---|
  | M4 | 12 mm | 1,5° | 1° | — |
  | AK-47 | 16 mm | 2,2° | 1,8° | lado 0,8° |
  | MP7 | 8 mm | 1° | 1,2° | — |
  | MP5 | 9 mm | 1,1° | — | — |
  | M9 | 15 mm | 4° | — | rápida (k 260, c 26) |
  | Deagle | 30 mm | 10° | 3° | lenta (k 90, c 14) |
  | L115 | 45 mm | 7° | — | — |
  | M200 | 50 mm | 8° | — | — |
  | Kar98k | 40 mm | 6° | — | — |

- Teste: o pico da Deagle é maior que o da M9, e o da AK maior que o da M4. O pico é igual (±10%) a 30 e a 144 fps.

**R5 — MÉDIA: a luneta não sobe com o coice** (`GunHud` scope e `scene.placeGunCamera`)
- O tranco gira a câmera (1,0–1,9°), mas a máscara da luneta fica parada.
- Correção: deslocar o anel da luneta em `viewPunch × (altura da tela / 2) / tan(fov / 2)` px para cima (o mesmo
  `spreadPx`), voltando com o tranco.

**R6 — MÉDIA: a dispersão não acompanha a rajada** (`spreadNow` sem o tiro da rajada)
- Mirando, a rajada é um laser que só sobe (impacto a 0,05–0,17° da mira em 30 tiros).
- Correção: `spread += min(n, 10) × bloom`, com `bloom` de quadril 0,0015 e mirando 0,0004 (fuzil); SMG ×0,7. O
  `bloom` cai junto com o índice do R3. A mira do HUD (`spreadPx`) usa o mesmo valor.

**R7 — MÉDIA: o coice na 3ª pessoa é igual para todas as armas e trava numa rajada** (`avatar.ts` `gunKick`, `KICK_S`
0,08 s em seno reiniciado)
- Na automática, o `kickT` reinicia antes de acabar (medido: 0,063 → 0,013 → 0,063). A arma fica empurrada para trás
  (média ~0,75) em vez de dar trancos.
- Correção: uma mola com impulso por arma (`vis` do R4 × 2 no boneco). Somar o impulso e nunca zerar. Junto, o
  `spine_03` gira 0,03 rad (fuzil) a 0,08 rad (sniper ou Deagle) para trás e volta.

**R8 — BAIXA: quem vê recebe a mira em degraus** (`scene.maybeSend` a cada 100 ms; `Avatar.setGunPose` aplica `pitch`
cru)
- Numa rajada, a arma do boneco remoto sobe aos saltos de ~0,7°.
- Correção: no `holdGun`, `pitchShown += (p.pitch - pitchShown) × (1 - exp(-dt × 15))`.

**R9 — BAIXA: o tranco tira a mira do centro da tela por um instante** (a câmera usa `pitch - viewPunch`; a bala usa
`pitch`)
- No fuzil, a média é 0,2°. Basta lembrar disso se o tranco crescer no R4: nesse caso, deixar `RECOIL_KEEP` maior nas
  automáticas, ou somar o `viewPunch` ao `aimAngles`.

## O RESTO DO JOGO (outro)

**O1 — ALTA: a cadência depende do fps** (`game.ts` `fire`: `nextShot = now + intervalo`, e 1 tiro por quadro)
- Medido: M4 720 / 600 / 786 rpm a 60 / 30 / 144 fps; MP5 720 rpm a 60 fps, igual à M4.
- Correção:
  - `nextShot = now - nextShot < iv ? nextShot + iv : now + iv` (carrega o resto);
  - no `step`, `while (canFire(now) && now >= nextShot && n++ < 3) fire(now)`.
- O mesmo vale para os bots (`bots.ts` linha 447).
- Teste: 1 s segurando a 30 fps dá 13 ou 14 tiros na M4.

**O2 — MÉDIA: o tiro não deixa marca na parede**
- `fx.ts` só tem traçante e clarão. Sem marca, não dá para ler o padrão do R2 nem saber onde a bala bateu.
- Correção: um pool fixo de 64 marcas (`InstancedMesh` de um quadrado de 6 cm, por cima da face da caixa).
  - A normal sai de `rayBox`: o eixo que deu `t0`.
  - A mais velha some primeiro, em 8 s.

**O3 — BAIXA: no quadril, o lado da dispersão não divide por `cos(pitch)`** (`aimDir`). Olhando muito para cima ou
para baixo, o espalhamento lateral cresce. Correção: `yy = yaw + cos(a) × r / max(0.2, cos(py))`.

**O4 — BAIXA: inspecionar não vai para a rede** (`case 'inspect'` sem `markAct`). Quem vê não percebe. Correção:
`markAct('inspect')` e a pose do boneco.

**O5 — BAIXA: o antebraço esquerdo é um tubo grande no quadril** (`sh_ak47.jpg`: cobre o canto de baixo à esquerda) e
a mão direita aparece alta, ao lado da alça de mira, ao mirar a AK. Fica com o Téo (forma e posição). Mecânica: o
`SHOULDER.x` 0,2 com a mão no apoio deixa o antebraço quase paralelo à câmera.

**O6 — BAIXA: a 3ª pessoa no quadril esconde a arma atrás do boneco** (`tg_cur.jpg` e `tg_a.jpg`; o mesmo antes e depois
do P1). Opcional: `SHOULDER_SIDE.hip` de 0,45 para 0,55.

## Não reabro

O teste com 2 pessoas em máquinas e redes diferentes continua PENDENTE.

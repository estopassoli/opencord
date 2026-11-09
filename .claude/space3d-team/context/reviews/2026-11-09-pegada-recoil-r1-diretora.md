# Pegada, recuo e o jogo todo — rodada 1, Lia (direção), 2026-11-09

Só leitura e medição: não mexi no código do app. Página de teste copiada para `scratchpad/lia-r1/gp` (porta 5487).
Roteiros novos em `entry.tsx`: `spray` (rajada parada na parede, `w`, `ads`, `cr`, `ms`), `side` (3ª pessoa) e
`play` (partida parada contra 3 bots, `lvl`). Sondas: `probe.cjs` (subida e desvio da mira por tiro), `lvl.cjs`
(quanto vive quem fica parado em cada nível), `num.cjs` (mãos na 3ª pessoa) e `me3p.cjs` (o boneco de 4 lados).
Folhas: `lia-r1/s_m4.jpg`, `s_ak.jpg`, `s_side.jpg`, `s_r6b.jpg`, `s_hv.jpg`, `s_play.jpg`, `tp_*.jpg`.

## Resumo de direção
O jogo já tem as peças de um shooter de PC, mas ainda não tem a sensação. Duas coisas pesam mais:
1. **O recuo não é um coice, é uma rampa.** Cada tiro sobe a mira o mesmo tanto, sem padrão e sem volta. Depois de
   um pente do M4 no quadril, a mira está 16,7° acima de onde começou e fica lá. O AK sobe 25,8°. A arma na tela dá o
   mesmo tranco no M4, no AK e nas SMGs, e a Desert Eagle tranca igual à M9.
2. **Na 3ª pessoa ninguém segura arma longa como arma longa.** As duas mãos ficam no punho, os braços esticados e a
   coronha longe do ombro. Por trás, a arma quase não aparece. Para quem vê o outro jogando, é a cara do jogo.

No jogo todo, o que mais tira a diversão é **morrer logo depois de nascer** (no Difícil, 1,1 s e 3,1 s de vida) e uma
**partida longa demais para poucas pessoas** (30 abates; no Fácil, 3 bots fizeram 1 abate em 30 s).

## Números medidos (`probe.cjs`, parado, pente inteiro)
| Arma | Situação | Tiros | Subida total | Desvio |
|---|---|---|---|---|
| M4 | quadril | 30 | 16,7° (0,47→0,60° por tiro, em linha) | 2,1° |
| M4 | mirando | 30 | 10,8° | 1,4° |
| M4 | mirando agachado | 30 | 8,7° | 1,1° |
| AK-47 | quadril | 30 | 25,8° | 3,7° |
| AK-47 | mirando | 30 | 16,8° | 2,4° |
| MP7 | quadril | 39 | 17,2° | 3,5° |
| MP5 | mirando | 30 | 9,5° | 1,5° |

- Depois de soltar o gatilho, a mira não volta nada: a subida no fim é igual à do último tiro.
- O desvio lateral do M4 e o do AK têm **a mesma forma**, porque vêm do mesmo sorteio com a mesma semente. Só a
  escala muda. Não dá para aprender o padrão.
- Por segundo, a subida quase não muda entre as armas: M4 5,9°/s, MP7 5,4°/s, AK 6,8°/s. "SMG rápida e baixa" e
  "AK bem mais forte" não aparecem.
- Mirar tira só 35% do recuo; agachar tira 20%.
- O tranco visual (`punch`) é uma mola só (k 400, c 40, ~150 ms) para todas as armas.

## 3ª pessoa (`num.cjs`)
- Mão esquerda a 0,21–0,28 m do apoio em todas as armas longas. Apoio a 0,56–0,64 m do ombro esquerdo; o braço tem
  0,38 m. O `pullInReach` escorrega a mão até o punho: por isso as duas ficam juntas.
- O cano agora desce 5–9° no quadril (o sinal foi corrigido na r3).

## Achados (ordem de prioridade)
Lista completa com arquivo e correção na saída estruturada da rodada. Resumo:
- **P0 recuo:** (a) padrão fixo por arma no lugar do sorteio; (b) a mira volta depois de soltar o gatilho; (c) tranco
  da arma na tela por arma (coice para trás, subida, rolagem, mola própria); (d) mirar e agachar reduzem mais; (e)
  os bots também sofrem recuo.
- **P0 pegada:** (a) na 3ª pessoa, coronha no ombro e mão de apoio na arma (tronco de lado, arma mais para o meio,
  apoio mais perto, braço esquerdo um pouco mais longo só segurando arma longa); (b) karambit com os dedos abertos e
  a argola no pulso, inclusive parado; (c) mão direita da Kar98k com os dedos esticados para fora da coronha; (d)
  antebraço esquerdo grosso, sem afinar, cobrindo o meio da tela (fuzil, Kar98k, recargas).
- **P0 jogo:** nascer sem proteção e sem conferir a linha de visão; partida de 30 abates sem limite de tempo.
- **P1:** sem marca de bala na parede (não dá para ler o padrão); bots do Difícil sem pausa nem recuo; a câmera da
  morte entra no corpo perto de parede (as mãos aparecem na tela); nasce de cara para um contêiner.
- **P2:** céu com o buraco negro do tema "station" no pátio de contêineres à noite; ponto de mira sozinho na 3ª pessoa
  mirando.

## Não conferido (sem ambiente)
Som (não toco áudio), duas pessoas em máquinas diferentes e desempenho numa GPU de verdade (a página roda em
swiftshader). Continua PENDENTE.

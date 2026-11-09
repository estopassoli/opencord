# Gunfight — revisão R2 — Téo (sensação e animação)

Data: 2026-11-09 · Só leitura (nenhum código do app mexido).

## Verificações rodadas
- `apps/desktop`: `npx prettier --check src/features/space3d test/space3d-*` limpo; `npx tsc --noEmit -p .` sem erros;
  `npx eslint src test` sem avisos; `npx vitest run` 68 arquivos, 465 testes passando.
- Página de teste (cópia em `scratchpad/teo-r2`, porta 5363). Roteiros `sniper` e quatro meus: `t1` (M4: sair da
  corrida atirando, flick, corrida tática, slide, agachar, bhop, esvaziar o pente + recarga vazia, Deagle e recarga,
  karambit golpe/inspecionar), `t3` (AK em 3ª pessoa: andar, correr, slide, agachar, mirar+atirar, virar 2,4 rad
  parado, recarga, morte), `t4` (Kar98k quadril/mira/recarga). Sondas: `grip.cjs`/`grip2.cjs` (close de cada mão de
  lado, de baixo e pela direita, por arma), `bot2.cjs` (bot dos quatro lados). Olhei os quadros e as folhas `s_*.jpg`,
  `hh_*.jpg`, `bots4.jpg`.

## O que ficou bom (R1 resolvido)
Saída da corrida espera a arma descer (~200 ms; tática mais longa está certo); flick não joga mais a arma de lado;
ferrolho da L115/Kar com a mão direita na alavanca; luneta entra com escurecer e acerto aparece dentro dela; clarão
no mundo na 3ª pessoa e nos bots; traçante saindo da arma; alvo pisca ao levar tiro; arma some na morte; polegar do
lado certo; "reduzir movimento" no viewmodel e no tranco da câmera.

## Problemas (do mais grave ao menos)

### Alta
1. **3ª pessoa parada: o corpo não vira para a mira** (`gunfight/game.ts` no `step`: `if (speed > 0.3 ||
   firstPerson) this.ry = …`). Em `t3`, depois de virar 2,4 rad parado, o boneco fica de frente para a câmera
   (rosto visível) por mais de 1 s e durante a recarga; a arma aponta para trás enquanto o tiro vai para a frente. Os
   outros jogadores recebem esse `ry` na pose, então veem alguém atirando de costas. Correção: na 3ª pessoa girar
   `ry` para o `yaw` sempre que mirar/atirar/recarregar, e parado virar no lugar quando a diferença passar de ~50°
   (até ~10 rad/s), com passinho das pernas.
2. **Mão de apoio fora do guarda-mão em todos os fuzis e snipers** (`gunfight/models.ts:171-173`). `sz =
   box.min.z * 0.7` (0,5 nas snipers) fica perto da boca: na M4 a mão está na massa de mira, no AK na ponta do tubo
   de gás, e na L115 a mão flutua uns 10 cm abaixo do cano, à frente da coronha, sem encostar em nada
   (`hh_m4.jpg`, `hh_ak47.jpg`, `hh_l115.jpg`). Correção: ponto de apoio por arma (tabela em `grips.ts`/`models.ts`:
   meio do guarda-mão; ex. M4 ~0,40 e AK ~0,42 do comprimento até a boca; L115/M200/Kar no fim da coronha de madeira,
   ~0,30), e `bottomAt` só aceitar o fundo se ele estiver a até ~4 cm do eixo do cano (senão é o ar abaixo do cano).
3. **Baioneta: a mão não segura o cabo** (`gunfight/grips.ts:36`). O cabo passa por cima e ao lado do punho fechado,
   a uns 5–8 cm (`rita2/gp/v_bay/f00008.jpg`, `hh_bayonet.jpg`); a faca parece flutuar sobre a mão. Correção: pôr o
   centro dos dedos fechados no centro do cabo (pegar o centro da caixa do cabo no modelo, como o `support`), não um
   offset fixo do pulso; conferir com o close de lado.
4. **Corrida tática: a manga esquerda vira um tronco que cruza a tela** (`viewmodel.ts:250-253`, `placeArm`). Com a
   arma de cano para cima a mão esquerda fica fora do alcance (>0,62 m do ombro), o braço estica reto e a cápsula do
   antebraço é escalada: um tubo verde de ~150 px do canto de baixo até o topo da tela, e a arma fica bem no centro
   cobrindo a mira (`v_t1/f00045.jpg`). Correção: na tática a mão esquerda solta a arma e balança baixa fora da tela
   (como a faca, `armL` some ou vai para `(−0,25, −0,45, −0,2)`), e a arma vai mais para a direita (`pos.x += tacK *
   0.06`) com o cano inclinado para dentro; nunca escalar o antebraço além de 1,0 (se não alcança, a mão solta).

### Média
5. **Recarga vazia do fuzil: a mão esquerda voa para fora da arma** (`viewmodel.ts:326-339`). Ao puxar a alavanca a
   mão vai ~15 cm à direita da arma, palma aberta no ar, e o antebraço passa por cima do receptor (`v_t1/f00138.jpg`).
   O ponto vem da origem do osso `charge`, não da alavanca que se vê. Correção: alvo na alavanca de verdade (topo de
   trás do receptor: centro da caixa da peça, não a origem do osso), mão por cima com dedos fechados (curl ~0,8), e o
   cotovelo por baixo.
6. **Pente solto na recarga (L115, M4) e recarga da pistola sem pente** (`viewmodel.ts:315-325`). O pente desce
   0,26 m e a mão sai da tela: na L115 e na M4 o pente aparece sozinho na borda de baixo (`s_sn_6.jpg`,
   `v_t1/f00130.jpg`); na Deagle a troca toda acontece abaixo da tela (só se vê a mão sumir e voltar). Correção:
   levantar e girar a arma na recarga (`pos.y += tilt*0.06`, `rot.x += tilt*0.3`), deixar `away` em ~0,09 e manter a
   mão + pente no quadro; na pistola, mão vem por baixo com o pente visível.
7. **Kar98k: a mão direita fica embaixo da coronha, no ar** (`grips.ts:37`). A mesma pegada de punho de pistola vale
   para todos; a Kar não tem punho, e a mão fica abaixo do delgado da coronha, sem envolver (`hh_kar98k.jpg`).
   Correção: pegada própria para coronha reta (pulso mais alto, ~`(0.015, -0.01, 0.06)`, giro de ~25° com os dedos
   envolvendo o delgado).
8. **3ª pessoa: ações invisíveis para quem vê** (`avatar.ts` `holdGun`; `SpaceGunPose`). O boneco não dá coice,
   não recarrega, não corta com a faca, não puxa o ferrolho e não troca de arma; faca em 3ª pessoa/para os outros não
   tem golpe nenhum (o `swing` só sai como `gunfx` local). Correção: no `fire` remoto (e no meu tiro em 3ª pessoa)
   chamar um `avatar.gunKick()` (mola de ~80 ms no `holdGun`); pôr na pose um campo curto de ação (`act`: recarga,
   golpe, ferrolho, saque, com um contador para repetir) e animar no `holdGun` (arma baixa e mão no pente; braço
   direito em arco no golpe).
9. **Clarão e traçante de quem está em 1ª pessoa saem no lugar errado para os outros** (`game.ts` `muzzleWorld` →
   `send({kind:'fire', from})`). Em 1ª pessoa o `from` é um ponto a ~0,55 m da câmera de quem atirou, na frente do
   rosto, não a arma do boneco dele. Correção: no `remote('fire')` usar a boca da arma do avatar de quem atirou
   (`av.muzzleWorld()` pelo host, como os bots já fazem) e só cair no `from` se não houver avatar.
10. **3ª pessoa: arma escondida atrás do corpo, e o boneco tampa a tela mirando e encostado na parede**
    (`avatar.ts:898`, `scene.ts` `placeGunCamera`). De trás só aparece a massa de mira acima do ombro (`v_t3/f00020`);
    mirando, a câmera a 1,4 m deixa o boneco com ~40% da tela (`s_t3_5.jpg`); na parede chega a 0,4 m e a cabeça
    cobre um terço. Correção: deslocar a câmera para 0,6 m à direita mirando (0,45 hoje), esconder/esmaecer o próprio
    boneco quando `d < 0,9` (como `placeCamera` faz com 1,1), e no quadril a arma em "low ready" mais para fora
    (x≈−0,25, cano 0,2 rad para dentro) para o cano aparecer ao lado do corpo.
11. **Saída da luneta mostra o miolo da arma** (`game.ts render`/`hud`). Ao soltar o botão direito há um quadro com a
    ocular e a caixa da L115 enchendo a tela (`s_sn_5.jpg`, 2ª linha). O escurecer de 80 ms só existe na entrada.
    Correção: o mesmo escurecer na saída, ou não desenhar a arma enquanto `ads > 0,6` na volta.

### Baixa
12. Bots com SMG: braços travados e retos, arma longe do ombro ("braços de zumbi") (`bots4.jpg`). O `back` da coronha
    usa `length + muzzle.z`, que é pequeno na MP7. Correção: mínimo de ~0,28 m de coronha, cotovelos dobrados (alvo
    da IK a ~85% do alcance).
13. Karambit parada: a lâmina fica quase toda abaixo da tela; lê como um punho fechado. Correção: subir `HIP_KNIFE`
    ~3 cm e girar a ponta para dentro (rot.z ~−0,3) para a curva aparecer.
14. Painel "Abatido por" cobre o boneco e o nome de quem matou na câmera de morte (`s_sn_12.jpg`). Correção (com a
    Nara): painel mais alto ou a câmera de morte mira um pouco abaixo.

## Sem mudança
Tática com saída da corrida mais longa (Caio): está certo, é o que os shooters fazem. Falta o teste com duas pessoas
em máquinas reais (o item 8 e o 9 só aparecem lá).

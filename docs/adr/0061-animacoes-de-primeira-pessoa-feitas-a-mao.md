# ADR-0061: Animações de primeira pessoa feitas à mão, quadro a quadro (gunfight)
Status: Accepted (pedido do mantenedor, 2026-11-09)

## Contexto
As mãos e os braços da primeira pessoa do gunfight têm esqueleto (ADR-0060), mas o movimento de tudo (segurar,
sacar, correr, recarregar, inspecionar) ainda era feito por contas em código no `viewmodel.ts`, com as pegadas medidas
por esferas (`holds.ts`, `contact.ts`). O mantenedor joga CoD MW3 (2023) e CS2, testou e achou que a pegada, as
animações e as inspeções ainda ficam estranhas e que a mão não assenta na arma. A decisão dele: animações próprias,
escritas à mão (nada de pacote pago), começando por uma arma piloto que tem de ficar "perfeita": o MP7.

## Pesquisa (só texto; nada baixado nem executado)
**H&K MP7A1 (como se opera):**
- 638 mm com a coronha aberta e 415 mm fechada, cano de 180 mm, ~1,9 kg; carregadores de 20, 30 e 40 tiros que
  entram no punho, como numa pistola (en/de.wikipedia "Heckler & Koch MP7"; old.weaponsystems.net "MP7").
- Retém do carregador em pá na traseira do guarda-mato, dos dois lados (análise da TTAG, "Gun Review: HK MP7A1";
  descrição da réplica Umarex licenciada na Patrol Base). O carregador novo sobe reto pelo punho; o empurrão final com
  a palma é suposição nossa (nenhuma fonte descreve o assentamento).
- Alavanca de carregar em T, atrás e em cima, como a do AR-15 (TTAG). Retém do ferrolho acima do gatilho,
  ambidestro, "difícil de alcançar" (TTAG). Seletor 0-1-F ambidestro.
- Empunhadura vertical dobrável embaixo da frente (a do A1; o A2, que é o modelo do jogo, troca por trilho);
  coronha telescópica de 3 posições; miras de ferro dobráveis no trilho de cima. ~950 tiros/min (~63 ms por tiro).

**Princípios de animação de primeira pessoa (aplicamos os princípios, nada copiado de jogo nenhum):**
- Conjunto de clipes clássico: sacar, guardar, parado (respirando), recarga com bala e vazia, tiro como camada,
  andar/correr como laço, golpe (documentação de animação de primeira pessoa do Halo 2, Microsoft Learn).
- Recarga com bala e recarga vazia são animações diferentes: na com bala o pente velho vai para o colete; na vazia ele
  cai e a arma é engatilhada; cada uma é um movimento contínuo, sem emendas (blog da Activision sobre a animação de
  CoD MW 2019; Charlie Intel).
- "Active idle": parado, movimentos pequenos de músculo, nada de barco balançando; a cabeça vai na frente e a arma
  vem atrás (mesmas fontes); peso diferente por classe de arma.
- Pente entrando: aperto paciente devagar e depois a força de uma vez; assentamentos como ondas que decaem (bola
  quicando) proporcionais ao peso; translações pequenas; troca de "pai" (a mão pega o pente) no quadro do contato,
  sem pulo; recarga vazia montada sobre ~5 poses-chave (Micah Reigstad, 80.lv).
- Silhueta e poses-chave que leem da câmera de primeira pessoa (80.lv, animação de DOOM: The Dark Ages);
  o realismo cede quando ele lê mal (animador da Infinity Ward na Engadget, 2012); os braços perto da câmera aumentam
  qualquer tremidinha (Khoa Le, Activision).
- Esqueleto: um osso de encaixe da arma (como o `ik_hand_gun` do manequim da Unreal, o "weapon target" do CryEngine)
  com as mãos presas a ele; deslocamentos por arma em cima do mesmo esqueleto e da mesma animação (CryEngine
  `fp_offset`; Kinemation "attach left hand" para empunhadura × poço do pente).
- Camadas de código por cima do clipe: balanço do mouse e do movimento, coice por mola, mira (CryEngine: recuo como
  suspensão de carro; texto sobre o GDC do Overwatch em sreitich.github.io: poses aditivas guiadas por molas).
- Tempo: não há números publicados confiáveis de CoD/Tarkov; os tempos são nossos e seguem o jogo (recarga do MP7 1,9 s
  com bala, 2,3 s vazia; o som do pente saindo em 18%, entrando em 60%, a alavanca em 80%). O tiro a 950/min não cabe
  num clipe inteiro por tiro: é uma camada aditiva que recomeça a cada tiro.

## Decisão
**Caminho de produção (`apps/desktop/scripts/anims/`, Blender sem interface):**
- `mp7.py -- holds` encaixa as pegadas na malha do MP7 do jogo (`assets/guns/mp7.glb`, na mesma origem e orientação do
  `models.ts`), com os acessórios do armeiro como peças simples com as mesmas medidas do `attachmodels.ts`, e grava
  `mp7-holds.json`; `mp7.py -- bake` assa os clipes quadro a quadro (30 qps), mede e exporta.
- Esqueleto: o de `assets/arms.glb` importado como está (os giros de descanso voltam idênticos no glTF exportado —
  conferido osso a osso) mais `weapon` (encaixe da arma), `mag` e `charge` (filhos dele) e `ctl` (canais para as camadas
  do jogo, na posição do osso). Dedos em FK; o eixo de dobra de cada falange foi conferido (positivo leva a ponta para
  a palma) e um teste de punho fechado sai igual no Blender e no three.js.
- **Pegada por restrições** (`fpanim/grip.py`), não por ângulo de junta escrito: a mão (âncora com 6 graus) é posta
  por otimização com metas medidas na malha — a membrana entre polegar e indicador encaixada no alto das costas do
  punho, cada falange do médio, anelar e mindinho encostando (fechadas da base para a ponta até tocar, em cascata
  parecida entre os dedos), o mindinho acima do fim do punho, o indicador esticado sobre a armação, o polegar pela
  esquerda para a frente; nada entra na arma além de 1 mm (as esferas da medida são um pouco maiores que a malha).
  **Pulso reto como restrição dura:** o antebraço sai do pulso na linha do dorso da mão (10° de extensão, sem desvio
  lateral) e tem de sair da tela pelo canto de baixo do lado dele; o cotovelo vem daí, e o braço aponta para o ombro.
- Clipes escritos como chaves com tempo (`fpanim/clips_mp7.py`): a arma em deslocamentos a partir da pose de quadril,
  cada mão presa a um espaço (arma, pente, alavanca ou câmera) e trocando de espaço no quadro do contato (o pente sai
  preso à mão e entra preso à arma), Hermite com tangentes de Catmull-Rom para arcos, paradas onde a mão encosta,
  passagens por fora e por baixo da arma, molas para o tranco e o assentamento.
- Clipes do MP7: parado (respiração, 4 s em laço), mirando (pose fixa), corrida e corrida tática (laços de dois passos,
  a fase segue o passo do jogo), sacar, guardar, tiro (aditivo), golpe, recarga com bala (pega o pente por baixo do
  punho, puxa reto, leva ao colete por fora, volta com o cheio em arco, entra devagar e é assentado com um tapa da
  palma), recarga vazia (o pente cai sozinho, a mão já vai ao colete; depois do tapa, sobe pela esquerda até a
  alavanca em T, engancha, puxa e solta) e inspeção (3,6 s: lado esquerdo, lado direito, confere o pente puxando uns
  milímetros e empurrando de volta).
- Saída: `assets/anims/mp7.glb` (só o esqueleto e os clipes, amostrados e enxugados pelo exportador) e
  `gunfight/fpclips-mp7.ts` (gerado: pose de quadril, pivôs, duração e eventos de cada clipe, pegadas por acessório e o
  indicador no gatilho). O relatório de folga de cada falange por quadro sai em `.anim-report/mp7.json` (fora do git).

**No jogo (`gunfight/fpanim.ts`, `gunfight/fpmix.ts`, `viewmodel.ts`):**
- Só as armas de `AUTHORED` (hoje `mp7`) usam o caminho novo; as outras seguem com as contas de código, sem mudança.
  Terceira pessoa sem mudança.
- `FpMixer` (puro, testado) decide pesos e tempos: laços de base com soma 1, um clipe de uma vez por cima (entra em
  0,12 s, sai nos últimos 0,15 s, esticado para a duração do jogo: a recarga do pente estendido é mais lenta e a
  animação acompanha), o tiro somando por cima (menos mirando) e o indicador indo ao gatilho só no tiro.
- Um `AnimationMixer` toca os clipes num esqueleto sem malha; a mão de cada lado e o cotovelo vão para o `FpsArms`
  (`solveHand`: o braço do pulso até o ombro), os dedos por `setFingerQuats`, o pente por `posePart` (qualquer giro) e a
  alavanca por `movePart`.
- As camadas de código continuam por cima, no espaço em que o clipe foi escrito: mira (a mesma conta de `AIM`/`adsEye`
  das outras armas: parado e mirando o clipe deixa a arma exatamente na pose de quadril, então a linha de mira não
  muda), balanço do mouse, passo, coice pelas molas, deslizar e pulo.
- **Uma pegada por acessório como camada**: o clipe é escrito com a empunhadura dobrável; com a vertical ou a angulada,
  a mão de apoio anda (no espaço da arma, pesando pelo canal `ctl.x`, "a mão está no apoio") para a pegada medida
  nelas, com os dedos medidos; com o pente estendido, a mão no pente (`ctl.y`) pega mais embaixo e o pente desce o tanto
  a mais antes de sair do punho (curso maior).
- A empunhadura dobrável do MP7A1 é desenhada só na primeira pessoa e só sem acessório embaixo.

**Adaptação para as outras armas (próximas rodadas):** o esqueleto, o `FpMixer`, o `fpanim.ts` e as camadas são os
mesmos; por arma, muda o `holds_<arma>.py` (metas de contato no punho, no apoio, no pente e na alavanca, a partir dos
pontos que já existem em `grips.ts`/`holds.ts`: `support`, `foregrip`, caixa do pente, alavanca) e o `clips_<arma>.py`
(reaproveitando a estrutura do MP7 por família: pente pela lateral nos fuzis, pente no punho nas SMG de punho e
pistolas, ferrolho nas snipers). Entra no `AUTHORED` quando os quadros forem aprovados.

## Alternativas descartadas
- Seguir ajustando as contas de código: foi o que trouxe a reclamação.
- Pacotes de animação comprados ou baixados: vetado pelo mantenedor; e não combinam com esses braços e armas.
- Escrever cada ângulo de junta à mão: tentado na primeira versão desta rodada; o resultado (dedos soltos, pulso
  quebrado) foi pior que o de antes. A pegada passou a sair de restrições medidas.
- Uma cópia dos clipes por acessório: multiplicaria o arquivo; as camadas por montagem fazem o mesmo com poucos dados.

## Consequências
- Arquivo novo `assets/anims/mp7.glb` e um módulo gerado; o carregamento vai junto com as armas.
- Refazer as pegadas e os clipes é rodar o Blender (`mp7.py -- holds`, `mp7.py -- bake`); o JSON das pegadas fica no
  git para o `bake` sair igual sem refazer a busca.
- Limitações: as metas de contato são esferas (sobra ou falta ~1 mm); a camada de acessório interpola a mão no espaço da
  arma (nas transições ela pode passar alguns milímetros diferente do que um clipe próprio faria); "reduzir movimento"
  só reduz as camadas de código (o clipe toca inteiro); teste em máquina real (Windows) pendente.

## Adendo (2026-11-09): movimento de referência CC BY 4.0 levado para os nossos braços

O mantenedor reprovou as pegadas escritas por restrição (mão "montada", sem cara de mão de verdade) e pediu tudo low
poly e com o mesmo visual (as nossas armas e o nosso `arms.glb`), aproveitando só o **movimento** de animações feitas por
gente. Fontes: "AK-74M" e "Pistol", de LokitoBlu (https://sketchfab.com/martinezequielgorno), CC BY 4.0 (licença
conferida pela API do Sketchfab); créditos em `assets/guns/CREDITS.md` e no menu "Esta partida".

- **Leitura** (`scripts/anims/fpanim/source.py`): só o `.glb` pelo importador de glTF do Blender (`-b --disable-autoexec`);
  o `.blend` que veio junto não é aberto. A malha, a arma e as texturas de origem não vão para o jogo.
- **Do esqueleto dele para o nosso** (`fpanim/retarget.py`, `fpanim/rt_mp7.py`): escala pelo tamanho da mão (pulso → nó
  do médio); a nossa mão vai para o mesmo referencial anatômico (pulso, nós do indicador, do médio e do mindinho) da mão de
  origem; cada falange segue a direção da falange de origem nesse referencial (o descanso dele é a mão fechada: comparar
  com o descanso deixava as nossas mãos abertas); o cotovelo é o dele, escalado (o braço do jogo vai do pulso ao ombro).
- **A arma**: a de origem vira o MP7 pelo punho (centro e eixo medidos na malha dela), sem girar o cano; depois a arma
  anda uns centímetros por baixo da direita até nada entrar e a mão encostar (`grip_fix`), e a mão de apoio (que segurava o
  guarda-mão do AK) é levada para baixo da frente da caixa do MP7, encostada. Sem a empunhadura dobrável.
- **Clipes**: parado (laço), sacar, guardar e tiro do AK; as duas recargas (pente no punho) da pistola, aplicadas como
  movimento relativo a partir da pose de quadril do AK; a mão de apoio troca da pegada do AK para a da pistola só enquanto
  sai de casa; com a mão no pente, ela pega mais embaixo (o nosso pente é mais comprido). Mirando: o primeiro quadro do
  parado. Corrida, corrida tática, golpe e inspeção continuam escritos à mão, agora em cima da pegada que sai do parado de
  referência. O indicador de gatilho escrito à mão saiu (na referência o dedo já está no gatilho).
- O resto da decisão continua: mesmo esqueleto exportado, mesmo `FpMixer`, mesmas camadas (mira, balanço, coice,
  acessórios), só o MP7 no caminho novo, terceira pessoa sem mudança. `mp7.py -- retarget` refaz tudo (com `ANIM_SRC`
  apontando a pasta com os dois `.glb`, que ficam fora do repositório).
- Limitações conhecidas: a mão de apoio no parado fica meio aberta embaixo da caixa (a pegada do guarda-mão do AK não fecha
  em volta do MP7); na recarga da pistola a mão de apoio entra até ~2 cm na arma em alguns quadros; a angulada usa uma
  pegada medida que ainda não ficou boa; teste no app e em máquina real pendentes.

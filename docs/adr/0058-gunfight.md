# ADR-0058: Gunfight no Espaço 3D (zona 8)
Status: Accepted (pedido do mantenedor, 2026-11-09)

## Contexto
O mantenedor pediu um minigame de tiro todos contra todos, com sensação de shooter moderno de PC, em primeira e
terceira pessoa, com 11 armas (M4, AK47, MP7, MP5, L115, M200, Kar98k, M9, Desert Eagle, karambit e baioneta M9),
animações de todas, movimento tático (corrida tática, slide, slide cancel, bunny hop, quick scope) e treino contra bots
em Fácil, Médio e Difícil. Nada de mapas, arte, sons ou interface copiados de jogos existentes.

## Decisão
- **Zona própria (8)**, fora das zonas esportivas 1–7: arena de contêineres (`gunfight/map.ts`, `mapmesh.ts`), sem
  paredes da sala. Partida até 30 abates (`FFA_TARGET`), vida 100 com regeneração após 4,5 s, renascer em 3 s.
- **Rede: cliente autoritativo, só repasse.** Evento novo `space:gun` (`fire`, `hit`, `die`, `spawn`) em
  `packages/contracts`, repassado pela API só às pessoas da chamada (balde 40/40 no gateway, volátil). Quem atira
  detecta o acerto e manda `hit`; a vítima aplica o dano e anuncia `die`. A pose (`SpaceMove.gun`) leva arma, mira,
  agachado, ADS e vivo. A vítima descarta acertos implausíveis (arma diferente da pose, faca fora do alcance).
  Sem estado no servidor nem migração.
- **Balística pura** (`weapons.ts`): raio contra caixas do mapa, esfera da cabeça e cilindro do corpo; dano por
  distância, espalhamento por movimento/ADS, cadência por arma.
- **Movimento** (`movement.ts`): máquina de estados pura (correr, corrida tática, agachar, slide com velocidade inicial
  guardada, slide cancel, bunny hop com buffer de pulo e teto de velocidade), independente da taxa de quadros.
- **Primeira pessoa:** arma e braços numa cena e câmera próprias, desenhadas por cima com limpeza de profundidade
  (`viewmodel.ts`); animações procedurais (sacar, tiro, recarga, recarga vazia, ferrolho, carregador da Kar98k, faca,
  golpe pesado, inspecionar) com antecipação, overshoot e molas; peças móveis por osso (pente, ferrolho, alavanca).
  Mãos articuladas com dedos (`hand.ts`, pegadas em `grips.ts`), também nos bonecos.
- **Terceira pessoa:** câmera de ombro com recuo por colisão; arma presa ao boneco com IK de braço.
- **Modelos:** 7 armas do pacote Ultimate Low Poly Guns (CC-BY 4.0, TastyTony/Pichuliru), convertidas para GLB;
  M200 derivada da M24; Desert Eagle, karambit e baioneta feitas em código. Atribuição em
  `assets/guns/CREDITS.md` e no menu da partida.
- **Bots:** só no app de quem chamou e com a arena vazia (mesma regra do ADR-0055, adendo dos bots); caminho por BFS
  numa grade, percepção por linha de visão e campo de visão, reação, erro de mira que diminui, rajadas e strafe.
- **Som:** receitas sintetizadas no Web Audio (ADR-0055, adendo do som), uma por arma, mais recarga, ferrolho,
  marcador de acerto e abate.

## Alternativas descartadas
- Servidor autoritativo com reconciliação: precisaria simular a partida na API; para um minigame entre amigos na
  mesma chamada, o repasse com checagem de plausibilidade basta.
- Animações gravadas (mocap): não há assets livres compatíveis com as armas e as mãos; as procedurais se ajustam a
  cada arma.
- Comprar ou baixar pacotes de armas sem licença clara: descartado; só CC-BY/CC0.

## Consequências
- Contrato e API mudam (zona até 8, `gun` na pose, `space:gun`): API e app sobem juntos. Sem migração.
- Trapaça possível por cliente modificado (como nos outros minigames); aceitável no contexto de amigos.
- Pessoas de verdade ainda se atravessam (a separação vale só para os bots).
- Teste manual com duas pessoas em máquinas diferentes: PENDENTE.

## Adendo (2026-11-09): pegada e recuo

- **Recuo por padrão fixo por arma** (`weapons.ts` `RecoilSpec`, `recoilKick`): trechos em graus por tiro (subida, lado
  e balanço), o mesmo a cada pente, com pouca variação sorteada por cima. Mirando ×0,6 (lado ×0,5), agachado ×0,85;
  o primeiro tiro sai com 60% (menos na sniper). A rajada não zera ao soltar o gatilho: esfria aos poucos (`burstNow`),
  e a dispersão abre com ela (`bloomNow`, também na mira do HUD e nos bots).
- **A mira volta:** parte do recuo (`recover.frac`) vira uma conta que volta sozinha depois de um tempo sem atirar
  (exponencial); puxar o mouse contra o recuo paga a conta, e a volta nunca passa da mira inicial.
- **Tranco da vista** (para cima, para o lado e rolagem) com a mola da arma; o tiro sai do centro da tela que se vê.
- **Molas** (`gunfight/spring.ts`): coice da 1ª pessoa, tranco da câmera e coice do boneco, em subpassos de 1/120 s
  (o mesmo pico a 30 e 144 qps), escritas pelo pico que se vê.
- **Cadência** contada do tiro anterior (até 3 tiros por quadro): não cai mais com o fps.
- **Pegada:** indicador separado no gatilho (`hand.ts setCurl(c, t, index)`); na 3ª pessoa, arma longa a 0,86 da
  escala do boneco e coronha no ombro, para a mão de apoio alcançar o guarda-mão; o tronco (tiro levado e coice) leva
  a arma junto.

## Adendo (2026-11-09): o jogo todo (rodada 1 de pegada/recuo, integração do Caio)

- **Partida curta:** o alvo de abates sai do tamanho da partida no começo (`ffaTarget`: 2–3 pessoas e bots → 15,
  4–5 → 20, 6+ → 25) e a partida acaba em 8 min (`MATCH_MS`; vence quem tem mais abates, empate pelo menor número de
  mortes; sem nenhum abate, só recomeça). Cada um publica na pose o alvo e os segundos que faltam (`ft`, `fl`); quem
  entra depois, ou começou depois, pega o relógio de quem está há mais tempo (só se estiver 3 s à frente, e nunca
  logo depois de um recomeço).
- **Proteção ao nascer:** 1,5 s sem levar dano, ou até o primeiro tiro/golpe (`prot` na pose; o boneco fica meio
  transparente para os outros; bots não miram em quem está protegido). Os bots também nascem protegidos.
- **Nascer:** nunca à vista (olho a olho) de um inimigo vivo a menos de 30 m, se houver ponto seguro; olhando para a
  direção de vista mais livre (`spawnFacing`).
- **Bots:** sentem o recuo da arma pelo mesmo padrão (corrigem 30%/65%/85% conforme o nível), espalham andando,
  cadência pelo tiro anterior, reação no Difícil 0,28 s e pausa de 120 ms entre rajadas, e o primeiro tiro depois de
  ver alguém é de aviso (erra por ≥ 0,03 rad). Medido parado contra 3 bots no Difícil (4 × 90 s): vida média 15,4 s,
  mínima 1,9 s (antes: 7,4 s, 3,1 s e 1,1 s).
- **Marcas de tiro** na parede e no chão (`fx.ts`: pool fixo de 64 numa `InstancedMesh`, somem em 8 s); o tiro para no
  chão (`castShot` devolve a normal da face).
- **Câmera da morte** (`camera.ts deathCam`): atrás e acima do corpo, do lado oposto a quem matou, virando em 1,2 s
  para o atirador; encostada na parede, sobe e olha de cima.
- **Céu:** o pátio usa a luz da estação, sem as estrelas e o buraco negro (escondidos pelo nome), com céu liso escuro.
- **Faca:** golpe rápido 55 (dois golpes), pesado 150.
- **Som:** passos (meus, dos outros e dos bots, pela distância andada; agachado não), tom por arma, tiro de longe
  abafado (> 25 m) e panorâmica ±0,8 na zona 8.
- **Contrato:** `SpaceGunPose` ganha `prot`, `ft`, `fl` (opcionais) e `act: 'inspect'`. Servidor e app sobem juntos
  (servidor antigo recusa a pose com `act: 'inspect'`).

## Adendo (2026-11-09): armas novas e troca da M200 e da Desert Eagle

- **Modelos:** 13 armas novas dos modelos "Low Poly" de TastyTony no Sketchfab (CC-BY 4.0, atribuição em
  `assets/guns/CREDITS.md` e no menu): Haenel RS9, FN Ballista e SV-98 (snipers de ferrolho), SCAR-L, Sig MCX, AKS-74U e
  StG 44 (fuzis), Sig MPX, MSMC e KAC PDW (submetralhadoras), Automag III (pistola), Magnum BFR e Chiappa Rhino
  (revólveres). A M200 e a Desert Eagle feitas em código foram trocadas pelos modelos dele, com o mesmo id, números e
  acessórios. Gepard, Mateba e Judge ficaram de fora.
- **Conversão** (`apps/desktop/scripts/guns-build.py`, Blender, sem rodar nada do arquivo): pose de descanso aplicada,
  cada vértice na peça do osso de maior peso (ou por nome da malha/caixa nos modelos sem esqueleto), peças rígidas como
  nós com o nome que o jogo procura (`mag`, `bullets`, `bolt`, `boltmove`, `boltrotate`, `slide`, `charginghandle`,
  `bolthandle`, `irons`, `optic`, `foregrip`), um nó `trigger` vazio na frente do gatilho, escala para o comprimento da
  arma de verdade (a Automag do arquivo é baixa e larga: escala por eixo), sem UV nem cor de vértice. ~7 MB a mais no total.
- **Jogo:** mira de ferro medida com raios no modelo (furo da alça/fundo do entalhe e ponta da massa); lunetas e o ponto
  vermelho de fábrica (MSMC, MCX) pelo eixo óptico, com retículo aceso no vidro; a alça e a massa de SCAR-L, MPX, PDW,
  AKS-74U e StG 44 deitam com uma mira do armeiro; a mira e a empunhadura de fábrica saem quando se monta outra.
- **Recarga:** pente pela lateral (fuzis e submetralhadoras), no punho (MSMC, como a MP7), pistola, ferrolho (snipers) e,
  nova, a do revólver (`reload.ts cylinderPose`): o tambor abre para a esquerda girando, a mão aninha por baixo, vai ao
  cinto e volta com o carregador rápido, empurra e o tambor fecha. Revólver não solta estojo no tiro.
- **Números:** no estilo dos que já existiam (SCAR-L entre M4 e AK; MCX leve; AKS-74U ágil e de dano que cai cedo;
  StG 44 lenta e forte; MPX estável; MSMC a mais rápida de perto; PDW alcança mais; RS9 e Ballista derrubam no peito,
  SV-98 mira rápido e de longe precisa de dois; Automag de cano longo; Rhino de coice baixo; BFR com o tiro mais forte
  das pistolas e coice enorme).
- **Contrato:** `GUN_IDS` ganha os 13 ids no fim (a ordem antiga não muda). API e app sobem juntos (a API antiga recusa
  a pose com arma nova). Sem migração.
- **Limitações:** recarga do revólver simplificada (sem estojos caindo do tambor); dedos da mão de apoio na pegada em
  "C" sobem pela lateral do guarda-mão como nas armas antigas; teste em máquina real (Windows) pendente.

## Adendo (2026-11-09): movimento e tiro no pulo no estilo CoD (MW 2019/2023)

- **Mirando, o tiro vai para o centro da mira** (pedido do mantenedor): no ar, andando ou deslizando, com a mira em
  cima a bala sai reta; o primeiro tiro mirando é exato e a rajada mirando abre só o pouco de `spread.ads`/`bloom`
  (igual no chão e no ar). Os castigos de andar, pular e deslizar (`AIR_SPREAD`, `SLIDE_SPREAD`, `spread.move`) valem
  no quadril e somem junto com a transição da mira (na luneta, de vez). Substitui o "nem com a luneta" de antes.
- **Corrida:** a normal não cansa; o vigor é só da tática (~3,5 s, volta depois de 1 s sem ela, também correndo).
  Sair da corrida para atirar: 200/150/110/300 ms (fuzil/SMG/pistola/sniper), ×1,6 da tática; o clique dado correndo
  sai quando a arma desce, mesmo depois da janela do clique guardado.
- **Mirando, cada classe no seu ritmo** (`ADS_MOVE`: fuzil 0,55, SMG 0,68, pistola 0,75, sniper 0,42 × peso da arma);
  de costas, ×0,8.
- **No ar:** o controle vira a direção mas não passa da velocidade que se teria no chão (pular parado não vira
  corrida; antes acelerava até o teto do bunny hop); aterrissar sem pular de novo freia para ×0,85. O bunny hop (pulo
  guardado) segue como antes.
- Bots e rede sem mudança (os bots usam `spreadNow`, que não mudou; nada novo na pose).

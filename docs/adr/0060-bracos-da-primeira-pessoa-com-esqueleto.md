# ADR-0060: Braços da primeira pessoa com esqueleto (gunfight)
Status: Accepted (pedido do mantenedor, 2026-11-09)

## Contexto
As mãos da primeira pessoa do gunfight (ADR-0058) eram feitas em código: palma em esfera achatada, falanges em
cápsulas e mangas em cilindros, tudo posto por conta. O mantenedor (que joga CoD MW3 e CS2) achou "muito bugado": a
mão de guarda da faca parecia um toco fechado e, na mão da karambit, um dedo entrava na palma. Ele escolheu trocar por
um modelo de braços de verdade, com esqueleto, e poses escritas por arma.

## Decisão
- **Modelo**: `assets/arms.glb`, feito a partir do "fps arms (rigged only)" de para (OpenGameArt, **CC0**), pelo
  script `apps/desktop/scripts/arms-build.py` (Blender, sem rodar nada do arquivo baixado): esqueleto limpo
  (braço → antebraço → mão → metacarpos → 3 falanges por dedo, polegar de 3 ossos), em metros, braço/antebraço e
  falanges esticados para medidas de adulto (as falanges originais não davam a volta num punho de arma), manga e luva
  sem dedos tiradas da própria malha, uma subdivisão. ~1 MB, carregado junto com as armas.
- **Dados do esqueleto em TS** (`gunfight/armsrig.ts`, gerado por `scripts/arms-rig.mjs` a partir do .glb): descanso
  de cada osso da mão, tamanho e grossura de cada falange e a grade de espessura da palma. A medida de contato
  (`contact.ts`/`holds.ts`) usa esferas montadas desses números (`handrig.ts`), sem carregar o arquivo (testes rodam
  em Node), e a malha que se vê usa os mesmos ossos: o encaixe medido é o que aparece.
- **Poses escritas** (`handrig.ts`, `HAND_POSE`): quanto cada junta de cada dedo dobra no fechado (o mindinho fecha
  antes, a palma faz concha), o dedo de gatilho, a abertura lateral e o polegar aberto/cruzado. Os parâmetros da pegada
  continuam os mesmos (`curl`, polegar, indicador e o acerto medido por dedo), então recarga, saque, inspeção, ferrolho
  e golpes mantêm o tempo e a coreografia de antes; só a mão que aparece mudou.
- **Braço**: a mão vai para a âncora da pegada; o antebraço sai do pulso na direção do cotovelo pedido (a mesma IK de
  antes, com o caso da faca), com o tamanho do modelo, e o braço vai do cotovelo para o ombro. Metade do giro do pulso
  em volta do antebraço vai para o antebraço (a pele do pulso não torce).
- **Faca**: os dedos partem abertos e fecham até encostar no cabo (o indicador na argola da karambit); a mão de guarda
  fica relaxada (dedos em cascata, polegar solto), não cerrada.
- **Terceira pessoa** não muda: o boneco continua com a mão de cápsulas (`hand.ts`); as pegadas (`grips.ts`) recebem a
  medida da mão que vai segurar (`HandFit`: vão do punho fechado, centro do punho da arma, apoio em "C", argola).

## Alternativas consideradas
- Manter a mão em código e só ajustar números: não resolve o visual (bolhas) que motivou o pedido.
- Mão do manequim do UAL (CC0, já usado no boneco): segmentada como manequim de madeira.
- "Low Poly Arms (Rigged)" (DevMops, CC0): baixa demais para a primeira pessoa.
- Animações gravadas por arma (clipes no .glb): exigiriam refazer toda a coreografia (recarga por arma, pente
  seguindo a peça, ferrolho) que já depende da geometria medida de cada arma; ficaram as poses de mão como dados e o
  movimento existente.

## Consequências
- Mãos e braços com volume, juntas e luva; dedos fecham em volta do punho, do guarda-mão e do cabo sem atravessar
  (medido). Pele dos dedos em tom fixo (antes a mão tinha a cor do jogador).
- Arquivo novo de ~1 MB no app; 2 malhas com pele na cena da primeira pessoa (~17 mil vértices).
- Limitações conhecidas: anelar e mindinho às vezes ficam mais abertos que o ideal no punho de fuzil (o encaixe abre o
  dedo quando ele encosta no guarda-mato ou no poço do pente); o encaixe é por esferas, então pode sobrar ~1 mm de
  folga ou de contato; teste em máquina real (Windows) pendente.

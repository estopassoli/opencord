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

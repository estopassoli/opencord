# ADR-0055: Espaço 3D da chamada
Status: Accepted (pedido do mantenedor, 2026-11-08)

## Contexto
O mantenedor quer uma atividade da chamada de voz em que todos aparecem como avatares low poly num ambiente 3D, andam
livremente, ouvem os outros mais baixo quando estão longe (sem nunca deixar de ouvir), assistem juntos num telão (live
de alguém da chamada ou vídeo do YouTube) e, como no The Sims, o dono do servidor monta o ambiente (paredes, área,
móveis). Cada servidor precisa ter um ambiente próprio desde o começo. Escolhas dele: câmera em terceira pessoa com
WASD; fases 1 a 3 juntas (ambiente, avatares e voz; telão; editor); editar por uma permissão nova; quem está na
chamada sem abrir o espaço fala em volume normal.

## Decisão
- **Atividade da chamada**, ao lado de "Assistir juntos" e "Música". Só em canais de servidor (não em chamada privada).
  Abrir o espaço é individual: quem não abre continua no palco normal e sem posição.
- **Renderização no app com three.js** (já usado no fundo do layout Vidro), sem arquivos de modelo: peças e avatares
  são geometria low poly montada em código (`apps/desktop/src/features/space3d`). Avatar original (cápsula com rosto de
  tela, olhos que piscam, antena), cor estável por pessoa — sem reproduzir personagens de jogos existentes.
  Sem sombras em tempo real; o laço para com a janela escondida e o app avisa se ficar abaixo de 24 fps.
- **Ambiente por servidor**: formato `SpaceLayout` (tema, largura × profundidade de 8 a 60 m, cores, até 200 paredes
  em segmentos e 300 peças de um catálogo fechado, ponto de entrada) validado com zod nos dois lados
  (`packages/contracts/src/space.ts`). Sem edição, o ambiente é **gerado de forma determinística a partir do id do
  servidor** (6 temas, tamanhos, cores e arranjos variados) — sem IA, sem custo e sem guardar nada. Ao salvar, vai
  para a tabela `ServerSpace` (1 linha por servidor, JSONB + revisão); salvar exige a revisão de origem (409 se outra
  pessoa salvou no meio). "Restaurar original" apaga a linha.
- **Permissão nova `EDIT_SPACE` (1 << 21)**: dono e administradores têm; pode ser dada a cargos. Salvar e restaurar
  ficam no registro de auditoria (`space.update`, `space.reset`).
- **Posições pelo Socket.IO, não pelo canal de dados do LiveKit**: o canal de dados da SFU só é liberado para quem pode
  transmitir (decisão anterior, para ninguém mandar imagens/dados fora da moderação), e abrir para todos exigiria
  revalidar a prévia da live e o controle remoto. A posição é presença efêmera: `space:move` sem ACK (~10/s andando,
  1/s parado, balde próprio de 20/s por socket), validada pelo zod, repassada como `space:moved` **só para quem está na
  mesma chamada** (lista relida a cada 2 s) com emissão volátil (descartada se o socket estiver ocupado). Nada é
  guardado. `space:leave`/sair da chamada tiram o avatar; sem notícia por 6 s ele some.
- **Voz pela distância no cliente**: cada um calcula a distância até os outros e multiplica o volume da voz deles
  (GainNode do LiveKit) por uma curva suave: cheia até 3 m, cai até 35% aos 22 m e não desce disso. Não mexe no áudio
  de quem não está no espaço nem no áudio das lives.
- **Telão**: estado da chamada no Redis (`space:<canal>`, como a atividade), `space:get`/`space:screen` com ACK,
  `space:state`/`space:ended`. Fontes: a live de alguém da chamada (o app assina a transmissão e usa o vídeo como
  textura no telão e nas televisões) ou o vídeo do "Assistir juntos" (o mesmo player oficial do YouTube e a mesma
  sincronia, desenhado num plano CSS 3D atrás do canvas, que abre um "buraco" transparente no lugar da tela — o YouTube
  não pode virar textura por ser de outra origem). Chamada vazia apaga o estado.
- **Editor no próprio espaço**: câmera livre, selecionar/arrastar peças (grade de 25 cm), girar, duplicar, recolorir,
  apagar, desenhar paredes arrastando (grade de 50 cm), altura de parede, tamanho da área (paredes da borda
  acompanham), tema, cores, ponto de entrada, gerar outro ambiente e desfazer. Trabalha num rascunho; "Salvar para
  todos" manda `PUT /servers/:id/space` e todos do servidor recebem `space:layout`.

## Alternativas descartadas
- Canal de dados do LiveKit para posições: menor latência, mas exigiria liberar dados para todos (ver acima).
- Áudio espacial com HRTF/panorâmica: mais imersivo, mas cansa em conversas longas e exige um grafo de áudio próprio
  fora do LiveKit; pode vir depois como opção.
- Ambientes gerados por IA: custo por geração e resultado imprevisível; o gerador procedural já dá um ambiente
  diferente por servidor.
- Modelos glTF prontos: arquivos e licenças a gerenciar; a geometria em código é leve e tem o mesmo estilo low poly.

## Consequências
- Migração `20261108000000_server_space` (aditiva) antes da API nova.
- Posições passam pela API: com 25 pessoas andando são ~250 mensagens/s por chamada, repassadas a 24 sockets cada.
  Aceitável na escala atual; se pesar, o próximo passo é o canal de dados da SFU com dados liberados só no espaço.
- Quem não abriu o espaço não aparece nele (sem posição) e é ouvido normalmente por todos.
- O telão com live depende do Go Live; a regra do projeto continua: validar Go Live em duas máquinas Windows reais
  antes de afirmar que funciona — o telão com live está **bloqueado para validação** até esse teste.

## Adendo 2026-11-08: interação e x1 no soco
- **Interagir (F)**: assentos (sofá, poltrona, cadeira, banqueta, puff, cama) põem o avatar sentado (pose `a = 5`,
  vista por todos; lugar ocupado não é oferecido); luminária, lareira e fliperama ligam/desligam para a chamada
  (`space:toggle`, estado `toggles` no Redis da sessão, só peças desses tipos que existem no ambiente do servidor);
  televisão/telão abrem o menu do telão; caixa de som abre a música. No máximo 6 luzes de verdade por ambiente
  (apagar = intensidade 0, para não recompilar materiais).
- **x1 no soco**: desafiar alguém a até 4 m, convite de 20 s, contagem de 3 s, luta de 90 s, 100 de vida, soco rápido
  8 (recarga 0,42 s), forte 16 (1,1 s), defesa reduz a um quarto. **O servidor decide cada golpe** pela última posição
  recebida de cada um (alcance 1,5 m + 0,4 de folga, mira de ±69°, recarga, defesa = pose `a = 8`), não pelo que o
  cliente diz. Ringue no chão; quem luta não sai dele e fica virado para o adversário. Sair do espaço = derrota.
  As lutas ficam **em memória** na API (duram ~2 min); reiniciar a API encerra as lutas em andamento.
- **Esportes (basquete, futebol, tênis)**: cada um tem uma arena fixa (não depende do ambiente do servidor), aberta
  pelo botão Jogos; a posição leva `zone` (0 sala, 1–3 arenas) e quem está em outra arena é ouvido como se estivesse
  longe (piso de 35%). A bola é de quem tocou por último: essa pessoa simula e manda `space:ball` (~10/s, repassado
  só a quem está na chamada, volátil); os outros simulam também e corrigem pelo que chega; empate de toque fica com
  quem já mandava. Física própria (gravidade, quique, atrito, muros, aro/tabela, traves, rede). Ponto detectado por
  quem simula → `space:score` (placar no Redis da sessão, mesma arena ignorada por 1,5 s para não contar o mesmo lance
  duas vezes; qualquer um da chamada pode zerar). Basquete: pegar/roubar com F, segurar e soltar na faixa boa; 3 pontos
  de trás do arco. Futebol: encostar chuta, F chuta forte. Tênis: F rebate, ponto por dois quiques, bola fora ou
  bola que não passa da rede.
- Limite conhecido: a autoridade da bola confia no cliente (um app modificado poderia marcar pontos falsos); como é
  diversão sem prêmio, aceitamos. O x1 continua decidido no servidor.
- 2026-11-08 (ajustes após o teste do mantenedor): no x1 os golpes vão no mouse (esquerdo rápido, direito forte),
  com a mira travada no centro (Pointer Lock; Esc solta), câmera por cima do ombro e o boneco olhando para onde a mira
  aponta (acertar depende de mirar); defesa segurando Shift. A posse da bola deixou de comparar o relógio de cada PC
  (quem estava com o relógio atrasado nunca conseguia pegar a bola): agora é um contador de toques (o meu toque = o
  maior visto + 1; empate decidido pelo id, igual em todos os apps). Times nas arenas: entra no time com menos gente,
  pode trocar, faixa e disco da cor do time no boneco, gol/cesta/fundo da cor de quem defende; no tênis quem ganha o
  ponto saca, com a bola aparecendo na frente de quem está daquele lado.
- 2026-11-09: vôlei de areia (4), ping pong (5, a bolinha quica na mesa), sinuca (6) e corrida de moto (7) — arenas
  próprias como os outros esportes. Raquete na mão no tênis e no ping pong. Regras de ponto dos jogos de rede numa
  função testada (`netPoint`). Sinuca: física das 16 bolas no cliente de quem tacou (`space:pool`, contador de tacadas
  como a posse da bola), vez por time, 1 ponto por bola. Corrida: cada um simula a própria moto (posição pelo
  `space:move`), pontos de controle a cada terço impedem cortar caminho; largada (`space:race:start`, contagem de 4 s)
  e chegada (`space:race:finish`) no servidor, que recusa tempo menor que 12 s por volta ou maior que o tempo desde a
  largada (+3 s). Estilo de corrida arcade original (não reproduz personagens, pistas ou itens de outros jogos).

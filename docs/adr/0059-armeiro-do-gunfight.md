# ADR-0059: Armeiro do gunfight (acessórios nas armas e na pose)
Status: Accepted (pedido do mantenedor, 2026-11-09)

## Contexto
O menu de equipamento do gunfight (ADR-0058) era uma grade de botões de texto. O mantenedor pediu um menu mais rico
e a possibilidade de personalizar a arma: mira, peças da boca e outros acessórios. Os acessórios precisam mudar o
jogo de verdade, aparecer no modelo (primeira e terceira pessoa) e ser vistos e ouvidos pelos outros.

## Decisão
- **Catálogo puro** (`gunfight/attachments.ts`): quatro encaixes — mira (ponto vermelho, reflexa mini (era a holográfica), luneta 3x; ponto
  de pistola; luneta variável nas snipers; luneta clássica na Kar98k), boca (supressor, compensador, quebra-chamas),
  sob o cano (empunhadura vertical e angulada) e carregador (estendido). O que cabe em cada arma é uma tabela; faca
  não tem encaixes. `applyAttachments(spec, build)` devolve a arma montada: recuo (padrão, tranco da vista, coice),
  dispersão mirando, tempo para mirar, zoom e luneta, pente e reserva, recarga, alcance do dano, velocidade, tiro
  abafado e sem clarão. O dano máximo nunca muda (a vítima confere o acerto por ele).
- **Modelos em código** (`attachmodels.ts`, poucos polígonos como as armas feitas em código): montados no trilho, na
  boca (no eixo do furo medido na ponta do cano), sob o guarda-mão e preso ao osso do pente (sai junto na recarga). A
  linha de mira passa a ser a da mira; a alça e a massa dobráveis (M4, MP7) somem com uma mira. Miras de ponto têm o
  retículo desenhado no vidro, no ponto onde a linha do centro da câmera cruza o vidro (fica no centro da tela, como
  uma mira sem paralaxe); as de aumento usam a tela de luneta com um retículo por estilo. A empunhadura vertical
  leva a mão de apoio para ela (as pegadas são medidas de novo por montagem).
- **Rede: campo opcional na pose.** `SpaceGunPose.att`: até 4 inteiros de 0 a 15 (o código de cada encaixe na ordem
  mira, boca, sob o cano, carregador; 0 = de fábrica; sem o campo = arma de fábrica). O código é a posição no catálogo
  (`ATT_CODES`), que só cresce no fim. Quem recebe ignora o código que não conhece ou que não cabe na arma. O som e o
  clarão do tiro de outra pessoa saem da montagem da pose dela. Sem estado no servidor nem migração.
- **Salvo local** (`opencord.space3d.loadout.v2`): as três armas e a montagem de cada arma; o salvo antigo
  (`opencord.space3d.loadout`, só as armas) é lido uma vez e migrado. Sozinho ou contra bots, a troca vale na hora;
  com gente na arena, ao nascer.
- **Menu**: cartões das três armas com a imagem do modelo montado (desenhada uma vez num renderizador só do menu,
  liberado ao fechar), barras de atributos e acessórios; lista de armas com comparação; armeiro com abas por encaixe e
  prós e contras com sinal e cor. Esc volta uma tela.
- **Bots**: cada bot sorteia uma montagem (sorteio à parte, o comportamento do bot não muda).

## Consequências
- Contrato muda (campo opcional): **API e app sobem juntos**. App antigo continua funcionando (não manda nem lê o
  campo; vê as armas de fábrica dos outros). Com a API antiga, o zod de `SpaceMove` tira a chave que não conhece: o
  jogo funciona, mas ninguém vê nem ouve os acessórios dos outros até a API subir.
- Teste manual em duas máquinas (ver os acessórios e ouvir o supressor de outra pessoa) pendente.

## Alternativas descartadas
- Lista de acessórios em texto na pose: mais bytes a cada envio (~10/s) sem ganho.
- Mira com imagem dentro da imagem (renderizar a cena de novo na lente): custo de GPU alto para um minigame; a tela de
  luneta já existia nas snipers.
- Modelos de acessórios baixados: sem pacote CC0/CC-BY que combine com o estilo e as medidas das armas.

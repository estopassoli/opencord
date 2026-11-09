# Gunfight — revisão R1 — Téo (sensação e animação)

Data: 2026-11-09 · Só leitura (nenhum código mexido).

## Verificações rodadas
- `npx tsc --noEmit -p .` (apps/desktop): ok, sem erros.
- `npx eslint src test`: ok, sem avisos.
- `npx vitest run`: 66 arquivos, 438 testes passando.
- Página de teste (cópia minha em `scratchpad/teo-r1`, porta 5347): roteiros `m4`, `sniper`, `knives` e dois meus
  (`teo`: corrida → tiro, 3ª pessoa slide/agachado/ADS/recarga/morte; `sn2`: L115 com clique segurado 70 ms, Deagle).
  Mais três sondas: `probe2.cjs` (arma do boneco depois da morte), `hands.cjs`/`thumb.cjs` (close das mãos da 1ª
  pessoa, de cima e de baixo) e `bot.cjs` (bot de quatro lados). Olhei os quadros.
- Achado do roteiro: `tap('Mouse0')` (apertar e soltar no mesmo quadro) **não atira** — a L115 e a Deagle do roteiro
  `sniper` nunca dispararam (munição parada em 5/25). Ver item 8.

## Problemas (do mais grave ao menos)

### Alta
1. **Polegar do lado do mindinho, nas duas mãos** (`hand.ts:66-67, 91`). Render de baixo (`thumbB_0.jpg`): na mão
   direita o indicador fica em −x e o polegar em +x, junto do mindinho, deitado na palma. Vale para 1ª e 3ª pessoa, e
   todas as pegadas foram ajustadas em cima disso. Correção: `thumbBase.position.x = 0.036 * -mirror` (lado do
   indicador), `rotation.y = -0.7 * mirror`, `thumb[0].rotation.y = -t * 0.6 * mirror`; dar oposição (girar em z para a
   polpa olhar os dedos). Depois reajustar `gripRight/gripLeft` e conferir com o close.
2. **Mão de apoio não segura o guarda-mão** (`viewmodel.ts:429-432`). Em todos os fuzis/snipers ela aparece ao lado
   da arma, palma aberta e dedos esticados (close `hand_l115_primary_L.jpg`; quadros de corrida, slide cancel e
   inspecionar do M4). Correção: tirar o ponto de apoio da geometria (fundo do guarda-mão naquela fatia z, não `y=0`
   fixo em `models.ts:167`), pôr o centro da palma encostado nele e curvar os dedos subindo pelo lado (com o polegar
   já corrigido por cima).
3. **Arma flutua depois da morte (3ª pessoa)** (`avatar.ts:571, 836`). Com `a=9` o `holdGun()` não roda e
   `g.root.visible` fica `true`; sonda: `{"a":9,"gunVis":true,"alive":false}` por 3 s. Vale para mim, bots e gente da
   rede. Correção: antes do `if`, `if (this.gun) this.gun.root.visible = this.gunPose.alive && a !== 9` (ou soltar a
   arma no chão).
4. **Braços da 3ª pessoa fora da arma** (`avatar.ts:860-876`). Bot com M4 (`bots.jpg`): a mão de apoio passa da boca
   do cano com o braço esticado, e a direita fica abaixo do punho. `reachLen = 0.55*DOLL_SCALE` é uma estimativa, o
   `aim()` só gira, e a mão não é orientada. Correção: IK de dois ossos com os comprimentos medidos no `build()`
   (ombro→cotovelo→pulso), lei dos cossenos, vetor de polo para baixo/fora, e girar `hand_*` para a pegada.
5. **Manga gigante na corrida tática** (`viewmodel.ts:381-390`). O cotovelo é `pulso + (±0.16, −0.3, +0.42)`. Com a
   arma de cano para cima, a manga esquerda passa colada na câmera e cobre um terço da tela (`v_teo/f00020`, M4
   tática). Correção: ombro fixo no espaço da câmera (ex.: `(±0.2, −0.35, +0.1)`), antebraço de comprimento fixo
   (~0.28 m) e cotovelo resolvido entre os dois. Nunca deixar a manga passar de z > −0.08.
6. **Balanço sem limite: um flick vira a arma de lado** (`viewmodel.ts:149-150`; `game.ts:633`). `lookX` é o delta
   do quadro sem teto: no roteiro, a mira travando no bot deixou a L115 atravessada na tela (`sn_qs.jpg`, 2º quadro).
   O renascer (`host.turn` em `respawn`) dá o mesmo tranco. Correção: limitar o delta (±0.05 rad/quadro) e
   `swayX/Y` (±0.12), e zerar `lookPrev` em `respawn()`.

### Média
7. **Atira saindo da corrida com a arma ainda apontada para cima** (`game.ts:427-433`). A bala sai no mesmo quadro em
   que a corrida acaba (`v_teo/f00021`: 29/120 com a AK de cano para o alto). Correção: tempo de saída da corrida por
   classe (fuzil ~180 ms, SMG ~140, pistola ~110, sniper ~260, menos na tática), guardando o clique.
8. **Clique curto se perde** (`game.ts:300-304, 640`). `press` só marca `triggerDown`, e o tiro sai no `step`. Se o
   botão desce e sobe no mesmo quadro (clique rápido com FPS baixo), não sai tiro em sniper nem em pistola, e o quick
   scope fica "comido". Correção: `firePending = true` no `press`, consumido no `step` mesmo já solto.
9. **Ferrolho anda sozinho** (`viewmodel.ts:265-275`). A alavanca gira e recua com a mão direita parada no punho
   (`a_bolt.jpg`). O mesmo vale para a alavanca de carregamento na recarga vazia. Correção: de 0,1 a 0,85 a mão
   direita vai até a alavanca (`parts.charge`/`boltRot`), segue o vai e volta com curl ~0,6 e depois volta ao punho. Na
   vazia, a mão esquerda puxa a alavanca.
10. **Pente não vai na mão** (`viewmodel.ts:246-256, 322`). A mão de apoio vai até (0, −0,16, 0) e volta vazia. O pente
    desce 0,3, some (`visible=false`) e depois sobe sozinho. Na pistola a mão nem aparece (`a_dreload.jpg`). Correção:
    entre 0,32 e 0,55 o pente segue a palma da mão esquerda e fica visível o tempo todo. Na pistola, trazer a mão
    para dentro da tela.
11. **Entrada da luneta** (`viewmodel.ts:169-171`, `models.ts:164`, `game.ts:663-694`). A linha de mira é o topo da
    luneta (`box.max.y`), então a ocular passa baixa e à direita antes do corte (`a_qs.jpg`, 2º quadro). A arma some
    quando `ads>0.85`, mas o HUD só recebe `scoped` a cada 50 ms, o que dá 1 a 3 quadros sem arma e sem luneta.
    Correção: mirar pelo eixo óptico (centro do tubo) com `eyeZ` maior, para a ocular encher a tela antes do corte.
    Mandar `scoped` ao HUD na hora em que muda e fazer um escurecer rápido (60–80 ms).
12. **Traçante sai de ponto fixo** (`game.ts:486-494`). `muzzleWorld` ignora a inclinação, a mira, a luneta e a 3ª
    pessoa. Na luneta, o traço entra pelo canto em diagonal (`a_qs.jpg`, 3º quadro), e o `from` enviado pela rede é o
    mesmo ponto errado. Correção: na 1ª pessoa, projetar `g.muzzle` do viewmodel (vm.camera → NDC → unproject na
    câmera da cena a ~0,5 m). Mirando ou com luneta, começar no raio da visão ~0,7 m à frente. Na 3ª pessoa, usar a
    boca da arma do boneco.
13. **3ª pessoa erra à esquerda da mira** (`scene.ts:2084-2093`, `game.ts:444-446`). O raio sai do olho, mas a mira
    está na câmera 0,45 m à direita e com raios paralelos, então o tiro sempre cai ~0,45 m à esquerda do centro.
    Correção: raio da câmera pelo centro até a primeira caixa/alvo, que vira o ponto de mira, e tiro do olho até esse
    ponto.
14. **Sem clarão no mundo e sem reação no alvo** (`juice.ts`, sem `case 'gunshot'`). Bots, outras pessoas e eu na 3ª
    pessoa atiramos sem clarão. Alvo atingido só solta um borrifo, sem brilho nem tranco. Correção: em `gunshot`,
    clarão aditivo de ~40 ms na boca da arma do avatar de quem atirou. Em `impact` de carne, `juice.flash(material,
    80)` e um tranco curto do tronco (não o clipe `Hit_Chest` inteiro, que trava em rajada).
15. **Slide na 3ª pessoa** (`avatar.ts:87, 532-543`; `movement.ts:19`). Ele reaproveita o carrinho do futebol
    (`a=15`, 650 ms), mas o slide dura 750 ms: nos últimos 100 ms o boneco fica sentado no ar
    (`v_teo/f00041-43`). A arma também fica no peito enquanto o corpo deita. Correção: duração própria do gunfight
    (`MOVE.slideMs`) ou um `a` novo, com a arma presa ao corpo inclinado.
16. **Corte da faca** (`viewmodel.ts:279-290`). `hump(u,0,0.12,0.12,0.22)` tem b=c, então a antecipação some num
    quadro (salto). Ela também dura só 54 ms, curta demais para ler. O golpe com `s=-1` vai para fora da tela à direita
    e não cruza o centro (`kn_slash.jpg`). Correção: antecipação de 80–110 ms (`hump(u,0,0.16,0.18,0.28)`) e um arco
    que sempre passa perto da mira, nos dois lados.
17. **Baioneta: a mão fecha acima do cabo** (`viewmodel.ts:410-414`). Os dedos apontam para +y a partir de y=0,055, e
    o centro dos dedos fechados fica ~7 cm acima do eixo do cabo (close `hand_ak47_melee_R.jpg`). Correção: raiz da
    mão em ~(0,02, −0,07, 0), com o eixo do cabo passando pelos dedos fechados.
18. **Karambit: o indicador não passa pela argola** (`viewmodel.ts:403-408`). A argola fica acima do punho fechado
    (close `hand_*_melee_R.jpg`). Correção: subir a mão ~2,5 cm ou descer a argola até o indicador.
19. **Recuo só como giro permanente da câmera** (`game.ts:467-470`). A sniper sobe 0,06 rad por tiro, o que tira o alvo
    da luneta 4x, e não tem "punch" que volta. Na luneta não há tranco nenhum. Correção: separar um punch visual (só
    câmera, volta em 120–200 ms) de uma subida menor e permanente da mira, e dar um tranco na tela da luneta.
20. **Arma invisível na 3ª pessoa vista do ombro** (`avatar.ts:841-844`). No quadril ela fica na frente do peito,
    escondida pelo corpo (`m_third.jpg`, `v_teo/f00030`). Correção: coronha no ombro direito (x≈−0,14, y≈0,95,
    z≈0,05), cano para a frente, para aparecer por trás.

### Baixa
21. O viewmodel ignora "reduzir movimento" (passo, balanço, inclinação do slide, giro do saque). Correção: passar o
    `reducedMotion` da cena e escalar tudo por ~0,3.
22. `viewmodel.ts:162-172` aloca `Vector3`/`Euler` a cada quadro. Correção: usar temporários do módulo, como no
    `avatar.ts`.
23. A pistola no quadril fica baixa e as duas mãos quase saem da tela (`a_deagle.jpg`). Correção: hip
    `(0.11, −0.105, −0.31)`.
24. As lâminas viram uma mancha branca: metal sem mapa de ambiente. Correção: cor mais escura e roughness ~0,45
    (ou um envMap simples).
25. O traçante é uma `Line` de 1 px parada por 60 ms. Correção: um traço curto que anda (~2 quadros) ou um quad fino
    aditivo.

## O que está certo (não mexer)
Saque com tranco no fim, coice com mola, ferrolho da pistola indo e voltando, tranco nos encaixes da recarga, faca
alternando lados, giro do karambit no inspecionar, clarão da 1ª pessoa, mira que abre com a dispersão, luneta com
retículo próprio, agachar na 3ª pessoa (pernas).

# Revisão do gunfight — rodada 3 (Caio, engenharia e rede) — 2026-11-09

Só leitura e medição: não mexi em nenhum código do app. Checks em `apps/desktop`: prettier ok, `tsc --noEmit` ok,
`eslint src test` ok, `vitest run` 69 arquivos / 477 testes ok (saídas em `scratchpad/caio-r5/*.txt`).

Sondas em `scratchpad/caio-r5/page/` (SpaceScene de verdade, relógio falso, swiftshader, porta 5455):
`perf.cjs` (chamadas de desenho e memória), `leak.cjs` e `leak2.cjs` (o que sobra depois de liberar), `act.cjs`
(quando a pose leva a ação).

## Conferido da rodada 2 (ficou bom)
- O balde de acertos funciona. `restart`, `die` e `spawn` só valem de quem está na arena, e o `restart` só vale com
  `canRestart`. `die` e `restart` vão com buffer. O servidor separa os baldes de tiro e de evento. A mola do recuo
  roda em subpassos. A recarga bloqueia a mira, a visão livre está desligada na zona 8 e `dispose()` libera o
  gunfight.
- `shoulderCam` está correta: o ombro é testado antes do raio de trás, sem mínimo e sem passar do chão. As paredes de
  fora estão em `GUN_BOXES`.
- As molas do viewmodel (kick k=170, jolt k=260) ficam estáveis com o dt máximo de 0,05 s.
- **Desempenho com 6 bots no Difícil:** 34–104 chamadas de desenho na 1ª pessoa e 27–110 na 3ª (sem bots, 24–32).
  Fica longe da meta de 300.
- **Texturas:** param em 12, e 6 mortes e renasceres não deixam nada sobrando.
- **6 bots por 90 s:** nenhum bot travado, o placar fecha (22/8, 19/7, …), `pending` = 0 e nenhum erro na página.

## Problemas (do mais grave ao menos)

### MÉDIA
1. **Recarga, golpe e ferrolho chegam até 1 s atrasados para quem vê** (`scene.ts`, `gunPoseKey`). A chave não
   inclui `act`/`an`. Parado, o `maybeSend` só manda a pose no envio de 1 s. Na medição, a recarga começou em 1320 ms
   e a pose com `act: 'reload'` só saiu em 2112 ms (792 ms depois). Para o outro, o boneco recarrega quase 1 s
   atrasado, e uma facada parado aparece depois do dano.
   **Correção:** pôr `${g.act}:${g.an}` na chave (ou mandar na hora quando o `an` mudar). **Teste:** a pose sai no
   próximo quadro depois de `press('reload')` parado.
2. **A sombra do boneco nunca é liberada** (`avatar.ts`: a `CircleGeometry` e o `MeshBasicMaterial` do construtor
   ficam fora do `dispose`). Cada boneco liberado deixa 1 geometria e 1 material para trás. Isso conta para os bots
   do gunfight, o bot dos outros jogos e cada pessoa que troca de zona (o boneco dela é recriado em todos os apps).
   Medido: pôr e tirar 6 bots 6 vezes leva as geometrias de 38 para 84 (+6 a cada vez, 1 por boneco); `leak2.cjs`
   aponta 24 malhas "Mesh<Group<Scene" depois de 4 ciclos.
   **Correção:** guardar a sombra e liberá-la no `dispose`, ou usar geometria e material do módulo, compartilhados por
   todos os bonecos. **Teste:** contar `geometry.dispose` com um espião no `Avatar.dispose`.

### BAIXA
3. **O "Recomeçar" local não confere `canRestart`** (`scene.ts` `restartGun` e `playZone(8)`, e
   `GunHud.tsx` `GunMatchPanel`). O botão decide por `others` (`counts[8]`, que vem do servidor e pode atrasar). Se
   alguém acabou de entrar, o clique zera só o meu placar e a minha pose publica 0/0, enquanto o outro recusa o
   `restart`: o placar fica dividido.
   **Correção:** `restartGun() { if (this.gun?.canRestart) this.gun.restart(); }` e mostrar o botão por um
   `canRestart` publicado no `useGunHud` (no lugar de `others`).
4. **Quem entra na tela do vencedor fica até 12 s parado** (`game.ts` `pushScores` e `step`). O app novo vê o `k`
   do vencedor na pose e marca `winnerAt = agora`. Quem já estava recomeça antes, e o app novo fica `over`: não atira,
   e o `hurt` ignora os acertos. O mesmo acontece, por menos tempo, com quem viu o vencedor depois.
   **Correção:** com `over`, se o vencedor publicar `k` abaixo de `FFA_TARGET` (ele já recomeçou), chamar
   `restart(now, false)` na hora.
5. **Os bots do gunfight recarregam sem animação** (`gunfight/bots.ts` `place`). O `gun` da `BotPose` não leva
   `act`/`an`, então o boneco fica 2–3 s com a arma parada e sem atirar.
   **Correção:** contador por bot, com `act: 'reload'` e `an++` quando `reloadUntil` começa.
6. **Bot baleado não reage mais rápido** (`gunfight/bots.ts`). O `hurt` adianta o `reactAt`, mas no `think`
   seguinte `!b.lastSeen` é verdadeiro e um `reactAt` novo, com o tempo de reação inteiro, sobrescreve o adiantado.
   **Correção:** marcar `b.alerted` no `hurt` e, no `think`, usar `Math.min` com o `reactAt` adiantado.
7. **O acerto recebido confia na arma que o remetente diz** (`game.ts` `hitPlausible`). Não confere `g.w` contra a
   arma da pose nem a distância nos golpes. Um "karambit" de 150 vale de qualquer distância, a cada 500 ms. É
   trapaça de cliente modificado, mas a checagem é barata.
   **Correção:**
   - `GunPlayer` passa a ter o `w` da pose, e só vale a arma da pose (ou trocada há menos de 1 s).
   - Faca e coronhada (`cls === 'knife'` ou `dmg` ≤ `BASH.dmg` com arma de fogo) exigem distância ≤ alcance + ~1,5 m,
     medida da posição desenhada.
8. **Testes que faltam:**
   - a chave da pose muda com `act`/`an` (item 1);
   - o `Avatar.dispose` libera todas as geometrias e materiais (item 2);
   - o `restartGun` é recusado sem `canRestart` (item 3);
   - o `over` sai quando o vencedor publica placar zerado (item 4);
   - o bot baleado reage antes do tempo normal (item 6).

## Não reabro
- Os pontos visuais da Rita (arma na 3ª pessoa, recarga vazia, pente da Desert Eagle, câmera da morte) estão fora do
  meu foco.
- O teste com 2 pessoas em máquinas e redes diferentes continua PENDENTE (não aprovado).
